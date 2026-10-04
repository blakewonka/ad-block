#!/usr/bin/env node
/*
 * prepare-package.mjs — the folder that goes into the Chrome / Edge zip.
 *
 *   node platforms/chromium/prepare-package.mjs --target <chromium|edge> --stage DIR --out DIR [--profile release|dev]
 *
 * STAGE (build/stage/<platform>, already checked by scripts/verify-stage.mjs) is
 * copied to OUT (default build/package/<target>; deleted first). Then, for the
 * default `release` profile, the two differences between an upstream *local*
 * build and an upstream *tagged* (store) build are applied, exactly as
 * upstream's tools/make-mv3.sh does for a tagged build:
 *
 *   1. delete rulesets/debug/          (debug copies of every ruleset, ~50 MB;
 *                                       upstream: `rm -rf "$UBOL_DIR/rulesets/debug"`)
 *   2. drop "declarativeNetRequestFeedback" from manifest.permissions
 *                                      (upstream adds it only to local builds:
 *                                       "Enable DNR rule debugging")
 *
 * Without that permission upstream's `isSideloaded` is false, so the
 * developer-only "matched rules" view and the debug log buffer are off, like
 * in the uBO Lite builds on the Chrome Web Store and Edge Add-ons.
 *
 * The `dev` profile copies STAGE unchanged (sideloaded debugging stays on).
 *
 * Afterwards OUT is compared with STAGE: every file must be byte-identical
 * except manifest.json (release only: it must equal the STAGE manifest minus
 * that one permission) and the deleted rulesets/debug/** files. Anything else
 * is an error and OUT is removed.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    BUILD, fail, isDir, isFile, isWithin, rel, runMain, sha256File, walk,
} from '../../scripts/lib/common.mjs';

const NAME = 'prepare-package';
const FEEDBACK = 'declarativeNetRequestFeedback';
const DEBUG_DIR = 'rulesets/debug';
const PROFILES = ['release', 'dev'];

function parseArgs(argv) {
    const o = { profile: 'release' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const v = argv[i + 1];
        if (a === '--target' && v) { o.target = v; i++; }
        else if (a === '--stage' && v) { o.stage = path.resolve(v); i++; }
        else if (a === '--out' && v) { o.out = path.resolve(v); i++; }
        else if (a === '--profile' && v) { o.profile = v; i++; }
        else fail(`unknown argument ${a} (usage: prepare-package.mjs --target <chromium|edge> --stage DIR [--out DIR] [--profile release|dev])`);
    }
    if (o.target !== 'chromium' && o.target !== 'edge') fail('--target must be chromium or edge');
    if (!o.stage) fail('--stage is required');
    if (!PROFILES.includes(o.profile)) fail(`--profile must be one of ${PROFILES.join(', ')}`);
    o.out ??= path.join(BUILD, 'package', o.target);
    return o;
}

function copyTree(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (process.platform === 'darwin') {
        const r = spawnSync('/bin/cp', ['-cR', src, dst], { encoding: 'utf8' });
        if (r.status === 0) return;
        fs.rmSync(dst, { recursive: true, force: true });
    }
    fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
}

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/** The release manifest: STAGE manifest without the feedback permission (key order kept). */
function releaseManifest(stageManifest) {
    const m = structuredClone(stageManifest);
    if (Array.isArray(m.permissions)) {
        m.permissions = m.permissions.filter(p => p !== FEEDBACK);
    }
    return m;
}

function compare(stage, out, profile) {
    const s = walk(stage);
    const o = walk(out);
    const problems = [];
    const isDebug = p => p === DEBUG_DIR || p.startsWith(`${DEBUG_DIR}/`);
    for (const [p, info] of o) {
        if (info.kind !== 'file') { problems.push(`${p}: not a regular file (${info.kind})`); continue; }
        if (!s.has(p)) { problems.push(`${p}: not in STAGE`); continue; }
        if (p === 'manifest.json' && profile === 'release') continue;
        if (sha256File(info.abs) !== sha256File(s.get(p).abs)) problems.push(`${p}: differs from STAGE`);
    }
    let removed = 0;
    for (const p of s.keys()) {
        if (o.has(p) || path.posix.basename(p) === '.DS_Store') continue;
        if (profile === 'release' && isDebug(p)) { removed += 1; continue; }
        problems.push(`${p}: missing from the package folder`);
    }
    if (profile === 'release') {
        const want = releaseManifest(readJson(path.join(stage, 'manifest.json')));
        const got = readJson(path.join(out, 'manifest.json'));
        if (JSON.stringify(want) !== JSON.stringify(got)) problems.push('manifest.json: not the STAGE manifest minus the feedback permission');
        if (isDir(path.join(out, DEBUG_DIR))) problems.push(`${DEBUG_DIR}/ still exists`);
    }
    return { problems, removed, files: o.size };
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (!isFile(path.join(o.stage, 'manifest.json'))) fail(`STAGE has no manifest.json: ${rel(o.stage)}`);
    const okOut = isWithin(o.out, path.join(BUILD, 'package')) && path.resolve(o.out) !== path.resolve(BUILD, 'package');
    const okTmp = [os.tmpdir(), '/private/tmp', '/tmp'].some(t => isWithin(o.out, t) && path.resolve(o.out) !== path.resolve(t));
    if (!okOut && !okTmp) fail(`refusing to use OUT=${o.out}: it must be inside ${rel(path.join(BUILD, 'package'))}/ (or a temp folder for tests)`);
    if (isWithin(o.out, o.stage) || isWithin(o.stage, o.out)) fail('OUT and STAGE overlap');

    console.log(`${NAME}: target ${o.target}, profile ${o.profile}`);
    console.log(`${NAME}: STAGE ${rel(o.stage)} -> ${rel(o.out)}`);
    fs.rmSync(o.out, { recursive: true, force: true });
    try {
        copyTree(o.stage, o.out);
        // Finder litter never belongs in a store package.
        for (const [p, info] of walk(o.out)) {
            if (path.posix.basename(p) === '.DS_Store') fs.rmSync(info.abs);
        }
        if (o.profile === 'release') {
            const debug = path.join(o.out, DEBUG_DIR);
            if (isDir(debug)) {
                fs.rmSync(debug, { recursive: true });
                console.log(`${NAME}: removed ${DEBUG_DIR}/ (upstream tagged builds do the same)`);
            } else {
                console.log(`${NAME}: no ${DEBUG_DIR}/ in STAGE (nothing to remove)`);
            }
            const mf = path.join(o.out, 'manifest.json');
            const before = readJson(mf);
            const after = releaseManifest(before);
            if ((before.permissions ?? []).includes(FEEDBACK)) {
                fs.writeFileSync(mf, `${JSON.stringify(after, null, 2)}\n`);
                console.log(`${NAME}: removed the "${FEEDBACK}" permission (local-build only upstream)`);
            } else {
                console.log(`${NAME}: manifest has no "${FEEDBACK}" permission (nothing to remove)`);
            }
        }
        const { problems, removed, files } = compare(o.stage, o.out, o.profile);
        if (problems.length !== 0) {
            for (const p of problems.slice(0, 40)) console.error(`${NAME}:   ${p}`);
            fail(`the package folder differs from STAGE in ${problems.length} unexpected way(s)`);
        }
        console.log(`${NAME}: ${files} file(s); identical to STAGE except ${o.profile === 'release' ? `manifest.json (-${FEEDBACK}) and ${removed} deleted ${DEBUG_DIR} file(s)` : 'nothing'}`);
    } catch (err) {
        fs.rmSync(o.out, { recursive: true, force: true });
        throw err;
    }
    return 0;
}

runMain(NAME, main);

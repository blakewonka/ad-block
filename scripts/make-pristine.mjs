#!/usr/bin/env node
/*
 * make-pristine.mjs — PRISTINE = the upstream build of one platform, renamed
 * to "Blocker". PRISTINE is the baseline the safety gate (verify-stage.mjs)
 * compares the staged extension against.
 *
 *   node scripts/make-pristine.mjs --platform <chromium|edge|firefox|safari> [--from DIR] [--out DIR]
 *
 *   --from DIR   upstream build output (default upstream/dist/build/uBOLite.<platform>)
 *   --out  DIR   PRISTINE folder (default build/pristine/<platform>, or BLOCKER_PRISTINE_DIR)
 *
 * Steps (always from scratch, so running it twice gives the same result):
 *   1. delete OUT, copy FROM -> OUT;
 *   2. every _locales/<l>/messages.json that has an `extName` key gets
 *      extName.message = "Blocker"; the file is re-serialised as
 *      JSON.stringify(json, null, 2) + "\n";
 *   3. manifest.json: short_name = "Blocker", same serialisation;
 *      firefox only: browser_specific_settings.gecko.id = the Blocker add-on id
 *      (platforms/firefox/gecko-id.mjs: BLOCKER_GECKO_ID, "geckoId" in
 *      signing.local.json, default blocker@example.org), because a fork must not
 *      reuse the upstream add-on id; and name "uBO Lite" (upstream's Firefox
 *      manifest has a literal name) -> "__MSG_extName__" like the other platforms.
 *      verify-stage.mjs accepts exactly these changes against the upstream build;
 *   4. check: every locale folder has extName "Blocker" (71 locales at the
 *      pinned upstream commit; another count is reported as a warning),
 *      manifest short_name is "Blocker" and manifest name is __MSG_extName__;
 *   5. write build/pristine/<platform>.json (version, upstream commit, locales).
 * FROM (the upstream tree) is only read. On failure OUT is removed.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveGeckoId } from '../platforms/firefox/gecko-id.mjs';
import {
    BUILD, UPSTREAM, cloneTree, fail, isDir, isFile, isWithin, pristineDir, rel, runMain, takePlatformArg, upstreamOut,
} from './lib/common.mjs';

const NAME = 'make-pristine';
const NEW_NAME = 'Blocker';
const EXPECTED_LOCALES = 71;

function parseArgs(argv) {
    const { platform, rest } = takePlatformArg(argv, undefined);
    const opts = { platform, from: upstreamOut(platform), out: pristineDir(platform) };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--from' && rest[i + 1]) opts.from = path.resolve(rest[++i]);
        else if (a === '--out' && rest[i + 1]) opts.out = path.resolve(rest[++i]);
        else fail(`unknown argument ${a} (usage: make-pristine.mjs --platform <p> [--from DIR] [--out DIR])`);
    }
    return opts;
}

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, j) => fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);

function rename(out, platform) {
    const localesDir = path.join(out, '_locales');
    if (!isDir(localesDir)) fail(`${rel(localesDir)} does not exist`);
    const locales = fs.readdirSync(localesDir).filter(n => isDir(path.join(localesDir, n))).sort();
    let renamed = 0;
    for (const l of locales) {
        const f = path.join(localesDir, l, 'messages.json');
        if (!isFile(f)) fail(`${rel(f)} is missing`);
        const j = readJson(f);
        if (j.extName) {
            j.extName.message = NEW_NAME;
            writeJson(f, j);
            renamed += 1;
        }
    }
    const mf = path.join(out, 'manifest.json');
    if (!isFile(mf)) fail(`${rel(mf)} is missing`);
    const m = readJson(mf);
    m.short_name = NEW_NAME;
    let gecko = null;
    if (platform === 'firefox') {
        // A fork must not reuse the upstream add-on id (see platforms/firefox/gecko-id.mjs).
        gecko = resolveGeckoId();
        for (const w of gecko.warnings) console.warn(`${NAME}: WARNING: ${w}`);
        const bss = m.browser_specific_settings;
        if (bss === null || typeof bss !== 'object' || bss.gecko === null || typeof bss.gecko !== 'object') {
            fail('firefox manifest has no browser_specific_settings.gecko object');
        }
        console.log(`${NAME}: gecko.id ${JSON.stringify(bss.gecko.id)} -> ${JSON.stringify(gecko.id)} (${gecko.source})`);
        bss.gecko.id = gecko.id;
        if (m.name !== '__MSG_extName__') {
            console.log(`${NAME}: name ${JSON.stringify(m.name)} -> "__MSG_extName__"`);
            m.name = '__MSG_extName__';
        }
    }
    writeJson(mf, m);
    return { locales, renamed, geckoId: gecko?.id };
}

function check(out, locales) {
    const bad = [];
    for (const l of locales) {
        const j = readJson(path.join(out, '_locales', l, 'messages.json'));
        if (j.extName?.message !== NEW_NAME) bad.push(l);
    }
    if (bad.length !== 0) fail(`locale(s) without extName "${NEW_NAME}": ${bad.join(', ')}`);
    const m = readJson(path.join(out, 'manifest.json'));
    if (m.short_name !== NEW_NAME) fail(`manifest short_name is ${JSON.stringify(m.short_name)}`);
    if (m.name !== '__MSG_extName__') {
        console.warn(`${NAME}: WARNING: manifest name is ${JSON.stringify(m.name)}, not __MSG_extName__ (the store name may not read "${NEW_NAME}")`);
    }
    return m;
}

function upstreamCommit() {
    const r = spawnSync('git', ['-C', UPSTREAM, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const { platform, from, out } = opts;
    const t0 = Date.now();

    if (!isDir(from)) fail(`upstream build not found: ${rel(from)} (run scripts/upstream-build.sh ${platform})`);
    for (const f of ['manifest.json', 'popup.html', 'dashboard.html', '_locales']) {
        if (!fs.existsSync(path.join(from, f))) fail(`${rel(from)} is missing ${f}; not an upstream uBO Lite build`);
    }
    // OUT is deleted recursively: only inside build/ (or a temp folder for tests), never overlapping FROM.
    const okParent = [BUILD, '/private/tmp', '/tmp', process.env.TMPDIR].filter(Boolean)
        .some(p => isWithin(out, p) && path.resolve(out) !== path.resolve(p));
    if (!okParent) fail(`refusing to write PRISTINE to ${out}: it must be inside ${rel(BUILD)}/ (or a temp folder)`);
    if (isWithin(out, from) || isWithin(from, out)) fail(`--out ${out} overlaps --from ${from}`);
    if (isWithin(out, UPSTREAM)) fail(`refusing to write inside the upstream submodule (${out})`);

    console.log(`${NAME}: platform ${platform}`);
    console.log(`${NAME}: from ${rel(from)}`);
    console.log(`${NAME}: to   ${rel(out)}`);

    fs.rmSync(out, { recursive: true, force: true });
    try {
        console.log(`${NAME}: copied with ${cloneTree(from, out)}`);
        const { locales, renamed, geckoId } = rename(out, platform);
        const m = check(out, locales);
        console.log(`${NAME}: extName -> "${NEW_NAME}" in ${renamed}/${locales.length} locales; manifest short_name -> "${NEW_NAME}"`);
        if (locales.length !== EXPECTED_LOCALES) {
            console.warn(`${NAME}: WARNING: ${locales.length} locales, expected ${EXPECTED_LOCALES} at the pinned upstream commit (all of them are renamed)`);
        }
        const meta = {
            platform,
            version: m.version,
            upstreamCommit: upstreamCommit(),
            locales: locales.length,
            ...(geckoId !== undefined ? { geckoId } : {}),
            createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(path.dirname(out), `${path.basename(out)}.json`), `${JSON.stringify(meta, null, 2)}\n`);
        console.log(`${NAME}: version ${m.version}; done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
        fs.rmSync(out, { recursive: true, force: true });
        console.error(`${NAME}: failed; removed ${rel(out)}`);
        throw err;
    }
    return 0;
}

runMain(NAME, main);

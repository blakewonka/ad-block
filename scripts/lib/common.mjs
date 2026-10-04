/*
 * Shared helpers for the build pipeline (scripts/*.mjs, platforms/<p>/*.mjs).
 *
 * Every path is derived from this file's location, so the scripts work from
 * any working directory.
 *
 *   REPO       repository root
 *   UI         REPO/ui                      the web UI project (npm)
 *   UPSTREAM   REPO/upstream                gorhill/uBlock (git submodule, never edited)
 *   BUILD      REPO/build                   everything generated (gitignored)
 *   UI_DIST    REPO/ui/dist                 output of `npm --prefix ui run build`
 *   OUT_DIST   REPO/dist                    final packages (zip / xpi / zipped .app)
 *   ICONS      REPO/assets/icons            editable icons: extension/, app/, app-window/
 *
 * Per platform (chromium | edge | firefox | safari):
 *   upstreamOut(p)  UPSTREAM/dist/build/uBOLite.<p>   raw upstream build
 *   pristineDir(p)  BUILD/pristine/<p>                upstream build + "Blocker" rename (the baseline)
 *   stageDir(p)     BUILD/stage/<p>                   PRISTINE + our UI overlay
 *
 * Environment overrides (tests and special builds only):
 *   BLOCKER_PRISTINE_DIR   replaces pristineDir(p)
 *   BLOCKER_STAGE_DIR      replaces stageDir(p)
 *   BLOCKER_UI_DIST_DIR    replaces UI_DIST
 *   BLOCKER_OUT_DIR        replaces OUT_DIST
 *   BLOCKER_ICONS_DIR      replaces ICONS; the value "none" disables every icon override
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const UI = path.join(REPO, 'ui');
export const UPSTREAM = path.join(REPO, 'upstream');
export const BUILD = path.join(REPO, 'build');

function envDir(name, fallback) {
    const v = process.env[name];
    return v && v.trim() !== '' ? path.resolve(v) : fallback;
}

export const UI_DIST = envDir('BLOCKER_UI_DIST_DIR', path.join(UI, 'dist'));
export const OUT_DIST = envDir('BLOCKER_OUT_DIR', path.join(REPO, 'dist'));

/** Icons folder, or null when overrides are disabled (BLOCKER_ICONS_DIR=none). */
export const ICONS = (() => {
    const v = process.env.BLOCKER_ICONS_DIR;
    if (v !== undefined && v.trim().toLowerCase() === 'none') return null;
    return envDir('BLOCKER_ICONS_DIR', path.join(REPO, 'assets', 'icons'));
})();
/** Folder whose files may replace same-named files in STAGE/img/ (null = none). */
export const EXTENSION_ICONS = ICONS === null ? null : path.join(ICONS, 'extension');

/** Upstream build platforms (`make -C upstream dist/build/uBOLite.<p>`). */
export const PLATFORMS = ['chromium', 'edge', 'firefox', 'safari'];
/** Build targets of scripts/build.sh and the platform each one is built from. */
export const TARGETS = {
    'chromium': 'chromium',
    'edge': 'edge',
    'firefox': 'firefox',
    'safari-macos': 'safari',
    'safari-ios': 'safari',
};

export function upstreamOut(platform) {
    return path.join(UPSTREAM, 'dist', 'build', `uBOLite.${platform}`);
}
export function pristineDir(platform) {
    return envDir('BLOCKER_PRISTINE_DIR', path.join(BUILD, 'pristine', platform));
}
export function stageDir(platform) {
    return envDir('BLOCKER_STAGE_DIR', path.join(BUILD, 'stage', platform));
}

/**
 * Reads `--platform <p>` (or `--platform=<p>`) from argv, falling back to
 * BLOCKER_PLATFORM and then to `fallback`. Accepts a build target name too
 * (safari-macos -> safari). Returns { platform, rest } where rest is argv
 * without the option.
 */
export function takePlatformArg(argv, fallback = 'safari') {
    const rest = [];
    let value;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--platform') {
            if (argv[i + 1] === undefined) fail('--platform needs a value');
            value = argv[++i];
        } else if (a.startsWith('--platform=')) {
            value = a.slice('--platform='.length);
        } else {
            rest.push(a);
        }
    }
    value ??= process.env.BLOCKER_PLATFORM || fallback;
    const platform = TARGETS[value] ?? value;
    if (!PLATFORMS.includes(platform)) {
        fail(`unknown platform ${JSON.stringify(value)} (expected one of ${PLATFORMS.join(', ')} or a target ${Object.keys(TARGETS).join(', ')})`);
    }
    return { platform, rest };
}

/** `a` equals `b` or lies inside it. */
export function isWithin(a, b) {
    const r = path.relative(path.resolve(b), path.resolve(a));
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

export class PipelineError extends Error {}

export function fail(msg) {
    throw new PipelineError(msg);
}

/** Run `main` and turn PipelineError into a clean message + exit code 1. */
export async function runMain(name, main) {
    try {
        const code = await main();
        process.exitCode = typeof code === 'number' ? code : 0;
    } catch (err) {
        if (err instanceof PipelineError) {
            console.error(`${name}: ERROR: ${err.message}`);
        } else {
            console.error(`${name}: unexpected error`);
            console.error(err);
        }
        process.exitCode = 1;
    }
}

export function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Walk a tree without following symlinks. Returns a Map of POSIX relative
 * path -> { kind: 'file' | 'symlink' | 'other', abs }. Directories are not
 * listed; pass a Set as `dirs` to collect their relative paths too.
 */
export function walk(rootDir, dirs = null) {
    const out = new Map();
    const stack = [''];
    while (stack.length !== 0) {
        const r = stack.pop();
        const abs = r === '' ? rootDir : path.join(rootDir, r);
        for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
            const childRel = r === '' ? ent.name : `${r}/${ent.name}`;
            const childAbs = path.join(abs, ent.name);
            if (ent.isDirectory()) {
                stack.push(childRel);
                if (dirs !== null) dirs.add(childRel);
            } else if (ent.isFile()) {
                out.set(childRel, { kind: 'file', abs: childAbs });
            } else if (ent.isSymbolicLink()) {
                out.set(childRel, { kind: 'symlink', abs: childAbs });
            } else {
                out.set(childRel, { kind: 'other', abs: childAbs });
            }
        }
    }
    return out;
}

export function sha256File(abs) {
    return createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

/** Path relative to the repository (or absolute when outside it), for messages. */
export function rel(p) {
    const r = path.relative(REPO, p);
    return r === '' ? '.' : r.startsWith('..') || path.isAbsolute(r) ? p : r;
}

/** Copy a tree: APFS clone (`cp -cR`) on macOS when possible, else fs.cpSync. */
export function cloneTree(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (process.platform === 'darwin') {
        const { status } = spawnSync('/bin/cp', ['-cR', src, dst], { encoding: 'utf8' });
        if (status === 0) return 'APFS clone (cp -cR)';
        fs.rmSync(dst, { recursive: true, force: true });
    }
    fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    return 'normal copy (fs.cpSync)';
}

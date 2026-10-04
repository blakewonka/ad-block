#!/usr/bin/env node
/*
 * stage.mjs — STAGE = PRISTINE + the Blocker UI overlay, for one platform.
 *
 *   node scripts/stage.mjs --platform <chromium|edge|firefox|safari> [--pristine DIR] [--stage DIR]
 *
 *   default PRISTINE build/pristine/<platform>   (BLOCKER_PRISTINE_DIR)
 *   default STAGE    build/stage/<platform>      (BLOCKER_STAGE_DIR)
 *   UI build output  ui/dist                     (BLOCKER_UI_DIST_DIR)
 *   icons            assets/icons/extension      (BLOCKER_ICONS_DIR=<dir with extension/> or "none")
 *
 * Every run starts from scratch:
 *   1. check the inputs (PRISTINE and ui/dist/extension) before touching anything;
 *   2. delete STAGE;
 *   3. copy PRISTINE -> STAGE (APFS clone `cp -cR`, else a normal copy);
 *   4. rename popup.html -> popup-classic.html, dashboard.html -> dashboard-classic.html;
 *   5. copy ui/dist/extension/{popup.html,dashboard.html,ui/} in;
 *   6. replace css/default.css with ui/dist/legacy/default.css (if it exists;
 *      otherwise, or when BLOCKER_SKIP_LEGACY_CSS=1, keep the pristine one and
 *      print a warning);
 *   7. delete log.txt. rulesets/debug is left alone;
 *   8. copy each file of assets/icons/extension/ over the same-named existing
 *      file in STAGE/img/ (verify-stage accepts img/<name> only when it is
 *      byte-identical to that file).
 * On any failure (including bad inputs) STAGE is removed, so a stale or half-built
 * folder can never be packaged. PRISTINE is only ever read.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    BUILD, EXTENSION_ICONS, OUT_DIST, UI, UI_DIST, UPSTREAM,
    cloneTree, fail, isDir, isFile, isWithin, pristineDir, rel, runMain, stageDir, takePlatformArg, walk,
} from './lib/common.mjs';

const NAME = 'stage';
const EXT_OUT = path.join(UI_DIST, 'extension');
const LEGACY_CSS = path.join(UI_DIST, 'legacy', 'default.css');
/** The only top-level entries `npm run build:ext` may produce. */
const EXT_ALLOWED_TOP = new Set(['popup.html', 'dashboard.html', 'ui']);
const IGNORED_NAMES = new Set(['.DS_Store']);

function parseArgs(argv) {
    const { platform, rest } = takePlatformArg(argv);
    const opts = { platform, pristine: pristineDir(platform), stage: stageDir(platform) };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--pristine' && rest[i + 1]) opts.pristine = path.resolve(rest[++i]);
        else if (a === '--stage' && rest[i + 1]) opts.stage = path.resolve(rest[++i]);
        else fail(`unknown argument ${a} (usage: stage.mjs --platform <p> [--pristine DIR] [--stage DIR])`);
    }
    return opts;
}

function checkStageLocation(STAGE, PRISTINE) {
    // STAGE gets deleted recursively: make sure it can only be a folder we own.
    const allowedParents = [path.join(BUILD, 'stage'), os.tmpdir(), '/private/tmp', '/tmp'];
    const okParent = allowedParents.some(p => isWithin(STAGE, p) && path.resolve(STAGE) !== path.resolve(p));
    if (!okParent) {
        fail(`refusing to use STAGE=${STAGE}: it must be inside ${rel(path.join(BUILD, 'stage'))}/ (or a temp folder for tests)`);
    }
    for (const forbidden of [PRISTINE, path.join(BUILD, 'pristine'), UPSTREAM, OUT_DIST, UI_DIST, path.join(UI, 'src')]) {
        if (isWithin(STAGE, forbidden) || isWithin(forbidden, STAGE)) {
            fail(`refusing to use STAGE=${STAGE}: it overlaps ${forbidden}`);
        }
    }
}

function checkInputs(PRISTINE, platform) {
    if (!isDir(PRISTINE)) fail(`PRISTINE not found: ${rel(PRISTINE)} (run scripts/build.sh, or scripts/make-pristine.mjs --platform ${platform})`);
    for (const f of ['manifest.json', 'popup.html', 'dashboard.html', 'css/default.css']) {
        if (!isFile(path.join(PRISTINE, f))) fail(`PRISTINE is missing ${f}: ${rel(PRISTINE)}`);
    }
    for (const f of ['popup-classic.html', 'dashboard-classic.html', 'ui']) {
        if (fs.existsSync(path.join(PRISTINE, f))) {
            fail(`PRISTINE already contains ${f}; it is not a clean upstream build (${rel(PRISTINE)})`);
        }
    }

    if (!isDir(EXT_OUT)) fail(`${rel(EXT_OUT)} does not exist; run \`npm --prefix ui run build\` first`);
    for (const f of ['popup.html', 'dashboard.html']) {
        if (!isFile(path.join(EXT_OUT, f))) {
            fail(`${rel(EXT_OUT)} is missing ${f}; run \`npm --prefix ui run build:ext\` (refusing to stage without both React entries)`);
        }
    }
    if (!isDir(path.join(EXT_OUT, 'ui'))) fail(`${rel(EXT_OUT)} is missing ui/; run \`npm --prefix ui run build:ext\``);
    const unexpected = fs.readdirSync(EXT_OUT).filter(n => !EXT_ALLOWED_TOP.has(n) && !IGNORED_NAMES.has(n));
    if (unexpected.length !== 0) {
        fail(`${rel(EXT_OUT)} contains unexpected entries: ${unexpected.join(', ')} (allowed: ${[...EXT_ALLOWED_TOP].join(', ')})`);
    }
    for (const [p, info] of walk(EXT_OUT)) {
        if (info.kind !== 'file') fail(`${rel(EXT_OUT)}/${p} is not a regular file (${info.kind})`);
    }
}

function copyFile(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // Never write through an existing entry (a clone is independent, but be strict).
    fs.rmSync(dst, { force: true });
    fs.copyFileSync(src, dst);
}

function applyIcons(STAGE) {
    if (EXTENSION_ICONS === null) {
        console.log(`${NAME}: icons: overrides disabled (BLOCKER_ICONS_DIR=none)`);
        return;
    }
    if (!isDir(EXTENSION_ICONS)) {
        console.warn(`${NAME}: icons: ${rel(EXTENSION_ICONS)} does not exist; keeping the upstream icons`);
        return;
    }
    let replaced = 0;
    for (const name of fs.readdirSync(EXTENSION_ICONS).sort()) {
        if (IGNORED_NAMES.has(name) || name.startsWith('.')) continue;
        const src = path.join(EXTENSION_ICONS, name);
        if (!isFile(src)) continue;
        const dst = path.join(STAGE, 'img', name);
        if (!isFile(dst)) {
            console.warn(`${NAME}: icons: ignoring ${name} (no img/${name} in this platform's extension)`);
            continue;
        }
        if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) {
            copyFile(src, dst);
            replaced += 1;
        }
    }
    console.log(`${NAME}: icons: ${replaced} file(s) in img/ replaced from ${rel(EXTENSION_ICONS)}`);
}

async function main() {
    const { platform, pristine: PRISTINE, stage: STAGE } = parseArgs(process.argv.slice(2));
    const t0 = Date.now();
    checkStageLocation(STAGE, PRISTINE);
    try {
        checkInputs(PRISTINE, platform);
    } catch (err) {
        // Never leave an older STAGE behind that no longer matches the inputs.
        if (fs.existsSync(STAGE)) {
            fs.rmSync(STAGE, { recursive: true, force: true });
            console.error(`${NAME}: removed the previous STAGE (${rel(STAGE)})`);
        }
        throw err;
    }

    console.log(`${NAME}: platform ${platform}`);
    console.log(`${NAME}: PRISTINE ${rel(PRISTINE)}`);
    console.log(`${NAME}: STAGE    ${rel(STAGE)}`);

    fs.rmSync(STAGE, { recursive: true, force: true });
    if (fs.existsSync(STAGE)) fail(`could not delete ${STAGE}`);

    try {
        console.log(`${NAME}: copied PRISTINE -> STAGE with ${cloneTree(PRISTINE, STAGE)}`);

        fs.renameSync(path.join(STAGE, 'popup.html'), path.join(STAGE, 'popup-classic.html'));
        fs.renameSync(path.join(STAGE, 'dashboard.html'), path.join(STAGE, 'dashboard-classic.html'));
        console.log(`${NAME}: renamed popup.html -> popup-classic.html, dashboard.html -> dashboard-classic.html`);

        let n = 0;
        for (const [p, info] of walk(EXT_OUT)) {
            if (IGNORED_NAMES.has(path.posix.basename(p))) continue;
            copyFile(info.abs, path.join(STAGE, p));
            n += 1;
        }
        console.log(`${NAME}: copied ${n} file(s) from ${rel(EXT_OUT)}`);

        if (process.env.BLOCKER_SKIP_LEGACY_CSS === '1') {
            console.warn(`${NAME}: WARNING: BLOCKER_SKIP_LEGACY_CSS=1 (legacy CSS build failed or was skipped); keeping the pristine css/default.css`);
        } else if (isFile(LEGACY_CSS)) {
            copyFile(LEGACY_CSS, path.join(STAGE, 'css', 'default.css'));
            console.log(`${NAME}: replaced css/default.css with ${rel(LEGACY_CSS)}`);
        } else {
            console.warn(`${NAME}: WARNING: ${rel(LEGACY_CSS)} not found (run \`npm --prefix ui run build:legacy-css\`); keeping the pristine css/default.css`);
        }

        applyIcons(STAGE);

        const log = path.join(STAGE, 'log.txt');
        if (fs.existsSync(log)) {
            fs.rmSync(log);
            console.log(`${NAME}: deleted log.txt`);
        } else {
            console.warn(`${NAME}: warning: PRISTINE has no log.txt (nothing to delete)`);
        }
    } catch (err) {
        fs.rmSync(STAGE, { recursive: true, force: true });
        console.error(`${NAME}: failed; removed the partial STAGE`);
        throw err;
    }

    console.log(`${NAME}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s. Next: node scripts/verify-stage.mjs --platform ${platform}`);
    return 0;
}

runMain(NAME, main);

#!/usr/bin/env node
/*
 * install-container.mjs — copy our container-app page over the files the
 * converter generated. Run it AFTER the converter.
 *
 *   node platforms/safari/install-container.mjs --project-dir DIR [--variant macos|ios]
 *        [--app-dir REL] [--from DIR]
 *
 *   --project-dir DIR   the converter's --project-location (e.g. build/xcode/safari-macos)
 *   --variant V         macos (default): the React page built by `npm --prefix ui run build:container`;
 *                       ios: the static page in platforms/safari/ios-container (see below)
 *   --app-dir REL       folder of the app target inside the project (default Blocker/Blocker,
 *                       the converter's layout for a single-platform project)
 *   --from DIR          page folder (default ui/dist/container, or platforms/safari/ios-container)
 *
 * macos copies (same relative layout on both sides):
 *   ui/dist/container/Base.lproj/Main.html -> DIR/<app-dir>/Resources/Base.lproj/Main.html
 *   ui/dist/container/Script.js            -> DIR/<app-dir>/Resources/Script.js
 *   ui/dist/container/Style.css            -> DIR/<app-dir>/Resources/Style.css
 *
 * ios copies Base.lproj/Main.html and Style.css only. The converter's iOS
 * template has no Script.js and its ViewController neither calls show() nor
 * handles the "open-preferences" message (an iOS app cannot open Safari's
 * extension settings), so the macOS page would show a dead button and an
 * "unknown" status forever. The iOS page is static HTML + CSS that explains
 * where to turn the extension on; it must contain no <script> at all.
 *
 * Refuses to run unless all destination files already exist (i.e. the
 * converter has generated the project) and the project file lists them, so a
 * file name the Xcode project does not know is never added. Only these
 * files are written; Icon.png and everything else stay as generated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_DIST, fail, isDir, isFile, runMain, sha256File } from '../../scripts/lib/common.mjs';

const NAME = 'install-container';
const APP_NAME = 'Blocker';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VARIANTS = {
    macos: { files: ['Base.lproj/Main.html', 'Script.js', 'Style.css'], from: () => path.join(UI_DIST, 'container'), check: checkSource },
    ios: { files: ['Base.lproj/Main.html', 'Style.css'], from: () => path.join(HERE, 'ios-container'), check: checkIosSource },
};
let FILES = VARIANTS.macos.files;

/** The static iOS page: template CSP kept, no script of any kind, nothing remote. */
function checkIosSource(src) {
    for (const f of FILES) {
        if (!isFile(path.join(src, f))) fail(`${path.join(src, f)} missing`);
    }
    const html = fs.readFileSync(path.join(src, 'Base.lproj/Main.html'), 'utf8');
    const css = fs.readFileSync(path.join(src, 'Style.css'), 'utf8');
    if (!/<meta\s+http-equiv="Content-Security-Policy"\s+content="default-src 'self'"\s*\/?>/i.test(html)) {
        fail('ios Main.html must keep the template\'s Content-Security-Policy meta tag (default-src \'self\')');
    }
    if (!/<link\s+rel="stylesheet"\s+href="\.\.\/Style\.css"\s*\/?>/i.test(html)) fail('ios Main.html does not load ../Style.css');
    if (/<script\b/i.test(html) || /\bon[a-z]+\s*=/i.test(html)) fail('ios Main.html must not contain scripts or inline event handlers');
    if (/\b(?:https?:)?\/\/[a-z0-9]/i.test(html.replace(/<!DOCTYPE[^>]*>/i, '')) || /\b(?:https?:)?\/\/[a-z0-9]/i.test(css)) {
        fail('ios page must not reference remote URLs');
    }
    if (/@import/i.test(css)) fail('ios Style.css must not use @import');
}

function checkSource(src) {
    for (const f of FILES) {
        if (!isFile(path.join(src, f))) fail(`${path.join(src, f)} missing; run \`npm --prefix ui run build:container\` first`);
    }
    // Same conventions the containerPage() build guard enforces; re-checked
    // here because these files go straight into the app bundle.
    const html = fs.readFileSync(path.join(src, 'Base.lproj/Main.html'), 'utf8');
    if (!/<meta\s+http-equiv="Content-Security-Policy"\s+content="default-src 'self'[^"]*"\s*\/?>/i.test(html)) {
        fail('dist Main.html lost the template\'s Content-Security-Policy meta tag');
    }
    if (!/<script\s+src="\.\.\/Script\.js"[^>]*><\/script>/i.test(html)) fail('dist Main.html does not load ../Script.js');
    if (!/<link\s+rel="stylesheet"\s+href="\.\.\/Style\.css"\s*\/?>/i.test(html)) fail('dist Main.html does not load ../Style.css');
    if (/type\s*=\s*"module"/i.test(html)) fail('dist Main.html uses type="module" (not allowed in the container window)');
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        if (m[1].trim() !== '') fail('dist Main.html contains an inline <script> (blocked by default-src \'self\')');
    }
    const js = fs.readFileSync(path.join(src, 'Script.js'), 'utf8');
    if (/cdn\.openai\.com/.test(js) || /cdn\.openai\.com/.test(fs.readFileSync(path.join(src, 'Style.css'), 'utf8'))) {
        fail('dist container bundle references cdn.openai.com');
    }
}

async function main() {
    const args = process.argv.slice(2);
    const opt = (name) => {
        const i = args.indexOf(name);
        return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
    };
    if (opt('--project-dir') === undefined) fail('--project-dir DIR is required');
    const variantName = opt('--variant') ?? 'macos';
    const variant = VARIANTS[variantName];
    if (variant === undefined) fail(`--variant must be one of ${Object.keys(VARIANTS).join(', ')}, got ${variantName}`);
    FILES = variant.files;
    const projectDir = path.resolve(opt('--project-dir'));
    const src = path.resolve(opt('--from') ?? variant.from());
    const dest = path.join(projectDir, opt('--app-dir') ?? path.join(APP_NAME, APP_NAME), 'Resources');
    const pbxproj = path.join(projectDir, APP_NAME, `${APP_NAME}.xcodeproj`, 'project.pbxproj');

    console.log(`${NAME}: variant ${variantName}`);
    console.log(`${NAME}: from ${src}`);
    console.log(`${NAME}: to   ${dest}`);
    if (!isDir(src)) fail(`${src} does not exist${variantName === 'macos' ? '; run `npm --prefix ui run build:container` first' : ''}`);
    variant.check(src);

    if (!isDir(dest)) fail(`${dest} does not exist; run the converter first (refusing to create it)`);
    const missing = FILES.filter(f => !isFile(path.join(dest, f)));
    if (missing.length !== 0) {
        fail(`destination files missing: ${missing.join(', ')} in ${dest}; run the converter first (refusing to create them)`);
    }
    if (!isFile(pbxproj)) fail(`${pbxproj} not found; run the converter first`);
    const proj = fs.readFileSync(pbxproj, 'utf8');
    for (const name of FILES.map(f => path.basename(f))) {
        if (!proj.includes(`/* ${name} in Resources */`) && !proj.includes(`/* ${name} */`)) {
            fail(`${pbxproj} does not list ${name}; the generated project layout changed`);
        }
    }

    for (const f of FILES) {
        const from = path.join(src, f);
        const to = path.join(dest, f);
        const before = sha256File(to);
        // Replace the file (no write-through into whatever the old entry was).
        const tmp = `${to}.tmp-${process.pid}`;
        fs.copyFileSync(from, tmp);
        fs.renameSync(tmp, to);
        const after = sha256File(to);
        if (after !== sha256File(from)) fail(`copy of ${f} does not match the source`);
        console.log(`${NAME}:   ${f.padEnd(20)} ${before === after ? 'unchanged' : `${before.slice(0, 12)} -> ${after.slice(0, 12)}`} (${fs.statSync(to).size} bytes)`);
    }
    console.log(`${NAME}: done`);
    return 0;
}

runMain(NAME, main);

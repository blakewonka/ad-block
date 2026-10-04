#!/usr/bin/env node
/*
 * selftest-verify-stage.mjs — proves the safety gate catches tampering.
 *
 *   node scripts/selftest-verify-stage.mjs --platform <chromium|edge|firefox|safari> [--tmp DIR]
 *
 * Needs a staged tree (scripts/build.sh <target> --ui-only, or
 * node scripts/stage.mjs --platform <p>). For every case it clones
 * STAGE into a throw-away folder (APFS clone where possible), applies one
 * tampering, runs verify-stage.mjs --json --stage <clone> and checks that it
 * fails with the expected rule. A first untouched clone must pass. STAGE and
 * PRISTINE are never written. Exit 0 = every case behaved as expected.
 *
 * Cases marked { pristine: true } also clone PRISTINE and apply the same
 * manifest edit to both clones (so check 4 still passes and check 4b, the
 * manifest provenance against the raw upstream build, must catch it). They are
 * skipped when the raw upstream build is missing or has another version.
 * Cases with { platforms: [...] } only run on those platforms.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, isDir, isFile, pristineDir, runMain, stageDir, takePlatformArg, upstreamOut, walk } from './lib/common.mjs';

const NAME = 'selftest-verify-stage';
const VERIFY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-stage.mjs');

function firstMatch(dir, re) {
    const hit = fs.readdirSync(dir).filter(n => re.test(n)).sort()[0];
    if (!hit) fail(`no file matching ${re} in ${dir}`);
    return path.join(dir, hit);
}
const append = (f, s) => fs.appendFileSync(f, s);
const edit = (f, fn) => fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8')));
const uiJs = d => firstMatch(path.join(d, 'ui'), /^popup-.*\.js$/);
const uiCss = d => firstMatch(path.join(d, 'ui'), /\.css$/);
/** A ruleset file: rulesets/main/*.json on most platforms, *.json at the root on Edge. */
function rulesetFile(d) {
    if (isDir(path.join(d, 'rulesets', 'main'))) return firstMatch(path.join(d, 'rulesets', 'main'), /\.json$/);
    const any = !isDir(path.join(d, 'rulesets')) ? undefined : [...walk(path.join(d, 'rulesets')).keys()].filter(p => p.endsWith('.json')).sort()[0];
    if (any) return path.join(d, 'rulesets', any);
    return firstMatch(d, /^(?!manifest\.json$).+\.json$/);
}
let PRISTINE;
const editJson = (f, fn) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`); };
/** Same manifest edit in the STAGE clone and the PRISTINE clone. */
const bothManifests = fn => (d, icons, p) => { editJson(path.join(d, 'manifest.json'), fn); editJson(path.join(p, 'manifest.json'), fn); };

const CASES = [
    ['untouched clone', null, d => { void d; }],
    ['flip one byte in a ruleset', 'modified', d => {
        const f = rulesetFile(d);
        const b = fs.readFileSync(f); b[b.length >> 1] ^= 1; fs.writeFileSync(f, b);
    }],
    ['inline <script> in popup.html', 'inline-script', d => edit(path.join(d, 'popup.html'), s => s.replace('</head>', '<script>console.log(1)</script></head>'))],
    ['cdn.openai.com URL in ui css', 'forbidden-content', d => append(uiCss(d), '\n.x{background:url(https://cdn.openai.com/a.png)}\n')],
    ['onclick handler in dashboard.html', 'inline-handler', d => edit(path.join(d, 'dashboard.html'), s => s.replace('<body', '<body onclick="x()"'))],
    ['style="" attribute in popup.html', 'inline-style', d => edit(path.join(d, 'popup.html'), s => s.replace('<body', '<body style="color:red"'))],
    ['javascript: URL in popup.html', 'inline-script', d => edit(path.join(d, 'popup.html'), s => s.replace('</body>', '<a href="javascript:void 0">x</a></body>'))],
    ['remote font in ui css', 'forbidden-content', d => append(uiCss(d), '\n@font-face{font-family:x;src:url("https://fonts.gstatic.com/x.woff2")}\n')],
    ['protocol-relative @import in ui css', 'forbidden-content', d => append(uiCss(d), '\n@import "//example.com/x.css";\n')],
    ['remote <script src> in popup.html', 'forbidden-content', d => edit(path.join(d, 'popup.html'), s => s.replace('</head>', '<script src="https://example.com/a.js"></script></head>'))],
    ['remote import() in ui js', 'forbidden-content', d => append(uiJs(d), '\nimport("https://example.com/m.js");\n')],
    ['eval( in ui js', 'forbidden-content', d => append(uiJs(d), '\nwindow.eval("1");\n')],
    ['new Function( in ui js', 'forbidden-content', d => append(uiJs(d), '\nnew Function("return 1");\n')],
    ['manifest.json changed', 'manifest', d => edit(path.join(d, 'manifest.json'), s => s.replace('"popup.html"', '"popup2.html"'))],
    ['popup-classic.html changed', 'classic-copy', d => append(path.join(d, 'popup-classic.html'), '\n')],
    ['extra file at the root', 'extra-file', d => fs.writeFileSync(path.join(d, 'extra.js'), '1')],
    ['extra file in js/', 'extra-file', d => fs.writeFileSync(path.join(d, 'js', 'evil.js'), '1')],
    ['empty folder added in lib/', 'extra-dir', d => fs.mkdirSync(path.join(d, 'lib', 'newdir'))],
    ['upstream file deleted', 'missing', d => fs.rmSync(path.join(d, 'js', 'background.js'))],
    ['log.txt not removed', 'not-removed', d => isFile(path.join(PRISTINE, 'log.txt'))
        ? fs.copyFileSync(path.join(PRISTINE, 'log.txt'), path.join(d, 'log.txt'))
        : fs.writeFileSync(path.join(d, 'log.txt'), 'x')],
    ['ui chunk missing (broken reference)', 'broken-ref', d => fs.rmSync(uiCss(d))],
    ['symlink in ui/', 'not-a-file', d => fs.symlinkSync('/etc/hosts', path.join(d, 'ui', 'link.js'))],
    ['popup.html is the upstream page', 'overlay-missing', d => fs.copyFileSync(path.join(PRISTINE, 'popup.html'), path.join(d, 'popup.html'))],
    ['remote .js URL string in ui js', 'forbidden-content', d => append(uiJs(d), '\nconst u="https://example.com/lib.js";\n')],
    ['img icon changed (not from assets)', 'modified', d => append(path.join(d, 'img', 'icon_16.png'), 'x')],
    // A custom icon is accepted only when it is byte-identical to <icons>/extension/<name>.
    ['img icon == custom icons file', null, (d, icons) => {
        const f = path.join(icons, 'extension', 'icon_16.png');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, Buffer.concat([fs.readFileSync(path.join(d, 'img', 'icon_16.png')), Buffer.from('custom')]));
        fs.copyFileSync(f, path.join(d, 'img', 'icon_16.png'));
    }, { icons: true }],
    ['img icon != custom icons file', 'modified', (d, icons) => {
        const f = path.join(icons, 'extension', 'icon_16.png');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'custom-a');
        fs.writeFileSync(path.join(d, 'img', 'icon_16.png'), 'custom-b');
    }, { icons: true }],
    // 4b: PRISTINE may differ from the upstream manifest only where make-pristine is allowed to change it.
    ['extra permission in PRISTINE manifest', 'pristine-manifest',
        bothManifests(m => { m.permissions = [...(m.permissions ?? []), 'tabs']; }), { pristine: true }],
    ['short_name not Blocker in PRISTINE', 'pristine-manifest',
        bothManifests(m => { m.short_name = 'uBO Lite (fork)'; }), { pristine: true }],
    // firefox: a fork must not reuse the upstream add-on id (platforms/firefox/gecko-id.mjs).
    ['upstream gecko id in PRISTINE + STAGE', 'gecko-id',
        bothManifests(m => { m.browser_specific_settings.gecko.id = 'uBOLiteRedux@raymondhill.net'; }), { pristine: true, platforms: ['firefox'] }],
    ['malformed gecko id in PRISTINE + STAGE', 'gecko-id',
        bothManifests(m => { m.browser_specific_settings.gecko.id = 'not an id'; }), { pristine: true, platforms: ['firefox'] }],
    ['another valid gecko id in PRISTINE + STAGE', null,
        bothManifests(m => { m.browser_specific_settings.gecko.id = '{01234567-89ab-cdef-0123-456789abcdef}'; }), { pristine: true, platforms: ['firefox'] }],
];

function cloneTree(src, dst) {
    if (process.platform === 'darwin' && spawnSync('/bin/cp', ['-cR', src, dst]).status === 0) return;
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
}

async function main() {
    const { platform, rest: args } = takePlatformArg(process.argv.slice(2));
    PRISTINE = pristineDir(platform);
    const STAGE = stageDir(platform);
    const tmpIdx = args.indexOf('--tmp');
    const tmpBase = tmpIdx !== -1 && args[tmpIdx + 1] ? path.resolve(args[tmpIdx + 1]) : os.tmpdir();
    if (!isDir(STAGE)) fail(`STAGE not found (${STAGE}); run scripts/build.sh <target> --ui-only first`);
    console.log(`${NAME}: platform ${platform}, STAGE ${STAGE}`);
    fs.mkdirSync(tmpBase, { recursive: true });
    const work = fs.mkdtempSync(path.join(tmpBase, 'verify-selftest-'));
    let bad = 0;
    let ran = 0;
    // check 4b needs the raw upstream build of the same version as PRISTINE
    const readVersion = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).version; } catch { return undefined; } };
    const upstreamVersion = readVersion(path.join(upstreamOut(platform), 'manifest.json'));
    const provenanceOk = upstreamVersion !== undefined && upstreamVersion === readVersion(path.join(PRISTINE, 'manifest.json'));
    try {
        for (const [label, expected, mutate, opts = {}] of CASES) {
            if (opts.platforms && !opts.platforms.includes(platform)) continue;
            if (opts.pristine && !provenanceOk) {
                console.log(`skip ${label.padEnd(40)} (raw upstream build missing or another version than PRISTINE)`);
                continue;
            }
            ran++;
            const dir = path.join(work, 'stage');
            const icons = path.join(work, 'icons');
            const pdir = path.join(work, 'pristine');
            cloneTree(STAGE, dir);
            if (opts.pristine) cloneTree(PRISTINE, pdir);
            mutate(dir, icons, pdir);
            const env = { ...process.env };
            if (opts.icons) env.BLOCKER_ICONS_DIR = icons;
            const r = spawnSync(process.execPath, [VERIFY, '--platform', platform, '--json', '--stage', dir, '--pristine', opts.pristine ? pdir : PRISTINE], { encoding: 'utf8', env });
            let report;
            try { report = JSON.parse(r.stdout); } catch { report = { byRule: {}, violations: [] }; }
            const rules = Object.keys(report.byRule ?? {});
            const ok = expected === null
                ? r.status === 0 && report.ok === true
                : r.status === 1 && rules.includes(expected);
            if (!ok) bad++;
            const got = r.status === 0 ? 'PASS' : `FAIL [${rules.join(', ')}]`;
            console.log(`${ok ? 'ok  ' : 'BAD '} ${label.padEnd(40)} expected ${expected === null ? 'PASS' : `FAIL [${expected}]`}, got ${got} (exit ${r.status})`);
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(icons, { recursive: true, force: true });
            fs.rmSync(pdir, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
    console.log(`${NAME}: ${ran - bad}/${ran} cases as expected`);
    return bad === 0 ? 0 : 1;
}

runMain(NAME, main);

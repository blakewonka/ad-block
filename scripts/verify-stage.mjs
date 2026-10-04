#!/usr/bin/env node
/*
 * verify-stage.mjs — the safety gate between our build and packaging.
 * Read-only: it never writes to either tree.
 *
 *   node scripts/verify-stage.mjs --platform <chromium|edge|firefox|safari> [--json] [--stage DIR] [--pristine DIR] [--upstream DIR]
 *
 *   default PRISTINE build/pristine/<platform>   (BLOCKER_PRISTINE_DIR)
 *   default STAGE    build/stage/<platform>      (BLOCKER_STAGE_DIR)
 *   default UPSTREAM upstream/dist/build/uBOLite.<platform> (raw upstream build, check 4b only;
 *                    docs/architecture.md calls it check 3, pristine provenance)
 *   icons            assets/icons/extension      (BLOCKER_ICONS_DIR=<dir with extension/> or "none")
 *
 * Exit 0 = STAGE is safe to package; 1 = at least one violation; 2 = usage.
 *
 * Checks
 *  1. Hash (sha256) every file of PRISTINE and STAGE.
 *  2. Every STAGE path not on the allow-list must be a regular file that is
 *     byte-identical to the PRISTINE file at the same path, and every PRISTINE
 *     path not on the allow-list must still exist in STAGE.
 *     Allow-list: popup.html, dashboard.html (ours), popup-classic.html,
 *     dashboard-classic.html, ui/**, css/default.css, log.txt (must be removed).
 *     New folders (even empty ones) outside ui/ are violations too.
 *     Exception: img/<name> may differ from PRISTINE when it is byte-identical
 *     to assets/icons/extension/<name> (the editable icons).
 *  3. popup-classic.html / dashboard-classic.html are byte-identical to the
 *     PRISTINE popup.html / dashboard.html.
 *  4. manifest.json is byte-identical (and still names popup.html /
 *     dashboard.html as popup / options page).
 *  4b. PRISTINE manifest provenance (when the raw upstream build is present
 *     and has the same version): PRISTINE manifest.json may differ from the
 *     upstream one ONLY in `short_name` (= "Blocker") and, on firefox, in
 *     `browser_specific_settings.gecko.id` (a valid id that is not an upstream
 *     *@raymondhill.net id; set by make-pristine, see platforms/firefox/gecko-id.mjs)
 *     and `name` (= "__MSG_extName__"). Any other difference: violation
 *     `pristine-manifest`. Raw build missing or rebuilt since: warning only.
 *     On firefox the STAGE manifest must also carry a valid non-upstream
 *     gecko id (violation `gecko-id`), whether or not the raw build exists.
 *  5. Forbidden content in ui/**, popup.html, dashboard.html (and in
 *     css/default.css when it was replaced): `cdn.openai.com`, remote font or
 *     script URLs (http://, https://, protocol-relative in CSS url()/@import
 *     and HTML attributes), `eval(`, `new Function(` / `Function("...")`.
 *     Other absolute URLs (XML namespaces, documentation links in error
 *     messages) are allowed and listed in the summary.
 *  6. HTML entries: no inline <script> body, no <script> without src, no
 *     on*="" handler attributes, no <style> element, no style="" attribute,
 *     no javascript: / data: URLs.
 *  7. Every relative reference in the HTML entries, in ui/*.js static or
 *     dynamic imports and in ui/*.css url() resolves to a file in STAGE.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    EXTENSION_ICONS, PipelineError, isDir, pristineDir, rel, runMain, sha256File, stageDir, takePlatformArg, upstreamOut, walk,
} from './lib/common.mjs';
import { geckoIdProblem } from '../platforms/firefox/gecko-id.mjs';

const NAME = 'verify-stage';

const ENTRIES = ['popup.html', 'dashboard.html'];
const CLASSIC = { 'popup-classic.html': 'popup.html', 'dashboard-classic.html': 'dashboard.html' };
const LEGACY_CSS = 'css/default.css';
const REMOVED = ['log.txt'];

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.json', '.svg', '.txt', '.map', '.xml', '.md']);
const SCRIPTISH_EXT = /\.(?:m?js|cjs|css|woff2?|ttf|otf|eot|wasm)$/i;
// Exact link targets whose path merely ends like a script (repository pages, not files).
// Added by build-dashboard-shell: upstream's verbatim About-pane credit (dashboard-shell.md §4.2).
const NON_SCRIPT_LINKS = new Set(['https://github.com/mathiasbynens/punycode.js']);
const REMOTE_CODE_HOSTS = [
    'cdn.openai.com', 'oaistatic.com', 'oaiusercontent.com',
    'fonts.googleapis.com', 'fonts.gstatic.com', 'ajax.googleapis.com',
    'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh', 'cdn.skypack.dev',
    'jspm.io', 'jspm.dev', 'use.typekit.net', 'p.typekit.net', 'code.jquery.com',
    'googletagmanager.com', 'google-analytics.com', 'rsms.me',
];

function parseArgs(argvIn) {
    let platform;
    let argv;
    try {
        ({ platform, rest: argv } = takePlatformArg(argvIn));
    } catch (err) {
        if (!(err instanceof PipelineError)) throw err;
        return { bad: true, badMsg: err.message };
    }
    const opts = { json: false, platform, stage: stageDir(platform), pristine: pristineDir(platform), upstream: upstreamOut(platform) };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--json') opts.json = true;
        else if (a === '--stage' && argv[i + 1]) opts.stage = path.resolve(argv[++i]);
        else if (a === '--pristine' && argv[i + 1]) opts.pristine = path.resolve(argv[++i]);
        else if (a === '--upstream' && argv[i + 1]) opts.upstream = path.resolve(argv[++i]);
        else if (a === '-h' || a === '--help') opts.help = true;
        else { opts.bad = a; break; }
    }
    return opts;
}

/* ------------------------------------------------------------------ */

function isAllowListed(p) {
    return ENTRIES.includes(p) || p in CLASSIC || p === 'ui' || p.startsWith('ui/') ||
        p === LEGACY_CSS || REMOVED.includes(p);
}

function lineOf(text, index) {
    let n = 1;
    for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
}

function snippet(text, index, len = 80) {
    const s = Math.max(0, index - 20);
    return text.slice(s, s + len).replace(/\s+/g, ' ').trim();
}

function hostOf(url) {
    try { return new URL(url.startsWith('//') ? `https:${url}` : url).hostname.toLowerCase(); } catch { return ''; }
}

function isKnownCodeHost(host) {
    return REMOTE_CODE_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

function isRemote(u) {
    return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(u.trim());
}

/** Minimal HTML tag/attribute reader (good enough for Vite output and upstream pages). */
function* htmlTags(html) {
    const tagRe = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
        const attrs = [];
        const attrRe = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        let a;
        while ((a = attrRe.exec(m[2])) !== null) {
            attrs.push({ name: a[1].toLowerCase(), value: a[2] ?? a[3] ?? a[4] ?? '' });
        }
        yield { name: m[1].toLowerCase(), attrs, index: m.index };
    }
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 4b. manifest provenance (PRISTINE vs the raw upstream build)         */

/** Paths (arrays of keys) where two JSON values differ. */
function jsonDiff(a, b, at = [], out = []) {
    const isObj = x => x !== null && typeof x === 'object';
    if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        if (Array.isArray(a) && a.length !== b.length) { out.push(at); return out; }
        for (const k of keys) {
            if (!(k in a) || !(k in b)) out.push([...at, k]);
            else jsonDiff(a[k], b[k], [...at, k], out);
        }
        return out;
    }
    if (a !== b) out.push(at);
    return out;
}

/**
 * The manifest changes make-pristine is allowed to make, per platform:
 * [path, check(value in PRISTINE) -> problem string or null].
 */
function allowedManifestChanges(platform) {
    const list = [[['short_name'], v => (v === 'Blocker' ? null : `must be "Blocker", got ${JSON.stringify(v)}`)]];
    if (platform === 'firefox') {
        list.push([['browser_specific_settings', 'gecko', 'id'], v => geckoIdProblem(v)]);
        list.push([['name'], v => (v === '__MSG_extName__' ? null : `must be "__MSG_extName__", got ${JSON.stringify(v)}`)]);
    }
    return list;
}

function checkManifestProvenance(platform, PRISTINE, STAGE, UPSTREAM_OUT, v, warnings, info) {
    const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
    if (platform === 'firefox') {
        let id;
        try { id = read(path.join(STAGE, 'manifest.json')).browser_specific_settings?.gecko?.id; } catch { id = undefined; }
        const problem = geckoIdProblem(id);
        if (problem !== null) v('gecko-id', 'manifest.json', `browser_specific_settings.gecko.id ${JSON.stringify(id)}: ${problem}`);
        info.geckoId = id;
    }
    const um = UPSTREAM_OUT ? path.join(UPSTREAM_OUT, 'manifest.json') : null;
    if (um === null || !fs.existsSync(um)) {
        warnings.push(`raw upstream build not found (${UPSTREAM_OUT ? rel(UPSTREAM_OUT) : 'none'}); PRISTINE manifest provenance not checked`);
        info.manifestProvenance = 'not checked (no upstream build)';
        return;
    }
    let up;
    let pr;
    try {
        up = read(um);
        pr = read(path.join(PRISTINE, 'manifest.json'));
    } catch (err) {
        v('pristine-manifest', 'manifest.json', `cannot read the upstream or PRISTINE manifest: ${err.message}`);
        return;
    }
    if (up.version !== pr.version) {
        warnings.push(`raw upstream build is version ${up.version}, PRISTINE ${pr.version} (rebuilt since make-pristine); PRISTINE manifest provenance not checked`);
        info.manifestProvenance = 'not checked (version differs)';
        return;
    }
    const allowed = allowedManifestChanges(platform);
    const changed = [];
    for (const p of jsonDiff(up, pr)) {
        const key = p.join('.');
        const rule = allowed.find(([ap]) => ap.join('.') === key);
        if (rule === undefined) {
            v('pristine-manifest', 'manifest.json', `PRISTINE differs from the upstream build at ${key || '(root)'}; only ${allowed.map(([ap]) => ap.join('.')).join(', ')} may change`);
            continue;
        }
        const get = o => p.reduce((x, k) => (x === null || typeof x !== 'object' ? undefined : x[k]), o);
        const problem = rule[1](get(pr));
        if (problem !== null) v('pristine-manifest', 'manifest.json', `${key}: ${problem}`);
        else changed.push(key);
    }
    info.manifestProvenance = `checked against ${rel(UPSTREAM_OUT)}; changed: ${changed.join(', ') || 'nothing'}`;
}

function verify(PRISTINE, STAGE, { platform, upstream } = {}) {
    const violations = [];
    const warnings = [];
    const allowedUrls = new Map(); // url -> [files]
    const info = { pristine: PRISTINE, stage: STAGE, icons: EXTENSION_ICONS };
    const v = (rule, file, detail) => violations.push({ rule, file, detail });

    for (const [label, dir] of [['PRISTINE', PRISTINE], ['STAGE', STAGE]]) {
        if (!isDir(dir)) {
            v('tree-missing', dir, `${label} folder does not exist`);
        }
    }
    if (violations.length !== 0) return { violations, warnings, info, allowedUrls };

    // 1. hash both trees
    const pdirs = new Set();
    const sdirs = new Set();
    const ptree = walk(PRISTINE, pdirs);
    const stree = walk(STAGE, sdirs);
    const phash = new Map();
    const shash = new Map();
    for (const [p, e] of ptree) if (e.kind === 'file') phash.set(p, sha256File(e.abs));
    for (const [p, e] of stree) if (e.kind === 'file') shash.set(p, sha256File(e.abs));
    info.pristineFiles = ptree.size;
    info.stageFiles = stree.size;
    info.pristineDigest = treeDigest(phash);
    info.stageDigest = treeDigest(shash);

    // 2. untouched part of the tree
    let identical = 0;
    for (const [p, e] of stree) {
        if (e.kind !== 'file') {
            v('not-a-file', p, `STAGE entry is a ${e.kind}, only regular files are allowed`);
            continue;
        }
        if (isAllowListed(p)) continue;
        const pe = ptree.get(p);
        if (pe === undefined) { v('extra-file', p, 'not in PRISTINE and not on the allow-list'); continue; }
        if (pe.kind !== 'file') { v('not-a-file', p, `PRISTINE entry is a ${pe.kind}`); continue; }
        if (phash.get(p) !== shash.get(p)) {
            // user-editable icons (assets/icons/extension): img/<name> may differ
            // from PRISTINE only if it is byte-identical to the icon file of that name
            const m = /^img\/([^/]+)$/.exec(p);
            if (EXTENSION_ICONS !== null && m) {
                const a = path.join(EXTENSION_ICONS, m[1]);
                if (fs.existsSync(a) && sha256File(a) === shash.get(p)) {
                    info.assetOverrides = [...(info.assetOverrides ?? []), p];
                    continue;
                }
            }
            v('modified', p, `sha256 ${shash.get(p).slice(0, 12)} != PRISTINE ${phash.get(p).slice(0, 12)}`);
            continue;
        }
        identical++;
    }
    for (const [p] of ptree) {
        if (isAllowListed(p)) continue;
        if (!stree.has(p)) v('missing', p, 'present in PRISTINE, missing from STAGE');
    }
    for (const d of sdirs) {
        if (d === 'ui' || d.startsWith('ui/') || pdirs.has(d)) continue;
        v('extra-dir', `${d}/`, 'folder not in PRISTINE and not on the allow-list');
    }
    info.identicalFiles = identical;
    for (const p of [...ptree.keys()].filter(p => p === 'ui' || p.startsWith('ui/') || p in CLASSIC)) {
        v('pristine-conflict', p, 'PRISTINE itself contains an allow-listed overlay path; it is not a clean upstream build');
    }

    // 3. classic copies
    for (const [copy, orig] of Object.entries(CLASSIC)) {
        if (!shash.has(copy)) v('classic-copy', copy, `missing (expected the upstream ${orig})`);
        else if (!phash.has(orig)) v('classic-copy', copy, `PRISTINE has no ${orig}`);
        else if (shash.get(copy) !== phash.get(orig)) v('classic-copy', copy, `not byte-identical to PRISTINE ${orig}`);
    }
    // entries exist and are ours
    for (const e of ENTRIES) {
        if (!shash.has(e)) v('entry-missing', e, 'React entry missing from STAGE');
        else if (shash.get(e) === phash.get(e)) v('overlay-missing', e, 'still the upstream page (overlay not applied)');
    }
    for (const r of REMOVED) {
        if (stree.has(r)) v('not-removed', r, 'must be deleted from STAGE');
    }

    // 4. manifest
    if (!shash.has('manifest.json')) v('manifest', 'manifest.json', 'missing from STAGE');
    else if (shash.get('manifest.json') !== phash.get('manifest.json')) v('manifest', 'manifest.json', 'changed');
    else {
        try {
            const m = JSON.parse(fs.readFileSync(path.join(STAGE, 'manifest.json'), 'utf8'));
            const popup = m.action?.default_popup;
            const options = m.options_ui?.page ?? m.options_page;
            if (popup !== 'popup.html') warnings.push(`manifest action.default_popup is ${JSON.stringify(popup)}, expected "popup.html"`);
            if (options !== 'dashboard.html') warnings.push(`manifest options page is ${JSON.stringify(options)}, expected "dashboard.html"`);
            info.manifestVersion = m.version;
            info.manifestName = m.name;
        } catch (err) {
            v('manifest', 'manifest.json', `not valid JSON: ${err.message}`);
        }
    }
    // 4b. PRISTINE manifest == upstream manifest + the allowed changes (gecko id on firefox)
    if (platform !== undefined) checkManifestProvenance(platform, PRISTINE, STAGE, upstream, v, warnings, info);

    // css/default.css
    if (!shash.has(LEGACY_CSS)) v('missing', LEGACY_CSS, 'missing from STAGE');
    const legacyReplaced = shash.has(LEGACY_CSS) && shash.get(LEGACY_CSS) !== phash.get(LEGACY_CSS);
    info.legacyCss = legacyReplaced ? 'generated' : 'pristine';
    if (!legacyReplaced) warnings.push('css/default.css is the pristine upstream file (no generated legacy CSS staged)');

    // 5-7. content checks
    const scanned = [...stree.keys()].filter(p => p.startsWith('ui/') || ENTRIES.includes(p));
    if (legacyReplaced) scanned.push(LEGACY_CSS);
    info.scannedFiles = scanned.length;
    for (const p of scanned) {
        const e = stree.get(p);
        if (e.kind !== 'file') continue;
        scanFile(p, e.abs, { v, warnings, allowedUrls, stree });
    }
    if (![...stree.keys()].some(p => p.startsWith('ui/'))) v('overlay-missing', 'ui/', 'STAGE has no ui/ folder');

    return { violations, warnings, info, allowedUrls };
}

function treeDigest(hashes) {
    const h = createHash('sha256');
    for (const p of [...hashes.keys()].sort()) h.update(`${hashes.get(p)}  ${p}\n`);
    return h.digest('hex');
}

function scanFile(p, abs, ctx) {
    const { v, warnings, allowedUrls, stree } = ctx;
    const buf = fs.readFileSync(abs);
    const ext = path.posix.extname(p).toLowerCase();
    const latin = buf.toString('latin1');

    // cdn.openai.com anywhere, any file type (binary included)
    for (const m of latin.matchAll(/cdn\.openai\.com/gi)) {
        v('forbidden-content', p, `cdn.openai.com at line ${lineOf(latin, m.index)}`);
    }
    if (!TEXT_EXT.has(ext)) return;
    if (ext === '.map') warnings.push(`${p}: source map shipped in ui/ (sourcemaps should be off)`);

    const text = buf.toString('utf8');
    const isCss = ext === '.css';
    const isHtml = ext === '.html' || ext === '.htm';

    for (const m of text.matchAll(/(?<![\w$])eval\s*\(/g)) {
        v('forbidden-content', p, `eval( at line ${lineOf(text, m.index)}: ${snippet(text, m.index)}`);
    }
    for (const m of text.matchAll(/\bnew\s+Function\s*\(/g)) {
        v('forbidden-content', p, `new Function( at line ${lineOf(text, m.index)}: ${snippet(text, m.index)}`);
    }
    for (const m of text.matchAll(/(?<![\w$.])Function\s*\(\s*["'`]/g)) {
        // `x || self || Function("return this")()` is the lodash-era global
        // lookup; in a page `self` is always an object so the call is never
        // reached. Report it, but only as a warning. Any other string-built
        // function is a violation (it would need 'unsafe-eval').
        const idiom = /^Function\s*\(\s*(["'`])return this\1\s*\)/.test(text.slice(m.index, m.index + 40)) &&
            /\|\|\s*$/.test(text.slice(Math.max(0, m.index - 8), m.index));
        if (idiom) {
            warnings.push(`${p}: line ${lineOf(text, m.index)}: unreachable global-lookup fallback \`|| Function("return this")()\` (allowed)`);
        } else {
            v('forbidden-content', p, `Function("...") at line ${lineOf(text, m.index)}: ${snippet(text, m.index)}`);
        }
    }

    // CSS: url() / @import must be local
    if (isCss) {
        for (const m of text.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi)) {
            const u = m[2].trim();
            if (isRemote(u)) v('forbidden-content', p, `remote url(${u}) at line ${lineOf(text, m.index)}`);
            else if (/^data:/i.test(u)) { /* allowed on extension pages */ }
            else if (u !== '' && !u.startsWith('#')) checkLocalRef(p, u, stree, v);
        }
        for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"');\s]+)/gi)) {
            const u = m[1];
            if (isRemote(u)) v('forbidden-content', p, `remote @import ${u} at line ${lineOf(text, m.index)}`);
        }
    }

    // JS: remote module loading
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        for (const m of text.matchAll(/(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s*|importScripts\s*\(\s*|new\s+(?:Shared)?Worker\s*\(\s*)["'`]((?:https?:)?\/\/[^"'`]+)["'`]/g)) {
            v('forbidden-content', p, `remote script load ${m[1]} at line ${lineOf(text, m.index)}`);
        }
        for (const m of text.matchAll(/(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
            checkLocalRef(p, m[1], stree, v);
        }
    }

    // Absolute http(s) URLs anywhere: font/script/style files or known CDNs are forbidden
    for (const m of text.matchAll(/https?:\/\/[^\s"'`()<>\\,;{}]+/gi)) {
        const url = m[0].replace(/[.:]+$/, '');
        const host = hostOf(url);
        let pathname = '';
        try { pathname = new URL(url).pathname; } catch { /* ignore */ }
        if (isKnownCodeHost(host) && host !== 'cdn.openai.com') {
            v('forbidden-content', p, `remote code/font host ${url} at line ${lineOf(text, m.index)}`);
        } else if (host !== 'cdn.openai.com' && SCRIPTISH_EXT.test(pathname) && !NON_SCRIPT_LINKS.has(url)) {
            v('forbidden-content', p, `remote font/script URL ${url} at line ${lineOf(text, m.index)}`);
        } else if (host !== 'cdn.openai.com') {
            if (!allowedUrls.has(url)) allowedUrls.set(url, new Set());
            allowedUrls.get(url).add(p);
        }
    }

    if (isHtml) scanHtml(p, text, stree, v);
}

function checkLocalRef(fromPath, ref, stree, v) {
    const clean = ref.split(/[?#]/)[0];
    if (clean === '') return;
    const base = path.posix.dirname(fromPath);
    const target = clean.startsWith('/') ? clean.slice(1) : path.posix.normalize(path.posix.join(base, clean));
    if (target.startsWith('..')) { v('broken-ref', fromPath, `${ref} points outside the extension`); return; }
    if (!stree.has(target)) v('broken-ref', fromPath, `${ref} -> ${target} does not exist in STAGE`);
}

function scanHtml(p, html, stree, v) {
    // inline scripts (any script with a body, or without src)
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (m[2].trim() !== '') v('inline-script', p, `<script> with an inline body at line ${lineOf(html, m.index)}`);
        if (!/\ssrc\s*=/i.test(` ${m[1]}`)) v('inline-script', p, `<script> without src at line ${lineOf(html, m.index)}`);
    }
    for (const m of html.matchAll(/<style\b/gi)) v('inline-style', p, `<style> element at line ${lineOf(html, m.index)}`);
    for (const tag of htmlTags(html)) {
        for (const { name, value } of tag.attrs) {
            const line = lineOf(html, tag.index);
            if (/^on[a-z]/.test(name)) v('inline-handler', p, `<${tag.name} ${name}="..."> at line ${line}`);
            if (name === 'style') v('inline-style', p, `<${tag.name} style="..."> at line ${line}`);
            if (['src', 'href', 'srcset', 'action', 'formaction', 'poster', 'data', 'xlink:href'].includes(name)) {
                const urls = name === 'srcset' ? value.split(',').map(s => s.trim().split(/\s+/)[0]) : [value.trim()];
                for (const u of urls) {
                    if (u === '' || u.startsWith('#')) continue;
                    if (/^javascript:/i.test(u)) v('inline-script', p, `javascript: URL in <${tag.name} ${name}> at line ${line}`);
                    else if (/^data:/i.test(u)) v('forbidden-content', p, `data: URL in <${tag.name} ${name}> at line ${line}`);
                    else if (isRemote(u)) v('forbidden-content', p, `remote URL ${u} in <${tag.name} ${name}> at line ${line}`);
                    else if (/^[a-z][a-z0-9+.-]*:/i.test(u)) v('forbidden-content', p, `non-local URL ${u} in <${tag.name} ${name}> at line ${line}`);
                    else if (tag.name !== 'a' && tag.name !== 'form') checkLocalRef(p, u, stree, v);
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ */

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || opts.bad) {
        if (opts.bad) console.error(`${NAME}: ${opts.badMsg ?? `unknown argument ${opts.bad}`}`);
        console.error('usage: node scripts/verify-stage.mjs --platform <chromium|edge|firefox|safari> [--json] [--stage DIR] [--pristine DIR] [--upstream DIR]');
        return opts.bad ? 2 : 0;
    }
    const t0 = Date.now();
    const { violations, warnings, info, allowedUrls } = verify(opts.pristine, opts.stage, { platform: opts.platform, upstream: opts.upstream });
    const ok = violations.length === 0;
    const byRule = {};
    for (const x of violations) byRule[x.rule] = (byRule[x.rule] ?? 0) + 1;
    const allowed = [...allowedUrls].map(([url, files]) => ({ url, files: [...files].sort() }))
        .sort((a, b) => a.url.localeCompare(b.url));

    if (opts.json) {
        process.stdout.write(`${JSON.stringify({
            ok, platform: opts.platform, ...info, violationCount: violations.length, byRule, violations, warnings,
            allowedUrls: allowed, elapsedMs: Date.now() - t0,
        }, null, 2)}\n`);
        return ok ? 0 : 1;
    }

    console.log(`${NAME}: platform ${opts.platform}`);
    console.log(`${NAME}: PRISTINE ${info.pristine}${info.pristineFiles !== undefined ? ` (${info.pristineFiles} files)` : ''}`);
    console.log(`${NAME}: STAGE    ${info.stage}${info.stageFiles !== undefined ? ` (${info.stageFiles} files)` : ''}`);
    if (info.identicalFiles !== undefined) {
        console.log(`${NAME}: ${info.identicalFiles} untouched files byte-identical; ${info.scannedFiles} overlay files scanned; css/default.css: ${info.legacyCss}`);
        console.log(`${NAME}: STAGE digest ${info.stageDigest}`);
        if (info.manifestProvenance) console.log(`${NAME}: manifest provenance: ${info.manifestProvenance}`);
        if (info.geckoId !== undefined) console.log(`${NAME}: Firefox add-on id ${info.geckoId}`);
        if (info.assetOverrides) console.log(`${NAME}: ${info.assetOverrides.length} icon(s) in img/ accepted as byte-identical to ${info.icons}`);
    }
    if (allowed.length !== 0) {
        console.log(`${NAME}: ${allowed.length} other absolute URL(s) found and allowed (not fonts/scripts):`);
        for (const a of allowed.slice(0, 12)) console.log(`    ${a.url}  [${a.files.join(', ')}]`);
        if (allowed.length > 12) console.log(`    ... ${allowed.length - 12} more (use --json)`);
    }
    for (const w of warnings) console.warn(`${NAME}: warning: ${w}`);
    if (ok) {
        console.log(`${NAME}: PASS (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        return 0;
    }
    console.error(`${NAME}: FAIL — ${violations.length} violation(s): ${Object.entries(byRule).map(([r, n]) => `${r} ${n}`).join(', ')}`);
    const shown = violations.slice(0, 40);
    for (const x of shown) console.error(`  [${x.rule}] ${x.file}: ${x.detail}`);
    if (violations.length > shown.length) console.error(`  ... ${violations.length - shown.length} more (use --json)`);
    return 1;
}

runMain(NAME, main);

#!/usr/bin/env node
/*
 * check-package.mjs — store-readiness checks for a Chrome / Edge package folder.
 * Read-only.
 *
 *   node platforms/chromium/check-package.mjs --target <chromium|edge> --dir DIR [--profile release|dev] [--json]
 *
 * Exit 0 = no errors (warnings are printed), 1 = errors, 2 = usage.
 *
 * Checks (Chrome Web Store / Edge Add-ons / Chromium manifest rules):
 *   manifest   manifest_version 3; only keys Chromium knows (no Firefox/Safari keys
 *              such as browser_specific_settings, background.scripts/page; no `key`,
 *              which the stores reject); name/short_name/description resolve in every
 *              locale and fit the limits (75 / 12 / 132 characters); version is 1-4
 *              dot-separated integers 0-65535 without leading zeros.
 *   files      every file the manifest names exists: icons (PNG of the declared
 *              size, a 128 px icon present), action icons and popup, options page,
 *              background service worker, managed storage schema, web-accessible
 *              resources, DNR rulesets (valid JSON arrays, unique ids).
 *   limits     at most 100 static rulesets, at most 50 enabled by default
 *              (Chromium's MAX_NUMBER_OF_STATIC_RULESETS / _ENABLED_STATIC_RULESETS).
 *   edge       every ruleset path sits at the package root (no "/"), as upstream's
 *              edge/patch-extension.js does for Edge Add-ons.
 *   release    no "declarativeNetRequestFeedback" permission, no rulesets/debug/.
 *   content    no log.txt, .DS_Store, __MACOSX, symlinks; no top-level name starting
 *              with "_" except _locales (reserved by Chromium); every _locales/*\/messages.json parses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fail, isDir, isFile, rel, runMain, walk } from '../../scripts/lib/common.mjs';

const NAME = 'check-package';

const KNOWN_KEYS = new Set([
    'action', 'author', 'background', 'chrome_settings_overrides', 'chrome_url_overrides', 'commands',
    'content_scripts', 'content_security_policy', 'cross_origin_embedder_policy', 'cross_origin_opener_policy',
    'declarative_net_request', 'default_locale', 'description', 'devtools_page', 'externally_connectable',
    'homepage_url', 'host_permissions', 'icons', 'incognito', 'manifest_version', 'minimum_chrome_version',
    'name', 'offline_enabled', 'omnibox', 'optional_host_permissions', 'optional_permissions', 'options_page',
    'options_ui', 'permissions', 'requirements', 'short_name', 'side_panel', 'storage', 'version', 'version_name',
    'web_accessible_resources',
]);
/** Keys that are wrong in a Chrome / Edge package (another browser's, or rejected by the stores). */
const FOREIGN_KEYS = {
    browser_specific_settings: 'Firefox/Safari only',
    applications: 'Firefox only (legacy)',
    developer: 'Firefox only',
    sidebar_action: 'Firefox only',
    browser_action: 'MV2',
    page_action: 'MV2',
    key: 'the stores reject a package with a "key"',
    update_url: 'set by the store, not the package',
};
const KNOWN_PERMISSIONS = new Set([
    'activeTab', 'alarms', 'declarativeNetRequest', 'declarativeNetRequestFeedback',
    'declarativeNetRequestWithHostAccess', 'offscreen', 'scripting', 'storage', 'unlimitedStorage',
    'userScripts', 'tabs', 'webNavigation', 'contextMenus', 'sidePanel', 'notifications',
]);
const MAX_STATIC_RULESETS = 100;
const MAX_ENABLED_STATIC_RULESETS = 50;

function parseArgs(argv) {
    const o = { profile: 'release', json: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const v = argv[i + 1];
        if (a === '--target' && v) { o.target = v; i++; }
        else if (a === '--dir' && v) { o.dir = path.resolve(v); i++; }
        else if (a === '--profile' && v) { o.profile = v; i++; }
        else if (a === '--json') o.json = true;
        else return { usage: `unknown argument ${a}` };
    }
    if (o.target !== 'chromium' && o.target !== 'edge') return { usage: '--target must be chromium or edge' };
    if (!o.dir) return { usage: '--dir is required' };
    if (o.profile !== 'release' && o.profile !== 'dev') return { usage: '--profile must be release or dev' };
    return o;
}

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function pngSize(file) {
    const b = fs.readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Resolve a manifest path ("/js/x.js" or "js/x.js") inside the package. */
const inPkg = (dir, p) => path.join(dir, String(p).replace(/^\/+/, ''));

function check(o) {
    const errors = [];
    const warnings = [];
    const info = {};
    const err = m => errors.push(m);
    const warn = m => warnings.push(m);
    const D = o.dir;

    const mfPath = path.join(D, 'manifest.json');
    if (!isFile(mfPath)) { err('manifest.json is missing at the package root'); return { errors, warnings, info }; }
    let m;
    try { m = readJson(mfPath); } catch (e) { err(`manifest.json is not valid JSON: ${e.message}`); return { errors, warnings, info }; }

    // --- keys
    if (m.manifest_version !== 3) err(`manifest_version is ${m.manifest_version}, expected 3`);
    for (const k of Object.keys(m)) {
        if (k in FOREIGN_KEYS) err(`manifest key "${k}" does not belong in a Chromium package (${FOREIGN_KEYS[k]})`);
        else if (!KNOWN_KEYS.has(k)) warn(`manifest key "${k}" is not a known Chromium key`);
    }
    if (m.background) {
        if (m.background.scripts || m.background.page) err('background.scripts / background.page are not supported in Chromium MV3');
        if (!m.background.service_worker) err('background.service_worker is missing');
        else if (!isFile(inPkg(D, m.background.service_worker))) err(`background.service_worker ${m.background.service_worker} does not exist`);
    } else {
        warn('no background service worker');
    }

    // --- version
    const v = String(m.version ?? '');
    const parts = v.split('.');
    if (parts.length < 1 || parts.length > 4 || !parts.every(x => /^(0|[1-9]\d*)$/.test(x) && Number(x) <= 65535)) {
        err(`version "${v}" is not 1-4 dot-separated integers 0-65535 without leading zeros`);
    }
    info.version = v;

    // --- locales and texts
    const localesDir = path.join(D, '_locales');
    const locales = isDir(localesDir) ? fs.readdirSync(localesDir).filter(n => isDir(path.join(localesDir, n))).sort() : [];
    const messages = new Map();
    for (const l of locales) {
        const f = path.join(localesDir, l, 'messages.json');
        if (!isFile(f)) { err(`_locales/${l}/messages.json is missing`); continue; }
        try { messages.set(l, readJson(f)); } catch (e) { err(`_locales/${l}/messages.json is not valid JSON: ${e.message}`); }
    }
    info.locales = locales.length;
    if (!m.default_locale) {
        if (locales.length) err('_locales/ exists but default_locale is not set');
    } else if (!messages.has(m.default_locale)) {
        err(`default_locale "${m.default_locale}" has no _locales/${m.default_locale}/messages.json`);
    }
    const limits = { name: 75, short_name: 12, description: 132 };
    const resolved = {};
    for (const [field, max] of Object.entries(limits)) {
        const raw = m[field];
        if (raw === undefined) { if (field !== 'short_name') err(`manifest.${field} is missing`); continue; }
        const mm = /^__MSG_(\w+)__$/.exec(String(raw));
        if (!mm) {
            resolved[field] = raw;
            if ([...String(raw)].length > max) err(`manifest.${field} is longer than ${max} characters`);
            continue;
        }
        const key = mm[1];
        const def = messages.get(m.default_locale)?.[key]?.message;
        if (typeof def !== 'string' || def === '') err(`manifest.${field} ${raw}: no message "${key}" in the default locale`);
        resolved[field] = def;
        for (const [l, j] of messages) {
            const s = j[key]?.message;
            if (typeof s === 'string' && [...s].length > max) err(`manifest.${field} in locale ${l} is ${[...s].length} characters (max ${max})`);
        }
    }
    info.name = resolved.name;
    info.short_name = resolved.short_name;
    info.description = resolved.description;

    // --- icons
    const iconSets = [['icons', m.icons], ['action.default_icon', m.action?.default_icon]];
    for (const [label, set] of iconSets) {
        if (set === undefined) continue;
        for (const [size, p] of Object.entries(set)) {
            const f = inPkg(D, p);
            if (!isFile(f)) { err(`${label}.${size}: ${p} does not exist`); continue; }
            const dim = pngSize(f);
            if (!dim) { err(`${label}.${size}: ${p} is not a PNG`); continue; }
            if (dim.w !== Number(size) || dim.h !== Number(size)) warn(`${label}.${size}: ${p} is ${dim.w}x${dim.h}`);
        }
    }
    if (!m.icons?.['128']) err('icons has no 128 px entry (required by the Chrome Web Store)');

    // --- pages and resources
    for (const [label, p] of [['action.default_popup', m.action?.default_popup], ['options_page', m.options_page],
        ['options_ui.page', m.options_ui?.page], ['storage.managed_schema', m.storage?.managed_schema]]) {
        if (p !== undefined && !isFile(inPkg(D, p))) err(`${label}: ${p} does not exist`);
    }
    for (const war of m.web_accessible_resources ?? []) {
        for (const r of war.resources ?? []) {
            if (/[*?]/.test(r)) continue;
            if (!isFile(inPkg(D, r))) err(`web_accessible_resources: ${r} does not exist`);
        }
    }

    // --- permissions
    for (const p of m.permissions ?? []) {
        if (!KNOWN_PERMISSIONS.has(p)) warn(`permission "${p}" is not in this checker's list`);
    }
    info.permissions = m.permissions ?? [];
    if (o.profile === 'release') {
        if ((m.permissions ?? []).includes('declarativeNetRequestFeedback')) err('release package still has the declarativeNetRequestFeedback permission');
        if (isDir(path.join(D, 'rulesets', 'debug'))) err('release package still has rulesets/debug/');
    }

    // --- DNR rulesets
    const rr = m.declarative_net_request?.rule_resources ?? [];
    const ids = new Set();
    let enabled = 0;
    let rules = 0;
    for (const r of rr) {
        if (ids.has(r.id)) err(`ruleset id "${r.id}" is declared twice`);
        ids.add(r.id);
        if (r.enabled) enabled += 1;
        if (o.target === 'edge' && String(r.path).replace(/^\/+/, '').includes('/')) {
            err(`Edge: ruleset ${r.id} path "${r.path}" is not at the package root`);
        }
        const f = inPkg(D, r.path);
        if (!isFile(f)) { err(`ruleset ${r.id}: ${r.path} does not exist`); continue; }
        try {
            const j = readJson(f);
            if (!Array.isArray(j)) err(`ruleset ${r.id}: ${r.path} is not a JSON array`);
            else rules += j.length;
        } catch (e) {
            err(`ruleset ${r.id}: ${r.path} is not valid JSON: ${e.message}`);
        }
    }
    if (rr.length > MAX_STATIC_RULESETS) err(`${rr.length} static rulesets declared (max ${MAX_STATIC_RULESETS})`);
    if (enabled > MAX_ENABLED_STATIC_RULESETS) err(`${enabled} rulesets enabled by default (max ${MAX_ENABLED_STATIC_RULESETS})`);
    info.rulesets = { declared: rr.length, enabledByDefault: enabled, staticRules: rules };

    // --- content
    let bytes = 0;
    let files = 0;
    for (const [p, e] of walk(D)) {
        const base = path.posix.basename(p);
        if (e.kind !== 'file') { err(`${p} is a ${e.kind}, not a regular file`); continue; }
        files += 1;
        bytes += fs.statSync(e.abs).size;
        if (p === 'log.txt') err('log.txt must not be packaged');
        if (base === '.DS_Store' || p.startsWith('__MACOSX/')) err(`${p} must not be packaged`);
        else if (base.startsWith('.')) warn(`hidden file ${p}`);
    }
    for (const n of fs.readdirSync(D)) {
        if (n.startsWith('_') && n !== '_locales') err(`top-level name "${n}" starts with "_" (reserved by Chromium)`);
    }
    info.files = files;
    info.bytes = bytes;
    return { errors, warnings, info };
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (o.usage) {
        console.error(`${NAME}: ${o.usage}`);
        console.error(`usage: check-package.mjs --target <chromium|edge> --dir DIR [--profile release|dev] [--json]`);
        return 2;
    }
    if (!isDir(o.dir)) fail(`not a folder: ${o.dir}`);
    const r = check(o);
    if (o.json) {
        console.log(JSON.stringify({ ok: r.errors.length === 0, ...r }, null, 2));
        return r.errors.length === 0 ? 0 : 1;
    }
    const i = r.info;
    console.log(`${NAME}: ${o.target} (${o.profile}) ${rel(o.dir)}`);
    if (i.version) {
        console.log(`${NAME}: "${i.name}" (${i.short_name}) ${i.version}, ${i.locales} locales, ${i.files} files, ${(i.bytes / 1048576).toFixed(1)} MB`);
        if (i.rulesets) console.log(`${NAME}: ${i.rulesets.declared} rulesets (${i.rulesets.enabledByDefault} enabled by default, ${i.rulesets.staticRules} static rules)`);
        console.log(`${NAME}: permissions: ${i.permissions.join(', ')}`);
    }
    for (const w of r.warnings) console.log(`${NAME}: warning: ${w}`);
    for (const e of r.errors) console.error(`${NAME}: ERROR: ${e}`);
    console.log(`${NAME}: ${r.errors.length === 0 ? 'PASS' : `FAIL (${r.errors.length} error(s))`}`);
    return r.errors.length === 0 ? 0 : 1;
}

runMain(NAME, main);

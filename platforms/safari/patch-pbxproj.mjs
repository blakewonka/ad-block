#!/usr/bin/env node
/*
 * patch-pbxproj.mjs — idempotent signing / bundle-id patch of the Xcode
 * project that safari-web-extension-converter generates.
 *
 *   node platforms/safari/patch-pbxproj.mjs --project PATH [--check]
 *        [--app-id ID --ext-id ID --team TEAM --identity NAME --style Manual|Automatic]
 *        [--expect-configs N]
 *
 *   --project PATH  project.pbxproj, or the .xcodeproj folder, or the converter
 *                   --project-location folder (then <PATH>/Blocker/Blocker.xcodeproj).
 *   --check         only report; exit 1 if a patch would be needed. Writes nothing.
 *   --app-id ... --style   default: resolved by platforms/safari/signing.mjs
 *                   (BLOCKER_SIGNING_CONFIG, signing.local.json or the defaults).
 *                   --team "" with --identity "-" = ad-hoc signing.
 *   --expect-configs N   number of target build configurations (default 4:
 *                   one app + one extension target, Debug + Release each).
 *
 * For every application and app-extension target and each of their build
 * configurations sets:
 *   PRODUCT_BUNDLE_IDENTIFIER = <app id>            (application)
 *                               <extension id>      (app-extension)
 *   CODE_SIGN_STYLE           = <style>
 *   CODE_SIGN_IDENTITY        = <identity>   ("Apple Development", or "-" for ad hoc)
 *   DEVELOPMENT_TEAM          = <team>       ("" for ad hoc)
 * Conditional variants such as "CODE_SIGN_IDENTITY[sdk=macosx*]" are set too,
 * so they cannot override the value. Targets and configurations are found by
 * structure (PBXNativeTarget -> XCConfigurationList -> XCBuildConfiguration),
 * never by object id, because ids change on every converter run.
 *
 * Fails (without writing) unless exactly one application target, one
 * app-extension target and four configurations are found. After writing it
 * runs `plutil -lint` and re-reads the file through `plutil -convert json` to
 * confirm all four configurations carry the expected values.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail, isDir, isFile, runMain } from '../../scripts/lib/common.mjs';
import { resolveSigning } from './signing.mjs';

const NAME = 'patch-pbxproj';
const APP_NAME = 'Blocker';
const PRODUCT_APP = 'com.apple.product-type.application';
const PRODUCT_EXT = 'com.apple.product-type.app-extension';

function resolveProject(arg) {
    if (arg === undefined) fail('--project PATH is required');
    const p = path.resolve(arg);
    if (isFile(p)) return p;
    if (isDir(p) && p.endsWith('.xcodeproj')) return path.join(p, 'project.pbxproj');
    if (isDir(p)) return path.join(p, APP_NAME, `${APP_NAME}.xcodeproj`, 'project.pbxproj');
    return p;
}

/* ---------- tiny structural reader for old-style (ASCII) plists ---------- */

/** Index of the brace/paren closing the one at `open`, skipping strings and comments. */
function matchClose(text, open) {
    const openCh = text[open];
    const closeCh = openCh === '{' ? '}' : ')';
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; } continue; }
        if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; continue; }
        if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue; }
        if (c === '{' || c === '(') depth++;
        else if (c === '}' || c === ')') { depth--; if (depth === 0) { if (c !== closeCh) break; return i; } }
    }
    fail('unbalanced braces in project.pbxproj');
}

/** Find `ID /* ... *\/ = {` for an object id; returns {start, open, close}. */
function findObject(text, id) {
    const re = new RegExp(`(^|\\n)\\s*${id}(?:\\s*/\\*[^*]*\\*/)?\\s*=\\s*\\{`, 'g');
    const hits = [...text.matchAll(re)];
    if (hits.length !== 1) fail(`object ${id} found ${hits.length} times`);
    const open = hits[0].index + hits[0][0].length - 1;
    return { open, close: matchClose(text, open) };
}

function field(body, key) {
    const m = new RegExp(`\\n\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|[^;\\s]+)`).exec(body);
    return m ? m[1].replace(/^"(.*)"$/, '$1') : undefined;
}

function section(text, name) {
    const begin = text.indexOf(`/* Begin ${name} section */`);
    const end = text.indexOf(`/* End ${name} section */`);
    if (begin === -1 || end === -1) fail(`no ${name} section in project.pbxproj`);
    return { begin, end };
}

function findTargets(text) {
    const { begin, end } = section(text, 'PBXNativeTarget');
    const out = [];
    const re = /\n\s*([0-9A-F]{24})(?:\s*\/\*[^*]*\*\/)?\s*=\s*\{/g;
    re.lastIndex = begin;
    let m;
    while ((m = re.exec(text)) !== null && m.index < end) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(text, open);
        const body = text.slice(open, close + 1);
        if (field(body, 'isa') === 'PBXNativeTarget') {
            out.push({ id: m[1], name: field(body, 'name'), productType: field(body, 'productType'), listId: field(body, 'buildConfigurationList') });
        }
        re.lastIndex = close;
    }
    return out;
}

function configIds(text, listId) {
    const { open, close } = findObject(text, listId);
    const body = text.slice(open, close + 1);
    if (field(body, 'isa') !== 'XCConfigurationList') fail(`${listId} is not an XCConfigurationList`);
    const m = /buildConfigurations\s*=\s*\(([^)]*)\)/.exec(body);
    if (!m) fail(`${listId} has no buildConfigurations`);
    return [...m[1].replace(/\/\*[^*]*\*\//g, '').matchAll(/[0-9A-F]{24}/g)].map(x => x[0]);
}

function quote(v) {
    // Xcode writes "-" (ad-hoc identity) quoted; keep the same form.
    return /^[A-Za-z0-9_$./][A-Za-z0-9_$./-]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Apply `settings` to the buildSettings dict of configuration `cfgId`.
 * Returns { text, name, changes[] }.
 */
function patchConfig(text, cfgId, settings) {
    const { open, close } = findObject(text, cfgId);
    const obj = text.slice(open, close + 1);
    if (field(obj, 'isa') !== 'XCBuildConfiguration') fail(`${cfgId} is not an XCBuildConfiguration`);
    const name = field(obj, 'name');
    const bsm = /buildSettings\s*=\s*\{/.exec(obj);
    if (!bsm) fail(`${cfgId} has no buildSettings`);
    const bsOpen = open + bsm.index + bsm[0].length - 1;
    const bsClose = matchClose(text, bsOpen);
    const inner = text.slice(bsOpen + 1, bsClose);

    // Split the dict body into top-level entries (lines), keeping multi-line lists together.
    const entries = [];
    let i = 0;
    while (i < inner.length) {
        const m = /^\s*([A-Za-z0-9_]+|"[^"]+")\s*=\s*/.exec(inner.slice(i));
        if (!m) break;
        const keyRaw = m[1];
        let j = i + m[0].length;
        if (inner[j] === '(' || inner[j] === '{') j = matchClose(inner, j) + 1;
        else if (inner[j] === '"') { j++; while (j < inner.length && inner[j] !== '"') { if (inner[j] === '\\') j++; j++; } j++; }
        else while (j < inner.length && inner[j] !== ';') j++;
        if (inner[j] !== ';') fail(`cannot parse buildSettings of ${cfgId} near ${keyRaw}`);
        j++;
        entries.push({ key: keyRaw.replace(/^"(.*)"$/, '$1'), raw: inner.slice(i, j) });
        i = j;
    }
    const trailing = inner.slice(i);
    if (trailing.trim() !== '') fail(`unparsed text in buildSettings of ${cfgId}: ${trailing.trim().slice(0, 60)}`);
    const indentM = /\n(\t+|\s+)\S/.exec(entries[0]?.raw ?? '\n\t\t\t\t');
    const indent = indentM ? indentM[1] : '\t\t\t\t';

    const changes = [];
    for (const [key, value] of Object.entries(settings)) {
        const line = `\n${indent}${key} = ${quote(value)};`;
        let found = false;
        for (const e of entries) {
            const base = e.key.replace(/\[.*\]$/, '');
            if (base !== key) continue;
            if (e.key === key) found = true;
            const want = e.key === key ? line : `\n${indent}${quote(e.key)} = ${quote(value)};`;
            const cur = /^\s*(?:"[^"]*"|[A-Za-z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]+);/.exec(e.raw)[1].trim().replace(/^"(.*)"$/, '$1');
            if (cur !== value) { changes.push(`${e.key}: ${cur} -> ${value}`); e.raw = want; }
        }
        if (!found) {
            changes.push(`${key}: (unset) -> ${value}`);
            // keep the dict sorted the way Xcode writes it
            let at = entries.findIndex(e => e.key.localeCompare(key, 'en') > 0);
            if (at === -1) at = entries.length;
            entries.splice(at, 0, { key, raw: line });
        }
    }
    const newInner = entries.map(e => e.raw).join('') + trailing;
    return { text: text.slice(0, bsOpen + 1) + newInner + text.slice(bsClose), name, changes };
}

function patchText(text, sign, expectConfigs) {
    const targets = findTargets(text);
    const apps = targets.filter(t => t.productType === PRODUCT_APP);
    const exts = targets.filter(t => t.productType === PRODUCT_EXT);
    if (apps.length === 0 || apps.length !== exts.length) {
        fail(`expected application and app-extension targets in pairs, found: ${targets.map(t => `${t.name} (${t.productType})`).join(', ') || 'none'}`);
    }
    const common = { CODE_SIGN_STYLE: sign.style, CODE_SIGN_IDENTITY: sign.identity, DEVELOPMENT_TEAM: sign.team };
    const report = [];
    let out = text;
    for (const [t, bundleId] of [...apps.map(a => [a, sign.appId]), ...exts.map(e => [e, sign.extId])]) {
        if (!t.listId) fail(`target ${t.name} has no buildConfigurationList`);
        for (const cfgId of configIds(out, t.listId)) {
            const r = patchConfig(out, cfgId, { PRODUCT_BUNDLE_IDENTIFIER: bundleId, ...common });
            out = r.text;
            report.push({ target: t.name, productType: t.productType, config: r.name, id: cfgId, changes: r.changes, bundleId });
        }
    }
    if (report.length !== expectConfigs) fail(`expected ${expectConfigs} target build configurations, found ${report.length}`);
    const names = report.map(r => `${r.target}/${r.config}`);
    if (new Set(names).size !== report.length) fail(`duplicate configurations: ${names.join(', ')}`);
    return { out, report, expected: { ...common } };
}

/** Independent post-check through plutil's own parser. */
function postCheck(file, expected, sign, expectConfigs) {
    const lint = spawnSync('/usr/bin/plutil', ['-lint', file], { encoding: 'utf8' });
    if (lint.status !== 0) fail(`plutil -lint failed: ${(lint.stdout + lint.stderr).trim()}`);
    const conv = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (conv.status !== 0) fail(`plutil -convert json failed: ${conv.stderr.trim()}`);
    const { objects } = JSON.parse(conv.stdout);
    let n = 0;
    for (const t of Object.values(objects).filter(o => o.isa === 'PBXNativeTarget')) {
        const bundleId = t.productType === PRODUCT_APP ? sign.appId : t.productType === PRODUCT_EXT ? sign.extId : null;
        if (bundleId === null) continue;
        for (const cid of objects[t.buildConfigurationList].buildConfigurations) {
            const bs = objects[cid].buildSettings;
            const want = { PRODUCT_BUNDLE_IDENTIFIER: bundleId, ...expected };
            for (const [k, v] of Object.entries(want)) {
                for (const key of Object.keys(bs).filter(x => x === k || x.startsWith(`${k}[`))) {
                    if (bs[key] !== v) fail(`post-check: ${t.name}/${objects[cid].name} ${key} = ${bs[key]}, expected ${v}`);
                }
                if (bs[k] !== v) fail(`post-check: ${t.name}/${objects[cid].name} ${k} missing`);
            }
            n++;
        }
    }
    if (n !== expectConfigs) fail(`post-check: ${n} target configurations verified, expected ${expectConfigs}`);
    return lint.stdout.trim();
}

async function main() {
    const args = process.argv.slice(2);
    const opt = (name) => {
        const i = args.indexOf(name);
        if (i === -1) return undefined;
        if (args[i + 1] === undefined) fail(`${name} needs a value`);
        return args[i + 1];
    };
    const check = args.includes('--check');
    const file = resolveProject(opt('--project'));
    if (!isFile(file)) fail(`project.pbxproj not found: ${file} (run the converter first)`);
    const expectConfigs = Number(opt('--expect-configs') ?? 4);
    if (!Number.isInteger(expectConfigs) || expectConfigs < 2) fail('--expect-configs must be an integer >= 2');
    const explicit = ['--app-id', '--ext-id', '--team', '--identity', '--style'].map(opt);
    let sign;
    if (explicit.every(v => v === undefined)) {
        const r = resolveSigning();
        for (const w of r.warnings) console.warn(`${NAME}: WARNING: ${w}`);
        sign = { ...r };
    } else {
        if (explicit.some(v => v === undefined)) fail('pass all of --app-id --ext-id --team --identity --style, or none of them');
        const [appId, extId, team, identity, style] = explicit;
        sign = { appId, extId, team, identity, style, source: 'command line' };
    }
    if (!['Manual', 'Automatic'].includes(sign.style)) fail(`--style must be Manual or Automatic, got ${sign.style}`);
    console.log(`${NAME}: ${file}`);
    console.log(`${NAME}: app ${sign.appId}, extension ${sign.extId}, ${sign.style} signing, identity ${JSON.stringify(sign.identity)}, team ${JSON.stringify(sign.team)} (${sign.source})`);

    const text = fs.readFileSync(file, 'utf8');
    const { out, report, expected } = patchText(text, sign, expectConfigs);
    for (const r of report) {
        console.log(`${NAME}:   ${r.target} / ${r.config}: ${r.changes.length === 0 ? 'already patched' : r.changes.join('; ')}`);
    }
    console.log(`${NAME}: ${report.length} target build configurations matched`);

    if (out === text) {
        console.log(`${NAME}: nothing to change (idempotent)`);
        if (!check) console.log(`${NAME}: ${postCheck(file, expected, sign, expectConfigs)}; values confirmed through plutil`);
        return 0;
    }
    if (check) {
        console.log(`${NAME}: --check: patch needed`);
        return 1;
    }
    // Re-parse our own output: a second pass must be a no-op.
    if (patchText(out, sign, expectConfigs).out !== out) fail('internal error: patch is not idempotent');
    // Lint and check a temporary copy first; the project is replaced only if it passes.
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, out);
    let lint;
    try {
        lint = postCheck(tmp, expected, sign, expectConfigs);
    } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
    fs.renameSync(tmp, file);
    console.log(`${NAME}: written; ${lint.replace(tmp, file)}; values confirmed through plutil`);
    return 0;
}

runMain(NAME, main);

#!/usr/bin/env node
/*
 * lint-summary.mjs — groups a `web-ext lint --output json` report by owner
 * (see platforms/firefox/lint.sh) and decides the exit code.
 *
 *   node platforms/firefox/lint-summary.mjs <report.json> [--strict]
 *
 * Exit 1: an error in our files or in manifest.json (or, with --strict, a
 * warning in our files). Upstream files never fail it.
 */

import fs from 'node:fs';

const NAME = 'lint-firefox';
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const file = args.find(a => !a.startsWith('--'));
if (!file) {
    console.error('usage: node platforms/firefox/lint-summary.mjs <report.json> [--strict]');
    process.exit(2);
}
const report = JSON.parse(fs.readFileSync(file, 'utf8'));

/** Files of the Blocker overlay (scripts/stage.mjs); everything else comes from upstream. */
export function ownerOf(p) {
    if (!p) return 'manifest';
    if (p === 'manifest.json') return 'manifest';
    if (p.startsWith('ui/') || p === 'popup.html' || p === 'dashboard.html' || p === 'css/default.css') return 'ours';
    return 'upstream';
}

const groups = { ours: [], manifest: [], upstream: [] };
for (const type of ['errors', 'warnings', 'notices']) {
    for (const m of report[type] ?? []) groups[ownerOf(m.file)].push({ ...m, _type: m._type ?? type.replace(/s$/, '') });
}

const s = report.summary ?? {};
console.log(`${NAME}: ${s.errors ?? 0} error(s), ${s.warnings ?? 0} warning(s), ${s.notices ?? 0} notice(s)`);
for (const [owner, list] of Object.entries(groups)) {
    console.log(`${NAME}: ${owner}: ${list.length} message(s)`);
    for (const m of list) {
        const where = m.file ? `${m.file}${m.line ? `:${m.line}` : ''}${m.column ? `:${m.column}` : ''}` : '(package)';
        console.log(`    ${m._type.padEnd(7)} ${m.code}  ${where}  ${m.message}`);
    }
}
const minified = (report.metadata?.unknownMinifiedFiles ?? []).filter(p => ownerOf(p) === 'ours');
if (minified.length) {
    console.log(`${NAME}: ours: ${minified.length} minified file(s) the linter cannot attribute to a known library (AMO asks for the source code): ${minified.join(', ')}`);
}

const ourErrors = [...groups.ours, ...groups.manifest].filter(m => m._type === 'error');
const ourWarnings = groups.ours.filter(m => m._type === 'warning');
if (ourErrors.length || (strict && ourWarnings.length)) {
    console.error(`${NAME}: FAIL: ${ourErrors.length} error(s) in our files or the manifest${strict ? `, ${ourWarnings.length} warning(s) in our files (--strict)` : ''}`);
    process.exit(1);
}
console.log(`${NAME}: OK (no error in our files or the manifest${strict ? ', no warning in our files' : ''})`);

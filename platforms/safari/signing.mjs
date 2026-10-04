#!/usr/bin/env node
/*
 * signing.mjs — resolve the bundle identifiers and code signing of the Safari
 * builds.
 *
 *   node platforms/safari/signing.mjs [--shell | --json]
 *
 * Source, first match wins:
 *   1. BLOCKER_SIGNING_CONFIG=<file>   (the value "none" = no config at all)
 *   2. signing.local.json at the repository root (gitignored; copy signing.example.json)
 *   3. nothing: defaults below
 *
 * Config keys (all optional):
 *   developmentTeam   10-character Apple team id. Set: sign with "Apple Development"
 *                     (CODE_SIGN_STYLE Manual). Unset: ad-hoc signature ("Sign to Run
 *                     Locally"): Safari then shows the extension only while
 *                     "Allow unsigned extensions" is on (Settings > Developer).
 *                     The example value of older templates, ABCDE12345, is rejected.
 *   bundleIdPrefix    reverse-DNS prefix. App id = <prefix>, extension id = <prefix>.Extension.
 *                     Default "org.example.blocker" (a placeholder: change it). Any
 *                     *.example.* prefix is a placeholder too and gets the same warning.
 * An empty string ("") means unset, as in signing.example.json.
 *
 * BLOCKER_SAFARI_TARGET=safari-ios (set by package.sh) only changes the wording of the
 * missing-team warning: without a team, safari-ios is an unsigned iOS Simulator build.
 *
 * --shell prints `KEY='value'` lines for `eval` in package.sh:
 *   SIGN_SOURCE, SIGN_APP_ID, SIGN_EXT_ID, SIGN_TEAM, SIGN_IDENTITY, SIGN_STYLE, SIGN_MODE (team | adhoc)
 * Warnings go to stderr.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, fail, isFile, rel, runMain } from '../../scripts/lib/common.mjs';

const NAME = 'signing';
export const DEFAULT_PREFIX = 'org.example.blocker';
export const LOCAL_CONFIG = path.join(REPO, 'signing.local.json');
/** Example team id of earlier signing.example.json versions: never a real team. */
const EXAMPLE_TEAM = 'ABCDE12345';
/** Reserved example domains (RFC 2606) as a bundle id prefix: com.example.*, org.example.*, ... */
const RE_PLACEHOLDER_PREFIX = /^[a-z]+\.example(\.|$)/i;
// geckoId is read by platforms/firefox/gecko-id.mjs (Firefox add-on id); accepted here so one file serves both.
const KNOWN_KEYS = new Set(['developmentTeam', 'bundleIdPrefix', 'geckoId', '$comment', '_comment']);

export function resolveSigning() {
    const env = process.env.BLOCKER_SIGNING_CONFIG;
    let file = null;
    if (env !== undefined && env.trim() !== '') {
        if (env.trim().toLowerCase() !== 'none') {
            file = path.resolve(env);
            if (!isFile(file)) fail(`BLOCKER_SIGNING_CONFIG=${env}: file not found`);
        }
    } else if (isFile(LOCAL_CONFIG)) {
        file = LOCAL_CONFIG;
    }

    let cfg = {};
    if (file !== null) {
        try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
            fail(`${rel(file)} is not valid JSON: ${err.message}`);
        }
        if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) fail(`${rel(file)} must contain a JSON object`);
        for (const k of Object.keys(cfg)) {
            if (!KNOWN_KEYS.has(k)) fail(`${rel(file)}: unknown key ${JSON.stringify(k)} (expected developmentTeam, bundleIdPrefix, geckoId)`);
        }
    }

    const warnings = [];
    let team = cfg.developmentTeam;
    if (team === '' || team === null) team = undefined;
    if (team !== undefined && (typeof team !== 'string' || !/^[A-Z0-9]{10}$/.test(team))) {
        fail(`${rel(file)}: "developmentTeam" must be a 10-character Apple team id, got ${JSON.stringify(team)}`);
    }
    if (team === EXAMPLE_TEAM) {
        fail(`${rel(file)}: "developmentTeam" is the example value ${EXAMPLE_TEAM}. Put your own Apple team id ` +
            '(see docs/building.md#signing-and-bundle-identifiers) or set it to "" for an ad-hoc build.');
    }
    let prefix = cfg.bundleIdPrefix;
    if (prefix === '' || prefix === null) prefix = undefined;
    if (prefix !== undefined && (typeof prefix !== 'string' || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(prefix))) {
        fail(`${rel(file)}: "bundleIdPrefix" must be a reverse-DNS identifier such as com.example.blocker, got ${JSON.stringify(prefix)}`);
    }
    if (prefix === undefined) prefix = DEFAULT_PREFIX;
    if (RE_PLACEHOLDER_PREFIX.test(prefix)) {
        warnings.push(
            `bundle id prefix is the placeholder "${prefix}". Set "bundleIdPrefix" in signing.local.json ` +
            '(copy signing.example.json) to an identifier you own before you distribute or install this build.',
        );
    }
    if (team === undefined && process.env.BLOCKER_SAFARI_TARGET === 'safari-ios') {
        warnings.push(
            'no "developmentTeam": safari-ios is built unsigned for the iOS Simulator only. ' +
            'Set "developmentTeam" in signing.local.json to build for an iPhone or iPad.',
        );
    } else if (team === undefined) {
        warnings.push(
            'no "developmentTeam": the app is signed ad hoc ("Sign to Run Locally"). Safari shows the extension only ' +
            'while "Allow unsigned extensions" is on (Safari Settings > Developer), and that setting resets when Safari quits.',
        );
    }
    return {
        source: file === null ? 'defaults (no signing config)' : rel(file),
        appId: prefix,
        extId: `${prefix}.Extension`,
        team: team ?? '',
        identity: team === undefined ? '-' : 'Apple Development',
        style: 'Manual',
        mode: team === undefined ? 'adhoc' : 'team',
        warnings,
    };
}

const shq = v => `'${String(v).replace(/'/g, `'\\''`)}'`;

async function main() {
    const args = process.argv.slice(2);
    const s = resolveSigning();
    for (const w of s.warnings) {
        console.error(`${NAME}: WARNING: ${w}`);
    }
    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
    } else if (args.includes('--shell')) {
        const vars = {
            SIGN_SOURCE: s.source, SIGN_APP_ID: s.appId, SIGN_EXT_ID: s.extId, SIGN_TEAM: s.team,
            SIGN_IDENTITY: s.identity, SIGN_STYLE: s.style, SIGN_MODE: s.mode,
        };
        process.stdout.write(Object.entries(vars).map(([k, v]) => `${k}=${shq(v)}\n`).join(''));
    } else {
        console.log(`${NAME}: source   ${s.source}`);
        console.log(`${NAME}: app      ${s.appId}`);
        console.log(`${NAME}: appex    ${s.extId}`);
        console.log(`${NAME}: signing  ${s.mode === 'team' ? `Apple Development, team ${s.team}` : 'ad hoc (Sign to Run Locally)'}`);
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runMain(NAME, main);
}

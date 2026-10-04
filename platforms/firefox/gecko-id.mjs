#!/usr/bin/env node
/*
 * gecko-id.mjs — the Firefox add-on id (manifest browser_specific_settings.gecko.id)
 * of the Blocker build.
 *
 *   node platforms/firefox/gecko-id.mjs [--json]
 *
 * A fork must not reuse the upstream add-on id: addons.mozilla.org (AMO) ties an id
 * to the account that first signed it, Firefox treats two add-ons with the same id
 * as one (one replaces the other), and the upstream ids belong to uBlock Origin Lite
 * (uBOLiteRedux@raymondhill.net for the store, uBOLite.dev@raymondhill.net for the
 * local builds that `make` produces). scripts/make-pristine.mjs therefore replaces it
 * with the id resolved here, and scripts/verify-stage.mjs accepts exactly that one
 * manifest change (and rejects any *@raymondhill.net id).
 *
 * Source, first match wins:
 *   1. BLOCKER_GECKO_ID=<id>
 *   2. "geckoId" in the config file: BLOCKER_SIGNING_CONFIG=<file> (the value "none"
 *      = no config file), else signing.local.json at the repository root (gitignored;
 *      copy signing.example.json). The other keys of that file are for Safari.
 *   3. the default "blocker@example.org" (a placeholder, with a warning: change it
 *      before you publish your build on AMO or share it).
 * Any id on a reserved example domain (@example.org, @example.com, @example.net) gets
 * the same warning, wherever it comes from.
 *
 * Valid ids (the formats AMO and Firefox accept): an e-mail-like id such as
 * blocker@example.org, or a GUID in braces such as {01234567-89ab-cdef-0123-456789abcdef};
 * at most 80 characters.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, fail, isFile, rel, runMain } from '../../scripts/lib/common.mjs';

const NAME = 'gecko-id';
export const DEFAULT_GECKO_ID = 'blocker@example.org';
const LOCAL_CONFIG = path.join(REPO, 'signing.local.json');

const RE_EMAIL_ID = /^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/;
const RE_GUID_ID = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;
/** Ids of the upstream project: never acceptable for this fork. */
export const RE_UPSTREAM_ID = /@raymondhill\.net$/i;
/** Ids on the reserved example domains (RFC 2606): placeholders. */
const RE_PLACEHOLDER_ID = /@example\.(com|org|net)$/i;

/** Problem with a gecko id as a string, or null when it is acceptable for a Blocker build. */
export function geckoIdProblem(id) {
    if (typeof id !== 'string' || id === '') return 'it is missing';
    if (id.length > 80) return 'it is longer than 80 characters';
    if (!RE_EMAIL_ID.test(id) && !RE_GUID_ID.test(id)) {
        return 'it is neither an e-mail-like id (name@domain) nor a GUID in braces';
    }
    if (RE_UPSTREAM_ID.test(id)) return 'it is an upstream uBlock Origin Lite id (*@raymondhill.net)';
    return null;
}

function configFile() {
    const env = process.env.BLOCKER_SIGNING_CONFIG;
    if (env !== undefined && env.trim() !== '') {
        if (env.trim().toLowerCase() === 'none') return null;
        const f = path.resolve(env);
        if (!isFile(f)) fail(`BLOCKER_SIGNING_CONFIG=${env}: file not found`);
        return f;
    }
    return isFile(LOCAL_CONFIG) ? LOCAL_CONFIG : null;
}

/** { id, source, warnings[] }. Throws (PipelineError) on an invalid configured id. */
export function resolveGeckoId() {
    const warnings = [];
    let id;
    let source;
    const env = process.env.BLOCKER_GECKO_ID;
    if (env !== undefined && env.trim() !== '') {
        id = env.trim();
        source = 'BLOCKER_GECKO_ID';
    } else {
        const file = configFile();
        if (file !== null) {
            let cfg;
            try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
                fail(`${rel(file)} is not valid JSON: ${err.message}`);
            }
            if (cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg) &&
                cfg.geckoId !== undefined && cfg.geckoId !== null && cfg.geckoId !== '') {
                id = cfg.geckoId;
                source = `${rel(file)} "geckoId"`;
            }
        }
    }
    if (id === undefined) {
        id = DEFAULT_GECKO_ID;
        source = 'default';
    }
    if (typeof id === 'string' && RE_PLACEHOLDER_ID.test(id)) {
        warnings.push(
            `Firefox add-on id is the placeholder "${id}". Set "geckoId" in signing.local.json ` +
            '(copy signing.example.json) or BLOCKER_GECKO_ID to an id you control before you submit the add-on ' +
            'to addons.mozilla.org or share the .xpi.',
        );
    }
    const problem = geckoIdProblem(id);
    if (problem !== null) fail(`invalid Firefox add-on id ${JSON.stringify(id)} from ${source}: ${problem}`);
    return { id, source, warnings };
}

async function main() {
    const r = resolveGeckoId();
    for (const w of r.warnings) console.error(`${NAME}: WARNING: ${w}`);
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    else console.log(`${NAME}: ${r.id} (${r.source})`);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runMain(NAME, main);
}

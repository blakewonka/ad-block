#!/usr/bin/env node
/*
 * Acceptance checks C1-C14 and S1 (docs/specs/legacy-tokens.md 7.1) for a legacy
 * stylesheet file.
 *
 * Usage: node scripts/check-legacy-css.mjs [FILE] [--upstream FILE] [--no-spec]
 *   FILE        default $BLOCKER_UI_DIST_DIR/legacy/default.css (ui/dist/legacy/default.css)
 *   --upstream  default: upstream src/css/themes/default.css (or the PRISTINE copy)
 *   --no-spec   skip C13 and C14 (comparison with the spec: 4.2 table, verbatim css blocks)
 * Exit 0 all pass, 1 a check failed, 2 usage / missing file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { DIST } from './lib/util.mjs';
import { checkLegacyCss, formatResults } from '../src/styles/legacy/checks.mjs';
import { readSpecMarkdown, readUpstreamCss } from '../src/styles/legacy/sources.mjs';

let file = path.join(DIST, 'legacy', 'default.css');
let upstreamFile = null;
let useSpec = true;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--upstream' && argv[i + 1]) { upstreamFile = path.resolve(argv[++i]); }
    else if (argv[i] === '--no-spec') { useSpec = false; }
    else if (!argv[i].startsWith('--')) { file = path.resolve(argv[i]); }
    else { console.error(`check-legacy-css: unknown argument ${argv[i]}`); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`check-legacy-css: ${file} does not exist`); process.exit(2); }

const G = fs.readFileSync(file, 'utf8');
const U = upstreamFile ? fs.readFileSync(upstreamFile, 'utf8') : readUpstreamCss().text;
const results = checkLegacyCss(G, U, { specMarkdown: useSpec ? readSpecMarkdown() : undefined });
console.log(`check-legacy-css: ${file}`);
console.log(formatResults(results));
const failed = results.filter(r => !r.ok);
console.log(failed.length === 0 ? 'check-legacy-css: PASS' : `check-legacy-css: FAIL (${failed.map(r => r.id).join(', ')})`);
process.exit(failed.length === 0 ? 0 : 1);

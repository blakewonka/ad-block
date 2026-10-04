#!/usr/bin/env node
/*
 * build:legacy-css — writes dist/legacy/default.css, the plain-CSS replacement
 * for the upstream css/default.css (docs/specs/legacy-tokens.md; staged by
 * the repository's scripts/stage.mjs over STAGE/css/default.css).
 *
 * Usage: node scripts/build-legacy-css.mjs [--out FILE]
 *   default output: $BLOCKER_UI_DIST_DIR/legacy/default.css (default ui/dist/legacy/default.css)
 *
 * Values come from the installed @openai/apps-sdk-ui CSS (resolved to
 * literals) and from upstream default.css. The result must pass the spec's
 * acceptance checks C1-C14 and S1 (src/styles/legacy/checks.mjs) or nothing is
 * written and the script exits 1 (a stale output file is removed).
 */

import fs from 'node:fs';
import path from 'node:path';

import { DIST, runMain, fail } from './lib/util.mjs';
import { checkLegacyCss, formatResults } from '../src/styles/legacy/checks.mjs';
import { generateLegacyCss } from '../src/styles/legacy/generate.mjs';
import { readGeneratorInputs, readSpecMarkdown } from '../src/styles/legacy/sources.mjs';

function parseArgs(argv) {
    const args = { out: path.join(DIST, 'legacy', 'default.css') };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out' && argv[i + 1]) { args.out = path.resolve(argv[++i]); }
        else { fail(`unknown argument ${argv[i]} (usage: build-legacy-css.mjs [--out FILE])`); }
    }
    return args;
}

await runMain('build-legacy-css', async () => {
    const args = parseArgs(process.argv.slice(2));
    const { inputs, upstreamFile, warnings } = readGeneratorInputs();
    for (const w of warnings) { console.warn(`build-legacy-css: WARNING: ${w}`); }

    let css;
    try {
        ({ css } = generateLegacyCss(inputs));
    } catch (err) {
        fs.rmSync(args.out, { force: true });
        fail(err.message);
    }

    const spec = readSpecMarkdown();
    if (spec === undefined) { console.warn('build-legacy-css: WARNING: spec not found, C13 skipped'); }
    const results = checkLegacyCss(css, inputs.upstreamCss, { specMarkdown: spec });
    const failed = results.filter(r => !r.ok);
    if (failed.length !== 0) {
        console.error(formatResults(results));
        fs.rmSync(args.out, { force: true });
        fail(`${failed.length} acceptance check(s) failed: ${failed.map(r => r.id).join(', ')}; nothing written`);
    }

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    const tmp = `${args.out}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, css);
    fs.renameSync(tmp, args.out);
    console.log(`build-legacy-css: wrote ${args.out} (${Buffer.byteLength(css)} bytes, library ${inputs.libraryVersion}, upstream ${upstreamFile})`);
    console.log(`build-legacy-css: checks ${results.map(r => r.id).join(' ')} passed`);
    return 0;
});

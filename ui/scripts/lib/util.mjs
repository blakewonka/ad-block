/*
 * Small helpers for the ui/ npm scripts (build:legacy-css, check-legacy-css).
 * The extension build pipeline itself lives in the repository's scripts/.
 *
 *   DIST   ui/dist, or BLOCKER_UI_DIST_DIR
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const env = process.env.BLOCKER_UI_DIST_DIR;
export const DIST = env && env.trim() !== '' ? path.resolve(env) : path.join(UI, 'dist');

export class PipelineError extends Error {}

export function fail(msg) {
    throw new PipelineError(msg);
}

/** Run `main` and turn PipelineError into a clean message + exit code 1. */
export async function runMain(name, main) {
    try {
        const code = await main();
        process.exitCode = typeof code === 'number' ? code : 0;
    } catch (err) {
        if (err instanceof PipelineError) {
            console.error(`${name}: ERROR: ${err.message}`);
        } else {
            console.error(`${name}: unexpected error`);
            console.error(err);
        }
        process.exitCode = 1;
    }
}

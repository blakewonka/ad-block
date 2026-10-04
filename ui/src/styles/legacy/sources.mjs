/*
 * File locations and loading for the legacy stylesheet generator.
 * Node only (used by scripts/*.mjs and the unit tests).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Repository root (ui/ is one of its folders). */
export const ROOT_DIR = path.resolve(UI_DIR, '..');
/** The upstream uBlock source (git submodule). */
export const UPSTREAM_DIR = path.join(ROOT_DIR, 'upstream');
export const LEGACY_SRC_DIR = path.join(UI_DIR, 'src', 'styles', 'legacy');
export const LIBRARY_DIR = path.join(UI_DIR, 'node_modules', '@openai', 'apps-sdk-ui');
export const LIBRARY_STYLES_DIR = path.join(LIBRARY_DIR, 'dist', 'es', 'styles');
export const LIBRARY_VARIABLE_FILES = ['variables-primitive.css', 'variables-semantic.css', 'variables-components.css'];
/** Upstream source of css/default.css (tools/make-mv3.sh copies it; spec 1.1). */
export const UPSTREAM_DEFAULT_CSS = path.join(UPSTREAM_DIR, 'src', 'css', 'themes', 'default.css');
export const PRISTINE_DEFAULT_CSS = path.join(
    process.env.BLOCKER_PRISTINE_DIR ? path.resolve(process.env.BLOCKER_PRISTINE_DIR) : path.join(ROOT_DIR, 'build', 'pristine', 'safari'),
    'css', 'default.css',
);
export const SPEC_FILE = path.join(ROOT_DIR, 'docs', 'specs', 'legacy-tokens.md');

const read = p => fs.readFileSync(p, 'utf8');

/** Read upstream default.css: the upstream source, else the PRISTINE copy. */
export function readUpstreamCss() {
    const candidates = [UPSTREAM_DEFAULT_CSS, PRISTINE_DEFAULT_CSS];
    const found = candidates.filter(p => fs.existsSync(p));
    if (found.length === 0) {
        throw new Error(`upstream default.css not found (looked at ${candidates.join(', ')})`);
    }
    const texts = found.map(read);
    const warnings = [];
    if (texts.length === 2 && texts[0] !== texts[1]) {
        warnings.push(`${UPSTREAM_DEFAULT_CSS} and ${PRISTINE_DEFAULT_CSS} differ; using the first`);
    }
    return { text: texts[0], file: found[0], warnings };
}

/** Everything generateLegacyCss() needs. */
export function readGeneratorInputs() {
    const pkg = JSON.parse(read(path.join(LIBRARY_DIR, 'package.json')));
    const upstream = readUpstreamCss();
    return {
        inputs: {
            libraryCss: LIBRARY_VARIABLE_FILES.map(f => read(path.join(LIBRARY_STYLES_DIR, f))),
            upstreamCss: upstream.text,
            codemirrorCss: read(path.join(LEGACY_SRC_DIR, 'codemirror.css')),
            focusCss: read(path.join(LEGACY_SRC_DIR, 'focus.css')),
            embedLayoutCss: read(path.join(LEGACY_SRC_DIR, 'embed-layout.css')),
            embedCss: read(path.join(LEGACY_SRC_DIR, 'embed.css')),
            libraryVersion: String(pkg.version),
        },
        upstreamFile: upstream.file,
        warnings: upstream.warnings,
    };
}

export function readSpecMarkdown() {
    return fs.existsSync(SPEC_FILE) ? read(SPEC_FILE) : undefined;
}

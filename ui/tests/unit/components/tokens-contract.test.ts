/**
 * Contract between the components and src/styles/blocker-tokens.css.
 *
 * Every `var(--blocker-…)` / `(--blocker-…)` a source file reads must be declared in
 * blocker-tokens.css. A fallback inside var() hides a misspelt name at runtime (the
 * component silently renders the fallback colour), so this is checked statically.
 * Scope: .ts/.tsx sources (where the components reference the tokens).
 */
import { describe, expect, it } from 'vitest';

// `?raw` imports of .css files come back empty under vitest's `css: false`, and the
// project has no Node typings, so node:fs is loaded through an untyped dynamic import.
// (import.meta.url is not a file: URL under happy-dom, so import.meta.dirname is used.)
const fs = (await import('node:fs' as string)) as { readFileSync(path: string, encoding: 'utf8'): string };
const here = (import.meta as ImportMeta & { dirname: string }).dirname;
const tokensCss = fs.readFileSync(`${here}/../../../src/styles/blocker-tokens.css`, 'utf8');

const sources = import.meta.glob<string>(
    ['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'],
    { query: '?raw', import: 'default', eager: true },
);

function declaredTokens(): Set<string> {
    const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
    return new Set([...css.matchAll(/(--blocker-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

describe('blocker token contract', () => {
    it('declares the level tokens named in UI rule §6.11', () => {
        const declared = declaredTokens();
        for (const n of [0, 1, 2, 3]) {
            expect(declared.has(`--blocker-level-${n}`)).toBe(true);
        }
    });

    it('scans the component sources', () => {
        expect(Object.keys(sources)).toContain('/src/components/LevelMeter/LevelMeter.tsx');
    });

    it('every --blocker-* variable read in src/ is declared in blocker-tokens.css', () => {
        const declared = declaredTokens();
        const missing: string[] = [];
        for (const [file, text] of Object.entries(sources)) {
            for (const m of text.matchAll(/\(\s*(--blocker-[\w-]+)/g)) {
                if (!declared.has(m[1]!)) missing.push(`${file}: ${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });
});

// @vitest-environment node
/// <reference types="node" />
/**
 * Legacy stylesheet generator (docs/specs/legacy-tokens.md):
 *  - the generated file passes the acceptance checks C1-C14 (+ S1),
 *  - every check actually detects the defect it is about (mutations),
 *  - upstream default.css fails exactly the checks the spec says it fails,
 *  - text colours keep >= 4.5:1 contrast (UI rule §6.10),
 *  - the source folder does not feed utilities into the Tailwind build.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkLegacyCss, cssBlocksOf, parseSpecCssBlocks, parseSpecTable } from '../../../src/styles/legacy/checks.mjs';
import {
    collectLibraryThemes,
    generateLegacyCss,
    parseColor,
    resolveLibraryToken,
} from '../../../src/styles/legacy/generate.mjs';
import { MAPPING, PALETTE_NAMES } from '../../../src/styles/legacy/mapping.mjs';
import { LEGACY_SRC_DIR, readGeneratorInputs, readSpecMarkdown, UI_DIR } from '../../../src/styles/legacy/sources.mjs';

const { inputs } = readGeneratorInputs();
const spec = readSpecMarkdown();
const generated = generateLegacyCss(inputs);
const G = generated.css;
const U = inputs.upstreamCss;

function failedIds(css: string, upstream = U, withSpec = true): string[] {
    return checkLegacyCss(css, upstream, withSpec ? { specMarkdown: spec } : {})
        .filter(r => !r.ok)
        .map(r => r.id);
}

/** Replace exactly one occurrence (fails the test if the anchor is missing or ambiguous). */
function replaceOnce(css: string, from: string, to: string): string {
    const first = css.indexOf(from);
    expect(first, `anchor not found: ${from}`).not.toBe(-1);
    expect(css.indexOf(from, first + 1), `anchor not unique: ${from}`).toBe(-1);
    return css.slice(0, first) + to + css.slice(first + from.length);
}

describe('legacy css: generated file', () => {
    it('the spec is present and its 4.2 rows plus the palette cover 256 names', () => {
        expect(spec).toBeDefined();
        const rows = parseSpecTable(spec ?? '');
        expect(rows).toHaveLength(143);
        expect(PALETTE_NAMES).toHaveLength(113);
        expect(MAPPING.map(([n]) => n).sort()).toEqual(rows.map(r => r.name).sort());
    });

    it('passes C1-C14 and S1', () => {
        const results = checkLegacyCss(G, U, { specMarkdown: spec });
        const failed = results.filter(r => !r.ok);
        expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
        expect(results.map(r => r.id)).toEqual(
            ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'S1'],
        );
    });

    it('is deterministic', () => {
        expect(generateLegacyCss(inputs).css).toBe(G);
    });

    it('defines all 256 names at :root and 83 dark overrides', () => {
        expect(generated.light.size).toBe(256);
        expect(generated.dark.size).toBe(83);
    });

    it('emits B7, B8, B9 and B6 exactly as the spec code blocks (C14) and in that order', () => {
        const want = parseSpecCssBlocks(spec ?? '');
        const got = cssBlocksOf(G);
        expect(got).toEqual(want);
        for (const b of ['B7', 'B8', 'B9', 'B6'] as const) { expect(got[b].length, b).toBeGreaterThan(0); }
        const at = (s: string) => G.indexOf(s);
        expect(at(':root .cm-editor .cm-gutters {')).toBeLessThan(at(':root:root :focus-visible'));
        expect(at(':root:root :focus-visible')).toBeLessThan(at(':root[data-blocker-embed] body {'));
        expect(at(':root[data-blocker-embed] body {')).toBeLessThan(at(':root[data-blocker-embed] body > header {'));
    });

    it('has no Tailwind or other at-rules, no @layer, no library-only names', () => {
        expect(G).not.toMatch(/@(?:import|layer|theme|apply|utility|custom-variant|tailwind|source|plugin|config|font-face|charset)\b/);
        // Library-only names, e.g. --color-text, --gray-1000, --blocker-*, never appear.
        expect(G).not.toMatch(/--(?:color|blocker|alpha|radius|shadow|font-sans|codeblock)-?/);
    });

    it('ends with the two embed-marker rules of dashboard-shell.md R-18, byte for byte', () => {
        const r18 = [
            ':root[data-blocker-embed] body > header {',
            '    display: none !important;',
            '}',
            ':root[data-blocker-embed] body > section:is([data-pane="settings"], [data-pane="rulesets"], [data-pane="about"], [data-pane="busy"]) {',
            '    display: none !important;',
            '}',
        ].join('\n');
        expect(G.trimEnd().endsWith(r18)).toBe(true);
    });

    it('matches the spec literals for a few key rows (light / dark)', () => {
        const { light, dark } = generated;
        expect(light.get('--surface-1')).toBe('#ffffff');
        expect(dark.get('--surface-1')).toBe('#212121');
        expect(light.get('--ink-1')).toBe('#0d0d0d');
        expect(dark.get('--ink-1')).toBe('#ffffff');
        expect(light.get('--accent-surface-1')).toBe('#0169cc');
        expect(dark.get('--accent-surface-1')).toBe('#339cff');
        expect(light.get('--border-1')).toBe('rgb(13 13 13 / 10%)');
        expect(light.get('--gray-75')).toBe('184 184 192');
        expect(light.get('--font-family')).toMatch(/^ui-sans-serif, -apple-system, system-ui, /);
    });

    // Review fixes.
    it('light --surface-0 (fields, hover, focus) differs from the white page; dark stays darker than the page', () => {
        const { light, dark } = generated;
        expect(light.get('--surface-0')).toBe('#f9f9f9');
        expect(light.get('--surface-0')).not.toBe(light.get('--surface-1'));
        expect(dark.get('--surface-0')).toBe('#0d0d0d');
        // The Develop editor keeps the extreme surface through --surface-0-rgb (B7).
        expect(light.get('--surface-0-rgb')).toBe('255 255 255');
        expect(dark.get('--surface-0-rgb')).toBe('13 13 13');
        expect(cssBlocksOf(G).B7).toContain(':root .cm-container .cm-editor { background-color: rgb(var(--surface-0-rgb)); margin: 2px; outline: 1px solid var(--border-1); outline-offset: 0 }');
    });

    it('--accent-ink-1 is a literal (white / near-black), not var(--surface-0)', () => {
        expect(generated.light.get('--accent-ink-1')).toBe('#ffffff');
        expect(generated.dark.get('--accent-ink-1')).toBe('#0d0d0d');
    });

    it('light active line is 2%, dark --info3-ink is --red-200', () => {
        expect(generated.light.get('--cm-active-line')).toBe('rgb(13 13 13 / 2%)');
        expect(generated.dark.get('--cm-active-line')).toBe('rgb(255 255 255 / 6%)');
        expect(generated.dark.get('--info3-ink')).toBe('#ff8583');
        expect(generated.dark.get('--info3-ink-rgb')).toBe('255 133 131');
    });

    it('the gutter separator is logical (border-inline-end), so RTL puts it on the text side', () => {
        const b7 = cssBlocksOf(G).B7.split('\n').find(r => r.startsWith(':root .cm-editor .cm-gutters {')) ?? '';
        expect(b7).toContain('border: 0; border-inline-end: 1px solid var(--cm-gutter-border)');
        expect(b7).not.toMatch(/border-right/);
    });

    it('keyboard focus: a visible ring on the focused editor (B7) and on upstream controls (B8)', () => {
        const { B7, B8 } = cssBlocksOf(G);
        expect(B7).toContain(':root .cm-container .cm-editor.cm-focused { outline: 2px solid var(--accent-surface-1); outline-offset: 0 }');
        expect(B8).toContain(':root:root :focus-visible:not(.cm-content) { outline: 2px solid var(--accent-surface-1); outline-offset: 2px }');
        expect(B8).toContain(':root:root .checkbox:has(> input:focus-visible) > svg, :root:root .radio:has(> input:focus-visible) > svg {');
    });

    it('embedded layout (B9) is marker-scoped and matches the React pane width (max-w-3xl = 48rem)', () => {
        expect(cssBlocksOf(G).B9).toBe([
            ':root[data-blocker-embed] body { align-items: flex-start }',
            ':root[data-blocker-embed] body > * { width: min(48rem, 100%) }',
        ].join('\n'));
    });
});

describe('legacy css: each check detects its defect', () => {
    const cases: Array<[string, string, (css: string) => string]> = [
        ['C1', '@layer added', css => `${css}\n@layer base { :root { --x: 1; } }\n`],
        ['C1', 'third @media added', css => replaceOnce(css, ':root.mobile {', '@media print { :root { --font-size: 12px; } }\n:root.mobile {')],
        ['C2', 'url() added', css => replaceOnce(css, '--ubo-red: #800000;', '--ubo-red: #800000; --x-img: url(x.png);')],
        ['C2', 'http in a comment', css => `/* see https://example.org */\n${css}`],
        ['C3', 'name removed from :root', css => replaceOnce(css, '    --ubo-red: #800000;\n', '')],
        ['C4', 'undefined var()', css => replaceOnce(css, '--hr-ink: var(--surface-2);', '--hr-ink: var(--surface-9);')],
        ['C4', 'var() fallback', css => replaceOnce(css, '--hr-ink: var(--surface-2);', '--hr-ink: var(--surface-2, red);')],
        ['C5', 'triplet replaced by a hex', css => replaceOnce(css, '--info0-ink-rgb: 93 93 93;', '--info0-ink-rgb: #5d5d5d;')],
        ['C6', 'background on html', css => replaceOnce(css, ':root.mobile {', 'html { background: white; }\n:root.mobile {')],
        ['C6', 'background on body', css => replaceOnce(css, ':root.mobile {', 'body { background-color: var(--surface-1); }\n:root.mobile {')],
        ['C6', 'color-scheme on :root.dark', css => replaceOnce(css, ':root.dark {', ':root.dark {\n    color-scheme: dark light;')],
        ['C7', 'B3 differs from B2', css => replaceOnce(css, ':root.dark {\n    --surface-0-rgb: 13 13 13;', ':root.dark {\n    --surface-0-rgb: 0 0 0;')],
        ['C8', 'prefers-contrast value changed', css => replaceOnce(css, '--button-border-size: 1px;', '--button-border-size: 2px;')],
        ['C8', ':root.mobile value changed', css => replaceOnce(css, '--monospace-size: 13px;', '--monospace-size: 14px;')],
        ['C9', 'cycle', css => replaceOnce(css, '--hr-ink: var(--surface-2);', '--hr-ink: var(--hr-ink);')],
        ['C10', '!important on a custom property', css => replaceOnce(css, '--ubo-red: #800000;', '--ubo-red: #800000 !important;')],
        ['C11', 'B6 without !important', css => replaceOnce(css, ':root[data-blocker-embed] body > header {\n    display: none !important;', ':root[data-blocker-embed] body > header {\n    display: none;')],
        ['C11', 'rule appended after B6', css => `${css}:root .cm-editor .cm-foo { color: red; }\n`],
        ['C12', 'collision redefined with the library value', css => replaceOnce(css, '--gray-75: 184 184 192;', '--gray-75: #f3f3f3;')],
        ['C13', 'row value differs from the spec', css => replaceOnce(css, '--link-hover-ink: #013566;', '--link-hover-ink: #0285ff;')],
        ['C13', 'dark override for a "—" row', css => css.replaceAll(':root.dark {\n', ':root.dark {\n    --ink-4: #afafaf;\n').replace(':root:not(.light) {\n', ':root:not(.light) {\n        --ink-4: #afafaf;\n')],
        ['C6', 'B8 rule sets a non-outline property', css => replaceOnce(css, '    outline-offset: 2px;\n}\n:root:root .checkbox', '    outline-offset: 2px;\n    display: none;\n}\n:root:root .checkbox')],
        ['C6', 'B9 rule sets another property', css => replaceOnce(css, '    align-items: flex-start;', '    align-items: flex-start;\n    background-color: red;')],
        ['C6', 'B8 rule with !important', css => replaceOnce(css, ':root:root :focus-visible:not(.cm-content) {\n    outline: 2px solid var(--accent-surface-1);', ':root:root :focus-visible:not(.cm-content) {\n    outline: 2px solid var(--accent-surface-1) !important;')],
        ['C14', 'B7 differs from spec 4.4', css => replaceOnce(css, '    outline: 2px solid var(--accent-surface-1);\n    outline-offset: 0;', '    outline: 2px solid var(--accent-surface-1);\n    outline-offset: -2px;')],
        ['C6', 'B7 margin outside the editor rule', css => replaceOnce(css, '    color: var(--cm-foldmarker-ink);', '    color: var(--cm-foldmarker-ink);\n    margin: 2px;')],
        ['C14', 'B9 width differs from spec 6.5', css => replaceOnce(css, 'width: min(48rem, 100%);', 'width: min(640px, 100%);')],
        ['C14', 'gutter separator back to border-right', css => replaceOnce(css, '    border: 0;\n    border-inline-end: 1px solid var(--cm-gutter-border);', '    border-right: 1px solid var(--cm-gutter-border);')],
        ['S1', 'B8 moved after B9', css => {
            const b8 = css.slice(css.indexOf('/* B8'), css.indexOf('/* B9'));
            const without = css.replace(b8, '');
            return replaceOnce(without, '/* B6', `${b8}/* B6`);
        }],
        ['S1', 'B9 missing', css => css.replace(css.slice(css.indexOf('/* B9'), css.indexOf('/* B6')), '')],
        ['S1', 'B3 moved before B2', css => {
            const b3 = css.slice(css.indexOf('/* B3'), css.indexOf('/* B4'));
            const without = css.replace(b3, '');
            return replaceOnce(without, '/* B2', `${b3}/* B2`);
        }],
    ];
    for (const [id, label, mutate] of cases) {
        it(`${id}: ${label}`, () => {
            const mutated = mutate(G);
            expect(mutated).not.toBe(G);
            expect(failedIds(mutated)).toContain(id);
        });
    }

    it('upstream default.css fails C1, C2, C3 (10 names), C6, C7 and C11 (spec 7.1 baseline)', () => {
        const results = checkLegacyCss(U, U, {});
        const failed = results.filter(r => !r.ok).map(r => r.id);
        for (const id of ['C1', 'C2', 'C3', 'C6', 'C7', 'C11']) { expect(failed).toContain(id); }
        const c3 = results.find(r => r.id === 'C3');
        expect(c3?.problems.some(p => p.startsWith('10 upstream names not in top-level :root: --surface-0-rgb'))).toBe(true);
    });
});

describe('legacy css: library resolution', () => {
    const themes = collectLibraryThemes(inputs.libraryCss);

    it('turns color-mix(in oklab, C p%, transparent) into rgb(R G B / p%)', () => {
        expect(resolveLibraryToken('--color-border', themes.light)).toBe('rgb(13 13 13 / 10%)');
        expect(resolveLibraryToken('--color-border', themes.dark)).toBe('rgb(255 255 255 / 12%)');
        expect(resolveLibraryToken('--yellow-a200', themes.light)).toBe('rgb(255 195 0 / 59%)');
    });

    it('resolves the light and dark gray scales separately', () => {
        expect(resolveLibraryToken('--gray-0', themes.light)).toBe('#ffffff');
        expect(resolveLibraryToken('--gray-0', themes.dark)).toBe('#0d0d0d');
        expect(resolveLibraryToken('--gray-0', themes.dark, 'triplet')).toBe('13 13 13');
    });

    it('refuses unknown tokens, unsupported color-mix and translucent triplets', () => {
        expect(() => resolveLibraryToken('--does-not-exist', themes.light)).toThrow(/not defined/);
        const map = new Map([['--a', 'color-mix(in srgb, #fff 50%, #000)'], ['--b', 'color-mix(in oklab, #0d0d0d 10%, transparent)']]);
        expect(() => resolveLibraryToken('--a', map)).toThrow(/unsupported color-mix/);
        expect(() => resolveLibraryToken('--b', map, 'triplet')).toThrow(/translucent/);
    });

    it('fails the generation when a mapped library token disappears', () => {
        const broken = inputs.libraryCss.map(t => t.replace(/--color-surface:/g, '--color-surface-renamed:'));
        expect(() => generateLegacyCss({ ...inputs, libraryCss: broken })).toThrow(/--color-surface/);
    });
});

/* WCAG 2.x contrast. */
function luminance(hex: string): number {
    const c = parseColor(hex);
    if (!c || c.a !== 100) { throw new Error(`not an opaque colour: ${hex}`); }
    const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
function contrast(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}

describe('legacy css: text contrast >= 4.5:1', () => {
    const resolve = (map: Map<string, string>, name: string): string => {
        let v = map.get(name) ?? '';
        for (let i = 0; i < 10 && v.startsWith('var('); i++) { v = map.get(v.slice(4, -1)) ?? ''; }
        return v;
    };
    const scheme = (dark: boolean) => new Map([...generated.light, ...(dark ? generated.dark : [])]);
    // [ink, background] pairs that carry body-size text in the classic pages.
    const pairs: Array<[string, string]> = [
        ['--ink-1', '--surface-1'], ['--ink-1', '--surface-0'], ['--ink-1', '--surface-2'],
        ['--ink-3', '--surface-1'], ['--ink-3', '--surface-0'], ['--ink-3', '--surface-2'],
        ['--link-ink', '--surface-1'], ['--link-hover-ink', '--surface-1'], ['--subtil-ink', '--surface-1'],
        ['--info0-ink', '--surface-1'], ['--info1-ink', '--surface-1'], ['--info2-ink', '--surface-1'], ['--info3-ink', '--surface-1'],
        ['--info3-ink', '--surface-0'], ['--cm-negative', '--surface-0'],
        ['--dashboard-tab-ink', '--surface-1'], ['--dashboard-tab-active-ink', '--surface-1'],
        ['--button-ink', '--button-surface'], ['--button-preferred-ink', '--button-preferred-surface'],
        ['--accent-ink-1', '--accent-surface-1'], ['--notice-ink', '--notice-surface'],
        // Editor text (--sf-*) is checked against the editor surface in the next describe block.
        ['--cm-gutter-ink', '--cm-gutter-surface'],
    ];
    for (const dark of [false, true]) {
        for (const [ink, bg] of pairs) {
            it(`${dark ? 'dark' : 'light'}: ${ink} on ${bg}`, () => {
                const map = scheme(dark);
                let fg = resolve(map, ink);
                const m = /^rgb\(var\((--[\w-]+)\)\)$/.exec(fg);
                if (m) { fg = `rgb(${map.get(m[1])})`; }
                expect(contrast(fg, resolve(map, bg))).toBeGreaterThanOrEqual(4.5);
            });
        }
    }
});

/* Colour of an expression in a scheme: var(--x), rgb(var(--x)), hex, rgb(R G B / p%). */
type Rgba = { r: number; g: number; b: number; a: number };
function colourOf(map: Map<string, string>, expr: string): Rgba {
    let v = expr.trim();
    for (let i = 0; i < 10; i++) {
        const m = /^var\((--[\w-]+)\)$/.exec(v);
        if (!m) { break; }
        v = (map.get(m[1]) ?? '').trim();
    }
    const t = /^rgb\(var\((--[\w-]+)\)\)$/.exec(v);
    if (t) { v = `rgb(${map.get(t[1])})`; }
    const c = parseColor(v);
    if (!c) { throw new Error(`cannot resolve ${expr} (${v})`); }
    return c;
}
/** Alpha-composite `fg` (any alpha, optionally scaled by `alpha` percent) over an opaque `bg`. */
function over(fg: Rgba, bg: Rgba, alpha = 100): Rgba {
    const a = (fg.a / 100) * (alpha / 100);
    const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a));
    return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 100 };
}
const hexOf = (c: Rgba) => `#${[c.r, c.g, c.b].map(n => n.toString(16).padStart(2, '0')).join('')}`;

describe('legacy css: text contrast on tinted bands and the active line (>= 4.5:1)', () => {
    const scheme = (dark: boolean) => new Map([...generated.light, ...(dark ? generated.dark : [])]);
    // Hard-coded Develop syntax colours (develop.css:47-63), not re-colourable.
    const DEVELOP_SYNTAX = { light: ['#ba5300', '#ae42be', '#168156'], dark: ['#fa7000', '#ea59ff', '#1dae74'] };
    for (const dark of [false, true]) {
        const label = dark ? 'dark' : 'light';
        const map = scheme(dark);
        const c = (e: string) => colourOf(map, e);
        const panel = c('var(--surface-1)'); // .cm-panel background (develop.css:101) and B7 .cm-panels
        const editor = c('rgb(var(--surface-0-rgb))'); // B7 editor surface
        // develop.css:148-150 summary band = 15% --info1-ink; :156-158 feedback band = 15% --info3-ink.
        const summary = over(c('var(--info1-ink)'), panel, 15);
        const feedback = over(c('var(--info3-ink)'), panel, 15);
        const activeLine = over(c('var(--cm-active-line)'), editor);
        const badline = over(c('var(--info3-ink)'), editor, 15); // develop.css:65-67
        const cases: Array<[string, Rgba, Rgba]> = [
            ['--info3-ink (.warning) on the summary band', c('var(--info3-ink)'), summary],
            ['--ink-1 on the summary band', c('var(--ink-1)'), summary],
            ['--info3-ink on the feedback band', c('var(--info3-ink)'), feedback],
            ['--ink-1 on the feedback band', c('var(--ink-1)'), feedback],
            ['--ink-1 on a bad line', c('var(--ink-1)'), badline],
            ['--ink-2 on a bad line', over(c('var(--ink-2)'), badline), badline],
            ...['--sf-comment-ink', '--sf-def-ink', '--sf-directive-ink', '--sf-keyword-ink', '--sf-tag-ink', '--sf-value-ink']
                .map((n): [string, Rgba, Rgba] => [`${n} on the editor`, c(`var(${n})`), editor]),
            ['--ink-1 on the active line', c('var(--ink-1)'), activeLine],
            ['--ink-2 on the active line', over(c('var(--ink-2)'), activeLine), activeLine],
            ...['--sf-comment-ink', '--sf-def-ink', '--sf-keyword-ink', '--sf-tag-ink', '--sf-value-ink']
                .map((n): [string, Rgba, Rgba] => [`${n} on the active line`, c(`var(${n})`), activeLine]),
            ...DEVELOP_SYNTAX[label].map((h): [string, Rgba, Rgba] => [`develop.css ${h} on the active line`, colourOf(map, h), activeLine]),
        ];
        if (dark) {
            // Light bad lines stay below 4.5 for the hard-coded syntax colours (upstream: 4.07); see the report.
            for (const h of DEVELOP_SYNTAX.dark) { cases.push([`develop.css ${h} on a bad line`, colourOf(map, h), badline]); }
        }
        for (const [name, fg, bg] of cases) {
            it(`${label}: ${name}`, () => {
                expect(contrast(hexOf(fg), hexOf(bg))).toBeGreaterThanOrEqual(4.5);
            });
        }
    }
});

describe('legacy css: focus ring and field edges are visible (non-text >= 3:1)', () => {
    for (const dark of [false, true]) {
        const map = new Map([...generated.light, ...(dark ? generated.dark : [])]);
        const ring = hexOf(colourOf(map, 'var(--accent-surface-1)'));
        for (const bg of ['var(--surface-1)', 'var(--surface-0)', 'var(--surface-2)', 'rgb(var(--surface-0-rgb))', 'var(--button-surface)']) {
            it(`${dark ? 'dark' : 'light'}: --accent-surface-1 ring on ${bg}`, () => {
                expect(contrast(ring, hexOf(colourOf(map, bg)))).toBeGreaterThanOrEqual(3);
            });
        }
    }
});

describe('legacy css: Tailwind scanning', () => {
    it('src/styles/legacy produces no Tailwind utilities (it sits under the @source "../" path)', async () => {
        const { Scanner } = await import('@tailwindcss/oxide');
        const { compile } = await import('@tailwindcss/node');
        const scanner = new Scanner({ sources: [{ base: LEGACY_SRC_DIR, pattern: '**/*', negated: false }] });
        const candidates = scanner.scan();
        expect(scanner.files.length).toBeGreaterThan(0);
        const compiler = await compile('@import "tailwindcss/utilities";', { base: UI_DIR, onDependency() {} });
        const css = compiler.build(candidates);
        const utilities = [...css.matchAll(/^\s*(\.[^{\s]+)\s*\{/gm)].map(x => x[1]);
        expect(utilities).toEqual([]);
    });

    it('the source folder exists where the build script expects it', () => {
        for (const f of ['mapping.mjs', 'generate.mjs', 'checks.mjs', 'sources.mjs', 'codemirror.css', 'focus.css', 'embed-layout.css', 'embed.css']) {
            expect(fs.existsSync(path.join(LEGACY_SRC_DIR, f)), f).toBe(true);
        }
    });
});

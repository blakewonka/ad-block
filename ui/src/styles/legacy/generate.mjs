/*
 * Generator for the legacy stylesheet `css/default.css`
 * (docs/specs/legacy-tokens.md, sections 4 and 5).
 * Used by scripts/build-legacy-css.mjs and the unit tests.
 *
 * Pure functions over text: the caller reads the files (library variable
 * CSS, upstream default.css, the two verbatim blocks) and writes the result.
 * Only dependency: postcss (present in node_modules as a dependency of vite;
 * not added to package.json).
 */

import postcss from 'postcss';

import { COLLIDING_NAMES, MAPPING, PALETTE_NAMES } from './mapping.mjs';

export class LegacyCssError extends Error {}

const fail = msg => { throw new LegacyCssError(msg); };

export const normalizeSpace = s => s.replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------------- *
 * Library side: collect the theme-independent, light and dark declarations.
 * ------------------------------------------------------------------------- */

/**
 * Classify a library rule by its selector (spec 4.1).
 * 'common'  `:root, :where([data-theme])`, `:where([data-theme])`
 * 'light'   `:where(:root), :where([data-theme="light"])`, `:where([data-theme="light"])`
 * 'dark'    `:where([data-theme="dark"])`
 * null      anything else (e.g. descendant scopes such as [data-surface="elevated"])
 */
function classifyLibrarySelector(selector) {
    const parts = selector.split(',').map(s => normalizeSpace(s)).sort();
    const key = parts.join(',');
    switch (key) {
    case ':root,:where([data-theme])':
    case ':where([data-theme])':
        return 'common';
    case ':where(:root),:where([data-theme="light"])':
    case ':where([data-theme="light"])':
        return 'light';
    case ':where([data-theme="dark"])':
        return 'dark';
    default:
        return null;
    }
}

function insideMedia(node) {
    for (let p = node.parent; p; p = p.parent) {
        if (p.type === 'atrule' && p.name === 'media') { return true; }
    }
    return false;
}

/**
 * @param {string[]} cssTexts text of variables-primitive/-semantic/-components.css, in that order
 * @returns {{ light: Map<string,string>, dark: Map<string,string> }}
 */
export function collectLibraryThemes(cssTexts) {
    const common = new Map();
    const light = new Map();
    const dark = new Map();
    for (const text of cssTexts) {
        const root = postcss.parse(text);
        // Tailwind `@theme` at-rule: theme-independent declarations.
        root.walkAtRules('theme', at => {
            at.each(node => {
                if (node.type === 'decl' && node.prop.startsWith('--')) {
                    common.set(node.prop, node.value);
                }
            });
        });
        root.walkRules(rule => {
            // The @media (resolution ...) hairline blocks are ignored (spec 4.1).
            if (insideMedia(rule)) { return; }
            const kind = classifyLibrarySelector(rule.selector);
            if (kind === null) { return; }
            const target = kind === 'common' ? common : kind === 'light' ? light : dark;
            rule.each(node => {
                if (node.type === 'decl' && node.prop.startsWith('--')) {
                    target.set(node.prop, node.value);
                }
            });
        });
    }
    return {
        light: new Map([...common, ...light]),
        dark: new Map([...common, ...dark]),
    };
}

/** Find the matching ')' for the '(' at index `open`. */
function matchParen(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === '(') { depth += 1; }
        else if (s[i] === ')') {
            depth -= 1;
            if (depth === 0) { return i; }
        }
    }
    return fail(`unbalanced parentheses in "${s}"`);
}

/** Replace every var(--x[, fallback]) by its value, recursively. */
function substituteVars(value, map, stack) {
    let out = '';
    let i = 0;
    for (;;) {
        const at = value.indexOf('var(', i);
        if (at === -1) { out += value.slice(i); break; }
        out += value.slice(i, at);
        const close = matchParen(value, at + 3);
        const inner = value.slice(at + 4, close);
        const comma = inner.indexOf(',');
        const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
        const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
        if (map.has(name)) {
            out += resolveRaw(name, map, stack);
        } else if (fallback !== null) {
            out += substituteVars(fallback, map, stack);
        } else {
            fail(`library variable ${name} is not defined (needed by ${stack.at(-1)})`);
        }
        i = close + 1;
    }
    return out;
}

function resolveRaw(name, map, stack = []) {
    if (stack.includes(name)) {
        fail(`cycle in library variables: ${[...stack, name].join(' -> ')}`);
    }
    if (!map.has(name)) { fail(`library variable ${name} is not defined`); }
    return normalizeSpace(substituteVars(map.get(name), map, [...stack, name]));
}

/* ------------------------------------------------------------------------- *
 * Colours
 * ------------------------------------------------------------------------- */

const NAMED = { white: '#ffffff', black: '#000000' };

/** Parse an opaque or translucent colour literal into { r, g, b, a } (a = 0..100 percent). */
export function parseColor(text) {
    const s = normalizeSpace(text).toLowerCase();
    const named = NAMED[s];
    if (named) { return parseColor(named); }
    let m = /^#([0-9a-f]{3,8})$/.exec(s);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) { h = [...h].map(c => c + c).join(''); }
        if (h.length !== 6 && h.length !== 8) { return null; }
        const n = i => parseInt(h.slice(i, i + 2), 16);
        const a = h.length === 8 ? Math.round(n(6) / 255 * 100) : 100;
        return { r: n(0), g: n(2), b: n(4), a };
    }
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+)(%?)\s*)?\)$/.exec(s);
    if (m) {
        let a = 100;
        if (m[4] !== undefined) { a = m[5] === '%' ? Number(m[4]) : Number(m[4]) * 100; }
        return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    return null;
}

/**
 * `color-mix(in oklab, C p%, transparent)` == C with alpha p (premultiplied
 * interpolation with a fully transparent colour). Any other color-mix is
 * refused, so a library change that needs real colour maths fails the build.
 */
function evalColorMix(value) {
    let s = value;
    for (;;) {
        const at = s.indexOf('color-mix(');
        if (at === -1) { return s; }
        const close = matchParen(s, at + 9);
        const inner = normalizeSpace(s.slice(at + 10, close));
        const m = /^in oklab, (.+?) ([\d.]+)%, transparent$/.exec(inner);
        if (!m) { fail(`unsupported color-mix(): color-mix(${inner})`); }
        const c = parseColor(m[1]);
        if (!c || c.a !== 100) { fail(`unsupported colour in color-mix(): ${m[1]}`); }
        const rgb = `rgb(${c.r} ${c.g} ${c.b} / ${Number(m[2])}%)`;
        s = s.slice(0, at) + rgb + s.slice(close + 1);
    }
}

const hex2 = n => n.toString(16).padStart(2, '0');

function formatValue(raw, format, token) {
    if (format === 'raw') { return raw; }
    const c = parseColor(raw);
    if (!c) { fail(`library token ${token} is not a colour: "${raw}"`); }
    if (format === 'triplet') {
        if (c.a !== 100) { fail(`library token ${token} is translucent, cannot be a triplet: "${raw}"`); }
        return `${c.r} ${c.g} ${c.b}`;
    }
    if (typeof format === 'object' && format !== null && 'alpha' in format) {
        if (c.a !== 100) { fail(`library token ${token} is already translucent: "${raw}"`); }
        return `rgb(${c.r} ${c.g} ${c.b} / ${format.alpha}%)`;
    }
    if (format === 'color') {
        return c.a === 100
            ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
            : `rgb(${c.r} ${c.g} ${c.b} / ${c.a}%)`;
    }
    return fail(`unknown format ${JSON.stringify(format)}`);
}

/** Resolve a library token to the literal written into the generated file. */
export function resolveLibraryToken(token, themeMap, format = 'color') {
    const raw = evalColorMix(resolveRaw(token, themeMap));
    return formatValue(raw, format, token);
}

/* ------------------------------------------------------------------------- *
 * Upstream side
 * ------------------------------------------------------------------------- */

/**
 * Parse upstream default.css.
 * @returns {{ names: string[], light: Map<string,string>, dark: Map<string,string>, rootValues: Map<string,string> }}
 *   names: every custom property declared anywhere (document order, unique)
 *   rootValues: top-level `:root` declarations (last wins)
 *   light: rootValues + `:root:not(.dark):not(.colorBlind)`
 *   dark:  `:root.dark` + `:root.dark:not(.colorBlind)`
 */
export function parseUpstream(cssText) {
    const root = postcss.parse(cssText);
    const names = [];
    const seen = new Set();
    const rootValues = new Map();
    const lightExtra = new Map();
    const dark = new Map();
    root.walkDecls(decl => {
        if (!decl.prop.startsWith('--')) { return; }
        if (!seen.has(decl.prop)) { seen.add(decl.prop); names.push(decl.prop); }
        const rule = decl.parent;
        if (rule.type !== 'rule' || rule.parent.type !== 'root') { return; }
        const sel = normalizeSpace(rule.selector);
        const value = normalizeSpace(decl.value);
        if (sel === ':root') { rootValues.set(decl.prop, value); }
        else if (sel === ':root:not(.dark):not(.colorBlind)') { lightExtra.set(decl.prop, value); }
        else if (sel === ':root.dark' || sel === ':root.dark:not(.colorBlind)') { dark.set(decl.prop, value); }
    });
    return { names, rootValues, light: new Map([...rootValues, ...lightExtra]), dark };
}

/* ------------------------------------------------------------------------- *
 * Generation
 * ------------------------------------------------------------------------- */

/**
 * Compute the light (B1) and dark (B2/B3) declarations.
 * @returns {{ light: Map<string,string>, dark: Map<string,string> }}
 */
export function computeDeclarations({ library, upstream }) {
    const light = new Map();
    const dark = new Map();

    for (const name of PALETTE_NAMES) {
        const v = upstream.rootValues.get(name);
        if (v === undefined) { fail(`palette name ${name} not found at upstream :root`); }
        light.set(name, v);
    }
    for (const [name, entry] of MAPPING) {
        if (light.has(name)) { fail(`duplicate mapping for ${name}`); }
        if (entry.kind === 'kept') {
            const lv = upstream.light.get(name);
            if (lv === undefined) { fail(`kept name ${name} has no upstream light value`); }
            light.set(name, lv);
            const dv = upstream.dark.get(name);
            if (dv !== undefined && dv !== lv) { dark.set(name, dv); }
            continue;
        }
        light.set(name, resolveLibraryToken(entry.lightToken, library.light, entry.format));
        if (entry.dark) {
            dark.set(name, resolveLibraryToken(entry.darkToken, library.dark, entry.format));
        }
    }

    // Every upstream name must be covered, and nothing else may be declared.
    const missing = upstream.names.filter(n => !light.has(n));
    if (missing.length !== 0) { fail(`upstream names without a mapping: ${missing.join(' ')}`); }
    const extra = [...light.keys()].filter(n => !upstream.names.includes(n));
    if (extra.length !== 0) { fail(`mapped names that upstream does not define: ${extra.join(' ')}`); }
    for (const n of COLLIDING_NAMES) {
        if (light.get(n) !== upstream.rootValues.get(n)) { fail(`colliding name ${n} lost its upstream triplet`); }
    }
    return { light, dark };
}

function cssRule(selector, decls, indent = '') {
    const lines = [`${indent}${selector} {`];
    for (const [name, value] of decls) { lines.push(`${indent}    ${name}: ${value};`); }
    lines.push(`${indent}}`);
    return lines.join('\n');
}

function stripLeadingComment(css) {
    return css.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').trim();
}

/**
 * @param {object} input
 * @param {string[]} input.libraryCss  text of the three library variable files
 * @param {string}   input.upstreamCss text of upstream default.css
 * @param {string}   input.codemirrorCss text of src/styles/legacy/codemirror.css
 * @param {string}   input.focusCss    text of src/styles/legacy/focus.css
 * @param {string}   input.embedLayoutCss text of src/styles/legacy/embed-layout.css
 * @param {string}   input.embedCss    text of src/styles/legacy/embed.css
 * @param {string}  [input.libraryVersion]
 * @returns {{ css: string, light: Map<string,string>, dark: Map<string,string> }}
 */
export function generateLegacyCss({ libraryCss, upstreamCss, codemirrorCss, focusCss, embedLayoutCss, embedCss, libraryVersion = 'unknown' }) {
    for (const [label, text] of [['codemirrorCss', codemirrorCss], ['focusCss', focusCss], ['embedLayoutCss', embedLayoutCss], ['embedCss', embedCss]]) {
        if (typeof text !== 'string' || text.trim() === '') { fail(`generator input ${label} is missing`); }
    }
    const library = collectLibraryThemes(libraryCss);
    const upstream = parseUpstream(upstreamCss);
    const { light, dark } = computeDeclarations({ library, upstream });

    const header = [
        '/*',
        ' * Blocker: generated replacement for the upstream css/default.css.',
        ' * Generated by ui/scripts/build-legacy-css.mjs; do not edit.',
        ` * Legacy variable names mapped to @openai/apps-sdk-ui ${libraryVersion} tokens as literal values`,
        ' * (docs/specs/legacy-tokens.md). Plain CSS: no imports, no layers,',
        ' * no remote resources, no color-scheme, no background on html/body.',
        ' */',
    ].join('\n');

    const note = text => `/* ${text} */`;
    const parts = [
        header,
        note('B1: every legacy name; light values, upstream palette verbatim'),
        cssRule(':root', light),
        note('B2: dark scheme before or without the theme.js class (not when the page chose .light)'),
        `@media (prefers-color-scheme: dark) {\n${cssRule(':root:not(.light)', dark, '    ')}\n}`,
        note('B3: dark scheme chosen by theme.js; same values as B2'),
        cssRule(':root.dark', dark),
        note('B4: sizes for touch devices, as upstream'),
        cssRule(':root.mobile', [
            ['--font-size', '16px'],
            ['--font-size-smaller', '14px'],
            ['--monospace-size', '13px'],
        ]),
        note('B5: increased contrast, as upstream'),
        `@media (prefers-contrast: more) {\n${cssRule(':root', [
            ['--native-control-opacity', '1'],
            ['--button-border-size', '1px'],
        ], '    ')}\n}`,
        note('B7: CodeMirror chrome through the --cm-* variables'),
        stripLeadingComment(codemirrorCss),
        note('B8: keyboard focus indicator (upstream removes the browser one)'),
        stripLeadingComment(focusCss),
        note('B9: embedded classic dashboard column, start-aligned like the React panes'),
        stripLeadingComment(embedLayoutCss),
        note('B6: embedded classic dashboard (parent sets data-blocker-embed on the frame html); must stay last'),
        stripLeadingComment(embedCss),
    ];
    return { css: `${parts.join('\n\n')}\n`, light, dark };
}

/*
 * Acceptance checks C1-C14 for the generated legacy stylesheet
 * (docs/specs/legacy-tokens.md section 7.1), plus S1 (order of the parts in 5.1).
 * Used by scripts/check-legacy-css.mjs,
 * scripts/build-legacy-css.mjs and tests/unit/legacy-css.
 *
 * Inputs are texts; nothing here reads files.
 */

import postcss from 'postcss';

import { COLLIDING_NAMES, PALETTE_NAMES, TRIPLET_BY_REFERENCE } from './mapping.mjs';

const norm = s => s.replace(/\s+/g, ' ').trim();
const TRIPLET_RE = /^\d{1,3} \d{1,3} \d{1,3}$/;

export const MEDIA_DARK = '(prefers-color-scheme: dark)';
export const MEDIA_CONTRAST = '(prefers-contrast: more)';
export const EMBED_SELECTORS = [
    ':root[data-blocker-embed] body > header',
    ':root[data-blocker-embed] body > section:is([data-pane="settings"], [data-pane="rulesets"], [data-pane="about"], [data-pane="busy"])',
];
const B7_PROP_RE = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end))?(?:-color)?|outline(?:-offset)?)$/;
const B8_PROP_RE = /^outline(?:-offset)?$/;
/** B9 selectors (spec 6.5) and the one property each may set. */
export const EMBED_LAYOUT_RULES = {
    ':root[data-blocker-embed] body': 'align-items',
    ':root[data-blocker-embed] body > *': 'width',
};

/**
 * Which generated part a top-level rule belongs to (spec 5.1), from its selectors:
 * 'B6' embed hiding, 'B7' CodeMirror chrome, 'B8' keyboard focus, 'B9' embed layout, null otherwise.
 */
export function blockOfRule(rule) {
    if (!rule || rule.type !== 'rule') { return null; }
    const sels = rule.selectors.map(norm);
    if (sels.length === 1 && EMBED_SELECTORS.includes(sels[0])) { return 'B6'; }
    if (sels.length === 1 && Object.hasOwn(EMBED_LAYOUT_RULES, sels[0])) { return 'B9'; }
    if (sels.every(x => x.startsWith(':root:root ') && x.includes(':focus-visible'))) { return 'B8'; }
    if (sels.every(x => x.startsWith(':root ') && x.includes('.cm-editor'))) { return 'B7'; }
    return null;
}

function ruleSignature(rule) {
    const decls = (rule.nodes ?? []).filter(n => n.type === 'decl')
        .map(d => `${d.prop}: ${norm(d.value)}${d.important ? ' !important' : ''}`);
    return `${rule.selectors.map(norm).join(', ')} { ${decls.join('; ')} }`;
}

/** Normalised rule texts of the generated blocks B7, B8, B9 and B6 (spec 5.1). */
export function cssBlocksOf(G) {
    const out = { B7: [], B8: [], B9: [], B6: [] };
    for (const n of postcss.parse(G).nodes) {
        const b = blockOfRule(n);
        if (b) { out[b].push(ruleSignature(n)); }
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}

/** The css code blocks of spec 4.4 (B7), 4.5 (B8), 6.5 (B9) and 6.2 (B6), normalised like cssBlocksOf. */
export function parseSpecCssBlocks(markdown) {
    const blockAfter = heading => {
        const at = markdown.indexOf(heading);
        if (at === -1) { throw new Error(`spec: section "${heading}" not found`); }
        const open = markdown.indexOf('```css\n', at);
        const next = markdown.indexOf('\n### ', at + heading.length);
        if (open === -1 || (next !== -1 && open > next)) { throw new Error(`spec: no css code in "${heading}"`); }
        const close = markdown.indexOf('\n```', open + 7);
        return postcss.parse(markdown.slice(open + 7, close)).nodes
            .filter(n => n.type === 'rule').map(ruleSignature).join('\n');
    };
    return {
        B7: blockAfter('### 4.4 '),
        B8: blockAfter('### 4.5 '),
        B9: blockAfter('### 6.5 '),
        B6: blockAfter('### 6.2 '),
    };
}

/** Parse the rows of spec section 4.2 into rows { name, light, dark|null }. */
export function parseSpecTable(markdown) {
    const start = markdown.indexOf('### 4.2 Table');
    const end = markdown.indexOf('### 4.3', start);
    if (start === -1 || end === -1) { throw new Error('spec: section 4.2 not found'); }
    const rows = [];
    for (const line of markdown.slice(start, end).split('\n')) {
        if (!line.startsWith('| `--')) { continue; }
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.length !== 6) { throw new Error(`spec: unexpected row shape: ${line}`); }
        const unquote = c => {
            const m = /^`(.*)`$/.exec(c);
            if (!m) { throw new Error(`spec: expected a code cell, got "${c}" in ${line}`); }
            return norm(m[1]);
        };
        rows.push({
            name: unquote(cells[0]),
            light: unquote(cells[3]),
            dark: cells[4] === '—' ? null : unquote(cells[4]),
        });
    }
    return rows;
}

function topLevel(root) {
    return root.nodes.filter(n => n.type !== 'comment');
}

function declsOf(rule) {
    const out = new Map();
    for (const n of rule.nodes ?? []) {
        if (n.type === 'decl') { out.set(n.prop, n); }
    }
    return out;
}

function findVars(value) {
    const out = [];
    let i = 0;
    for (;;) {
        const at = value.indexOf('var(', i);
        if (at === -1) { return out; }
        let depth = 0;
        let j = at + 3;
        for (; j < value.length; j++) {
            if (value[j] === '(') { depth += 1; }
            else if (value[j] === ')') { depth -= 1; if (depth === 0) { break; } }
        }
        const inner = value.slice(at + 4, j);
        const comma = inner.indexOf(',');
        out.push({ name: (comma === -1 ? inner : inner.slice(0, comma)).trim(), fallback: comma !== -1 });
        i = j + 1;
    }
}

/** Fully substitute var() in `name` within env (Map name -> value). */
function resolveIn(name, env, stack = []) {
    if (stack.includes(name)) { throw new Error(`cycle ${[...stack, name].join(' -> ')}`); }
    if (!env.has(name)) { throw new Error(`undefined ${name}${stack.length ? ` (via ${stack.join(' -> ')})` : ''}`); }
    let v = env.get(name);
    for (const ref of findVars(v)) {
        const sub = resolveIn(ref.name, env, [...stack, name]);
        v = v.replace(new RegExp(`var\\(\\s*${ref.name.replace(/[-]/g, '\\-')}\\s*\\)`), sub);
    }
    return norm(v);
}

/**
 * Run the checks.
 * @param {string} G generated CSS text
 * @param {string} U upstream default.css text
 * @param {{ specMarkdown?: string }} [opts] when given, C13 compares with the spec rows
 * @returns {Array<{ id: string, ok: boolean, problems: string[] }>}
 */
export function checkLegacyCss(G, U, opts = {}) {
    const results = [];
    const check = (id, fn) => {
        const problems = [];
        try { fn(p => problems.push(p)); } catch (err) { problems.push(`exception: ${err.message}`); }
        results.push({ id, ok: problems.length === 0, problems });
    };

    const g = postcss.parse(G);
    const u = postcss.parse(U);
    const top = topLevel(g);
    const b1 = top.filter(n => n.type === 'rule' && norm(n.selector) === ':root');
    const b1Decls = new Map(b1.flatMap(r => [...declsOf(r)].map(([k, d]) => [k, norm(d.value)])));
    const b3 = top.filter(n => n.type === 'rule' && norm(n.selector) === ':root.dark');
    const b3Decls = new Map(b3.flatMap(r => [...declsOf(r)].map(([k, d]) => [k, norm(d.value)])));
    const mediaDark = top.filter(n => n.type === 'atrule' && n.name === 'media' && norm(n.params) === MEDIA_DARK);
    const b2Rules = mediaDark.flatMap(m => m.nodes.filter(n => n.type === 'rule'));
    const b2Decls = new Map(b2Rules.filter(r => norm(r.selector) === ':root:not(.light)')
        .flatMap(r => [...declsOf(r)].map(([k, d]) => [k, norm(d.value)])));

    // Upstream facts.
    const upNames = new Set();
    const upTripletLiteral = new Set();
    const upRoot = new Map();
    u.walkDecls(d => {
        if (!d.prop.startsWith('--')) { return; }
        upNames.add(d.prop);
        if (TRIPLET_RE.test(norm(d.value))) { upTripletLiteral.add(d.prop); }
        if (d.parent.type === 'rule' && d.parent.parent.type === 'root' && norm(d.parent.selector) === ':root') {
            upRoot.set(d.prop, norm(d.value));
        }
    });

    check('C1', p => {
        const ats = [];
        g.walkAtRules(a => ats.push(a));
        const want = [MEDIA_DARK, MEDIA_CONTRAST];
        for (const a of ats) {
            if (a.name !== 'media' || !want.includes(norm(a.params))) { p(`unexpected at-rule @${a.name} ${a.params}`); }
        }
        for (const w of want) {
            const n = ats.filter(a => a.name === 'media' && norm(a.params) === w).length;
            if (n !== 1) { p(`@media ${w} appears ${n} times (want 1)`); }
        }
    });

    check('C2', p => {
        if (/url\(/i.test(G)) { p('contains url('); }
        if (/https?:/i.test(G)) { p('contains http: or https:'); }
    });

    check('C3', p => {
        if (b1.length !== 1) { p(`expected one top-level :root rule, found ${b1.length}`); }
        const missing = [...upNames].filter(n => !b1Decls.has(n));
        if (missing.length) { p(`${missing.length} upstream names not in top-level :root: ${missing.join(' ')}`); }
        if (upNames.size !== 256) { p(`upstream declares ${upNames.size} names (spec says 256)`); }
    });

    const declared = new Set();
    g.walkDecls(d => { if (d.prop.startsWith('--')) { declared.add(d.prop); } });

    check('C4', p => {
        g.walkDecls(d => {
            for (const ref of findVars(d.value)) {
                if (!declared.has(ref.name)) { p(`${d.prop}: var(${ref.name}) is not declared`); }
                if (ref.fallback) { p(`${d.prop}: var(${ref.name}, ...) has a fallback`); }
            }
        });
    });

    const lightEnv = new Map(b1Decls);
    const darkEnv = new Map([...b1Decls, ...b3Decls]);

    check('C5', p => {
        const want = new Set([...upTripletLiteral, ...TRIPLET_BY_REFERENCE]);
        if (upTripletLiteral.size !== 125) { p(`upstream has ${upTripletLiteral.size} literal triplet names (spec says 125)`); }
        if (want.size !== 130) { p(`${want.size} triplet names (spec says 130)`); }
        for (const n of want) {
            for (const [label, env] of [['light', lightEnv], ['dark', darkEnv]]) {
                let v;
                try { v = resolveIn(n, env); } catch (err) { p(`${n} (${label}): ${err.message}`); continue; }
                if (!TRIPLET_RE.test(v)) { p(`${n} (${label}) is not an R G B triplet: "${v}"`); }
            }
        }
    });

    check('C6', p => {
        g.walkDecls(d => {
            if (d.prop.toLowerCase() === 'color-scheme') { p('declares color-scheme'); return; }
            if (d.prop.startsWith('--')) { return; }
            const rule = d.parent;
            const sel = rule.type === 'rule' ? norm(rule.selector) : '';
            if (EMBED_SELECTORS.includes(sel)) {
                if (d.prop !== 'display' || norm(d.value) !== 'none' || !d.important) {
                    p(`B6 rule "${sel}" has "${d.prop}: ${d.value}${d.important ? ' !important' : ''}"`);
                }
                return;
            }
            const part = rule.type === 'rule' && rule.parent.type === 'root' ? blockOfRule(rule) : null;
            if (part === 'B7') {
                const editorMargin = d.prop === 'margin' && sel === ':root .cm-container .cm-editor';
                if (!B7_PROP_RE.test(d.prop) && !editorMargin) { p(`B7 rule "${sel}" sets non-colour property "${d.prop}"`); }
            } else if (part === 'B8') {
                if (!B8_PROP_RE.test(d.prop)) { p(`B8 rule "${sel}" sets "${d.prop}" (only outline, outline-offset)`); }
            } else if (part === 'B9') {
                if (d.prop !== EMBED_LAYOUT_RULES[sel]) { p(`B9 rule "${sel}" sets "${d.prop}" (only ${EMBED_LAYOUT_RULES[sel]})`); }
            } else {
                p(`non-custom-property "${d.prop}" in "${sel}"`);
                return;
            }
            if (d.important) { p(`${part} rule "${sel}" uses !important`); }
        });
        // K2: nothing may target html/body/:root with a background (also covered above).
        g.walkRules(r => {
            for (const s of r.selectors.map(norm)) {
                if (/^(?:html|body|:root)(?:[.:[][^ ]*)?$/.test(s)) {
                    for (const n of r.nodes ?? []) {
                        if (n.type === 'decl' && !n.prop.startsWith('--')) { p(`"${s}" sets ${n.prop}`); }
                    }
                }
            }
        });
    });

    check('C7', p => {
        if (b3.length !== 1) { p(`expected one top-level :root.dark rule, found ${b3.length}`); }
        if (mediaDark.length !== 1 || b2Rules.length !== 1 || norm(b2Rules[0].selector) !== ':root:not(.light)') {
            p(`@media ${MEDIA_DARK} must hold exactly one rule ":root:not(.light)"`);
        }
        const a = [...b2Decls].map(([k, v]) => `${k}: ${v}`).sort();
        const b = [...b3Decls].map(([k, v]) => `${k}: ${v}`).sort();
        const onlyA = a.filter(x => !b.includes(x));
        const onlyB = b.filter(x => !a.includes(x));
        if (onlyA.length || onlyB.length) { p(`B2/B3 differ: only in B2 [${onlyA.join('; ')}], only in B3 [${onlyB.join('; ')}]`); }
        if (b3Decls.size === 0) { p('no dark overrides'); }
    });

    check('C8', p => {
        const contrast = top.filter(n => n.type === 'atrule' && norm(n.params) === MEDIA_CONTRAST);
        const cRules = contrast.flatMap(m => m.nodes.filter(n => n.type !== 'comment'));
        const got = cRules.length === 1 && cRules[0].type === 'rule' && norm(cRules[0].selector) === ':root'
            ? [...declsOf(cRules[0])].map(([k, d]) => `${k}: ${norm(d.value)}`).sort().join('; ')
            : '(wrong shape)';
        const want = '--button-border-size: 1px; --native-control-opacity: 1';
        if (got !== want) { p(`prefers-contrast rule is "${got}", want "${want}"`); }
        const mobile = top.filter(n => n.type === 'rule' && norm(n.selector) === ':root.mobile');
        const gotM = mobile.length === 1
            ? [...declsOf(mobile[0])].map(([k, d]) => `${k}: ${norm(d.value)}`).sort().join('; ')
            : `(${mobile.length} :root.mobile rules)`;
        const wantM = '--font-size-smaller: 14px; --font-size: 16px; --monospace-size: 13px';
        if (gotM !== wantM) { p(`:root.mobile is "${gotM}", want "${wantM}"`); }
    });

    check('C9', p => {
        for (const [label, env] of [['light', lightEnv], ['dark', darkEnv]]) {
            for (const n of env.keys()) {
                try { resolveIn(n, env); } catch (err) { p(`${n} (${label}): ${err.message}`); }
            }
        }
    });

    check('C10', p => {
        g.walkDecls(d => { if (d.prop.startsWith('--') && d.important) { p(`${d.prop} is !important`); } });
    });

    check('C11', p => {
        const rules = [];
        g.walkRules(r => rules.push(r));
        const last2 = rules.slice(-2);
        const lastTop = top.slice(-2);
        for (let i = 0; i < 2; i++) {
            const r = last2[i];
            if (!r || norm(r.selector) !== EMBED_SELECTORS[i]) { p(`rule ${rules.length - 2 + i} is "${r && r.selector}", want "${EMBED_SELECTORS[i]}"`); continue; }
            if (lastTop[i] !== r) { p(`B6 rule ${i + 1} is not a top-level rule at the end of the file`); }
            const ds = (r.nodes ?? []).filter(n => n.type === 'decl');
            if (ds.length !== 1 || ds[0].prop !== 'display' || norm(ds[0].value) !== 'none' || !ds[0].important) {
                p(`B6 rule ${i + 1} must be exactly "display: none !important"`);
            }
        }
    });

    check('C12', p => {
        for (const n of COLLIDING_NAMES) {
            if (b1Decls.get(n) !== upRoot.get(n)) { p(`${n} is "${b1Decls.get(n)}", upstream "${upRoot.get(n)}"`); }
            if (b3Decls.has(n) || b2Decls.has(n)) { p(`${n} has a dark override`); }
        }
    });

    if (opts.specMarkdown !== undefined) {
        check('C13', p => {
            const rows = parseSpecTable(opts.specMarkdown);
            if (rows.length !== 143) { p(`spec 4.2 has ${rows.length} rows (want 143 = 256 - 113 palette)`); }
            for (const row of rows) {
                const lv = b1Decls.get(row.name);
                if (lv !== row.light) { p(`${row.name} light is "${lv}", spec "${row.light}"`); }
                const dv = b3Decls.get(row.name);
                if (row.dark === null) {
                    if (dv !== undefined || b2Decls.has(row.name)) { p(`${row.name} has a dark override "${dv}", spec has none`); }
                } else if (dv !== row.dark) {
                    p(`${row.name} dark is "${dv}", spec "${row.dark}"`);
                }
            }
            for (const n of PALETTE_NAMES) {
                if (b1Decls.get(n) !== upRoot.get(n)) { p(`palette ${n} is "${b1Decls.get(n)}", upstream "${upRoot.get(n)}"`); }
                if (b3Decls.has(n) || b2Decls.has(n)) { p(`palette ${n} has a dark override`); }
            }
            const covered = new Set([...rows.map(r => r.name), ...PALETTE_NAMES]);
            for (const n of b3Decls.keys()) { if (!covered.has(n)) { p(`dark override for unknown ${n}`); } }
        });
    }

    if (opts.specMarkdown !== undefined) {
        check('C14', p => {
            // The verbatim blocks equal the spec's code blocks (4.4, 4.5, 6.5, 6.2).
            const want = parseSpecCssBlocks(opts.specMarkdown);
            const got = cssBlocksOf(G);
            for (const b of ['B7', 'B8', 'B9', 'B6']) {
                if (got[b] !== want[b]) {
                    const g = got[b].split('\n');
                    const w = want[b].split('\n');
                    const diff = [...g.filter(x => !w.includes(x)).map(x => `+ ${x}`), ...w.filter(x => !g.includes(x)).map(x => `- ${x}`)];
                    p(`${b} differs from the spec${diff.length ? `: ${diff.join(' | ')}` : ' (rule order)'}`);
                }
            }
        });
    }

    check('S1', p => {
        // Block order of spec 5.1: B1, B2, B3, B4, B5, B7..., B6, B6.
        const sig = top.map(n => n.type === 'atrule' ? `@${n.name} ${norm(n.params)}` : norm(n.selector));
        const head = [':root', `@media ${MEDIA_DARK}`, ':root.dark', ':root.mobile', `@media ${MEDIA_CONTRAST}`];
        for (let i = 0; i < head.length; i++) {
            if (sig[i] !== head[i]) { p(`top-level part ${i + 1} is "${sig[i]}", want "${head[i]}"`); }
        }
        // Then B7, B8, B9 (each at least one rule, in that order), then the two B6 rules.
        const middle = top.slice(head.length, -2);
        const order = ['B7', 'B8', 'B9'];
        let at = 0;
        const seen = new Set();
        for (const n of middle) {
            const b = blockOfRule(n);
            const i = order.indexOf(b);
            if (i === -1) { p(`unexpected rule between B5 and B6: "${n.selector ?? n.name}"`); continue; }
            if (i < at) { p(`${b} rule "${norm(n.selector)}" comes after a ${order[at]} rule`); }
            at = Math.max(at, i);
            seen.add(b);
        }
        for (const b of order) { if (!seen.has(b)) { p(`part ${b} is missing`); } }
    });

    return results;
}

export function formatResults(results) {
    return results.map(r => r.ok
        ? `PASS ${r.id}`
        : `FAIL ${r.id}\n${r.problems.slice(0, 40).map(x => `     - ${x}`).join('\n')}${r.problems.length > 40 ? `\n     ... ${r.problems.length - 40} more` : ''}`,
    ).join('\n');
}

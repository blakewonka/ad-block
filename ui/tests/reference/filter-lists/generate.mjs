#!/usr/bin/env node
/**
 * Reference outputs of the UPSTREAM "Filter lists" pane, for the pure model in
 * src/lib/model/filterLists.ts (unit test: src/lib/model/filterLists.reference.test.ts).
 *
 * What it does:
 *   1. Bundles src/dev/install-mock.ts (the project's mock browser API) into one
 *      classic IIFE in a scratch folder (Vite lib build, nothing written to the project).
 *   2. Serves PRISTINE (the built upstream extension) read-only on 127.0.0.1.
 *   3. For every scenario below, opens the unmodified upstream dashboard.html in
 *      headless Google Chrome with the mock injected before any page script, opens
 *      the "Filter lists" pane, drives it (search input, checkbox clicks, hide-unused
 *      clicks) and records the DOM state, the totals line and the messages / storage
 *      writes the page made.
 *   4. Writes tests/reference/filter-lists/upstream-reference.json.
 *
 * Run:   node tests/reference/filter-lists/generate.mjs
 * Needs: /Applications/Google Chrome.app, PRISTINE at build/pristine/safari (BLOCKER_PRISTINE_DIR).
 * Env:   BLOCKER_REF_OUT=<file> to write elsewhere; SCRATCH via BLOCKER_REF_SCRATCH.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { launchChrome, PRISTINE_DIR, startStaticServer, UI_ROOT } from '../../e2e/lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISTINE = PRISTINE_DIR;
const OUT = process.env.BLOCKER_REF_OUT || path.join(HERE, 'upstream-reference.json');
const SCRATCH = process.env.BLOCKER_REF_SCRATCH || path.join(os.tmpdir(), 'blocker-filter-lists-ref');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 1. mock bundle                                                      */
/* ------------------------------------------------------------------ */

async function bundleMock() {
    mkdirSync(SCRATCH, { recursive: true });
    await build({
        configFile: false,
        root: UI_ROOT,
        logLevel: 'warn',
        resolve: { alias: { '@': path.join(UI_ROOT, 'src') } },
        build: {
            outDir: SCRATCH,
            emptyOutDir: false,
            minify: false,
            target: 'es2022',
            lib: {
                entry: path.join(UI_ROOT, 'src/dev/install-mock.ts'),
                formats: ['iife'],
                name: '__blockerMockLib',
                fileName: () => 'install-mock.iife.js',
            },
        },
    });
    return readFileSync(path.join(SCRATCH, 'install-mock.iife.js'), 'utf8');
}

/* Upstream's Safari ext-compat.js reads these at import time; the mock does not model them. */
const STUBS = `
(() => {
    const b = globalThis.browser;
    if (!b) return;
    b.windows ??= { WINDOW_ID_NONE: -1, onFocusChanged: { addListener() {} }, get: async () => ({ incognito: false }) };
    b.declarativeNetRequest ??= {};
})();
`;

/* ------------------------------------------------------------------ */
/* 2. page helpers                                                     */
/* ------------------------------------------------------------------ */

async function openPane(context, base, mockIife, config) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // install-mock.ts ends by tagging <html> (data-mock-scenario), which does not exist yet when an
    // init script runs; everything it installs comes before that, so the error is caught and ignored.
    await page.addInitScript({
        content: `globalThis.__BLOCKER_MOCK_CONFIG__ = ${JSON.stringify(config)};\ntry {\n${mockIife}\n} catch (e) { if (!globalThis.__blockerMock) throw e; }\n${STUBS}`,
    });
    await page.goto(`${base}/dashboard.html`);
    await page.waitForFunction(() => !document.body.classList.contains('loading'), null, { timeout: 30_000 });
    await page.click('button.tabButton[data-pane="rulesets"]');
    // Root groups are always created, even for an empty data set; wait for the totals line too.
    await page
        .waitForFunction(
            () =>
                document.querySelectorAll('#lists > .listEntries > .listEntry[data-role="rootnode"]').length === 8 &&
                document.querySelector('#listsOfBlockedHostsPrompt').textContent !== '',
            null,
            { timeout: 10_000 },
        )
        .catch(() => {});
    await sleep(150);
    return { page, errors };
}

/** DOM state of the pane, rows in document order. */
function snapshotInPage() {
    const rows = [];
    const walk = (container, depth, parentId) => {
        for (const el of container.children) {
            if (!el.classList.contains('listEntry')) continue;
            const role = el.dataset.role;
            const id = role === 'leaf' ? el.dataset.rulesetid : el.dataset.nodeid;
            const bar = el.querySelector(':scope > .detailbar');
            const nameEl = bar.querySelector('.listname');
            const name = [];
            for (const n of nameEl.childNodes) {
                if (n.nodeType === 3) name.push({ type: 'text', text: n.textContent });
                else if (n.nodeName === 'IMG') name.push({ type: 'flag', cc: n.getAttribute('title'), src: n.getAttribute('src') });
            }
            const input = bar.querySelector('input[type="checkbox"]');
            const count = bar.querySelector('.count');
            const home = bar.querySelector('a.support');
            const row = {
                role,
                id,
                depth,
                parentId,
                name,
                classes: {
                    fromAdmin: el.classList.contains('fromAdmin'),
                    isDefault: el.classList.contains('isDefault'),
                    hideUnused: el.classList.contains('hideUnused'),
                    searchMatch: el.classList.contains('searchMatch'),
                    toggled: el.classList.contains('toggled'),
                },
                visible: el.checkVisibility(),
                pointerNone: getComputedStyle(el).pointerEvents === 'none',
            };
            if (input) {
                row.checked = input.checked;
                row.disabled = input.disabled;
                row.partial = input.closest('.checkbox').classList.contains('partial');
            }
            if (count) row.count = count.textContent;
            if (role === 'leaf') {
                row.title = el.title;
                row.href = home ? home.getAttribute('href') : null;
                row.imported = el.dataset.imported !== undefined;
            }
            rows.push(row);
            const sub = el.querySelector(':scope > .listEntries');
            if (sub) walk(sub, depth + 1, id);
        }
    };
    const top = document.querySelector('#lists > .listEntries');
    if (top) walk(top, 0, null);
    return {
        totalsText: document.querySelector('#listsOfBlockedHostsPrompt').textContent,
        noMoreRuleset: document.body.classList.contains('noMoreRuleset'),
        searchMode: document.querySelector('#lists').classList.contains('searchMode'),
        rows,
    };
}

/**
 * Row columns of a compact snapshot (one array per row, keeps the JSON small).
 * `name` (segments), `title` and `href` are only kept in the initial snapshot of a scenario.
 */
const ROW_COLUMNS = [
    'role', 'id', 'depth', 'parentId', 'count', 'checked', 'partial', 'disabled',
    'fromAdmin', 'isDefault', 'hideUnused', 'searchMatch', 'toggled', 'visible', 'pointerNone',
    'title', 'href', 'imported',
];

function compact(snap, withNames) {
    const rows = snap.rows.map((r) => {
        const flat = { ...r, ...r.classes };
        // Tooltip and link never change after the first render: kept in the initial snapshot only.
        if (!withNames) {
            flat.title = undefined;
            flat.href = undefined;
        }
        return ROW_COLUMNS.map((c) => (flat[c] === undefined ? null : flat[c]));
    });
    const out = { totalsText: snap.totalsText, noMoreRuleset: snap.noMoreRuleset, searchMode: snap.searchMode, rows };
    if (withNames) out.names = snap.rows.map((r) => r.name);
    return out;
}

const snapshot = async (page, withNames = false) => compact(await page.evaluate(snapshotInPage), withNames);

async function search(page, pattern) {
    await page.evaluate((p) => {
        const input = document.querySelector('#findInLists');
        input.value = p;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, pattern);
}

/** Pane-originated calls since the last clear: applyRulesets messages and hideUnused writes. */
async function takeCalls(page) {
    return page.evaluate(() => {
        const out = [];
        for (const c of window.__blockerCalls) {
            if (c.api === 'runtime.sendMessage') out.push({ api: c.api, msg: c.args[0] });
            else if (c.api === 'storage.local.set') out.push({ api: c.api, items: c.args[0] });
        }
        window.__blockerMock.clearCalls();
        return out;
    });
}

const clickLeaf = (page, id) =>
    page.evaluate((i) => document.querySelector(`[data-role="leaf"][data-rulesetid="${CSS.escape(i)}"] > .detailbar input`).click(), id);
const clickNodeBox = (page, id) =>
    page.evaluate((i) => document.querySelector(`[data-role="node"][data-nodeid="${CSS.escape(i)}"] > .detailbar input`).click(), id);
/** Hide-unused toggle: the root header bar, or a composite node's expander (FL:531-535). */
const clickHideUnused = (page, id) =>
    page.evaluate((i) => {
        const el = document.querySelector(`.listEntry[data-nodeid="${CSS.escape(i)}"]`);
        const target = el.dataset.role === 'rootnode' ? el.querySelector(':scope > .detailbar') : el.querySelector(':scope > .detailbar .listExpander');
        target.click();
    }, id);

/** Waits for the debounce (997 ms) + the commit + the echo-driven re-render. */
async function settleCommit(page) {
    await sleep(1600);
}

/* ------------------------------------------------------------------ */
/* 3. scenarios                                                        */
/* ------------------------------------------------------------------ */

const DEFAULTS = ['ublock-filters', 'easylist', 'easyprivacy'];

const SEARCH_VECTORS = [
    'german', 'GERMAN', 'default', 'mobile', 'privacy', 'ru adlist', 'counters', 'русский', '(中文)', 'pl',
    'regions', 'rus-0', 'a.b', 'zzz', ' ', 'easylist', 'imported', 'list', '.', '*', 'ads', 'AdGuard/uBO', '  default',
];

const IMPORTED = {
    id: 'https://example.com/list.txt',
    name: 'My imported list',
    group: 'imported',
    enabled: true,
    homeURL: '',
    expires: 7,
    time: { added: 1, updated: 1 },
    filters: { total: 11, accepted: 11, rejected: 0 },
    rules: { total: 9, plain: 7, regex: 2 },
};

const rec = (id, extra = {}) => ({
    id,
    name: extra.name ?? `List ${id}`,
    enabled: false,
    homeURL: `https://example.org/${id}`,
    filters: { total: 2, accepted: 2, rejected: 0 },
    rules: { total: 1, plain: 1, regex: 0 },
    ...extra,
});

/** Synthetic data sets answered verbatim (no background state change). */
const SYNTHETIC = {
    'q2-row1-single-two-segment': [rec('x', { group: 'ads', parent: 'A|B' })],
    'q2-row2-two-under-two-segment': [rec('x', { group: 'ads', parent: 'A|B' }), rec('y', { group: 'ads', parent: 'A|B' })],
    'q2-row3-mixed-depth': [rec('x', { group: 'ads', parent: 'A' }), rec('y', { group: 'ads', parent: 'A|B' })],
    'q2-row4-siblings': [rec('x', { group: 'ads', parent: 'A|B' }), rec('y', { group: 'ads', parent: 'A|C' })],
    'q2-row5-two-subnodes': [
        rec('x', { group: 'ads', parent: 'A|B' }),
        rec('y', { group: 'ads', parent: 'A|B' }),
        rec('z', { group: 'ads', parent: 'A|C' }),
        rec('w', { group: 'ads', parent: 'A|C' }),
    ],
    'single-parent-promoted': [rec('x', { group: 'privacy', parent: 'A' }), rec('k', { group: 'privacy' })],
    'two-parent-kept': [rec('x', { group: 'privacy', parent: 'A' }), rec('y', { group: 'privacy', parent: 'A' }), rec('k', { group: 'privacy' })],
    'grouping-edge-cases': [
        rec('g-x', { group: 'x' }),
        rec('nolang-misc'),
        rec('lang-nogroup', { lang: 'de' }),
        rec('lang-empty-nogroup', { lang: '' }),
        rec('malware-1', { group: 'malware', enabled: true }),
        rec('imp-1', { group: 'imported', enabled: true }),
        rec('def-1', { group: 'default', enabled: true }),
        rec('def-2', { group: 'default' }),
    ],
    'sort-edge-cases': [
        rec('b-1', { group: 'annoyances' }),
        rec('a-2', { group: 'annoyances' }),
        rec('zzz', { group: 'annoyances', preferred: true }),
        rec('yyy', { group: 'annoyances', title: 'aaa' }),
        rec('10', { group: 'annoyances' }),
        rec('2', { group: 'annoyances' }),
        rec('c#1', { group: 'annoyances' }),
        rec('c*2', { group: 'annoyances' }),
        rec('c', { group: 'annoyances' }),
        rec('🇩🇪d', { group: 'annoyances' }),
        rec('Ä', { group: 'annoyances' }),
        rec('a', { group: 'annoyances' }),
        rec('B', { group: 'annoyances' }),
        rec('www', { group: 'annoyances', preferred: true, title: '0' }),
        rec('ttt', { group: 'annoyances', title: '' }),
        rec('chn-x', { group: 'annoyances' }),
        rec('hun-x', { group: 'annoyances' }),
    ],
    'search-edge-cases': [
        rec('s1', { group: 'ads', name: 'Alpha (beta) [gamma] a+b', tags: 'one two' }),
        rec('s2', { group: 'ads', name: '  padded  ' }),
        rec('s3', { name: 'No group', tags: 'tagged' }),
        rec('s4', { group: 'regions', lang: 'xx', name: '🇫🇷fr: Liste FR' }),
    ],
    'totals-missing-numbers': [
        rec('t1', { group: 'ads', enabled: true }),
        { ...rec('t2', { group: 'ads' }), rules: { total: 5, plain: 5 } },
    ],
};

async function runScenario(name, ctx, def) {
    const { context, base, mockIife } = ctx;
    const background = { ...(def.background ?? {}) };
    const config = { background, storage: { local: { ...(def.storageLocal ?? {}) } } };
    if (def.responses) config.responses = def.responses;
    const { page, errors } = await openPane(context, base, mockIife, config);
    await takeCalls(page);
    const result = { input: def.input, initial: await snapshot(page, true), steps: [] };
    for (const step of def.steps ?? []) {
        const rec = { step };
        if (step.search !== undefined) {
            await search(page, step.search);
        } else if (step.leaf !== undefined) {
            await clickLeaf(page, step.leaf);
        } else if (step.node !== undefined) {
            await clickNodeBox(page, step.node);
        } else if (step.hideUnused !== undefined) {
            await clickHideUnused(page, step.hideUnused);
        } else if (step.external !== undefined) {
            // Another page changes the enabled set: the background applies it and echoes (spec §13 item 4).
            await page.evaluate((list) => globalThis.browser.runtime.sendMessage({ what: 'applyRulesets', enabledRulesets: list }), step.external);
            await sleep(400);
        } else if (step.wait !== undefined) {
            await sleep(step.wait);
        } else if (step.settle) {
            await settleCommit(page);
        }
        if (step.snapshot !== false) rec.snapshot = await snapshot(page);
        rec.calls = await takeCalls(page);
        result.steps.push(rec);
    }
    result.pageErrors = errors;
    await page.close();
    console.log(`  ${name}: ${result.steps.length} steps, ${errors.length} page errors`);
    return result;
}

function scenarios() {
    const S = {};
    const real = (background, extra = {}) => ({
        ...extra,
        background: { enabledRulesets: DEFAULTS, maxNumberOfEnabledRulesets: 50, ...background },
        input: {
            details: 'real',
            ...extra.input,
            ...(extra.storageLocal && 'hideUnusedFilterLists' in extra.storageLocal
                ? { hideUnusedStored: extra.storageLocal.hideUnusedFilterLists }
                : {}),
        },
    });

    S['default'] = real({}, {
        input: { enabled: DEFAULTS, admin: [], max: 50, supportsCompiledFilters: false },
        steps: [
            ...SEARCH_VECTORS.map((p) => ({ search: p })),
            { search: '' },
            { hideUnused: 'regions' },
            { hideUnused: 'regions' },
            { hideUnused: 'default' },
            { hideUnused: '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList' },
            { hideUnused: 'ads' },
        ],
    });
    S['all-enabled'] = real({ enabledRulesets: 'ALL', maxNumberOfEnabledRulesets: null }, {
        input: { enabled: 'ALL', admin: [], max: null, supportsCompiledFilters: false },
    });
    S['partial-node'] = real({ enabledRulesets: [...DEFAULTS, 'rus-0'] }, {
        input: { enabled: [...DEFAULTS, 'rus-0'], admin: [], max: 50, supportsCompiledFilters: false },
        steps: [{ node: '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList' }, { settle: true }, { node: '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList' }, { settle: true }],
    });
    S['commits'] = real({}, {
        input: { enabled: DEFAULTS, admin: [], max: 50, supportsCompiledFilters: false },
        steps: [
            { leaf: 'deu-0' },
            { settle: true },
            { leaf: 'fra-0' },
            { leaf: 'fra-0' },
            { settle: true },
            { node: '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList' },
            { settle: true },
            { leaf: 'ublock-filters' },
            { leaf: 'ita-0' },
            { leaf: 'spa-1' },
            { settle: true },
        ],
    });
    S['broadcast-merge'] = real({ enabledRulesets: [...DEFAULTS, 'ita-0'] }, {
        input: { enabled: [...DEFAULTS, 'ita-0'], admin: [], max: 50, supportsCompiledFilters: false },
        steps: [{ leaf: 'deu-0' }, { external: [...DEFAULTS, 'fra-0'] }, { settle: true }],
    });
    S['admin-easylist'] = real({ adminRulesets: ['+easylist', '-easyprivacy'], enabledRulesets: ['ublock-filters', 'easylist'] }, {
        input: { enabled: ['ublock-filters', 'easylist'], admin: ['+easylist', '-easyprivacy'], max: 50, supportsCompiledFilters: false },
        steps: [{ search: 'easylist' }, { search: 'privacy' }, { search: '' }, { leaf: 'deu-0' }, { settle: true }],
    });
    S['admin-node-all'] = real({ adminRulesets: ['+rus-0', '+rus-1'], enabledRulesets: [...DEFAULTS, 'rus-0', 'rus-1'] }, {
        input: { enabled: [...DEFAULTS, 'rus-0', 'rus-1'], admin: ['+rus-0', '+rus-1'], max: 50, supportsCompiledFilters: false },
        steps: [{ search: 'ru' }, { search: '' }],
    });
    S['admin-node-one'] = real({ adminRulesets: ['+rus-0'], enabledRulesets: [...DEFAULTS, 'rus-0'] }, {
        input: { enabled: [...DEFAULTS, 'rus-0'], admin: ['+rus-0'], max: 50, supportsCompiledFilters: false },
        steps: [{ node: '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList' }, { settle: true }],
    });
    S['admin-node-unchecked'] = real({ adminRulesets: ['-rus-0', '-rus-1'] }, {
        input: { enabled: DEFAULTS, admin: ['-rus-0', '-rus-1'], max: 50, supportsCompiledFilters: false },
        storageLocal: { hideUnusedFilterLists: [] },
    });
    S['admin-prefix'] = real({ adminRulesets: ['+easylist-extra'] }, {
        input: { enabled: DEFAULTS, admin: ['+easylist-extra'], max: 50, supportsCompiledFilters: false },
    });
    S['limit-at'] = real({ enabledRulesets: [...DEFAULTS, 'deu-0'], maxNumberOfEnabledRulesets: 4 }, {
        input: { enabled: [...DEFAULTS, 'deu-0'], admin: [], max: 4, supportsCompiledFilters: false },
        storageLocal: { hideUnusedFilterLists: [] },
    });
    S['limit-partial-node'] = real({ enabledRulesets: [...DEFAULTS, 'rus-0'], maxNumberOfEnabledRulesets: 4 }, {
        input: { enabled: [...DEFAULTS, 'rus-0'], admin: [], max: 4, supportsCompiledFilters: false },
        storageLocal: { hideUnusedFilterLists: [] },
    });
    S['limit-below'] = real({ enabledRulesets: [...DEFAULTS, 'deu-0'], maxNumberOfEnabledRulesets: 5 }, {
        input: { enabled: [...DEFAULTS, 'deu-0'], admin: [], max: 5, supportsCompiledFilters: false },
    });
    S['limit-none'] = real({ maxNumberOfEnabledRulesets: null }, {
        input: { enabled: DEFAULTS, admin: [], max: null, supportsCompiledFilters: false },
    });
    S['imported-safari'] = real({ importedLists: [IMPORTED], enabledRulesets: [...DEFAULTS, IMPORTED.id] }, {
        input: { enabled: [...DEFAULTS, IMPORTED.id], admin: [], max: 50, supportsCompiledFilters: false, imported: [IMPORTED] },
        steps: [{ search: 'imported' }, { search: 'my imported' }, { search: '' }, { leaf: 'deu-0' }, { settle: true }],
    });
    S['imported-supported'] = real(
        { importedLists: [IMPORTED], enabledRulesets: [...DEFAULTS, IMPORTED.id], supportsCompiledFilters: true },
        {
            input: { enabled: [...DEFAULTS, IMPORTED.id], admin: [], max: 3, supportsCompiledFilters: true, imported: [IMPORTED] },
        },
    );
    // max 3 with 3 stock + 1 imported: imported does not count, so at the limit.
    S['imported-supported'].background.maxNumberOfEnabledRulesets = 3;
    // isDefault rows stay visible under a hide-unused group even when unchecked (CSS:164-166).
    S['hide-unused-default-unchecked'] = real({ enabledRulesets: ['ublock-filters', 'annoyances-ai'] }, {
        input: { enabled: ['ublock-filters', 'annoyances-ai'], admin: [], max: 50, supportsCompiledFilters: false },
        storageLocal: { hideUnusedFilterLists: ['default', 'annoyances', 'misc'] },
        steps: [{ leaf: 'easylist' }, { leaf: 'easylist' }, { leaf: 'annoyances-ai' }, { hideUnused: 'annoyances' }],
    });
    for (const [label, stored] of [['empty', []], ['misc', ['misc']], ['nope', 'nope'], ['star', ['*', 'regions']], ['null', null]]) {
        S[`hide-unused-stored-${label}`] = real({}, {
            input: { enabled: DEFAULTS, admin: [], max: 50, supportsCompiledFilters: false, hideUnusedStored: stored },
            storageLocal: { hideUnusedFilterLists: stored },
            steps: label === 'star' ? [{ hideUnused: 'ads' }, { hideUnused: 'regions' }] : [],
        });
    }
    for (const [label, records] of Object.entries(SYNTHETIC)) {
        const enabled = records.filter((r) => r.enabled).map((r) => r.id);
        const extraEnabled = label === 'search-edge-cases' ? ['s1', 's3'] : [];
        const allEnabled = [...enabled, ...extraEnabled];
        S[`synthetic-${label}`] = {
            background: { maxNumberOfEnabledRulesets: 50 },
            responses: { getRulesetDetails: records, getEnabledRulesets: allEnabled },
            input: { details: records, enabled: allEnabled, admin: [], max: 50, supportsCompiledFilters: false },
            steps:
                label === 'search-edge-cases'
                    ? ['(beta)', '[gamma]', 'a+b', 'padded', 'padded  ads', 'ads one', 'no group', 'tagged', 'fr', 'regions'].map((p) => ({ search: p }))
                    : [],
        };
    }
    return S;
}

/* ------------------------------------------------------------------ */
/* 4. main                                                             */
/* ------------------------------------------------------------------ */

async function main() {
    if (!existsSync(path.join(PRISTINE, 'dashboard.html'))) throw new Error(`PRISTINE not found: ${PRISTINE}`);
    console.log('bundling the mock ...');
    const mockIife = await bundleMock();
    const realDetails = JSON.parse(readFileSync(path.join(PRISTINE, 'rulesets/ruleset-details.json'), 'utf8'));
    const allIds = realDetails.map((d) => d.id);
    const server = await startStaticServer(PRISTINE);
    const out = {
        about:
            'Generated by tests/reference/filter-lists/generate.mjs from the unmodified upstream dashboard (PRISTINE) ' +
            'in headless Google Chrome with the project mock. Do not edit by hand.',
        generated: new Date().toISOString(),
        node: process.version,
        rowColumns: ROW_COLUMNS,
        locales: {},
    };
    try {
        for (const locale of ['en-US', 'cs-CZ']) {
            const chrome = await launchChrome({ locale });
            out.chrome = chrome.browser.version();
            const ctx = { context: chrome.context, base: server.url, mockIife };
            const results = {};
            console.log(`locale ${locale}`);
            const all = scenarios();
            const names = locale === 'en-US' ? Object.keys(all) : ['default', 'synthetic-sort-edge-cases'];
            for (const name of names) {
                const def = all[name];
                if (locale !== 'en-US') def.steps = []; // other locales: initial order and number format only
                if (def.background?.enabledRulesets === 'ALL') def.background.enabledRulesets = allIds;
                results[name] = await runScenario(name, ctx, def);
            }
            out.locales[locale] = results;
            await chrome.close();
        }
    } finally {
        await server.close();
    }
    writeFileSync(OUT, JSON.stringify(out) + '\n');
    console.log(`wrote ${OUT}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

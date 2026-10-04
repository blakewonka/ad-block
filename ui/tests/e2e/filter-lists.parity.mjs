/**
 * Filter lists pane parity test (docs/specs/filter-lists.md §19 PARITY CHECKLIST),
 * driven through the harness dashboard with the mock browser API.
 *
 *   npm run build:harness && node --test tests/e2e/filter-lists.parity.mjs
 *   (private build: BLOCKER_HARNESS_DIR=<dir> BLOCKER_SCREENSHOT_DIR=<dir>)
 *
 * Scenarios: default, max-rulesets, admin-locked, error-on-apply, slow.
 * Every state-changing message is asserted exactly (name, payload, order) from
 * window.__blockerCalls. Each test names the checklist lines it covers ("[Cn]").
 * Screenshots: filter-lists-{light,dark,rtl,search,max-rulesets,admin-locked,error}.png
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
    clearCalls,
    DASHBOARD_VIEWPORT,
    getCalls,
    getMessages,
    getMockState,
    HARNESS_DIR,
    launchChrome,
    mockBroadcast,
    openHarness,
    screenshot,
    startStaticServer,
    userDataDirRemoved,
} from './helpers/index.mjs';

const PANE = '[data-testid="filter-lists-pane"]';
const READY = `${PANE}[data-state="ready"]`;
const DEFAULTS = ['easylist', 'easyprivacy', 'ublock-filters'];
const RU_NODE = '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList';
const READS = ['getEnabledRulesets', 'getRulesetDetails'];

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof launchChrome>>} */
let chrome;

before(async () => {
    server = await startStaticServer(HARNESS_DIR);
    chrome = await launchChrome({ viewport: DASHBOARD_VIEWPORT, colorScheme: 'light' });
});

after(async () => {
    await chrome?.close();
    await server?.close();
    if (chrome) assert.equal(userDataDirRemoved(chrome), true);
});

/** Opens the dashboard on the Filter lists pane (stored active pane) and waits for it. */
async function open(params = {}, { storage = {} } = {}) {
    const page = chrome.page;
    await openHarness(page, 'dashboard', {
        ...params,
        mock: { storage: { local: { 'dashboard.activePane': 'rulesets', ...storage } } },
    });
    await page.waitForSelector(READY, { timeout: 30_000 });
    return page;
}

const whats = async (page) => (await getMessages(page)).map((m) => m.what);
const applies = async (page) => (await getMessages(page)).filter((m) => m.what === 'applyRulesets');
const pause = (page, ms = 150) => page.waitForTimeout(ms);
const leaf = (page, id) => page.locator(`[data-testid="leaf-checkbox-${id}"]`);
const leafRow = (page, id) => page.locator(`li[data-leaf-id="${id}"]`);
const group = (page, id) => page.locator(`section[data-group-id="${id}"]`);
const totals = (page) => page.locator('[data-testid="filter-lists-totals"]').innerText();
const storageWrites = async (page) =>
    (await getCalls(page, { api: /^storage\.(local|session|sync)\.(set|remove|clear)$/ })).map((c) => [c.api, c.args[0]]);
const visibleLeaves = (page) =>
    page.locator(`${PANE} li[data-leaf-id]`).evaluateAll((els) =>
        els.filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute('data-leaf-id')),
    );
/** Console errors other than missing static files. */
const realErrors = () => chrome.consoleErrors.filter((e) => !/Failed to load resource/.test(e));

/** Waits until `n` applyRulesets were sent (polling the record). */
async function waitForApplies(page, n, timeout = 10_000) {
    await page.waitForFunction(
        (count) => globalThis.__blockerCalls.filter((c) => c.api === 'runtime.sendMessage' && c.args[0]?.what === 'applyRulesets').length >= count,
        n,
        { timeout },
    );
}

/* ------------------------------------------------------------------ default */

test('[C1-C10, C13, C31, C39] default: first show, tree, order, counts, flags, links; no write', async () => {
    chrome.consoleErrors.length = 0;
    chrome.pageErrors.length = 0;
    const page = await open();
    await pause(page, 300);
    assert.deepEqual(await whats(page), ['getOptionsPageData', ...READS]);
    // Root groups: order, malware/imported hidden on Safari, no group checkbox.
    const groups = await page.locator(`${PANE} section[data-group-id]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-group-id')));
    assert.deepEqual(groups, ['default', 'ads', 'privacy', 'annoyances', 'misc', 'regions']);
    assert.equal(await group(page, 'default').locator('[data-group-name]').innerText(), 'Default');
    assert.equal(await page.locator(`${PANE} section[data-group-id] > h3 [role="checkbox"]`).count(), 0, 'no group checkbox');
    assert.equal(await page.getByTestId('filter-lists-title').innerText(), 'Filter lists');
    // Default hide-unused state: 13 rows shown (spec §20 #19).
    assert.deepEqual(await visibleLeaves(page), [
        ...DEFAULTS,
        'block-lan',
        'annoyances-ai', 'annoyances-cookies', 'annoyances-notifications', 'annoyances-others', 'annoyances-overlays', 'annoyances-social', 'annoyances-widgets',
        'ublock-experimental', 'ubol-tests',
    ]);
    assert.equal(await totals(page), '113,615 rules, converted from 121,437 network filters');
    const counts = await page.locator(`${PANE} section[data-group-id] [data-count]`).allInnerTexts();
    assert.deepEqual(counts, ['3/3', '0/1', '0/1', '0/7', '0/2', '0/37']);
    // Full order of regions (sorted by id, emoji/digits stripped), pol-0 promoted, RU node kept.
    await group(page, 'regions').getByTestId('group-toggle').click();
    const regions = await group(page, 'regions').locator('li[data-leaf-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-leaf-id')));
    assert.deepEqual(regions.slice(24, 30), ['nor-0', 'pol-0', 'rou-1', 'rus-0', 'rus-1', 'spa-0']);
    assert.equal(regions.length, 37);
    assert.equal(await page.locator(`li[data-node-id="${RU_NODE}"]`).count(), 1);
    // Flags as upstream images + hair space; other text unchanged.
    const deName = await leafRow(page, 'deu-0').locator('[data-name]').evaluate((el) => ({
        flags: [...el.querySelectorAll('img[data-flag]')].map((i) => i.getAttribute('src')),
        text: el.textContent,
        loaded: [...el.querySelectorAll('img')].every((i) => i.complete && i.naturalWidth > 0),
    }));
    assert.deepEqual(deName.flags, ['/img/flags-of-the-world/de.png', '/img/flags-of-the-world/ch.png', '/img/flags-of-the-world/at.png']);
    assert.equal(deName.text, ' de  ch  at: EasyList Germany');
    assert.equal(deName.loaded, true);
    // Home link: homeURL, new tab.
    const home = leafRow(page, 'ublock-filters').locator('a[data-home]');
    assert.equal(await home.getAttribute('href'), 'https://github.com/uBlockOrigin/uAssets');
    assert.equal(await home.getAttribute('target'), '_blank');
    assert.ok((await home.getAttribute('aria-label')).length > 0);
    // Rule-count description on the checkbox (the tooltip text).
    const described = await leaf(page, 'ublock-filters').evaluate((el) =>
        el.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id)?.textContent).join(' | '),
    );
    assert.match(described, /^6,913 rules, converted from 10,703 network filters/);
    // Opening and looking sends nothing else, writes nothing.
    await pause(page, 1300);
    assert.deepEqual(await whats(page), ['getOptionsPageData', ...READS]);
    assert.deepEqual(await storageWrites(page), [['storage.local.set', { hideUnusedFilterLists: ['ads', 'imported'] }]]);
    const apis = new Set((await getCalls(page)).map((c) => c.api));
    for (const api of apis) assert.doesNotMatch(api, /^(permissions|tabs|scripting|storage\.session)\./, `no ${api}`);
    assert.deepEqual(realErrors(), []);
    assert.deepEqual(chrome.pageErrors, []);
    assert.deepEqual(chrome.externalRequests, []);
});

test('[C11, C17-C19, C24, C36] default: tick deu-0 -> totals at once, one exact applyRulesets ~1 s later, then the reads', async () => {
    const page = await open();
    await group(page, 'regions').getByTestId('group-toggle').click();
    await clearCalls(page);
    await leaf(page, 'deu-0').click();
    assert.equal(await totals(page), '115,809 rules, converted from 123,751 network filters');
    assert.equal(await group(page, 'regions').locator('[data-count]').first().innerText(), '1/37');
    await pause(page, 700);
    assert.deepEqual(await whats(page), []);
    await waitForApplies(page, 1);
    await pause(page, 600);
    const msgs = await getMessages(page);
    assert.deepEqual(msgs[0], { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] });
    assert.deepEqual(msgs.slice(1).map((m) => m.what), READS, 'echo re-read only (no D8 duplicate)');
    const state = await getMockState(page);
    assert.ok(JSON.stringify(state).includes('deu-0'));
    assert.equal(await leaf(page, 'deu-0').getAttribute('aria-checked'), 'true');
    // Tick + untick inside the window sends nothing (C19).
    await clearCalls(page);
    await leaf(page, 'fra-0').click();
    await leaf(page, 'fra-0').click();
    await pause(page, 1500);
    assert.deepEqual(await whats(page), []);
});

test('[C12, C14, C15] default: tri-state RU node, node toggles, hide-unused writes', async () => {
    const page = await open();
    await group(page, 'regions').getByTestId('group-toggle').click(); // show all
    const node = page.locator(`li[data-node-id="${RU_NODE}"] [data-testid="node-checkbox"]`).first();
    assert.equal(await node.getAttribute('aria-checked'), 'false');
    await leaf(page, 'rus-0').click();
    assert.equal(await node.getAttribute('aria-checked'), 'mixed');
    assert.equal(await page.locator(`li[data-node-id="${RU_NODE}"] [data-count]`).first().innerText(), '1/2');
    await clearCalls(page);
    await node.click(); // partial -> all
    assert.equal(await node.getAttribute('aria-checked'), 'true');
    await waitForApplies(page, 1);
    assert.deepEqual((await applies(page))[0], {
        what: 'applyRulesets',
        enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'rus-0', 'rus-1'],
    });
    await pause(page, 500);
    await clearCalls(page);
    await node.click(); // all -> none
    assert.equal(await node.getAttribute('aria-checked'), 'false');
    await waitForApplies(page, 1);
    assert.deepEqual((await applies(page))[0], { what: 'applyRulesets', enabledRulesets: DEFAULTS });
    // Hide-unused toggles: whole array, node id = parent text; keyboard operable (D3).
    await clearCalls(page);
    await page.locator(`li[data-node-id="${RU_NODE}"] [data-testid="node-hide-unused"]`).click();
    const toggle = group(page, 'privacy').getByTestId('group-toggle');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(await storageWrites(page), [
        ['storage.local.set', { hideUnusedFilterLists: ['ads', 'imported', RU_NODE] }],
        ['storage.local.set', { hideUnusedFilterLists: ['ads', 'imported', RU_NODE, 'privacy'] }],
    ]);
    assert.deepEqual(await whats(page), []);
    // Header switch: one write with every collapsible group.
    await clearCalls(page);
    await page.getByTestId('filter-lists-hide-unused').click();
    const w = await storageWrites(page);
    assert.equal(w.length, 1);
    assert.deepEqual(w[0][1].hideUnusedFilterLists.sort(), ['ads', 'annoyances', 'imported', 'misc', 'privacy', 'regions', RU_NODE].sort());
    assert.deepEqual(await visibleLeaves(page), DEFAULTS);
});

test('[C14] stored hide-unused array replaces the default and is read once', async () => {
    const page = await open({}, { storage: { hideUnusedFilterLists: [] } });
    assert.equal((await visibleLeaves(page)).length, 51);
    const reads = await getCalls(page, { api: 'storage.local.get' });
    assert.equal(reads.filter((c) => JSON.stringify(c.args).includes('hideUnusedFilterLists')).length, 1);
});

test('[C16] search: literal, case-insensitive, name/group/tags; no message, no write; empty restores', async () => {
    const page = await open();
    await clearCalls(page);
    const search = page.getByTestId('filter-lists-search');
    const cases = [
        ['german', ['deu-0']],
        ['GERMAN', ['deu-0']],
        ['privacy', ['easyprivacy', 'block-lan']],
        ['ru adlist', ['rus-0', 'rus-1']],
        ['rus-0', []],
        ['a.b', []],
    ];
    for (const [pattern, ids] of cases) {
        await search.fill(pattern);
        await pause(page, 50);
        assert.deepEqual((await visibleLeaves(page)).sort(), [...ids].sort(), pattern);
    }
    assert.equal(await page.getByTestId('filter-lists-no-results').count(), 1);
    await search.fill('german');
    await pause(page, 100);
    await screenshot(page, 'filter-lists-search');
    await search.fill('');
    assert.equal((await visibleLeaves(page)).length, 13);
    assert.deepEqual(await whats(page), []);
    assert.deepEqual(await storageWrites(page), []);
});

test('[C24, C25, C40] broadcasts: { enabledRulesets } re-reads; undefined ignored; pending edit survives', async () => {
    const page = await open();
    await clearCalls(page);
    await mockBroadcast(page, { enabledRulesets: undefined });
    await mockBroadcast(page, { autoReload: false });
    await pause(page, 300);
    assert.deepEqual(await whats(page), []);
    await group(page, 'privacy').getByTestId('group-toggle').isVisible();
    await leaf(page, 'block-lan').click(); // pending edit
    await mockBroadcast(page, { enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'] });
    await pause(page, 300);
    assert.deepEqual(await whats(page), READS);
    assert.equal(await leaf(page, 'block-lan').getAttribute('aria-checked'), 'true');
    await waitForApplies(page, 1);
    assert.deepEqual((await applies(page))[0], { what: 'applyRulesets', enabledRulesets: [...DEFAULTS, 'block-lan'] });
});

test('[C33, D1] page hide with a pending change sends it once, at once', async () => {
    const page = await open();
    await clearCalls(page);
    const sent = await page.evaluate(() => {
        document.querySelector('[data-testid="leaf-checkbox-block-lan"]').click();
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        return globalThis.__blockerCalls.filter((c) => c.api === 'runtime.sendMessage').map((c) => c.args[0]);
    });
    assert.deepEqual(sent, [{ what: 'applyRulesets', enabledRulesets: [...DEFAULTS, 'block-lan'] }]);
    await pause(page, 1500);
    assert.equal((await applies(page)).length, 1);
    // Nothing pending: nothing sent (C34).
    await clearCalls(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    assert.deepEqual(await whats(page), []);
});

test('screenshots: light, dark, rtl', async () => {
    let page = await open();
    await screenshot(page, 'filter-lists-light', { fullPage: true });
    page = await open({ theme: 'dark' });
    await group(page, 'regions').getByTestId('group-toggle').click();
    await leaf(page, 'rus-0').click();
    await page.evaluate(() => window.scrollTo(0, 0)); // a sticky header is drawn at the scroll position in full-page shots
    await pause(page, 100);
    await screenshot(page, 'filter-lists-dark', { fullPage: true });
    page = await open({ lang: 'ar' });
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    // Totals line localised; numbers from toLocaleString().
    assert.ok((await totals(page)).length > 0);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.equal(noOverflow, true);
    // Label sits at the inline start side of the box with a gap (library pads physically; fixed in the pane).
    const gap = await leaf(page, 'easylist').evaluate((box) => {
        const label = box.parentElement.querySelector('label');
        return box.getBoundingClientRect().left - label.getBoundingClientRect().right + parseFloat(getComputedStyle(label).paddingRight);
    });
    assert.ok(gap >= 6, `checkbox/label gap in RTL: ${gap}`);
    await screenshot(page, 'filter-lists-rtl', { fullPage: true });
    assert.deepEqual(chrome.pageErrors, []);
});

/* ------------------------------------------------------------- max-rulesets */

test('[C30, Q6, §9.5] max-rulesets: unchecked rows locked; exceeding through a partial node is sent, refused and reported', async () => {
    const page = await open({ scenario: 'max-rulesets' });
    assert.equal(await page.getByTestId('filter-lists-limit').count(), 1);
    await group(page, 'regions').getByTestId('group-toggle').click();
    assert.equal(await leaf(page, 'fra-0').getAttribute('aria-disabled'), 'true', 'locked row');
    assert.equal(await leaf(page, 'deu-0').getAttribute('aria-disabled'), null, 'checked row operable');
    // Locked rows stay focusable (the reason is reachable) and a change is ignored.
    await clearCalls(page);
    await leaf(page, 'fra-0').focus();
    await page.keyboard.press('Space');
    assert.equal(await leaf(page, 'fra-0').getAttribute('aria-checked'), 'false');
    await pause(page, 1200);
    assert.deepEqual(await whats(page), []);
    await clearCalls(page);
    await leaf(page, 'deu-0').click(); // 4: below the limit
    assert.equal(await page.getByTestId('filter-lists-limit').count(), 0);
    assert.equal(await leaf(page, 'fra-0').getAttribute('aria-disabled'), null);
    await leaf(page, 'rus-0').click(); // 5: at the limit, RU node partial = checked = not locked
    const node = page.locator(`li[data-node-id="${RU_NODE}"] [data-testid="node-checkbox"]`).first();
    assert.equal(await node.getAttribute('aria-disabled'), null);
    await node.click(); // 6: above the limit, lock disappears (strict equality)
    await waitForApplies(page, 1);
    assert.deepEqual(await applies(page), [
        {
            what: 'applyRulesets',
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'annoyances-cookies', 'rus-0', 'rus-1'],
        },
    ]);
    await page.waitForSelector('[data-testid="filter-lists-not-applied"]', { timeout: 5000 });
    const text = await page.getByTestId('filter-lists-not-applied-names').innerText();
    assert.match(text, /RU AdList/);
    assert.doesNotMatch(text, /🇷🇺/, 'names without flags');
    assert.equal(await page.getByTestId('filter-lists-not-applied').locator('img').count(), 0);
    // The boxes show the real state again.
    assert.equal(await leaf(page, 'rus-0').getAttribute('aria-checked'), 'false');
    assert.equal(await leaf(page, 'deu-0').getAttribute('aria-checked'), 'true');
    // Scrolled to where the user acted: the stuck header carries a one-line notice.
    await page.waitForSelector('[data-testid="filter-lists-header"][data-stuck]', { timeout: 3000 });
    const sticky = page.getByTestId('filter-lists-sticky-notice');
    assert.equal(await sticky.innerText(), 'Not every filter list could be enabled');
    const box = await sticky.boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 800, `sticky notice in view (y=${box?.y})`);
    await screenshot(page, 'filter-lists-max-rulesets');
    await page.evaluate(() => window.scrollTo(0, 0));
    await pause(page, 200);
    assert.equal(await sticky.count(), 0, 'no duplicate while the full notice is in view');
    await screenshot(page, 'filter-lists-not-applied-top');
});

/* ------------------------------------------------------------- admin-locked */

test('[C27-C29, Q5] admin-locked: rows disabled/hidden, excluded from payload and search', async () => {
    const page = await open({ scenario: 'admin-locked' });
    // -easyprivacy: unchecked admin row not shown; +annoyances-cookies: shown, checked, disabled.
    assert.equal(await leafRow(page, 'easyprivacy').count(), 0);
    assert.equal(await leaf(page, 'annoyances-cookies').getAttribute('aria-checked'), 'true');
    assert.equal(await leaf(page, 'annoyances-cookies').getAttribute('aria-disabled'), 'true');
    // Admin-forced rows keep the real checked look (no library disabled styling).
    assert.equal(await leaf(page, 'annoyances-cookies').getAttribute('data-disabled'), null);
    assert.equal(await leafRow(page, 'annoyances-cookies').locator('[data-managed]').count(), 1);
    assert.equal(await group(page, 'default').locator('[data-count]').innerText(), '2/3');
    await screenshot(page, 'filter-lists-admin-locked', { fullPage: true });
    await clearCalls(page);
    await page.getByTestId('filter-lists-search').fill('cookie');
    await pause(page, 50);
    assert.deepEqual(await visibleLeaves(page), []);
    await page.getByTestId('filter-lists-search').fill('');
    // Tick + untick: nothing (Q5 fix). Then tick: admin ids excluded.
    await leaf(page, 'block-lan').click();
    await leaf(page, 'block-lan').click();
    await pause(page, 1400);
    assert.deepEqual(await whats(page), []);
    await leaf(page, 'block-lan').click();
    await waitForApplies(page, 1);
    assert.deepEqual(await applies(page), [{ what: 'applyRulesets', enabledRulesets: ['easylist', 'ublock-filters', 'block-lan'] }]);
});

/* ----------------------------------------------------------- error-on-apply */

test('[C37, D4] error-on-apply: failure shown, state re-read, box reverts', async () => {
    const page = await open({ scenario: 'error-on-apply' });
    await clearCalls(page);
    await leaf(page, 'block-lan').click();
    await waitForApplies(page, 1);
    await page.waitForSelector('[data-testid="filter-lists-save-error"]', { timeout: 5000 });
    await pause(page, 400);
    const msgs = await getMessages(page);
    assert.deepEqual(msgs[0], { what: 'applyRulesets', enabledRulesets: [...DEFAULTS, 'block-lan'] });
    assert.deepEqual(msgs.slice(1).map((m) => m.what), READS);
    assert.equal(await page.getByTestId('filter-lists-save-error').getAttribute('role'), 'alert');
    assert.equal(await leaf(page, 'block-lan').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('[data-testid="filter-lists-commit-status"]').innerText(), '');
    // Plain language only: the transport error goes to the console, not into the notice.
    const notice = await page.getByTestId('filter-lists-save-error').innerText();
    assert.doesNotMatch(notice, /sendMessage|Could not establish|applyRulesets/);
    await screenshot(page, 'filter-lists-error');
    // Dismiss by keyboard: focus goes to the search field, not to <body>.
    await page.getByTestId('filter-lists-save-error').getByRole('button', { name: 'Dismiss' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByTestId('filter-lists-save-error').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'filter-lists-search');
});

test('[C37, C44, C45] failed reads: no controls, retry makes the pane operable', async () => {
    let page = chrome.page;
    await openHarness(page, 'dashboard', {
        fail: 'getRulesetDetails:reject',
        mock: { storage: { local: { 'dashboard.activePane': 'rulesets' } } },
    });
    await page.waitForSelector(`${PANE}[data-state="error"]`, { timeout: 10_000 });
    assert.equal(await page.locator(`${PANE} [role="checkbox"]`).count(), 0);
    await page.evaluate(() => globalThis.__blockerMock.setFailure('getRulesetDetails', null));
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForSelector(READY, { timeout: 10_000 });
    await clearCalls(page);
    await leaf(page, 'block-lan').click();
    await waitForApplies(page, 1);
    // Options data failure: nothing operable.
    await openHarness(page, 'dashboard', {
        fail: 'getOptionsPageData:reject',
        mock: { storage: { local: { 'dashboard.activePane': 'rulesets' } } },
    });
    await pause(page, 800);
    assert.equal(await page.locator(`${PANE} [role="checkbox"]`).count(), 0);
});

/* --------------------------------------------------------------------- slow */

test('[C21, C22, C42] slow: spinner during the commit; a change made meanwhile is sent after the response', async () => {
    const page = await open({ scenario: 'slow' });
    await clearCalls(page);
    await leaf(page, 'block-lan').click();
    await waitForApplies(page, 1);
    await page.waitForSelector('[data-testid="filter-lists-commit-status"] svg, [data-testid="filter-lists-commit-status"] div', { timeout: 2000 });
    assert.match(await page.getByTestId('filter-lists-commit-status').innerText(), /Saving/);
    await leaf(page, 'ubol-tests').click(); // during the in-flight commit
    await pause(page, 1200);
    assert.equal((await applies(page)).length, 1, 'no parallel commit');
    await waitForApplies(page, 2, 15_000);
    const calls = (await getCalls(page, { api: 'runtime.sendMessage' })).map((c) => c.args[0]);
    assert.deepEqual(
        calls.filter((m) => m.what === 'applyRulesets'),
        [
            { what: 'applyRulesets', enabledRulesets: [...DEFAULTS, 'block-lan'] },
            { what: 'applyRulesets', enabledRulesets: [...DEFAULTS, 'block-lan', 'ubol-tests'] },
        ],
    );
    await page.waitForFunction(() => document.querySelector('[data-testid="filter-lists-commit-status"]').innerText === '', undefined, { timeout: 10_000 });
    assert.deepEqual(chrome.pageErrors, []);
});

/* ------------------------------------------ regression tests (review findings) */

const tab = (page, re) => page.getByRole('tab', { name: re });
async function settingsReset(page) {
    await tab(page, /settings/i).click();
    await page.getByTestId('settings-reset-button').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset to default settings' }).click();
}

test('[fix F1, H17] a later Settings reset is no "not enabled" failure; the pending change lands first', async () => {
    const page = await open();
    await group(page, 'regions').getByTestId('group-toggle').click();
    await leaf(page, 'deu-0').click();
    await waitForApplies(page, 1);
    await pause(page, 800); // echo read verified the commit
    assert.equal(await page.getByTestId('filter-lists-not-applied').count(), 0);
    await clearCalls(page);
    await settingsReset(page);
    await page.locator('[data-testid="settings-busy"]').waitFor({ state: 'detached', timeout: 15_000 });
    await pause(page, 1200);
    const sent = await applies(page);
    assert.deepEqual(sent.at(-1)?.enabledRulesets?.slice().sort(), [...DEFAULTS].sort(), 'reset list lands last');
    await tab(page, /filter lists/i).click();
    await pause(page, 300);
    assert.equal(await page.getByTestId('filter-lists-not-applied').count(), 0, 'no false warning');
    assert.equal(await leaf(page, 'deu-0').getAttribute('aria-checked'), 'false');
});

test('[fix F1 remnant, H17] a Settings reset within the 997 ms debounce: pending change first, reset last, no false warning', async () => {
    const page = await open();
    await group(page, 'regions').getByTestId('group-toggle').click();
    await clearCalls(page);
    await leaf(page, 'deu-0').click(); // pending: the reset below comes well inside the debounce
    await settingsReset(page);
    await page.locator('[data-testid="settings-busy"]').waitFor({ state: 'detached', timeout: 15_000 });
    await pause(page, 1500); // echo reads and the D8 grace are over
    const sent = (await applies(page)).map((m) => m.enabledRulesets);
    assert.deepEqual(sent, [[...DEFAULTS, 'deu-0'], ['ublock-filters', 'easylist', 'easyprivacy']], 'pending change first, reset list last');
    await tab(page, /filter lists/i).click();
    await pause(page, 300);
    assert.equal(await page.getByTestId('filter-lists-not-applied').count(), 0, 'no false "Safari did not enable"');
    assert.equal(await leaf(page, 'deu-0').getAttribute('aria-checked'), 'false');
    assert.deepEqual(chrome.pageErrors, []);
});

test('[fix F4] a hung applyRulesets delays Settings reset by at most ~8 s instead of blocking it', async () => {
    const page = await open();
    await group(page, 'regions').getByTestId('group-toggle').click();
    await page.evaluate(() => globalThis.__blockerMock.setFailure('applyRulesets', 'hang'));
    await leaf(page, 'deu-0').click();
    await waitForApplies(page, 1);
    await leaf(page, 'fra-0').click(); // pending while the first send hangs
    await pause(page, 300);
    await clearCalls(page);
    await settingsReset(page);
    await page.waitForFunction(
        () => globalThis.__blockerCalls.some((c) => c.api === 'runtime.sendMessage' && c.args[0]?.what !== 'applyRulesets' && !/^get/.test(c.args[0]?.what)),
        undefined,
        { timeout: 12_000 },
    );
    // Never two filter-list sends in parallel: fra-0 was dropped, not sent.
    const ours = (await applies(page)).filter((m) => m.enabledRulesets.includes('fra-0'));
    assert.deepEqual(ours, []);
});

test('[fix a11y] focus: group ring visible; a row hidden by its own untick hands focus to the disclosure', async () => {
    const page = await open();
    const toggle = group(page, 'regions').getByTestId('group-toggle');
    await group(page, 'privacy').getByTestId('group-toggle').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const ring = await page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement);
        return { id: document.activeElement.getAttribute('data-testid'), style: cs.outlineStyle, width: cs.outlineWidth };
    });
    assert.deepEqual(ring, { id: 'group-toggle', style: 'solid', width: '2px' });
    await toggle.click(); // expand regions
    await leaf(page, 'deu-0').click();
    await toggle.click(); // hide unused again: deu-0 stays (checked)
    assert.equal(await leafRow(page, 'deu-0').count(), 1);
    assert.match(await toggle.innerText(), /35 hidden/); // 36 direct entries (RU node = 1) minus deu-0
    await leaf(page, 'deu-0').focus();
    await page.keyboard.press('Space');
    assert.equal(await leafRow(page, 'deu-0').count(), 0, 'row hidden (upstream)');
    const active = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        group: document.activeElement?.closest('section')?.getAttribute('data-group-id'),
        testid: document.activeElement?.getAttribute('data-testid'),
    }));
    assert.deepEqual(active, { tag: 'BUTTON', group: 'regions', testid: 'group-toggle' });
});

test('[fix a11y] semantics: live regions from mount, node button named by the list, rule counts on keyboard focus', async () => {
    const page = await open({}, { storage: { hideUnusedFilterLists: [] } });
    assert.equal(await page.getByTestId('filter-lists-commit-status').getAttribute('role'), 'status');
    assert.equal(await page.getByTestId('filter-lists-results-status').getAttribute('role'), 'status');
    const nodeToggle = page.locator(`li[data-node-id="${RU_NODE}"] [data-testid="node-hide-unused"]`);
    const name = await nodeToggle.evaluate((b) =>
        b.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id).textContent).join(' '),
    );
    assert.match(name, /^\s*ru\s+ua\s+uz\s+kz: RU AdList$/u);
    assert.equal(await nodeToggle.getAttribute('aria-expanded'), 'true');
    // No library "open menu" look on the expanded node chevron.
    assert.equal(await nodeToggle.evaluate((b) => b.closest('[data-variant]') === b), false);
    // List names are an isolated LTR run (flags stay next to their codes in RTL).
    assert.equal(await leafRow(page, 'deu-0').locator('[data-name]').getAttribute('dir'), 'ltr');
    // Keyboard focus shows the rule counts (tooltip), not only hover.
    await page.getByTestId('filter-lists-search').focus();
    await page.keyboard.press('Tab'); // switch
    await page.keyboard.press('Tab'); // first row checkbox
    await page.waitForSelector('[role="tooltip"]', { timeout: 3000 });
    assert.match(await page.locator('[role="tooltip"]').first().innerText(), /rules, converted from/);
    // Clear button replaces the native one; Escape still clears too.
    await page.getByTestId('filter-lists-search').fill('german');
    await page.getByTestId('filter-lists-search-clear').click();
    assert.equal(await page.getByTestId('filter-lists-search').inputValue(), '');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'filter-lists-search');
});

test('[fix visual] dark badge contrast, RTL search icon gap, stuck header border, screenshots', async () => {
    let page = await open({ theme: 'dark' });
    const color = await group(page, 'default').locator('[data-count]').evaluate((e) => getComputedStyle(e.parentElement).color);
    assert.equal(color, 'rgb(102, 181, 255)', 'info badge uses the stronger info text in dark');
    // 0/N badges stay neutral in dark (were info blue too).
    const zero = await group(page, 'regions').locator('[data-count]').first().evaluate((e) => ({
        text: e.textContent,
        color: getComputedStyle(e.parentElement).color,
        badge: e.parentElement.getAttribute('data-color'),
    }));
    assert.deepEqual(zero, { text: '0/37', color: 'rgb(255, 255, 255)', badge: 'secondary' }, 'neutral 0/N badge in dark');
    await screenshot(page, 'filter-lists-dark-viewport');
    page = await open({ lang: 'ar' });
    const gap = await page.getByTestId('filter-lists-search').evaluate((input) => {
        const c = input.parentElement;
        return Math.round(c.getBoundingClientRect().right - c.firstElementChild.getBoundingClientRect().right);
    });
    assert.ok(gap >= 8, `RTL search icon inset ${gap}`);
    page = await open({}, { storage: { hideUnusedFilterLists: [] } });
    assert.equal(await page.locator('[data-testid="filter-lists-header"][data-stuck]').count(), 0);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForSelector('[data-testid="filter-lists-header"][data-stuck]', { timeout: 3000 });
    const border = await page.getByTestId('filter-lists-header').evaluate((h) => getComputedStyle(h).borderBottomColor);
    assert.notEqual(border, 'rgba(0, 0, 0, 0)');
    // `border-default` (10% alpha in light), not the faint 5% `border-subtle`.
    const alpha = Number(/\/\s*([\d.]+)\)$/.exec(border)?.[1] ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(border)?.[1]);
    assert.ok(alpha >= 0.1, `stuck header border alpha ${border}`);
    await screenshot(page, 'filter-lists-scrolled');
    await page.getByTestId('filter-lists-search').fill('zzzz');
    await pause(page, 100);
    await screenshot(page, 'filter-lists-no-results');
    assert.deepEqual(chrome.pageErrors, []);
});

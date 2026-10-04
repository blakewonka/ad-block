/**
 * Harness smoke test: the mock browser API (src/dev/mock-ext.ts) is installed
 * in the harness pages, answers runtime.sendMessage round trips with the spec
 * shapes, mutates its state like the background, echoes on
 * BroadcastChannel('uBOL'), records every call, and honours the switches.
 *
 *   npm run build:harness && node tests/e2e/harness.smoke.mjs    (also part of npm run e2e)
 *
 * Screenshots (build/screenshots): mock-harness-popup-light.png, mock-harness-popup-dark.png.
 * It does not depend on what the popup renders (placeholder or real popup): it
 * only waits for the React root to mount.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
    getCalls,
    getMessages,
    getMockState,
    HARNESS_DIR,
    launchChrome,
    openHarness,
    POPUP_VIEWPORT,
    screenshot,
    startStaticServer,
    userDataDirRemoved,
} from './helpers/index.mjs';
import { PRISTINE_DIR, UI_ROOT } from './lib/harness.mjs';

/** messaging.md §21 fixture F / src/dev/fixtures/background-state.ts EXPECTED_DEFAULT_RESPONSES. */
const F_POPUP_PANEL_DATA = {
    hasOmnipotence: true,
    level: 1,
    autoReload: true,
    isSideloaded: true,
    developerMode: false,
    hasCustomFilters: 0,
};
const POPUP_REQUEST = { what: 'popupPanelData', origin: 'https://www.example.com', hostname: 'www.example.com' };

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof launchChrome>>} */
let chrome;

before(async () => {
    server = await startStaticServer(HARNESS_DIR);
    chrome = await launchChrome({ viewport: POPUP_VIEWPORT, colorScheme: 'light' });
});

after(async () => {
    await chrome?.close();
    await server?.close();
    if (chrome) assert.equal(userDataDirRemoved(chrome), true, 'temporary Chrome profile was deleted');
});

/** Sends one message from the page through the mock and returns the answer (or the rejection text). */
async function send(page, message) {
    return page.evaluate(async (m) => {
        try {
            return { ok: true, value: await globalThis.browser.runtime.sendMessage(m) };
        } catch (err) {
            return { ok: false, error: String(err && err.message) };
        }
    }, message);
}

test('popup harness, light: mock installed, sendMessage round trip, state change, echo, record', async () => {
    const { page } = chrome;
    await openHarness(page, 'popup', { theme: 'light' });

    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-harness')), 'mock-installed');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
    assert.equal(await page.evaluate(() => Array.isArray(globalThis.__blockerCalls)), true);
    assert.equal(await page.evaluate(() => typeof globalThis.browser?.runtime?.sendMessage), 'function');

    // Listen on the channel the background posts to (messaging.md §11).
    await page.evaluate(() => {
        globalThis.__echoes = [];
        new BroadcastChannel('uBOL').onmessage = (ev) => globalThis.__echoes.push(ev.data);
    });

    // Round trip 1: the popup's open message answers fixture F.
    const callsBefore = (await getMessages(page)).length;
    const first = await send(page, POPUP_REQUEST);
    assert.deepEqual(first, { ok: true, value: F_POPUP_PANEL_DATA });

    // Round trip 2: setFilteringMode changes what the next popupPanelData reports.
    assert.deepEqual(await send(page, { what: 'setFilteringMode', hostname: 'www.example.com', level: 3 }), { ok: true, value: 3 });
    const second = await send(page, POPUP_REQUEST);
    assert.equal(second.value.level, 3, 'level persisted in the mock background');
    await page.waitForFunction(() => globalThis.__echoes.length > 0);
    const echo = await page.evaluate(() => globalThis.__echoes[0]);
    assert.equal(echo.defaultFilteringMode, 2);
    assert.equal(echo.hasOmnipotence, true);
    assert.ok(echo.filteringModeDetails.complete instanceof Set || typeof echo.filteringModeDetails.complete === 'object');

    // The record: exact messages in order, deep copies, numeric timestamps.
    const messages = (await getMessages(page)).slice(callsBefore);
    assert.deepEqual(messages, [
        POPUP_REQUEST,
        { what: 'setFilteringMode', hostname: 'www.example.com', level: 3 },
        POPUP_REQUEST,
    ]);
    const calls = await getCalls(page, { api: 'runtime.sendMessage' });
    for (let i = 1; i < calls.length; i++) {
        assert.equal(typeof calls[i].t, 'number');
        assert.ok(calls[i].t >= calls[i - 1].t, 'timestamps are monotonic');
    }
    // Page-side BroadcastChannel construction is recorded; the background's own posts are not.
    assert.deepEqual(
        (await getCalls(page, { api: 'BroadcastChannel' })).map((c) => c.args),
        [['uBOL']],
    );
    const state = await getMockState(page);
    assert.deepEqual(state.background.filteringModes.complete, ['www.example.com']);

    const file = await screenshot(page, 'mock-harness-popup-light');
    assert.ok(existsSync(file) && statSync(file).size > 1000, 'light screenshot written');
});

test('popup harness, ?theme=dark overrides the OS scheme; the mock still answers', async () => {
    const { page } = chrome;
    const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await openHarness(page, 'popup', { theme: 'dark' });
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
    const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(darkBackground, lightBackground, 'surface colour differs in dark mode');

    // theme-init.js reacts to an OS change, the override puts dark back.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');

    // A fresh page load starts from fixture F again.
    assert.deepEqual(await send(page, POPUP_REQUEST), { ok: true, value: F_POPUP_PANEL_DATA });
    const file = await screenshot(page, 'mock-harness-popup-dark');
    assert.ok(existsSync(file) && statSync(file).size > 1000, 'dark screenshot written');
});

test('switches: lang, dir, url, perm, scenarios, fail, mock JSON, injected config', async () => {
    const { page } = chrome;

    // Locales: real PRISTINE messages; @@ui_locale; RTL; longest locale.
    await openHarness(page, 'popup', { lang: 'ar' });
    assert.deepEqual(
        await page.evaluate(() => [
            browser.i18n.getMessage('@@ui_locale'),
            browser.i18n.getMessage('@@bidi_dir'),
            browser.i18n.getMessage('extName'),
            browser.i18n.getMessage('noSuchKey'),
        ]),
        ['ar', 'rtl', 'Blocker', ''],
    );
    // (`popupNoWebsite` is untranslated in PRISTINE's ar locale; `popupTipDashboard` is translated.)
    assert.match(await page.evaluate(() => browser.i18n.getMessage('popupTipDashboard')), /[؀-ۿ]/, 'Arabic text');
    await openHarness(page, 'popup', { lang: 'longest' });
    assert.equal(await page.evaluate(() => browser.i18n.getMessage('@@ui_locale')), 'el');
    await openHarness(page, 'popup', { lang: 'de', dir: 'rtl' });
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.equal(await page.evaluate(() => browser.i18n.getMessage('@@ui_locale')), 'ar');
    assert.equal(await page.evaluate(() => browser.i18n.getMessage('popupTipDashboard')).then((s) => s.length > 0), true);

    // Tabs: fixture F tab, a non-http page, a tab without url, no tab.
    await openHarness(page, 'popup');
    assert.deepEqual(
        await page.evaluate(async () => (await browser.tabs.query({ active: true, currentWindow: true })).map((t) => [t.id, t.url])),
        [[42, 'https://www.example.com/path?x=1']],
    );
    await openHarness(page, 'popup', { scenario: 'no-website' });
    assert.equal(await page.evaluate(async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].url), 'about:blank');
    await openHarness(page, 'popup', { url: 'file:///x' });
    assert.equal(await page.evaluate(async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].url), 'file:///x');
    await openHarness(page, 'popup', { url: 'none' });
    assert.equal(await page.evaluate(async () => 'url' in (await browser.tabs.query({ active: true, currentWindow: true }))[0]), false);
    await openHarness(page, 'popup', { tab: 'none' });
    assert.deepEqual(await page.evaluate(() => browser.tabs.query({ active: true, currentWindow: true })), []);

    // Permissions: grant (default), deny, reject.
    await openHarness(page, 'popup');
    assert.equal(await page.evaluate(() => browser.permissions.request({ origins: ['*://*.www.example.com/*'] })), true);
    await openHarness(page, 'popup', { perm: 'deny' });
    assert.equal(await page.evaluate(() => browser.permissions.request({ origins: ['*://*.www.example.com/*'] })), false);
    await openHarness(page, 'popup', { perm: 'reject' });
    assert.equal(
        await page.evaluate(() => browser.permissions.request({ origins: ['<all_urls>'] }).then(() => 'resolved', () => 'rejected')),
        'rejected',
    );

    // Scenarios.
    await openHarness(page, 'dashboard', { scenario: 'admin-locked' });
    const admin = (await send(page, { what: 'getOptionsPageData' })).value;
    assert.deepEqual(admin.disabledFeatures, ['filteringMode', 'develop', 'picker']);
    assert.deepEqual(admin.adminRulesets, ['+annoyances-cookies', '-easyprivacy']);
    assert.deepEqual(admin.enabledRulesets, ['ublock-filters', 'easylist', 'annoyances-cookies']);
    assert.equal(admin.rulesetDetails.length, 51);

    await openHarness(page, 'dashboard', { scenario: 'max-rulesets' });
    const max = (await send(page, { what: 'getOptionsPageData' })).value;
    assert.equal(max.maxNumberOfEnabledRulesets, 5);
    assert.equal(max.enabledRulesets.length, 5);
    await send(page, { what: 'applyRulesets', enabledRulesets: [...max.enabledRulesets, 'fra-0'] });
    assert.deepEqual((await send(page, { what: 'getEnabledRulesets' })).value, max.enabledRulesets, 'over the limit: unchanged');

    await openHarness(page, 'dashboard', { scenario: 'error-on-apply' });
    assert.deepEqual(await send(page, { what: 'applyRulesets', enabledRulesets: ['easylist'] }), {
        ok: false,
        error: 'Could not establish connection. Receiving end does not exist.',
    });
    assert.equal((await send(page, { what: 'getEnabledRulesets' })).value.length, 3, 'reads still answer, nothing changed');

    await openHarness(page, 'popup', { scenario: 'slow' });
    const elapsed = await page.evaluate(async () => {
        const t0 = performance.now();
        await browser.runtime.sendMessage({ what: 'getDefaultFilteringMode' });
        return performance.now() - t0;
    });
    assert.ok(elapsed >= 1400, `slow scenario delays answers (${Math.round(elapsed)} ms)`);

    // Per-message failures, verbatim responses, and the JSON / injected config channels.
    await openHarness(page, 'popup', { fail: 'popupPanelData:undefined,setFilteringMode:null' });
    assert.deepEqual(await send(page, POPUP_REQUEST), { ok: true, value: undefined });
    assert.deepEqual(await send(page, { what: 'setFilteringMode', hostname: 'a.b', level: 2 }), { ok: true, value: null });
    await openHarness(page, 'popup', { mock: { responses: { popupPanelData: { level: 2 } }, background: { developerMode: true } } });
    assert.deepEqual((await send(page, POPUP_REQUEST)).value, { level: 2 });
    assert.equal((await send(page, { what: 'getCurrentConfig' })).value.developerMode, true);

    const injected = await chrome.context.newPage();
    try {
        await openHarness(injected, 'popup', {}, { config: { tabUrl: 'https://news.example.org/', level: 0, customFilterCount: 2 } });
        assert.deepEqual(
            (await send(injected, { what: 'popupPanelData', origin: 'https://news.example.org', hostname: 'news.example.org' })).value,
            { ...F_POPUP_PANEL_DATA, level: 0, hasCustomFilters: 2 },
        );
    } finally {
        await injected.close();
    }

    // window.close and confirm are recorded, not executed.
    await openHarness(page, 'popup', { confirm: false });
    await page.evaluate(() => {
        window.confirm('sure?');
        self.close();
    });
    const tail = (await getCalls(page)).slice(-2);
    assert.deepEqual(tail.map((c) => [c.api, c.args]), [
        ['window.confirm', ['sure?']],
        ['window.close', []],
    ]);
    assert.equal(await page.evaluate(() => globalThis.__blockerMock.closed), true);
});

test('mock fixtures match PRISTINE', (t) => {
    // PRISTINE = build/pristine/safari (scripts/build.sh). Locales come from the pinned
    // upstream commit and must be byte-identical. The manifest differs only in its
    // build-time version stamp. ruleset-details.json depends on the filter lists that were
    // downloaded when PRISTINE was built, so only its list of rulesets must match.
    const pristine = PRISTINE_DIR;
    if (!existsSync(pristine)) {
        t.skip(`PRISTINE not found at ${pristine}`);
        return;
    }
    const fixtures = path.join(UI_ROOT, 'src', 'dev', 'fixtures');
    const same = (a, b) => readFileSync(a).equals(readFileSync(b));
    const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
    const details = (f) => json(f).map((d) => d.id);
    assert.deepEqual(
        details(path.join(fixtures, 'ruleset-details.json')),
        details(path.join(pristine, 'rulesets', 'ruleset-details.json')),
        'same rulesets in the same order',
    );
    const withoutVersion = (f) => { const m = json(f); delete m.version; return m; };
    assert.deepEqual(withoutVersion(path.join(fixtures, 'manifest.json')), withoutVersion(path.join(pristine, 'manifest.json')));
    const folders = readdirSync(path.join(pristine, '_locales')).sort();
    assert.deepEqual(
        readdirSync(path.join(fixtures, 'locales')).map((f) => f.replace(/\.json$/, '')).sort(),
        folders,
        'one fixture per PRISTINE locale',
    );
    for (const folder of folders) {
        assert.ok(same(path.join(fixtures, 'locales', `${folder}.json`), path.join(pristine, '_locales', folder, 'messages.json')), folder);
    }
});

test('no request left the local server, no page error, no console error', () => {
    assert.deepEqual(chrome.externalRequests, [], 'no external request');
    assert.deepEqual(chrome.failedRequests, [], 'no failed request');
    assert.deepEqual(chrome.pageErrors, [], 'no uncaught page error');
    assert.deepEqual(chrome.consoleErrors, [], 'no console error');
});

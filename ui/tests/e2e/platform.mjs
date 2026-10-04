/**
 * The UI on every target browser: what changes with the platform, and the
 * touch layout of Safari on iOS/iPadOS and Firefox for Android.
 *
 *   npm run build:harness && node --test tests/e2e/platform.mjs
 *
 * The harness switch `?platform=safari|chromium|firefox` (src/dev/mock-ext.ts)
 * sets the scheme of runtime.getURL (what upstream's `webextFlavor` and the UI
 * branch on) and the background defaults of that build: compiled filters
 * (imported lists) on Chromium and Firefox, strict blocking on by default there.
 * On Chromium the mock is installed as `chrome` only (no `browser` global).
 *
 * What may differ per platform, exactly as upstream:
 * - Settings: no strict-blocking row on Safari (dashboard.js:33, settings.css:104).
 * - Filter lists: the "Imported lists" group, the user-scripts notice and
 *   "Add filter list…" only with compiled-filter support (settings.js:334-341,
 *   settings.css:267-279); importing sends `{ what: 'importFilterList', url }`
 *   (filter-lists.js:490-499); a removed imported list is disabled by the
 *   debounced commit and deleted by the page-hide commit with `toRemove`
 *   (filter-lists.js:442-457, 501-523).
 * Everything else, the popup in particular, sends the same messages everywhere.
 *
 * Touch layout (Chrome with touch emulation answers `(hover: none) and
 * (pointer: coarse)` like a phone): the popup fills a 390 x 844 sheet with
 * 44 px targets; the dashboard never scrolls sideways.
 *
 * Screenshots (build/screenshots): platform-filter-lists-chromium.png,
 * phone-popup-{light,dark}.png, phone-dashboard-{settings,filter-lists}.png.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
    DASHBOARD_VIEWPORT,
    getMessages,
    HARNESS_DIR,
    launchChrome,
    openHarness,
    PHONE_VIEWPORT,
    POPUP_VIEWPORT,
    screenshot,
    startStaticServer,
    TOUCH_DEVICE,
    userDataDirRemoved,
} from './helpers/index.mjs';

const PLATFORMS = ['safari', 'chromium', 'firefox'];
const FL_READY = '[data-testid="filter-lists-pane"][data-state="ready"]';
const DEFAULTS = ['easylist', 'easyprivacy', 'ublock-filters'];
const IMPORTED = Object.freeze({
    id: 'https://example.org/my-list.txt',
    name: 'My list',
    group: 'imported',
    enabled: true,
    homeURL: '',
    expires: 7,
    time: { added: 1, updated: 0 },
    filters: { total: 10, accepted: 9, rejected: 1 },
    rules: { total: 9, plain: 9, regex: 0 },
});

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;

before(async () => {
    server = await startStaticServer(HARNESS_DIR);
});

after(async () => {
    await server?.close();
});

const realErrors = (chrome) => chrome.consoleErrors.filter((e) => !/Failed to load resource/.test(e));
const applies = async (page) => (await getMessages(page)).filter((m) => m.what === 'applyRulesets');

async function openFilterLists(page, params = {}, background = undefined) {
    await openHarness(page, 'dashboard', {
        ...params,
        mock: { storage: { local: { 'dashboard.activePane': 'rulesets' } }, ...(background ? { background } : {}) },
    });
    await page.waitForSelector(FL_READY, { timeout: 30_000 });
}

/** Imported list enabled at start (the mock keeps it in storage.local['rulesets.imported']). */
const WITH_IMPORTED = { importedLists: [IMPORTED], enabledRulesets: [...DEFAULTS, IMPORTED.id] };

/* ------------------------------------------------------------------ desktop */

describe('platform branches (desktop)', () => {
    /** @type {Awaited<ReturnType<typeof launchChrome>>} */
    let chrome;
    before(async () => {
        chrome = await launchChrome({ viewport: DASHBOARD_VIEWPORT });
    });
    after(async () => {
        await chrome?.close();
        if (chrome) assert.equal(userDataDirRemoved(chrome), true);
    });

    test('the mock really is each platform: URL scheme, and `chrome` only on Chromium', async () => {
        const page = chrome.page;
        const expected = { safari: 'safari-web-extension:', chromium: 'chrome-extension:', firefox: 'moz-extension:' };
        for (const platform of PLATFORMS) {
            await openHarness(page, 'popup', { platform });
            const info = await page.evaluate(() => ({
                platform: document.documentElement.getAttribute('data-mock-platform'),
                hasBrowser: typeof globalThis.browser?.runtime?.getURL === 'function',
                scheme: (globalThis.browser ?? globalThis.chrome).runtime.getURL('').split('//')[0],
            }));
            assert.equal(info.platform, platform);
            assert.equal(info.scheme, expected[platform]);
            assert.equal(info.hasBrowser, platform !== 'chromium');
        }
    });

    test('popup: same messages on every platform', async () => {
        const page = chrome.page;
        await page.setViewportSize(POPUP_VIEWPORT);
        const seen = {};
        for (const platform of PLATFORMS) {
            chrome.consoleErrors.length = 0;
            chrome.pageErrors.length = 0;
            await openHarness(page, 'popup', { platform });
            await page.waitForSelector('[data-testid="popup"][data-state="ready"]');
            // A level change with its permission request and reload, as on Safari.
            await page.locator('[role="radio"][aria-label="optimal"]').click();
            await page.waitForFunction(() =>
                globalThis.__blockerCalls.some((c) => c.api === 'runtime.sendMessage' && c.args[0]?.what === 'setFilteringMode'),
            );
            seen[platform] = await getMessages(page);
            const box = await page.locator('[data-testid="popup"]').boundingBox();
            assert.deepEqual([box?.width, box?.height], [340, 456], `${platform}: fixed desktop size`);
            assert.deepEqual(chrome.pageErrors, [], platform);
            assert.deepEqual(realErrors(chrome), [], platform);
        }
        assert.ok(seen.safari.length >= 2, JSON.stringify(seen.safari));
        assert.deepEqual(seen.chromium, seen.safari);
        assert.deepEqual(seen.firefox, seen.safari);
        await page.setViewportSize(DASHBOARD_VIEWPORT);
    });

    test('settings: strict blocking is offered except on Safari (dashboard.js:33, settings.css:104)', async () => {
        const page = chrome.page;
        for (const platform of PLATFORMS) {
            await openHarness(page, 'dashboard', { platform });
            await page.waitForSelector('[data-testid="settings-pane"][data-state="ready"]');
            const strict = page.locator('[data-testid="settings-toggle-strictBlockMode"]');
            if (platform === 'safari') {
                assert.equal(await strict.count(), 0);
            } else {
                assert.equal(await strict.count(), 1);
                // config.js:35: on by default outside Safari.
                assert.equal(await strict.getAttribute('aria-checked'), 'true');
            }
        }
    });

    test('filter lists on Safari: no imported group, no import area, even with an imported record (D6)', async () => {
        const page = chrome.page;
        await openFilterLists(page, { platform: 'safari' }, WITH_IMPORTED);
        assert.equal(await page.locator('section[data-group-id="imported"]').count(), 0);
        assert.equal(await page.getByTestId('filter-lists-import-area').count(), 0);
        assert.equal(await page.getByTestId('leaf-remove').count(), 0);
        // The imported list still counts and is still sent (§12.1).
        await page.locator('[data-testid="leaf-checkbox-easylist"]').click();
        await page.waitForFunction(() => globalThis.__blockerCalls.some((c) => c.args[0]?.what === 'applyRulesets'), undefined, {
            timeout: 5000,
        });
        const [msg] = await applies(page);
        assert.ok(msg.enabledRulesets.includes(IMPORTED.id), JSON.stringify(msg));
        assert.equal('toRemove' in msg, false);
    });

    for (const platform of ['chromium', 'firefox']) {
        test(`filter lists on ${platform}: imported group, user-scripts notice and "Add filter list…"`, async () => {
            chrome.consoleErrors.length = 0;
            chrome.pageErrors.length = 0;
            const page = chrome.page;
            await openFilterLists(page, { platform });
            const group = page.locator('section[data-group-id="imported"]');
            assert.equal(await group.count(), 1);
            // Default hide-unused state includes `imported`: the area is behind the disclosure (§7.5).
            assert.equal(await page.getByTestId('filter-lists-import-area').count(), 0);
            await group.getByTestId('group-toggle').click();
            await page.getByTestId('filter-lists-import-area').waitFor();
            const info = page.getByTestId('filter-lists-user-scripts-info');
            assert.equal(await info.count(), 1);
            const text = await info.innerText();
            assert.match(text, /Blocker/);
            assert.doesNotMatch(text, /uBO Lite/);

            await page.getByTestId('filter-lists-import-toggle').click();
            const input = page.getByTestId('filter-lists-import-url');
            const add = page.getByTestId('filter-lists-import-add');
            const before = (await getMessages(page)).length;
            // Fails upstream's test (filter-lists.js:493): nothing is sent, Add is disabled.
            await input.fill('https://example.com');
            assert.equal(await add.isDisabled(), true);
            await input.press('Enter');
            await page.waitForTimeout(200);
            assert.equal((await getMessages(page)).length, before);

            await input.fill('https://example.com/extra.txt');
            assert.equal(await add.isDisabled(), false);
            await add.click();
            await page.waitForFunction(
                () => document.querySelector('li[data-leaf-id="https://example.com/extra.txt"]') !== null,
                undefined,
                { timeout: 5000 },
            );
            const after = (await getMessages(page)).slice(before);
            assert.deepEqual(after[0], { what: 'importFilterList', url: 'https://example.com/extra.txt' });
            // The background's broadcast re-reads the lists (§13); nothing else is sent.
            assert.deepEqual(
                after.slice(1).map((m) => m.what),
                ['getEnabledRulesets', 'getRulesetDetails'],
            );
            // The form closed and cleared (filter-lists.js:496-497).
            assert.equal(await page.getByTestId('filter-lists-import-form').count(), 0);
            if (platform === 'chromium') await screenshot(page, 'platform-filter-lists-chromium', { fullPage: true });
            assert.deepEqual(chrome.pageErrors, []);
            assert.deepEqual(realErrors(chrome), []);
        });
    }

    test('filter lists: the user-scripts notice is hidden when user scripts are allowed', async () => {
        const page = chrome.page;
        await openFilterLists(page, { platform: 'chromium', userScripts: 1 });
        await page.locator('section[data-group-id="imported"]').getByTestId('group-toggle').click();
        await page.getByTestId('filter-lists-import-area').waitFor();
        assert.equal(await page.getByTestId('filter-lists-user-scripts-info').count(), 0);
    });

    test('filter lists: remove disables now and deletes on page hide with toRemove; undo cancels', async () => {
        const page = chrome.page;
        await openFilterLists(page, { platform: 'firefox' }, WITH_IMPORTED);
        const row = page.locator(`li[data-leaf-id="${IMPORTED.id}"]`);
        await row.waitFor();
        // Undo first: nothing at all is sent.
        await row.getByTestId('leaf-remove').click();
        assert.equal(await row.getAttribute('data-remove'), '');
        await row.getByTestId('leaf-undo-remove').click();
        await page.waitForTimeout(1300);
        assert.deepEqual(await applies(page), []);

        await row.getByTestId('leaf-remove').click();
        await page.waitForFunction(() => globalThis.__blockerCalls.some((c) => c.args[0]?.what === 'applyRulesets'), undefined, {
            timeout: 5000,
        });
        const [debounced] = await applies(page);
        assert.deepEqual(debounced, { what: 'applyRulesets', enabledRulesets: DEFAULTS });
        await page.waitForTimeout(400);
        // Still listed (unchecked, struck through) until the page goes away.
        assert.equal(await row.getAttribute('data-remove'), '');
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
        const all = await applies(page);
        assert.equal(all.length, 2, JSON.stringify(all));
        assert.deepEqual(all[1], { what: 'applyRulesets', enabledRulesets: DEFAULTS, toRemove: [IMPORTED.id] });
        const state = await page.evaluate(() => globalThis.__blockerMock.state());
        assert.deepEqual(JSON.stringify(state).includes(IMPORTED.id), false, 'the mock background deleted the list');
    });
});

/* -------------------------------------------------------------------- touch */

describe('touch layout (phone, 390 x 844)', () => {
    /** @type {Awaited<ReturnType<typeof launchChrome>>} */
    let chrome;
    before(async () => {
        chrome = await launchChrome({ viewport: PHONE_VIEWPORT, ...TOUCH_DEVICE });
    });
    after(async () => {
        await chrome?.close();
        if (chrome) assert.equal(userDataDirRemoved(chrome), true);
    });

    const noSideways = (page) =>
        page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

    test('the emulated device is a touch screen', async () => {
        await openHarness(chrome.page, 'popup', {});
        assert.equal(await chrome.page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), true);
    });

    for (const [platform, theme] of [
        ['safari', 'light'],
        ['firefox', 'dark'],
    ]) {
        test(`popup (${platform}, ${theme}): full-width sheet, footer at the bottom, 44px targets`, async () => {
            chrome.consoleErrors.length = 0;
            chrome.pageErrors.length = 0;
            const page = chrome.page;
            // Developer mode + sideloaded: the matched-rules button is in the footer too.
            await openHarness(page, 'popup', { platform, theme, dev: 1 });
            await page.waitForSelector('[data-testid="popup"][data-state="ready"]');
            const m = await page.evaluate(() => {
                const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
                const popup = r('[data-testid="popup"]');
                const footer = r('[data-testid="ribbon"]');
                return {
                    popup: [popup.width, popup.height],
                    footerBottom: footer.bottom,
                    footerButtons: [...document.querySelectorAll('[data-testid="ribbon"] button')].map((b) => b.getBoundingClientRect().height),
                    tools: [...document.querySelectorAll('[data-testid="tools-section"] button')].map((b) => b.getBoundingClientRect().height),
                    control: r('[role="radiogroup"]').height,
                    hostname: document.querySelector('[data-testid="hostname"]').textContent,
                };
            });
            assert.deepEqual(m.popup, [390, 844]);
            assert.equal(m.footerBottom, 844);
            assert.ok(m.footerButtons.length === 2 && m.footerButtons.every((h) => h >= 44), JSON.stringify(m.footerButtons));
            assert.ok(m.tools.length > 0 && m.tools.every((h) => h >= 44), JSON.stringify(m.tools));
            assert.ok(m.control >= 44, String(m.control));
            assert.equal(m.hostname, 'www.example.com');
            assert.equal(await noSideways(page), true);
            await screenshot(page, `phone-popup-${theme}`);
            assert.deepEqual(chrome.pageErrors, []);
            assert.deepEqual(realErrors(chrome), []);
        });
    }

    test('popup: a long hostname is shown whole on a touch screen (no hover for its title)', async () => {
        const page = chrome.page;
        const host = 'very-long-subdomain-name.another-example-company.co.uk.example-cdn.net';
        await openHarness(page, 'popup', { url: `https://${host}/x` });
        await page.waitForSelector('[data-testid="popup"][data-state="ready"]');
        assert.equal(await page.locator('[data-testid="hostname"]').textContent(), host);
        assert.equal(await noSideways(page), true);
    });

    test('dashboard: settings and filter lists fit the width; rule counts are visible without hover', async () => {
        chrome.consoleErrors.length = 0;
        chrome.pageErrors.length = 0;
        const page = chrome.page;
        await openHarness(page, 'dashboard', { platform: 'firefox' });
        await page.waitForSelector('[data-testid="settings-pane"][data-state="ready"]');
        assert.equal(await noSideways(page), true);
        await screenshot(page, 'phone-dashboard-settings');

        await openFilterLists(page, { platform: 'firefox' }, WITH_IMPORTED);
        assert.equal(await noSideways(page), true);
        const stats = page.locator('li[data-leaf-id="easylist"] [data-touch-stats]');
        assert.equal(await stats.isVisible(), true);
        assert.match(await stats.innerText(), /\d/);
        const remove = page.locator(`li[data-leaf-id="${IMPORTED.id}"]`).getByTestId('leaf-remove');
        assert.ok(((await remove.boundingBox())?.height ?? 0) >= 44);
        await screenshot(page, 'phone-dashboard-filter-lists');
        assert.deepEqual(chrome.pageErrors, []);
        assert.deepEqual(realErrors(chrome), []);
    });
});

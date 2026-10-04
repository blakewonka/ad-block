/**
 * Settings pane parity test (docs/specs/settings.md §14 PARITY CHECKLIST),
 * driven through the harness dashboard page with the mock browser API.
 *
 *   npm run build:harness && node --test tests/e2e/settings.parity.mjs
 *   (private build: BLOCKER_HARNESS_DIR=<dir> BLOCKER_SCREENSHOT_DIR=<dir>)
 *
 * Each test names the checklist lines it covers ("[Pn]"); lines that need
 * Safari are checked by hand.
 * Screenshots: settings-light.png, settings-dark.png, settings-rtl.png,
 * settings-admin-locked.png, settings-reset-dialog.png, settings-error.png,
 * settings-narrow-el.png, settings-mode-pending, settings-busy-restore,
 * settings-restore-done, settings-error-toggle, settings-warning-dark,
 * settings-narrow-el-320, settings-el-640.
 * Tests named "[fix …]" are regression tests for review findings.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
    clearCalls,
    DASHBOARD_VIEWPORT,
    getCalls,
    getMessages,
    HARNESS_DIR,
    launchChrome,
    mockBroadcast,
    openHarness,
    screenshot,
    startStaticServer,
    userDataDirRemoved,
} from './helpers/index.mjs';

const PANE = '[data-testid="settings-pane"]';
const READY = `${PANE}[data-state="ready"]`;
const RESET_WHATS = [
    'getDefaultConfig',
    'setAutoReload',
    'setShowBlockedCount',
    'setDeveloperMode',
    'setStrictBlockMode',
    'setPopupBlockMode',
    'applyRulesets',
    'setFilteringModeDetails',
    'removeAllCustomFilters',
    'setSandboxFilters',
    'updateUserDnrRules',
];

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

/** Opens the dashboard (Settings is the default pane) and waits for the pane. */
async function open(params = {}, options = {}) {
    const page = chrome.page;
    await openHarness(page, 'dashboard', params, options);
    await page.waitForSelector(READY, { timeout: 30_000 });
    return page;
}

const whats = async (page) => (await getMessages(page)).map((m) => m.what);
const pause = (page, ms = 150) => page.waitForTimeout(ms);
const radio = (page, name) => page.getByRole('radio', { name, exact: true });
const toggle = (page, key) => page.locator(`[data-testid="settings-toggle-${key}"]`);
/** Console errors other than missing static files (the shell's favicon is not in the harness). */
const realErrors = () => chrome.consoleErrors.filter((e) => !/Failed to load resource/.test(e));

test('[P1-P5, P6a, P23] boot: one getOptionsPageData, channel after the answer, Safari rows, toggle order', async () => {
    chrome.consoleErrors.length = 0;
    const page = await open();
    await pause(page);
    assert.deepEqual(await whats(page), ['getOptionsPageData']);
    const calls = await getCalls(page);
    const iData = calls.findIndex((c) => c.api === 'runtime.sendMessage');
    const channels = calls.filter((c) => c.api === 'BroadcastChannel' && c.args[0] === 'uBOL');
    assert.equal(channels.length, 1, 'one uBOL channel');
    assert.ok(calls.indexOf(channels[0]) > iData, 'channel opened after the request');
    const rows = await page.locator('[data-setting]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')));
    assert.deepEqual(rows, ['autoReload', 'showBlockedCount', 'popupBlockMode', 'developerMode']);
    assert.equal(await page.getByText('Enable strict blocking').count(), 0);
    assert.deepEqual(realErrors(), []);
    assert.deepEqual(chrome.pageErrors, []);
    assert.deepEqual(chrome.externalRequests, []);
    await screenshot(page, 'settings-light', { fullPage: true });
});

test('[P2] failed getOptionsPageData: error state, no widget, no channel', async () => {
    const page = chrome.page;
    await openHarness(page, 'dashboard', { fail: 'getOptionsPageData:reject' });
    await pause(page, 600);
    assert.equal(await page.getByRole('switch').count(), 0);
    assert.equal(await page.getByRole('radiogroup').count(), 0);
    const calls = await getCalls(page);
    assert.equal(calls.filter((c) => c.api === 'BroadcastChannel').length, 0);
    assert.deepEqual(await whats(page), ['getOptionsPageData']);
    assert.ok((await page.getByRole('alert').count()) + (await page.locator('[data-testid="settings-load-error"]').count()) > 0, 'an error is shown');
    await screenshot(page, 'settings-error');
});

test('[P6, P24] admin-locked: mode block and developer row absent (hidden, not disabled)', async () => {
    const page = await open({ scenario: 'admin-locked' });
    assert.equal(await page.locator('[data-testid="settings-mode"]').count(), 0);
    assert.equal(await page.getByRole('radiogroup').count(), 0);
    assert.equal(await page.locator('[data-setting="developerMode"]').count(), 0);
    assert.equal(await page.locator('[data-testid="settings-managed-note"]').count(), 1);
    for (const key of ['autoReload', 'showBlockedCount', 'popupBlockMode']) {
        assert.equal(await toggle(page, key).isEnabled(), true, `${key} not locked`);
    }
    await screenshot(page, 'settings-admin-locked', { fullPage: true });
});

test('[P7, P8, P46] three options basic/optimal/complete; stored level selected; level 0 selects none', async () => {
    let page = await open();
    const labels = await page
        .getByRole('radio')
        .evaluateAll((els) => els.map((e) => document.getElementById(e.getAttribute('aria-labelledby')).textContent));
    assert.deepEqual(labels, ['basic', 'optimal', 'complete']);
    assert.equal(await radio(page, 'optimal').isChecked(), true);
    const desc = await page.locator('[data-level-card="3"] p').innerText();
    assert.match(desc, /\n\s*\n/, 'paragraph breaks kept');
    const nameTransform = await page.locator('[data-level-card="1"] span.capitalize').evaluate((e) => getComputedStyle(e).textTransform);
    assert.equal(nameTransform, 'capitalize');
    page = await open({ default: 0 });
    const checked = await page.getByRole('radio').evaluateAll((els) => els.map((e) => e.checked));
    assert.deepEqual(checked, [false, false, false]);
});

test('[P9, P14, P15] basic: exactly setDefaultFilteringMode level 1, no permission call; re-selecting sends nothing', async () => {
    const page = await open();
    await clearCalls(page);
    await radio(page, 'basic').click();
    await pause(page);
    assert.deepEqual(await getMessages(page), [{ what: 'setDefaultFilteringMode', level: 1 }]);
    assert.equal((await getCalls(page, { api: /^permissions\./ })).length, 0);
    await clearCalls(page);
    await radio(page, 'basic').click();
    await pause(page);
    assert.deepEqual(await getCalls(page), []);
    const apis = (await getCalls(page, { all: true })).map((c) => c.api);
    assert.ok(!apis.includes('tabs.reload') && !apis.includes('permissions.remove'));
});

const isChecked = (level) => `document.querySelector('[data-level-card="${level}"] input')?.checked === true`;

test('[P10, P11, P13] complete: permission requested synchronously in the gesture (pointer, card and keyboard arrows), then the message', async () => {
    const page = await open({ gesture: 'strict' });
    await clearCalls(page);
    // Synchronous dispatch + synchronous read of the record.
    const inGesture = await page.evaluate(() => {
        const before = globalThis.__blockerCalls.length;
        document.querySelector('[data-level-card="3"] input').click();
        return globalThis.__blockerCalls.slice(before).map((c) => c.api).filter((a) => !a.startsWith('i18n.'));
    });
    assert.deepEqual(inGesture, ['permissions.request']);
    // Real pointer gesture on the card's text (gesture=strict rejects without user activation).
    await page.reload();
    await page.waitForSelector(READY);
    await clearCalls(page);
    await page.locator('[data-level-card="3"] p').click();
    await page.waitForFunction(isChecked(3));
    await pause(page);
    const perm = await getCalls(page, { api: 'permissions.request' });
    assert.deepEqual(perm.map((c) => c.args), [[{ origins: ['<all_urls>'] }]], 'requested even with omnipotence');
    assert.deepEqual(await getMessages(page), [{ what: 'setDefaultFilteringMode', level: 3 }]);
    // Keyboard: arrow keys select, like upstream's native radios (§3.2), and the
    // request is made inside the click the browser derives from the keydown.
    await clearCalls(page);
    await page.evaluate(() => {
        globalThis.__arrowProbe = [];
        window.addEventListener('click', () => {
            globalThis.__arrowProbe.push(globalThis.__blockerCalls.map((c) => c.api).filter((a) => a.startsWith('permissions.')));
        });
    });
    await radio(page, 'complete').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(isChecked(2));
    await pause(page);
    assert.deepEqual(await page.evaluate(() => globalThis.__arrowProbe), [['permissions.request']], 'requested during the keyboard-derived click');
    assert.deepEqual((await getCalls(page)).map((c) => c.api), ['permissions.request', 'runtime.sendMessage']);
    assert.deepEqual(await getMessages(page), [{ what: 'setDefaultFilteringMode', level: 2 }]);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-level-card="2"] input')), true);
    // Space on the selected option sends nothing (P14).
    await clearCalls(page);
    await page.keyboard.press('Space');
    await pause(page);
    assert.deepEqual(await getCalls(page), []);
    // P13: a later broadcast wins.
    await mockBroadcast(page, { defaultFilteringMode: 1 });
    await page.waitForFunction(isChecked(1));
});

test('[P12] permission denied: no message, selection returns to the stored mode', async () => {
    const page = await open({ perm: 'deny' });
    await clearCalls(page);
    await radio(page, 'complete').click();
    await page.getByRole('status').filter({ hasText: 'not granted' }).waitFor();
    assert.deepEqual(await getMessages(page), []);
    assert.equal(await radio(page, 'optimal').isChecked(), true);
});

test('[P16] rejected permission request / failed message: reverted, surfaced, no extra message', async () => {
    let page = await open({ perm: 'reject' });
    await clearCalls(page);
    await radio(page, 'complete').click();
    await page.getByRole('alert').filter({ hasText: 'could not be changed' }).waitFor();
    assert.deepEqual(await getMessages(page), []);
    assert.equal(await radio(page, 'optimal').isChecked(), true);

    page = await open({ scenario: 'error-on-apply' });
    await clearCalls(page);
    await radio(page, 'basic').click();
    await page.getByRole('alert').filter({ hasText: 'could not be changed' }).waitFor();
    assert.deepEqual(await getMessages(page), [{ what: 'setDefaultFilteringMode', level: 1 }]);
    assert.equal(await radio(page, 'optimal').isChecked(), true);
});

test('[P17, P18, P20, P21, P22] toggles: exact message each, new state at once, Develop tab follows immediately', async () => {
    const page = await open({ delay: 300 });
    for (const [key, what] of [
        ['autoReload', 'setAutoReload'],
        ['showBlockedCount', 'setShowBlockedCount'],
        ['popupBlockMode', 'setPopupBlockMode'],
    ]) {
        await clearCalls(page);
        const before = (await toggle(page, key).getAttribute('aria-checked')) === 'true';
        await toggle(page, key).click();
        assert.equal(await toggle(page, key).getAttribute('aria-checked'), String(!before), `${key} shows the new state before the answer`);
        assert.deepEqual(await getMessages(page), [{ what, state: !before }]);
        await pause(page, 400);
        assert.deepEqual(await getMessages(page), [{ what, state: !before }], `${key}: one message only`);
    }
    await clearCalls(page);
    const developTab = page.getByRole('tab', { name: 'Develop' });
    assert.equal(await developTab.count(), 0);
    await toggle(page, 'developerMode').click();
    await developTab.waitFor({ timeout: 250 }); // before the 300 ms answer
    assert.deepEqual(await getMessages(page), [{ what: 'setDeveloperMode', state: true }]);
});

test('[P18] show blocked count unchecked and disabled when it cannot be shown', async () => {
    const page = await open({ mock: { background: { canShowBlockedCount: false } } });
    assert.equal(await toggle(page, 'showBlockedCount').isDisabled(), true);
    assert.equal(await toggle(page, 'showBlockedCount').getAttribute('aria-checked'), 'false');
});

test('[H12] a failed toggle reverts and is surfaced', async () => {
    const page = await open({ scenario: 'error-on-apply' });
    await toggle(page, 'autoReload').click();
    await page.getByRole('alert').filter({ hasText: 'could not be changed' }).waitFor();
    assert.equal(await toggle(page, 'autoReload').getAttribute('aria-checked'), 'true');
});

test('[P25, P26, P28] live sync: field by field, non-objects and unknown fields ignored', async () => {
    const page = await open();
    await mockBroadcast(page, 'hello');
    await mockBroadcast(page, { filteringModeDetails: {}, disabledFeatures: ['develop'], foo: 1 });
    await mockBroadcast(page, { autoReload: false, developerMode: true });
    await page.waitForFunction(() => document.querySelector('[data-testid="settings-toggle-autoReload"]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await toggle(page, 'developerMode').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('[data-setting="developerMode"]').count(), 1, 'disabledFeatures broadcast ignored');
    assert.equal(await page.getByRole('tab', { name: 'Develop' }).count(), 1);
});

test('[P31-P33] backup: four reads then userDnrRules, no write, my-ubol-settings.json byte-exact, no busy', async () => {
    const page = await open();
    await clearCalls(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('settings-backup-button').click()]);
    assert.equal(download.suggestedFilename(), 'my-ubol-settings.json');
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk;
    const modes = await page.evaluate(() => globalThis.__blockerMock.state());
    const calls = await getCalls(page);
    assert.deepEqual(
        calls.map((c) => (c.api === 'runtime.sendMessage' ? c.args[0].what : `${c.api}:${JSON.stringify(c.args)}`)),
        ['getDefaultConfig', 'getSandboxFilters', 'getFilteringModeDetails', 'getAllCustomFilters', 'storage.local.get:["userDnrRules"]'],
    );
    const data = JSON.parse(text);
    assert.deepEqual(Object.keys(data), ['version', 'filteringModes']);
    assert.equal(text, JSON.stringify(data, null, 2) + '\n');
    assert.equal(data.version, '2026.1003.1243');
    assert.ok(modes, 'state readable');
    assert.equal(await page.locator('[data-testid="settings-busy"]').count(), 0);
});

test('[P34] backup with a failed read: no file, surfaced error', async () => {
    const page = await open({ fail: 'getFilteringModeDetails:reject' });
    let downloaded = false;
    page.once('download', () => {
        downloaded = true;
    });
    await page.getByTestId('settings-backup-button').click();
    await page.getByRole('alert').filter({ hasText: 'backup' }).waitFor();
    await pause(page, 300);
    assert.equal(downloaded, false);
});

async function restoreFile(page, content) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('settings-restore-button').click()]);
    await chooser.setFiles({ name: 'my-ubol-settings.json', mimeType: 'application/json', buffer: Buffer.from(content) });
}

test('[P35-P40, P40a, P42] restore: picker, busy, 21-step traffic, same file twice, no reload', async () => {
    const page = await open({ delay: 40 });
    const input = page.getByTestId('settings-restore-input');
    assert.equal(await input.getAttribute('accept'), 'application/json');
    assert.equal(await input.evaluate((e) => e.multiple), false);
    const file = JSON.stringify({ version: 'ignored', autoReload: false, sandboxFilters: ['a##.b'] });
    for (let round = 0; round < 2; round += 1) {
        await clearCalls(page);
        await restoreFile(page, file);
        await page.locator('[data-testid="settings-busy"]').waitFor();
        await page.locator('[data-testid="settings-busy"]').waitFor({ state: 'detached', timeout: 10_000 });
        const msgs = await getMessages(page);
        assert.deepEqual(msgs.map((m) => m.what), RESET_WHATS, `round ${round}`);
        assert.deepEqual(msgs[1], { what: 'setAutoReload', state: false });
        assert.deepEqual(msgs.find((m) => m.what === 'setSandboxFilters'), { what: 'setSandboxFilters', text: '\na##.b' });
        const storage = (await getCalls(page, { api: /^storage\.local\./ })).map((c) => `${c.api}:${JSON.stringify(c.args)}`);
        assert.deepEqual(storage, ['storage.local.get:["rulesets.imported"]', 'storage.local.remove:["userDnrRules"]']);
        const apis = (await getCalls(page, { all: true })).map((c) => c.api);
        assert.ok(!apis.includes('tabs.reload') && !apis.includes('window.confirm'));
        await page.getByRole('status').filter({ hasText: 'Settings restored' }).waitFor();
    }
    await page.waitForFunction(() => document.querySelector('[data-testid="settings-toggle-autoReload"]')?.getAttribute('aria-checked') === 'false');
});

test('[P36] cancelling the picker sends nothing and never enters busy', async () => {
    const page = await open();
    await clearCalls(page);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('settings-restore-button').click()]);
    await chooser.setFiles([]);
    await pause(page, 200);
    assert.deepEqual(await getCalls(page), []);
    assert.equal(await page.locator('[data-testid="settings-busy"]').count(), 0);
});

test('[P38] unreadable / non-JSON / non-object files send nothing', async () => {
    const page = await open();
    for (const content of ['not json', '', '42', '"abc"', 'null']) {
        await clearCalls(page);
        await restoreFile(page, content);
        await page.getByRole('status').filter({ hasText: 'does not contain settings' }).waitFor();
        await pause(page, 50);
        assert.deepEqual(await getMessages(page), [], JSON.stringify(content));
        assert.equal(await page.locator('[data-testid="settings-busy"]').count(), 0);
    }
});

test('[fix] a JSON file without settings keys sends nothing: no silent reset, custom filters kept', async () => {
    const page = await open();
    const before = await page.evaluate(() => globalThis.__blockerMock.state());
    for (const content of ['{}', '[]', '{"hello":1}', '{"name":"some-other-app","version":"1.0.0","dependencies":{}}']) {
        await clearCalls(page);
        await restoreFile(page, content);
        await page.getByRole('status').filter({ hasText: 'does not contain settings' }).waitFor();
        await pause(page, 50);
        assert.deepEqual(await getMessages(page), [], content);
        assert.equal(await page.locator('[data-testid="settings-busy"]').count(), 0);
    }
    assert.deepEqual(await page.evaluate(() => globalThis.__blockerMock.state()), before, 'mock background unchanged');
});

test('[fix] a ruleset id this build does not ship is never sent; the restore names it', async () => {
    const page = await open();
    await clearCalls(page);
    await restoreFile(page, '{"rulesets":["+fra-0","+removed-in-this-build"]}');
    const fb = page.getByTestId('settings-feedback-backup');
    await fb.filter({ hasText: 'Settings restored' }).waitFor({ timeout: 10_000 });
    assert.equal(await fb.getAttribute('data-tone'), 'warning');
    assert.match(await fb.innerText(), /were not enabled: removed-in-this-build/);
    const applied = (await getMessages(page)).filter((m) => m.what === 'applyRulesets');
    assert.deepEqual(applied, [{ what: 'applyRulesets', enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'fra-0'] }]);
});

test('[P40b, P41] malformed file: upstream prefix, partial restore surfaced; missing deferredJobs surfaced', async () => {
    let page = await open();
    await clearCalls(page);
    await restoreFile(page, '{"customFilters":[["a",5]]}');
    await page.getByRole('alert').filter({ hasText: 'only partly restored' }).waitFor();
    assert.deepEqual(await whats(page), RESET_WHATS.slice(0, RESET_WHATS.indexOf('removeAllCustomFilters') + 1));
    assert.equal(await page.locator('[data-testid="settings-busy"]').count(), 0);

    page = await open();
    await page.evaluate(() => browser.storage.local.remove('deferredJobs'));
    await clearCalls(page);
    await restoreFile(page, '{"rulesets":["+https://example.com/list.txt"]}');
    await page.getByRole('alert').filter({ hasText: 'only partly restored' }).waitFor();
    const storage = (await getCalls(page, { api: /^storage\.local\./ })).map((c) => c.api);
    assert.deepEqual(storage, ['storage.local.get', 'storage.local.get', 'storage.local.getKeys', 'storage.local.set', 'storage.local.get']);
    assert.ok(!(await whats(page)).includes('applyRulesets'));
});

test('[P43-P45] reset: confirmation text, cancel sends nothing, confirm sends the reset traffic inside busy', async () => {
    const page = await open({ delay: 40 });
    await clearCalls(page);
    await page.getByTestId('settings-reset-button').click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /All your custom settings will be removed/);
    await screenshot(page, 'settings-reset-dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(await getCalls(page), []);
    await page.getByTestId('settings-reset-button').click();
    await dialog.getByRole('button', { name: 'Reset to default settings' }).click();
    await page.locator('[data-testid="settings-busy"]').waitFor();
    await page.locator('[data-testid="settings-busy"]').waitFor({ state: 'detached', timeout: 10_000 });
    assert.deepEqual(await whats(page), RESET_WHATS);
    const msgs = await getMessages(page);
    assert.deepEqual(msgs.find((m) => m.what === 'setFilteringModeDetails').modes, { none: [], basic: [], optimal: ['all-urls'], complete: [] });
    const apis = (await getCalls(page, { all: true })).map((c) => c.api);
    assert.ok(!apis.includes('tabs.reload'));
    await page.getByRole('status').filter({ hasText: 'Default settings restored' }).waitFor();
});

test('[error-on-apply] reset whose first write fails: surfaced, busy left', async () => {
    const page = await open({ scenario: 'error-on-apply' });
    await page.getByTestId('settings-reset-button').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset to default settings' }).click();
    await page.getByRole('alert').filter({ hasText: 'could not be restored' }).waitFor();
    assert.equal(await page.locator('[data-testid="settings-busy"]').count(), 0);
});

test('screenshots: dark and RTL (long strings), no horizontal overflow', async () => {
    let page = await open({ theme: 'dark' });
    await screenshot(page, 'settings-dark', { fullPage: true });
    page = await open({ lang: 'ar', theme: 'light' });
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `no horizontal overflow (${overflow})`);
    await screenshot(page, 'settings-rtl', { fullPage: true });
    page = await open({ lang: 'el' });
    await page.setViewportSize({ width: 400, height: 800 });
    await pause(page, 200);
    const overflowNarrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await screenshot(page, 'settings-narrow-el', { fullPage: true });
    await page.setViewportSize(DASHBOARD_VIEWPORT);
    assert.ok(overflowNarrow <= 0, `no horizontal overflow at 400px (${overflowNarrow})`);
});

/* ------------------------------------------------------------------------ */
/* Regression tests: one per confirmed review finding                       */
/* ------------------------------------------------------------------------ */

/** True when the element's box is fully inside the viewport. */
const inViewport = (locator) =>
    locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    });

test('[fix parity M1, P13] a permission prompt that never settles does not lock the selector; a broadcast wins', async () => {
    const page = await open({ perm: 'hang' });
    await radio(page, 'complete').click();
    assert.equal(await radio(page, 'complete').isChecked(), true, 'pending choice shown');
    assert.equal(await page.getByRole('radiogroup').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('[data-testid="settings-mode-pending"]').count(), 1, 'pending is visible');
    await screenshot(page, 'settings-mode-pending');
    await mockBroadcast(page, { defaultFilteringMode: 1 });
    await page.waitForFunction(isChecked(1));
    assert.equal(await page.getByRole('radiogroup').getAttribute('aria-busy'), null);
    // Back to the old value: the dropped pending choice does not come back.
    await mockBroadcast(page, { defaultFilteringMode: 2 });
    await page.waitForFunction(isChecked(2));
    await clearCalls(page);
    await radio(page, 'complete').click();
    assert.deepEqual((await getCalls(page)).map((c) => c.api), ['permissions.request'], 'a new change is accepted');
});

test('[fix parity M2] a restore started during a pending mode change lands after it', async () => {
    const page = await open({ permDelay: 600 });
    await clearCalls(page);
    await radio(page, 'complete').click();
    await restoreFile(page, '{"rulesets":[]}');
    await page.getByRole('status').filter({ hasText: 'Settings restored' }).waitFor({ timeout: 10_000 });
    const w = await whats(page);
    assert.deepEqual(w, ['setDefaultFilteringMode', ...RESET_WHATS]);
    const state = await page.evaluate(() => globalThis.__blockerMock.state());
    assert.equal(state.background.defaultFilteringMode, 2, 'the restored default wins');
    await page.waitForFunction(isChecked(2));
});

test('[fix parity M5] a toggle never answered: a broadcast of the same field wins', async () => {
    const page = await open({ fail: 'setPopupBlockMode:hang' });
    await toggle(page, 'popupBlockMode').click();
    assert.equal(await toggle(page, 'popupBlockMode').getAttribute('aria-checked'), 'false');
    await mockBroadcast(page, { popupBlockMode: false });
    await mockBroadcast(page, { popupBlockMode: true });
    await page.waitForFunction(() => document.querySelector('[data-testid="settings-toggle-popupBlockMode"]')?.getAttribute('aria-checked') === 'true');
});

test('[fix parity M6] without echoes, restore still updates the store: switches and the next backup are right', async () => {
    const page = await open({ echo: 'off' });
    await restoreFile(page, JSON.stringify({ autoReload: false, developerMode: true, rulesets: ['-easyprivacy'] }));
    await page.getByRole('status').filter({ hasText: 'Settings restored' }).waitFor({ timeout: 10_000 });
    assert.equal(await toggle(page, 'autoReload').getAttribute('aria-checked'), 'false');
    assert.equal(await toggle(page, 'developerMode').getAttribute('aria-checked'), 'true');
    await page.getByRole('tab', { name: 'Develop' }).waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('settings-backup-button').click()]);
    let text = '';
    for await (const chunk of await download.createReadStream()) text += chunk;
    const data = JSON.parse(text);
    assert.equal(data.autoReload, false);
    assert.equal(data.developerMode, true);
    assert.deepEqual(data.rulesets, ['-easyprivacy']);
});

test('[fix parity M4] a failed rulesets.imported read does not stop the restore (upstream localRead)', async () => {
    const page = await open();
    await page.evaluate(() => {
        const local = browser.storage.local;
        const get = local.get.bind(local);
        local.get = (k) => (k === 'rulesets.imported' ? Promise.reject(new Error('read failed')) : get(k));
    });
    await clearCalls(page);
    await restoreFile(page, '{"rulesets":[]}');
    await page.getByRole('status').filter({ hasText: 'Settings restored' }).waitFor({ timeout: 10_000 });
    assert.deepEqual(await whats(page), RESET_WHATS);
});

test('[fix a11y M1, visual M2/M4] restore and reset: focus kept, busy pill centred, outcome next to the buttons and in view', async () => {
    const page = await open({ delay: 120 });
    await page.setViewportSize({ width: 1100, height: 600 });
    // Restore by keyboard.
    await page.getByTestId('settings-restore-button').focus();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
    await chooser.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"autoReload":false}') });
    const pill = page.getByTestId('settings-busy-status');
    await pill.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'settings-busy-status');
    assert.equal(await inViewport(pill), true, 'busy pill visible');
    assert.equal(await pill.innerText(), 'Restoring settings…');
    assert.equal(await page.getByRole('alert').or(page.getByRole('status')).filter({ hasText: 'Restoring settings' }).count(), 1);
    assert.equal(await page.locator('[data-testid="settings-busy"] .rounded-2xl').count(), 0, 'dimming layer is square');
    await screenshot(page, 'settings-busy-restore');
    await page.locator('[data-testid="settings-busy"]').waitFor({ state: 'detached', timeout: 10_000 });
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'settings-restore-button');
    const fb = page.getByTestId('settings-feedback-backup');
    assert.match(await fb.innerText(), /Settings restored/);
    assert.equal(await inViewport(fb), true, 'restore outcome in view');
    await screenshot(page, 'settings-restore-done');
    // Reset by keyboard.
    await page.getByTestId('settings-reset-button').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset to default settings' }).click();
    await pill.waitFor();
    assert.equal(await pill.innerText(), 'Restoring default settings…');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'settings-busy-status');
    await page.locator('[data-testid="settings-busy"]').waitFor({ state: 'detached', timeout: 10_000 });
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'settings-reset-button');
    assert.match(await fb.innerText(), /Default settings restored/);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'settings-restore-button', 'Tab order continues from Reset');
    await page.setViewportSize(DASHBOARD_VIEWPORT);
});

test('[fix visual M2] a failed toggle: the alert appears under the block, in view, and the row does not move', async () => {
    const page = await open({ scenario: 'error-on-apply' });
    await page.setViewportSize({ width: 1100, height: 600 });
    const row = page.locator('[data-setting="developerMode"]');
    await row.scrollIntoViewIfNeeded();
    const before = await row.evaluate((e) => e.getBoundingClientRect().top);
    await toggle(page, 'developerMode').click();
    const fb = page.getByTestId('settings-feedback-toggles');
    await fb.waitFor();
    const after = await row.evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(Math.abs(after - before) < 2 || after < before, `row did not move down (${before} -> ${after})`);
    assert.equal(await inViewport(fb), true);
    await page.waitForFunction(() => document.querySelector('[data-testid="settings-toggle-developerMode"]')?.getAttribute('aria-checked') === 'false');
    await screenshot(page, 'settings-error-toggle');
    await page.setViewportSize(DASHBOARD_VIEWPORT);
});

/** WCAG contrast of an element's text against its (composited) background. */
async function textContrast(locator) {
    return locator.evaluate((el) => {
        const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
        const lum = ([r, g, b]) => {
            const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        // Composite the backgrounds from the root down to the element.
        const chain = [];
        for (let n = el; n; n = n.parentElement) chain.unshift(n);
        let bg = [255, 255, 255];
        for (const n of chain) {
            const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
            if (a > 0) bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
        }
        const [r, g, b, a = 1] = parse(getComputedStyle(el).color);
        const fg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
        const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return (l1 + 0.05) / (l2 + 0.05);
    });
}

test('[fix a11y M3, visual m6] text contrast >= 4.5 for the reset button and the feedback alerts, light and dark', async () => {
    for (const theme of ['light', 'dark']) {
        let page = await open({ theme });
        const reset = await textContrast(page.getByTestId('settings-reset-button'));
        assert.ok(reset >= 4.5, `${theme} reset ${reset.toFixed(2)}`);
        // Unchecked radio boundary against the card: >= 3:1 (non-text, WCAG 1.4.11).
        const ring = await page.locator('[data-level-card="1"] input').evaluate((el) => {
            const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
            const lum = ([r, g, b]) => {
                const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
                return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const [l1, l2] = [lum(parse(getComputedStyle(el).borderTopColor)), lum(parse(getComputedStyle(el.closest('label')).backgroundColor))].sort((x, y) => y - x);
            return (l1 + 0.05) / (l2 + 0.05);
        });
        assert.ok(ring >= 3, `${theme} radio boundary ${ring.toFixed(2)}`);
        // danger (failed toggle)
        page = await open({ theme, scenario: 'error-on-apply' });
        await toggle(page, 'autoReload').click();
        const danger = page.getByTestId('settings-feedback-toggles').locator('[data-variant="soft"] div').filter({ hasText: 'could not be changed' }).last();
        await danger.waitFor();
        const d = await textContrast(danger);
        assert.ok(d >= 4.5, `${theme} danger ${d.toFixed(2)}`);
        // warning (permission denied)
        page = await open({ theme, perm: 'deny' });
        await radio(page, 'complete').click();
        const warning = page.getByTestId('settings-feedback-mode').locator('[data-variant="soft"] div').filter({ hasText: 'not granted' }).last();
        await warning.waitFor();
        const w = await textContrast(warning);
        assert.ok(w >= 4.5, `${theme} warning ${w.toFixed(2)}`);
        if (theme === 'dark') await screenshot(page, 'settings-warning-dark');
        // success (reset done)
        page = await open({ theme });
        await page.getByTestId('settings-reset-button').click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Reset to default settings' }).click();
        const success = page.getByTestId('settings-feedback-backup').locator('[data-variant="soft"] div').filter({ hasText: 'Default settings restored' }).last();
        await success.waitFor({ timeout: 10_000 });
        const sc = await textContrast(success);
        assert.ok(sc >= 4.5, `${theme} success ${sc.toFixed(2)}`);
    }
});

test('[fix a11y M2, visual M3] long locales: no horizontal overflow down to 320 px; level cards follow the pane width', async () => {
    for (const lang of ['el', 'bg', 'hu', 'ml']) {
        const page = await open({ lang });
        for (const width of [768, 400, 320]) {
            await page.setViewportSize({ width, height: 800 });
            await pause(page, 100);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            assert.ok(overflow <= 0, `${lang}@${width}: horizontal overflow ${overflow}`);
        }
        if (lang === 'el') await screenshot(page, 'settings-narrow-el-320', { fullPage: true });
    }
    // Cards are never squeezed: three columns only when each gets >= 13rem, else one per row.
    const page = await open({ lang: 'el' });
    for (const width of [1100, 900, 768, 640, 480, 400]) {
        await page.setViewportSize({ width, height: 800 });
        await pause(page, 100);
        const boxes = await page.locator('[data-level-card]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.left), w: r.width })));
        const columns = new Set(boxes.map((b) => b.x)).size;
        assert.ok(columns === 1 || columns === 3, `el@${width}: ${columns} columns`);
        assert.ok(boxes.every((b) => b.w >= 208), `el@${width}: card widths ${boxes.map((b) => Math.round(b.w))}`);
        if (width === 640) await screenshot(page, 'settings-el-640', { fullPage: true });
    }
    await page.setViewportSize(DASHBOARD_VIEWPORT);
});

test('[P40c, H17] a Filter-lists change pending its debounce is sent before the reset starts', async () => {
    const page = await open();
    await page.getByRole('tab', { name: 'Filter lists' }).click();
    const leaf = page.locator('[data-testid^="leaf-checkbox-"]').first();
    await leaf.waitFor({ timeout: 10_000 });
    await clearCalls(page);
    const t0 = Date.now();
    await leaf.click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByTestId('settings-reset-button').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset to default settings' }).click();
    const t1 = Date.now();
    await page.getByRole('status').filter({ hasText: 'Default settings restored' }).waitFor({ timeout: 10_000 });
    await pause(page, 1200); // past the 997 ms debounce
    const w = await whats(page);
    assert.equal(w.indexOf('applyRulesets'), 0, `the pending commit is flushed first (${w.join(', ')})`);
    assert.equal(w.filter((x) => x === 'applyRulesets').length, 2, 'no commit lands after the restore');
    // The Filter-lists pane re-reads its lists after the echoes (its own refresh, reads only).
    assert.deepEqual(w.slice(1).filter((x) => x !== 'getEnabledRulesets' && x !== 'getRulesetDetails'), RESET_WHATS);
    assert.ok(t1 - t0 < 997, `reset confirmed inside the debounce window (${t1 - t0} ms)`);
});

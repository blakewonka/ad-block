/**
 * Popup parity test: drives the harness popup (mock browser API) and checks the
 * recorded calls (window.__blockerCalls) against docs/specs/popup.md §16 (PARITY
 * CHECKLIST). Each test names the checklist lines it covers ("L12" = line 12).
 *
 *   npm run build:harness   (or a private build + BLOCKER_HARNESS_DIR)
 *   node --test tests/e2e/popup.parity.mjs
 *
 * Screenshots (BLOCKER_SCREENSHOT_DIR or build/screenshots): popup-*.png.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
    HARNESS_DIR,
    POPUP_VIEWPORT,
    PURE_APIS,
    getCalls,
    launchChrome,
    openHarness,
    screenshot,
    startStaticServer,
} from './helpers/index.mjs';

const EXT_HOST = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'; // MOCK_EXTENSION_HOST (src/dev/mock-ext.ts)
const EXT = `safari-web-extension://${EXT_HOST}`;
const H = 'www.example.com';
const PAGE_URL = 'https://www.example.com/path?x=1';
const POPUP_HEIGHT = 456; // POPUP_HEIGHT_PX in src/popup/Popup.tsx

const ALLOWED_WHATS = new Set(['popupPanelData', 'setPendingFilteringMode', 'setFilteringMode', 'gotoURL', 'showMatchedRules']);
const FORBIDDEN_APIS = /^(storage\.|BroadcastChannel|permissions\.(contains|getAll|remove)|declarativeNetRequest|windows\.)/;

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof launchChrome>>} */
let chrome;
const sessions = [];

before(async () => {
    server = await startStaticServer(HARNESS_DIR);
    chrome = await launchChrome({ viewport: POPUP_VIEWPORT });
});

after(async () => {
    await chrome?.close();
    await server?.close();
});

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens the harness popup in a fresh tab and waits until it left the loading state. */
async function open(params = {}, options = {}) {
    const page = await chrome.context.newPage();
    if (options.init) await page.addInitScript(options.init);
    await openHarness(page, 'popup', params, options);
    await page.waitForFunction(
        () => {
            const s = document.querySelector('[data-testid="popup"]')?.getAttribute('data-state');
            return s !== undefined && s !== null && s !== 'loading';
        },
        undefined,
        { timeout: 15_000 },
    );
    return page;
}

/** Non-pure calls as `{ api, args, t }`. */
const calls = (page) => getCalls(page);
const apis = (list) => list.map((c) => c.api);
const msgs = (list) => list.filter((c) => c.api === 'runtime.sendMessage').map((c) => c.args[0]);

/** Checks L37/L38 on a page's whole record, then closes it. */
async function done(page) {
    const all = await calls(page);
    sessions.push(all);
    checkGlobal(all);
    await page.close();
}

function checkGlobal(all) {
    const messages = msgs(all);
    for (const m of messages) {
        assert.ok(ALLOWED_WHATS.has(m.what), `L37: unexpected what ${m.what}`);
        for (const k of ['level', 'beforeLevel', 'afterLevel']) {
            if (k in m) assert.ok([0, 1, 2, 3].includes(m[k]), `L38: ${k} must be an integer 0..3, got ${JSON.stringify(m[k])}`);
        }
        if ('tabId' in m) assert.ok(Number.isInteger(m.tabId), 'L38: tabId is an integer');
        if ('hostname' in m) {
            assert.notEqual(m.hostname, EXT_HOST, 'L38: never the extension host');
            assert.equal(m.hostname, m.hostname.toLowerCase(), 'L38: lower-case hostname');
            assert.ok(!/[^\x00-\x7f]/.test(m.hostname), 'L38: ASCII hostname');
            assert.ok(!/:\d+$/.test(m.hostname), 'L38: no port');
        }
    }
    assert.ok(messages.filter((m) => m.what === 'popupPanelData').length <= 1, 'L37: popupPanelData at most once per open');
    for (const c of all) assert.ok(!FORBIDDEN_APIS.test(c.api), `L37: forbidden API ${c.api}`);
    for (const c of all.filter((x) => x.api === 'permissions.request')) {
        assert.ok(!JSON.stringify(c.args).includes(EXT_HOST), 'L38: no permission for the extension host');
    }
}

/** Number of calls recorded so far (to slice later). */
const mark = (page) => page.evaluate(() => globalThis.__blockerCalls.length);
async function callsSince(page, from) {
    const list = await page.evaluate((n) => globalThis.__blockerCalls.slice(n), from);
    return list.filter((c) => !PURE_APIS.includes(c.api));
}

/** Waits until `pred(callsSince(from))` is true. */
async function waitCalls(page, from, pred, timeout = 5000) {
    const end = Date.now() + timeout;
    for (;;) {
        const list = await callsSince(page, from);
        if (pred(list)) return list;
        if (Date.now() > end) throw new Error(`waitCalls timed out; calls: ${JSON.stringify(list)}`);
        await sleep(25);
    }
}

const radioSel = (level) => `[data-level="${level}"] [role="radio"]`;

/**
 * Clicks a level option with a synchronous DOM dispatch and returns the non-pure calls
 * made DURING that dispatch (UI rule §6.6: nothing awaited before permissions.request).
 */
function clickSync(page, selector) {
    return page.evaluate(
        ({ sel, pure }) => {
            const start = globalThis.__blockerCalls.length;
            const el = document.querySelector(sel);
            if (!el) throw new Error(`no element ${sel}`);
            el.click();
            return globalThis.__blockerCalls.slice(start).filter((c) => !pure.includes(c.api));
        },
        { sel: selector, pure: PURE_APIS },
    );
}

async function shownLevel(page) {
    return page.evaluate(() => {
        const checked = document.querySelector('[role="radio"][aria-checked="true"]');
        const lvl = checked?.closest('[data-level]')?.getAttribute('data-level');
        return lvl === undefined || lvl === null ? null : Number(lvl);
    });
}

async function waitShownLevel(page, level) {
    await page.waitForFunction(
        (l) => document.querySelector(`[data-level="${l}"] [role="radio"]`)?.getAttribute('aria-checked') === 'true',
        level,
        { timeout: 5000 },
    );
}

async function present(page, selector) {
    return (await page.locator(selector).count()) > 0;
}

async function toolOrder(page) {
    return page.evaluate(() => [...document.querySelectorAll('[data-testid="tools-section"] button')].map((b) => b.id));
}

async function hostnameText(page) {
    return (await page.locator('[data-testid="hostname"]').innerText()).trim();
}

const SET = (level, hostname = H) => ({ what: 'setFilteringMode', hostname, level });
const PENDING = (beforeLevel, afterLevel, extra = {}) => ({
    what: 'setPendingFilteringMode',
    tabId: 42,
    url: PAGE_URL,
    hostname: H,
    beforeLevel,
    afterLevel,
    ...extra,
});
const PERM = (hostname = H) => ({ origins: [`*://*.${hostname}/*`] });

/** A complete popupPanelData answer (for `responses` overrides). */
const PANEL = (over = {}) => ({
    hasOmnipotence: true,
    level: 1,
    autoReload: true,
    isSideloaded: true,
    developerMode: false,
    hasCustomFilters: 0,
    ...over,
});

/* ------------------------------------------------------------------------ */
/* Opening                                                                   */
/* ------------------------------------------------------------------------ */

describe('opening', () => {
    test('L1 default open: calls, hostname, level, tools, ribbon; fixed size', async () => {
        const page = await open({ scenario: 'default' });
        const list = await calls(page);
        assert.deepEqual(
            list.map(({ api, args }) => ({ api, args })),
            [
                { api: 'tabs.query', args: [{ active: true, currentWindow: true }] },
                { api: 'runtime.sendMessage', args: [{ what: 'popupPanelData', origin: 'https://www.example.com', hostname: H }] },
            ],
        );
        assert.equal(await hostnameText(page), H);
        assert.equal(await shownLevel(page), 1);
        assert.equal(await page.locator('[data-testid="mode-badge"]').innerText(), 'basic');
        assert.deepEqual(await toolOrder(page), ['gotoZapper', 'gotoPicker', 'gotoReport']);
        assert.equal(await present(page, '#gotoDashboard'), true);
        assert.equal(await present(page, '#gotoMatchedRules'), false);
        const box = await page.locator('[data-testid="popup"]').boundingBox();
        assert.equal(box.width, 340);
        assert.equal(box.height, POPUP_HEIGHT);
        assert.equal(await page.evaluate(() => document.title), 'Blocker');
        await done(page);
    });

    test('height is the same from the first paint (skeleton) to READY (UI rule §6.9)', async () => {
        // Answers delayed by 1.5 s, so the skeleton can be measured before the data arrives.
        const p2 = await chrome.context.newPage();
        await openHarness(p2, 'popup', { delay: 1500 });
        assert.equal(await p2.locator('[data-testid="popup"]').getAttribute('data-state'), 'loading');
        const skeletonBox = await p2.locator('[data-testid="popup"]').boundingBox();
        const bodyBefore = await p2.evaluate(() => document.body.getBoundingClientRect().height);
        assert.equal(await present(p2, '[data-testid="mode-skeleton"]'), true);
        await p2.waitForFunction(() => document.querySelector('[data-testid="popup"]')?.getAttribute('data-state') === 'ready');
        const readyBox = await p2.locator('[data-testid="popup"]').boundingBox();
        const bodyAfter = await p2.evaluate(() => document.body.getBoundingClientRect().height);
        assert.deepEqual(skeletonBox, readyBox);
        assert.equal(bodyBefore, bodyAfter);
        await done(p2);
    });

    test('L2 strict-block tab is unwrapped', async () => {
        const page = await open({ url: `${EXT}/strictblock.html#https://blocked.example/x?y=1` });
        assert.deepEqual(msgs(await calls(page)), [{ what: 'popupPanelData', origin: 'https://blocked.example', hostname: 'blocked.example' }]);
        assert.equal(await hostnameText(page), 'blocked.example');
        await done(page);
    });

    test('L3 IDN: payloads use punycode, display is Unicode (both tab URL forms)', async () => {
        for (const url of ['https://xn--bcher-kva.example/pfad', 'https://bücher.example/pfad']) {
            const page = await open({ url, level: 1 }); // the fixture default for other hosts is 2
            assert.deepEqual(msgs(await calls(page)), [
                { what: 'popupPanelData', origin: 'https://xn--bcher-kva.example', hostname: 'xn--bcher-kva.example' },
            ]);
            assert.equal(await hostnameText(page), 'bücher.example');
            const sync = await clickSync(page, radioSel(2));
            assert.deepEqual(sync.find((c) => c.api === 'permissions.request')?.args, [PERM('xn--bcher-kva.example')]);
            await waitCalls(page, 0, (l) => msgs(l).some((m) => m.what === 'setFilteringMode'));
            const set = msgs(await calls(page)).find((m) => m.what === 'setFilteringMode');
            assert.deepEqual(set, SET(2, 'xn--bcher-kva.example'));
            await done(page);
        }
    });

    test('L4 userinfo, port, upper case', async () => {
        const page = await open({ url: 'http://user:pw@Sub.Example.COM:8080/a b?q=1#frag' });
        assert.deepEqual(msgs(await calls(page)), [{ what: 'popupPanelData', origin: 'http://sub.example.com:8080', hostname: 'sub.example.com' }]);
        assert.equal(await hostnameText(page), 'sub.example.com');
        await done(page);
    });

    test('L5 non-website tabs: tabs.query only, no message, no control, dashboard present', async () => {
        const variants = [
            { url: 'about:blank' },
            { url: 'file:///x' },
            { url: 'ftp://example.com/' },
            { url: `${EXT}/dashboard.html` },
            { url: 'none' },
            { url: `${EXT}/strictblock.html` },
            { tab: 'none' },
            { scenario: 'no-website' },
        ];
        for (const params of variants) {
            const page = await open(params);
            const list = await calls(page);
            assert.deepEqual(apis(list), ['tabs.query'], JSON.stringify(params));
            assert.equal(await page.locator('[data-testid="popup"]').getAttribute('data-state'), 'no-website');
            assert.equal(await page.getByText('not a website', { exact: true }).isVisible(), true);
            assert.equal(await present(page, '[role="radiogroup"]'), false);
            assert.equal(await present(page, '[data-testid="tools-section"]'), false);
            assert.equal(await present(page, '#gotoMatchedRules'), false);
            assert.equal(await present(page, '#gotoDashboard'), true);
            assert.notEqual(await hostnameText(page), 'example.com');
            await done(page);
        }
    });

    test('L6 popupPanelData answers undefined / null: one message, no-website look plus an error', async () => {
        for (const mode of ['undefined', 'null', 'reject']) {
            const page = await open({ fail: `popupPanelData:${mode}` });
            const list = await calls(page);
            assert.deepEqual(apis(list), ['tabs.query', 'runtime.sendMessage'], mode);
            assert.equal(await page.getByText('not a website', { exact: true }).isVisible(), true);
            assert.equal(await present(page, '[role="radiogroup"]'), false);
            assert.equal(await present(page, '[data-testid="tools-section"]'), false);
            assert.equal(await page.locator('[data-politeness="assertive"]').innerText().then((s) => s.length > 0), true, 'error announced');
            // One visible message unit: the failure is the empty state's description, no separate Alert box.
            assert.equal(await page.locator('[data-testid="no-website"] [data-testid="load-failed"]').isVisible(), true, 'error shown');
            assert.equal(await page.locator('[data-blocker-status] [data-variant]').count(), 0, 'no second (Alert) copy');
            assert.equal(await present(page, '#gotoDashboard'), true);
            if (mode === 'reject') await screenshot(page, 'popup-load-error-transport', { clip: { x: 0, y: 0, width: 340, height: POPUP_HEIGHT } });
            await done(page);
        }
    });

    test('L7 levels 0, 2, 3 at open', async () => {
        const names = { 0: 'no filtering', 2: 'optimal', 3: 'complete' };
        for (const level of [0, 2, 3]) {
            const page = await open({ level });
            assert.equal(await shownLevel(page), level);
            assert.equal(await page.locator('[data-testid="mode-badge"]').innerText(), names[level]);
            assert.equal(await page.locator('[data-testid="mode-caption"] [data-part="current"]').innerText(), names[level]);
            await done(page);
        }
    });

    test('L8 / L46 unpicker follows the hasCustomFilters count', async () => {
        for (const [count, expected] of [
            [2, ['gotoZapper', 'gotoPicker', 'gotoUnpicker', 'gotoReport']],
            [1, ['gotoZapper', 'gotoPicker', 'gotoUnpicker', 'gotoReport']],
            [0, ['gotoZapper', 'gotoPicker', 'gotoReport']],
        ]) {
            const page = await open({ customFilters: count });
            assert.deepEqual(await toolOrder(page), expected, `count ${count}`);
            await done(page);
        }
    });

    test('L9 matched rules needs isSideloaded and developerMode', async () => {
        for (const [params, expected] of [
            [{ dev: 1, sideloaded: 1 }, true],
            [{ dev: 1, sideloaded: 0 }, false],
            [{ dev: 0, sideloaded: 1 }, false],
        ]) {
            const page = await open(params);
            assert.equal(await present(page, '#gotoMatchedRules'), expected, JSON.stringify(params));
            await done(page);
        }
    });

    test('L10 / L41 admin tokens', async () => {
        const cases = [
            [{ disabled: 'zapper' }, ['gotoPicker', 'gotoReport'], true],
            [{ disabled: 'picker', customFilters: 2 }, ['gotoZapper', 'gotoReport'], true],
            [{ disabled: 'report' }, ['gotoZapper', 'gotoPicker'], true],
            [{ disabled: 'zapper,picker,report' }, null, true],
            [{ disabled: 'dashboard', dev: 1 }, ['gotoZapper', 'gotoPicker', 'gotoReport'], false],
            [{ disabled: 'develop' }, ['gotoZapper', 'gotoPicker', 'gotoReport'], true],
            [{ disabled: 'none' }, ['gotoZapper', 'gotoPicker', 'gotoReport'], true],
            [{ disabled: 'null' }, ['gotoZapper', 'gotoPicker', 'gotoReport'], true], // L41
        ];
        for (const [params, tools, dashboard] of cases) {
            const page = await open(params);
            const list = await calls(page);
            assert.deepEqual(msgs(list), [{ what: 'popupPanelData', origin: 'https://www.example.com', hostname: H }]);
            assert.equal(await page.locator('[data-testid="popup"]').getAttribute('data-state'), 'ready', JSON.stringify(params));
            if (tools === null) {
                assert.equal(await present(page, '[data-testid="tools-section"]'), false, 'whole section incl. heading removed');
                assert.equal(await page.getByText('On this website').count(), 0);
            } else {
                assert.deepEqual(await toolOrder(page), tools, JSON.stringify(params));
            }
            assert.equal(await present(page, '#gotoDashboard'), dashboard);
            if (!dashboard) assert.equal(await present(page, '#gotoMatchedRules'), false);
            await done(page);
        }
        // 'filteringMode': control visible with its level, read-only (L24 covers the clicks).
        const page = await open({ disabled: 'filteringMode' });
        assert.equal(await shownLevel(page), 1);
        assert.equal(await page.locator('[role="radiogroup"]').getAttribute('aria-readonly'), 'true');
        await done(page);
    });

    test('admin-locked scenario (filteringMode, develop, picker)', async () => {
        const page = await open({ scenario: 'admin-locked', customFilters: 2 });
        assert.deepEqual(await toolOrder(page), ['gotoZapper', 'gotoReport']);
        assert.equal(await page.locator('[role="radiogroup"]').getAttribute('aria-readonly'), 'true');
        assert.equal(await present(page, '#gotoMatchedRules'), false);
        const from = await mark(page);
        // force: the options are aria-disabled , which Playwright treats as not
        // clickable; a real trusted mouse click is still dispatched.
        await page.locator(radioSel(3)).click({ force: true });
        await sleep(300);
        assert.deepEqual(await callsSince(page, from), []);
        assert.equal(await shownLevel(page), 1);
        await screenshot(page, 'popup-admin-locked', { clip: { x: 0, y: 0, width: 340, height: POPUP_HEIGHT } });
        await done(page);
    });
});

/* ------------------------------------------------------------------------ */
/* Level control                                                             */
/* ------------------------------------------------------------------------ */

describe('level control', () => {
    test('L11 hover preview: current → target, no call; RTL arrow ←', async () => {
        for (const [params, arrow] of [
            [{}, '→'],
            [{ lang: 'ar' }, '←'],
        ]) {
            const page = await open(params);
            const from = await mark(page);
            await page.locator(radioSel(3)).hover();
            const caption = page.locator('[data-testid="mode-caption"]');
            await page.waitForFunction(() => document.querySelector('[data-testid="mode-caption"] [data-part="target"]') !== null);
            const txt = await caption.innerText();
            assert.ok(txt.includes(arrow), `arrow ${arrow} in "${txt}"`);
            await page.mouse.move(5, 5);
            await page.waitForFunction(() => document.querySelector('[data-testid="mode-caption"] [data-part="target"]') === null);
            assert.deepEqual(await callsSince(page, from), []);
            await done(page);
        }
    });

    test('L12 select 0: setFilteringMode then tabs.reload after 437 ms; shown at once', async () => {
        const page = await open({ delay: 400 });
        const from = await mark(page);
        const sync = await clickSync(page, radioSel(0));
        assert.deepEqual(sync.map((c) => c.args[0]), [SET(0)], 'only setFilteringMode, no permission, no pending');
        await waitShownLevel(page, 0); // before the (delayed) answer
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'), 4000);
        const send = list.find((c) => c.api === 'runtime.sendMessage');
        const reload = list.find((c) => c.api === 'tabs.reload');
        assert.deepEqual(reload.args, [42]);
        const gap = reload.t - send.t;
        assert.ok(gap >= 400 + 437 - 5 && gap < 400 + 437 + 600, `reload ${gap} ms after the request (answer delayed 400 ms)`);
        await sleep(200);
        assert.deepEqual(apis(await callsSince(page, from)), ['runtime.sendMessage', 'tabs.reload']);
        assert.equal(await shownLevel(page), 0);
        await done(page);
    });

    test('L13 select 1 from 0 and from 3', async () => {
        for (const level of [0, 3]) {
            const page = await open({ level });
            const from = await mark(page);
            await page.locator(radioSel(1)).click();
            const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'));
            assert.deepEqual(apis(list), ['runtime.sendMessage', 'tabs.reload']);
            assert.deepEqual(msgs(list), [SET(1)]);
            await done(page);
        }
    });

    test('L14 select 2: pending (not awaited) + permissions.request in the same handler run, then setFilteringMode, reload', async () => {
        const page = await open({ gesture: 'strict' });
        const from = await mark(page);
        // Real (trusted) click so `gesture=strict` would reject a request made outside the gesture.
        await page.locator(radioSel(2)).click();
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'));
        assert.deepEqual(
            list.map(({ api, args }) => ({ api, args })),
            [
                { api: 'runtime.sendMessage', args: [PENDING(1, 2)] },
                { api: 'permissions.request', args: [PERM()] },
                { api: 'runtime.sendMessage', args: [SET(2)] },
                { api: 'tabs.reload', args: [42] },
            ],
        );
        assert.equal(await shownLevel(page), 2);
        await done(page);

        // Synchronous dispatch: both calls are made before the click returns.
        const p2 = await open({});
        const sync = await clickSync(p2, radioSel(2));
        assert.deepEqual(
            sync.map(({ api, args }) => ({ api, args })),
            [
                { api: 'runtime.sendMessage', args: [PENDING(1, 2)] },
                { api: 'permissions.request', args: [PERM()] },
            ],
        );
        await waitCalls(p2, 0, (l) => l.some((c) => c.api === 'tabs.reload'));
        await done(p2);
    });

    test('L15 from 0 select 3', async () => {
        const page = await open({ level: 0 });
        const from = await mark(page);
        const sync = await clickSync(page, radioSel(3));
        assert.deepEqual(sync.map((c) => c.args[0]), [PENDING(0, 3), PERM()]);
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'));
        assert.deepEqual(msgs(list), [PENDING(0, 3), SET(3)]);
        await done(page);
    });

    test('L16 permission denied / rejected: pending + request only, back to level 1', async () => {
        for (const perm of ['deny', 'reject']) {
            const page = await open({ perm });
            const from = await mark(page);
            await clickSync(page, radioSel(2));
            await waitShownLevel(page, 1);
            await sleep(700);
            const list = await callsSince(page, from);
            assert.deepEqual(
                list.map(({ api, args }) => ({ api, args })),
                [
                    { api: 'runtime.sendMessage', args: [PENDING(1, 2)] },
                    { api: 'permissions.request', args: [PERM()] },
                ],
                perm,
            );
            // Control usable again.
            await page.locator(radioSel(0)).click();
            await waitCalls(page, from, (l) => msgs(l).some((m) => m.what === 'setFilteringMode'));
            await done(page);
        }
    });

    test('L17 / L18 between 2 and 3: request without pending; denied → back', async () => {
        for (const [start, target] of [
            [2, 3],
            [3, 2],
        ]) {
            const page = await open({ level: start });
            const from = await mark(page);
            await clickSync(page, radioSel(target));
            const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'));
            assert.deepEqual(
                list.map(({ api, args }) => ({ api, args })),
                [
                    { api: 'permissions.request', args: [PERM()] },
                    { api: 'runtime.sendMessage', args: [SET(target)] },
                    { api: 'tabs.reload', args: [42] },
                ],
            );
            await done(page);
        }
        const page = await open({ level: 2, perm: 'deny' });
        const from = await mark(page);
        await clickSync(page, radioSel(3));
        await waitShownLevel(page, 2);
        await sleep(700);
        assert.deepEqual(apis(await callsSince(page, from)), ['permissions.request']);
        await done(page);
    });

    test('L19 background answers a different level (asked 2, got 0): shown 0, warning, reload', async () => {
        const page = await open({ mock: { responses: { setFilteringMode: 0 } } });
        const from = await mark(page);
        await clickSync(page, radioSel(2));
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'));
        assert.deepEqual(apis(list), ['runtime.sendMessage', 'permissions.request', 'runtime.sendMessage', 'tabs.reload']);
        assert.equal(await shownLevel(page), 0);
        assert.equal(await page.locator('[data-testid="mode-badge"]').innerText(), 'no filtering');
        const status = await page.locator('[data-blocker-status]').innerText();
        assert.ok(status.includes('no filtering'), `warning names the level in force: ${status}`);
        await done(page);
    });

    test('L20 select 0, background keeps 1: shown 1, no reload', async () => {
        const page = await open({ mock: { responses: { setFilteringMode: 1 } } });
        const from = await mark(page);
        await clickSync(page, radioSel(0));
        await waitCalls(page, from, (l) => l.length >= 1);
        await waitShownLevel(page, 1);
        await sleep(800);
        assert.deepEqual(apis(await callsSince(page, from)), ['runtime.sendMessage']);
        await done(page);
    });

    test('L21 autoReload off: same messages, never reload/update', async () => {
        for (const [level, target, expected] of [
            [1, 0, ['runtime.sendMessage']],
            [1, 2, ['runtime.sendMessage', 'permissions.request', 'runtime.sendMessage']],
            [2, 3, ['permissions.request', 'runtime.sendMessage']],
        ]) {
            const page = await open({ autoReload: 0, level });
            const from = await mark(page);
            await clickSync(page, radioSel(target));
            await waitShownLevel(page, target);
            await sleep(900);
            assert.deepEqual(apis(await callsSince(page, from)), expected);
            await done(page);
        }
    });

    test('L22 strict-block page and non-normalised tab URL use tabs.update', async () => {
        const page = await open({
            url: `${EXT}/strictblock.html#https://blocked.example/x?y=1`,
            mock: { responses: { popupPanelData: PANEL({ level: 2 }) } },
        });
        const from = await mark(page);
        await clickSync(page, radioSel(0));
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api.startsWith('tabs.')));
        assert.deepEqual(
            list.map(({ api, args }) => ({ api, args })),
            [
                { api: 'runtime.sendMessage', args: [SET(0, 'blocked.example')] },
                { api: 'tabs.update', args: [42, { url: 'https://blocked.example/x?y=1' }] },
            ],
        );
        await done(page);

        const p2 = await open({ url: 'http://user:pw@Sub.Example.COM:8080/a b?q=1#frag' });
        const f2 = await mark(p2);
        await clickSync(p2, radioSel(0));
        const l2 = await waitCalls(p2, f2, (l) => l.some((c) => c.api.startsWith('tabs.')));
        assert.deepEqual(l2[1], { ...l2[1], api: 'tabs.update', args: [42, { url: 'http://user:pw@sub.example.com:8080/a%20b?q=1#frag' }] });
        await done(p2);
    });

    test('L23 slow commit: further selections ignored, busy overlay after 1 s until the end', async () => {
        const page = await open({ scenario: 'slow' });
        const from = await mark(page);
        await clickSync(page, radioSel(2));
        await sleep(100);
        await page.evaluate(() => {
            document.querySelector('[data-level="3"] [role="radio"]').click();
            document.querySelector('[data-level="0"] [role="radio"]').click();
        });
        await sleep(200);
        assert.equal(await present(page, '[data-testid="busy-overlay"]'), false, 'no overlay at 300 ms');
        // aria-busy is on the radiogroup only, never on <main>, which holds the live regions.
        assert.equal(await page.locator('[role="radiogroup"]').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('main').getAttribute('aria-busy'), null);
        await page.waitForSelector('[data-testid="busy-overlay"]', { timeout: 2000 });
        await screenshot(page, 'popup-busy', { clip: { x: 0, y: 0, width: 340, height: POPUP_HEIGHT } });
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'), 8000);
        await page.waitForSelector('[data-testid="busy-overlay"]', { state: 'detached', timeout: 2000 });
        assert.equal(msgs(list).filter((m) => m.what === 'setFilteringMode').length, 1);
        assert.deepEqual(msgs(list), [PENDING(1, 2), SET(2)]);
        assert.equal(await shownLevel(page), 2);
        await done(page);
    });

    test('L24 filteringMode forbidden: no message, no API call', async () => {
        const page = await open({ disabled: 'filteringMode' });
        const from = await mark(page);
        for (const l of [0, 2, 3]) await clickSync(page, radioSel(l));
        await page.locator(radioSel(3)).click({ force: true }); // aria-disabled: see the admin-locked test
        await sleep(400);
        assert.deepEqual(await callsSince(page, from), []);
        assert.equal(await shownLevel(page), 1);
        await done(page);
    });

    test('L25 activating the current level sends nothing (the control cannot re-commit)', async () => {
        const page = await open({ level: 2 });
        const from = await mark(page);
        await page.locator(radioSel(2)).click();
        await page.keyboard.press('Space');
        await sleep(400);
        assert.deepEqual(await callsSince(page, from), []);
        await done(page);
    });

    test('keyboard: arrows move focus only, Space selects inside the gesture', async () => {
        const page = await open({});
        const from = await mark(page);
        await page.locator(radioSel(1)).focus();
        await page.keyboard.press('ArrowRight');
        await sleep(150);
        assert.deepEqual(await callsSince(page, from), [], 'arrow key selects nothing');
        await page.keyboard.press('Space');
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'));
        assert.deepEqual(msgs(list), [PENDING(1, 2), SET(2)]);
        await done(page);
    });

    test('L43 failed setFilteringMode: error, no reload, level back; next change uses an integer before-level', async () => {
        const page = await open({ scenario: 'error-on-apply' });
        const from = await mark(page);
        await clickSync(page, radioSel(0));
        await waitShownLevel(page, 1);
        await page.waitForFunction(() => (document.querySelector('[data-politeness="assertive"]')?.textContent ?? '') !== '');
        await sleep(700);
        assert.deepEqual(msgs(await callsSince(page, from)), [SET(0)]);
        assert.equal((await callsSince(page, from)).some((c) => c.api.startsWith('tabs.')), false, 'no reload');
        await screenshot(page, 'popup-error-on-apply', { clip: { x: 0, y: 0, width: 340, height: POPUP_HEIGHT } });

        await page.evaluate(() => globalThis.__blockerMock.setFailure('setFilteringMode', null));
        const f2 = await mark(page);
        await clickSync(page, radioSel(2));
        const l2 = await waitCalls(page, f2, (l) => l.some((c) => c.api === 'tabs.reload'));
        assert.deepEqual(
            l2.map(({ api, args }) => ({ api, args })),
            [
                { api: 'runtime.sendMessage', args: [PENDING(1, 2)] },
                { api: 'permissions.request', args: [PERM()] },
                { api: 'runtime.sendMessage', args: [SET(2)] },
                { api: 'tabs.reload', args: [42] },
            ],
        );
        await done(page);

        for (const mode of ['undefined', 'null']) {
            const p = await open({ fail: `setFilteringMode:${mode}` });
            const f = await mark(p);
            await clickSync(p, radioSel(0));
            await waitShownLevel(p, 1);
            await sleep(700);
            assert.deepEqual(apis(await callsSince(p, f)), ['runtime.sendMessage'], mode);
            await done(p);
        }
    });

    test('L45 IPv6 host: pending, invalid pattern rejected, back to 1', async () => {
        const page = await open({ url: 'http://[::1]:8080/', level: 1 });
        assert.deepEqual(msgs(await calls(page)), [{ what: 'popupPanelData', origin: 'http://[::1]:8080', hostname: '[::1]' }]);
        const from = await mark(page);
        await clickSync(page, radioSel(2));
        await waitShownLevel(page, 1);
        await sleep(700);
        assert.deepEqual(
            (await callsSince(page, from)).map(({ api, args }) => ({ api, args })),
            [
                { api: 'runtime.sendMessage', args: [{ what: 'setPendingFilteringMode', tabId: 42, url: 'http://[::1]:8080/', hostname: '[::1]', beforeLevel: 1, afterLevel: 2 }] },
                { api: 'permissions.request', args: [{ origins: ['*://*.[::1]/*'] }] },
            ],
        );
        await done(page);
    });
});

/* ------------------------------------------------------------------------ */
/* Tools and ribbon                                                          */
/* ------------------------------------------------------------------------ */

describe('tools and ribbon', () => {
    const TOOL_CASES = [
        ['#gotoZapper', ['/js/scripting/tool-overlay.js', '/js/scripting/zapper.js'], {}],
        ['#gotoPicker', ['/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/picker.js'], {}],
        ['#gotoUnpicker', ['/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/unpicker.js'], { customFilters: 2 }],
    ];

    test('L27 / L28 / L29 tools: executeScript then window.close, no message', async () => {
        for (const [sel, files, params] of TOOL_CASES) {
            const page = await open(params);
            const from = await mark(page);
            await page.locator(sel).click();
            const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'window.close'));
            assert.deepEqual(
                list.map(({ api, args }) => ({ api, args })),
                [
                    { api: 'scripting.executeScript', args: [{ files, target: { tabId: 42 } }] },
                    { api: 'window.close', args: [] },
                ],
                sel,
            );
            await done(page);
        }
    });

    test('L30 no browser.scripting: nothing at all, popup stays open', async () => {
        for (const [sel, , params] of TOOL_CASES) {
            const page = await open({ ...params, scripting: 'none' });
            const from = await mark(page);
            await page.locator(sel).click();
            await sleep(300);
            assert.deepEqual(await callsSince(page, from), [], sel);
            await done(page);
        }
    });

    test('L31 / L32 / L33 / L44 report', async () => {
        let page = await open({});
        let from = await mark(page);
        await page.locator('#gotoReport').click();
        let list = await waitCalls(page, from, (l) => l.length > 0);
        await sleep(300);
        list = await callsSince(page, from);
        assert.deepEqual(list.map(({ api, args }) => ({ api, args })), [
            { api: 'runtime.sendMessage', args: [{ what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1' }] },
        ]);
        await done(page);

        // L32: mode = level at open.
        page = await open({ level: 2 });
        await clickSync(page, radioSel(0));
        await waitCalls(page, 0, (l) => l.some((c) => c.api === 'tabs.reload'));
        from = await mark(page);
        await page.locator('#gotoReport').click();
        list = await waitCalls(page, from, (l) => l.length > 0);
        assert.ok(msgs(list)[0].url.endsWith('&mode=2'), msgs(list)[0].url);
        await done(page);

        // L33: strict-block tab.
        page = await open({
            url: `${EXT}/strictblock.html#https://blocked.example/x?y=1`,
            mock: { responses: { popupPanelData: PANEL({ level: 2 }) } },
        });
        from = await mark(page);
        await page.locator('#gotoReport').click();
        list = await waitCalls(page, from, (l) => l.length > 0);
        assert.deepEqual(msgs(list), [{ what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fblocked.example%2Fx%3Fy%3D1&mode=2' }]);
        await done(page);

        // L44: userinfo and fragment kept (level 1 at open, as the checklist fixture).
        page = await open({ url: 'http://user:pw@Sub.Example.COM:8080/a b?q=1#frag', level: 1 });
        from = await mark(page);
        await page.locator('#gotoReport').click();
        list = await waitCalls(page, from, (l) => l.length > 0);
        assert.deepEqual(msgs(list), [
            { what: 'gotoURL', url: '/report.html?tabid=42&url=http%3A%2F%2Fuser%3Apw%40sub.example.com%3A8080%2Fa%2520b%3Fq%3D1%23frag&mode=1' },
        ]);
        await done(page);
    });

    test('L34 dashboard: openOptionsPage() without argument, in READY and NO-WEBSITE', async () => {
        for (const params of [{}, { scenario: 'no-website' }]) {
            const page = await open(params);
            const from = await mark(page);
            await page.locator('#gotoDashboard').click();
            await sleep(300);
            assert.deepEqual((await callsSince(page, from)).map(({ api, args }) => ({ api, args })), [{ api: 'runtime.openOptionsPage', args: [] }]);
            await done(page);
        }
    });

    test('L35 matched rules: showMatchedRules { tabId }, no close', async () => {
        const page = await open({ dev: 1 });
        const from = await mark(page);
        await page.locator('#gotoMatchedRules').click();
        await sleep(300);
        assert.deepEqual((await callsSince(page, from)).map(({ api, args }) => ({ api, args })), [
            { api: 'runtime.sendMessage', args: [{ what: 'showMatchedRules', tabId: 42 }] },
        ]);
        await done(page);
    });

    test('L36 right and middle clicks do nothing', async () => {
        const page = await open({ dev: 1, customFilters: 2 });
        const from = await mark(page);
        for (const sel of ['#gotoZapper', '#gotoPicker', '#gotoUnpicker', '#gotoReport', '#gotoDashboard', '#gotoMatchedRules', radioSel(0), radioSel(2)]) {
            await page.locator(sel).click({ button: 'right' });
            await page.keyboard.press('Escape');
            await page.locator(sel).click({ button: 'middle' });
        }
        await sleep(300);
        assert.deepEqual(await callsSince(page, from), []);
        await done(page);
    });
});

/* ------------------------------------------------------------------------ */
/* Errors required by §13                                                    */
/* ------------------------------------------------------------------------ */

describe('error states (§13)', () => {
    test('L40 tabs.query rejects: error, no message, nothing operable', async () => {
        const page = await open(
            {},
            {
                init: () => {
                    let value;
                    Object.defineProperty(globalThis, 'browser', {
                        configurable: true,
                        get: () => value,
                        set: (v) => {
                            value = v;
                            const original = v.tabs.query;
                            v.tabs.query = (...args) => {
                                original(...args);
                                return Promise.reject(new Error('tabs.query failed (test)'));
                            };
                        },
                    });
                },
            },
        );
        assert.equal(await page.locator('[data-testid="popup"]').getAttribute('data-state'), 'error');
        assert.deepEqual(apis(await calls(page)), ['tabs.query']);
        assert.equal(await present(page, '[role="radiogroup"]'), false);
        assert.equal(await present(page, '[data-testid="tools-section"]'), false);
        assert.ok((await page.locator('[data-politeness="assertive"]').innerText()).length > 0);
        assert.equal(await page.locator('[data-testid="load-error"] [data-testid="load-failed"]').isVisible(), true);
        assert.equal(await page.locator('[data-blocker-status] [data-variant]').count(), 0, 'shown once (empty state), announced once');
        assert.equal(await present(page, '#gotoDashboard'), true);
        await screenshot(page, 'popup-load-error', { clip: { x: 0, y: 0, width: 340, height: POPUP_HEIGHT } });
        await done(page);
    });

    test('L42 malformed popupPanelData (no level, "2", null, 7): one message, error, no level', async () => {
        const { level: _omit, ...withoutLevel } = PANEL();
        for (const answer of [withoutLevel, PANEL({ level: '2' }), PANEL({ level: null }), PANEL({ level: 7 })]) {
            const page = await open({ mock: { responses: { popupPanelData: answer } } });
            assert.equal(await page.locator('[data-testid="popup"]').getAttribute('data-state'), 'error', JSON.stringify(answer));
            assert.deepEqual(apis(await calls(page)), ['tabs.query', 'runtime.sendMessage']);
            assert.equal(await present(page, '[role="radiogroup"]'), false);
            assert.equal(await present(page, '[data-testid="tools-section"]'), false);
            assert.equal(await hostnameText(page), H);
            assert.equal(await page.locator('[data-testid="load-error"] [data-testid="load-failed"]').isVisible(), true);
            assert.equal(await page.locator('[data-blocker-status] [data-variant]').count(), 0);
            await done(page);
        }
    });
});

/* ------------------------------------------------------------------------ */
/* i18n / RTL / screenshots                                                  */
/* ------------------------------------------------------------------------ */

describe('look', () => {
    const clip = { x: 0, y: 0, width: 340, height: POPUP_HEIGHT };

    test('L39 RTL: dir=rtl, level 0 at the right edge; hostname kept LTR', async () => {
        const page = await open({ lang: 'ar', customFilters: 2, dev: 1 });
        assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
        assert.equal(await page.evaluate(() => document.body.dir), 'rtl');
        const x0 = (await page.locator(radioSel(0)).boundingBox()).x;
        const x3 = (await page.locator(radioSel(3)).boundingBox()).x;
        assert.ok(x0 > x3, 'level 0 is right of level 3');
        assert.equal(await page.locator('[data-testid="hostname"] bdi').getAttribute('dir'), 'ltr');
        // ArrowLeft moves to the next level in RTL; Space selects (level 2 → permission request).
        await page.locator(radioSel(1)).focus();
        await page.keyboard.press('ArrowLeft');
        await sleep(100);
        const from = await mark(page);
        await page.keyboard.press('Space');
        const list = await waitCalls(page, from, (l) => l.some((c) => c.api === 'permissions.request'));
        assert.equal(msgs(list)[0].afterLevel, 2);
        await waitCalls(page, from, (l) => l.some((c) => c.api === 'tabs.reload'));
        await done(page);
    });

    test('screenshots: light, dark, rtl, long locale, no website (no horizontal overflow)', async () => {
        const shots = [
            ['popup-light', { customFilters: 2, dev: 1 }],
            ['popup-dark', { customFilters: 2, dev: 1, theme: 'dark' }],
            ['popup-rtl', { customFilters: 2, dev: 1, lang: 'ar' }],
            ['popup-rtl-dark', { customFilters: 2, dev: 1, lang: 'fa', theme: 'dark' }],
            ['popup-long-locale', { customFilters: 2, dev: 1, lang: 'longest', url: 'https://a-very-long-subdomain-name.with-many-labels.example-website-domain.co.uk/' }],
            ['popup-long-locale-br', { customFilters: 2, dev: 1, lang: 'br_FR' }],
            ['popup-long-locale-pl', { customFilters: 2, dev: 1, lang: 'pl', scenario: 'no-website' }],
            ['popup-no-website', { scenario: 'no-website' }],
            ['popup-no-website-dark', { scenario: 'no-website', theme: 'dark' }],
        ];
        for (const [name, params] of shots) {
            const page = await open(params);
            await sleep(150);
            const overflow = await page.evaluate(() => ({
                scrollW: document.documentElement.scrollWidth,
                bodyW: document.body.getBoundingClientRect().width,
                popupH: document.querySelector('[data-testid="popup"]').getBoundingClientRect().height,
                wide: [...document.querySelectorAll('[data-testid="popup"] *')].filter((el) => {
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && (r.right > 340.5 || r.left < -0.5);
                }).length,
            }));
            assert.equal(overflow.scrollW, 340, `${name}: no horizontal scroll`);
            assert.equal(overflow.popupH, POPUP_HEIGHT, `${name}: fixed height`);
            assert.equal(overflow.wide, 0, `${name}: nothing sticks out`);
            await screenshot(page, name, { clip });
            await done(page);
        }
        // Hover preview with tooltip (light).
        const page = await open({});
        await page.locator(radioSel(3)).hover();
        await sleep(900);
        await screenshot(page, 'popup-hover-preview', { clip });
        await done(page);
    });

    test('no console errors, page errors, failed or external requests in any session', () => {
        assert.deepEqual(chrome.pageErrors, []);
        assert.deepEqual(chrome.consoleErrors, []);
        assert.deepEqual(chrome.failedRequests, []);
        assert.deepEqual(chrome.externalRequests, []);
        assert.ok(sessions.length > 40, `sessions checked: ${sessions.length}`);
    });
});

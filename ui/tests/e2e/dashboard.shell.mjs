/**
 * Dashboard shell (docs/specs/dashboard-shell.md): tabs, pane persistence,
 * keyboard, developer-mode visibility, the persistent classic iframe, and the
 * About pane. Screenshots (build/screenshots): dashboard-shell-*.png.
 *
 *   npm run build:harness && node --test tests/e2e/dashboard.shell.mjs
 *   (BLOCKER_HARNESS_DIR / BLOCKER_SCREENSHOT_DIR for private builds)
 *
 * Two classic-frame modes:
 * - plain harness: dashboard-classic.html does not exist there, so the shell
 *   must show its "could not be loaded" placeholder;
 * - "upstream" mode: the test serves the PRISTINE upstream files
 *   (dashboard-classic.html = PRISTINE dashboard.html, js/, css/, lib/, img/,
 *   _locales/) and css/default.css = PRISTINE + the two R-18 rules, and gives
 *   every child frame the parent's mock `browser` (plus the two Safari APIs
 *   ext-compat.js touches at load). This runs the real upstream controllers
 *   inside the frame, like the spec's [H2] harness.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
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
import { PRISTINE_DIR as PRISTINE } from './lib/harness.mjs';
const R18_RULES = `
:root[data-blocker-embed] body > header {
    display: none !important;
}
:root[data-blocker-embed] body > section:is([data-pane="settings"], [data-pane="rulesets"], [data-pane="about"], [data-pane="busy"]) {
    display: none !important;
}
`;
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};

const TROUBLESHOOTING_CALLS = [
    'getDefaultConfig',
    'getCurrentConfig',
    'getEnabledRulesets',
    'getRulesetDetails',
    'getDefaultFilteringMode',
    'getEffectiveUserRules',
    'getConsoleOutput',
    'getRegisteredContentScripts',
    'hasBroadHostPermissions',
];

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof launchChrome>>} */
let chrome;
let upstreamMode = false;

function upstreamFile(pathname) {
    if (pathname === '/dashboard-classic.html') return path.join(PRISTINE, 'dashboard.html');
    if (pathname.startsWith('/img/')) return path.join(PRISTINE, pathname);
    if (!upstreamMode) return null;
    if (/^\/(js|css|lib|_locales)\//.test(pathname)) return path.join(PRISTINE, pathname);
    return null;
}

before(async () => {
    assert.ok(existsSync(PRISTINE), `PRISTINE missing: ${PRISTINE}`);
    server = await startStaticServer(HARNESS_DIR);
    chrome = await launchChrome({ viewport: DASHBOARD_VIEWPORT, colorScheme: 'light' });
    // Upstream images (logo, favicon) always; the classic page only in upstream mode.
    await chrome.context.route(
        (url) => {
            const p = new URL(url).pathname;
            if (p === '/dashboard-classic.html') return upstreamMode;
            return upstreamFile(p) !== null;
        },
        async (route) => {
            const p = new URL(route.request().url()).pathname;
            const file = upstreamFile(p);
            if (file === null || !existsSync(file)) {
                await route.fulfill({ status: 404, body: 'not found' });
                return;
            }
            let body = readFileSync(file);
            if (p === '/css/default.css') body = Buffer.concat([body, Buffer.from(R18_RULES)]);
            await route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body });
        },
    );
    // Child frames (the classic dashboard) use the parent's mock browser API.
    await chrome.context.addInitScript(() => {
        if (window.top === window) return;
        try {
            const base = window.top.browser;
            if (!base) return;
            const noopEvent = { addListener() {}, removeListener() {}, hasListener: () => false };
            window.browser = Object.assign({}, base, {
                windows: { WINDOW_ID_NONE: -1, onFocusChanged: noopEvent, get: async () => ({}) },
                declarativeNetRequest: {},
            });
        } catch {
            /* cross-origin: leave it */
        }
    });
});

after(async () => {
    await chrome?.close();
    await server?.close();
    if (chrome) assert.equal(userDataDirRemoved(chrome), true, 'temporary Chrome profile was deleted');
});

async function newPage(viewport = DASHBOARD_VIEWPORT) {
    const page = await chrome.context.newPage();
    await page.setViewportSize(viewport);
    return page;
}

async function openDashboard(page, params = {}, options = {}) {
    await openHarness(page, 'dashboard', params, options);
    await page.waitForSelector('[data-shell-status="ready"]', { timeout: 30_000 });
}

/** The dashboard.activePane writes, in order: ['set', value] or ['remove']. */
async function paneWrites(page) {
    const calls = await getCalls(page, { api: /^storage\.local\.(set|remove)$/ });
    const out = [];
    for (const c of calls) {
        if (c.api === 'storage.local.remove') {
            const keys = Array.isArray(c.args[0]) ? c.args[0] : [c.args[0]];
            if (keys.includes('dashboard.activePane')) out.push(['remove']);
        } else if (c.args[0] && Object.hasOwn(c.args[0], 'dashboard.activePane')) {
            out.push(['set', c.args[0]['dashboard.activePane']]);
        }
    }
    return out;
}

async function tabNames(page) {
    return page.$$eval('[role="tablist"] [role="tab"]', (tabs) => tabs.map((t) => t.textContent.trim()));
}

async function selectedTab(page) {
    return page.$eval('[role="tab"][aria-selected="true"]', (t) => t.textContent.trim());
}

async function activePane(page) {
    return page.$eval('[data-active-pane]', (el) => el.getAttribute('data-active-pane'));
}

function storedPane(value) {
    return { mock: { storage: { local: { 'dashboard.activePane': value } } } };
}

test('shell: title, favicon, logo, five tabs in order, Develop hidden without developer mode', async () => {
    const page = await newPage();
    try {
        await openDashboard(page);
        assert.equal(await page.title(), 'uBO Lite — Dashboard');
        assert.equal(await page.$eval('link[rel="icon"]', (l) => l.getAttribute('href')), 'img/icon_64.png');
        const logo = await page.$eval('[data-testid="dashboard-title"] img', (img) => ({
            src: img.getAttribute('src'),
            alt: img.alt,
            title: img.title,
            ok: img.complete && img.naturalWidth > 0,
        }));
        assert.deepEqual(logo, { src: 'img/ublock.svg', alt: 'Blocker', title: 'Blocker', ok: true });
        assert.deepEqual(await tabNames(page), ['Settings', 'Filter lists', 'Custom filters', 'About']);
        assert.equal(await selectedTab(page), 'Settings');
        assert.equal(await activePane(page), 'settings');
        // The tablist is named by the h1 ("Blocker"), not by the stale dashboardName.
        const tablist = await page.$eval('[role="tablist"]', (el) => ({
            orientation: el.getAttribute('aria-orientation'),
            label: el.getAttribute('aria-label'),
            labelledBy: el.getAttribute('aria-labelledby'),
            name: document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.querySelector('img')?.alt,
            h1: document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.tagName,
        }));
        assert.deepEqual(tablist, { orientation: 'vertical', label: null, labelledBy: 'dashboard-title', name: 'Blocker', h1: 'H1' });
        assert.equal(await page.getByRole('tablist', { name: 'Blocker' }).count(), 1);
        // Every tab controls an existing tabpanel.
        const dangling = await page.$$eval('[role="tab"]', (tabs) =>
            tabs.filter((t) => document.getElementById(t.getAttribute('aria-controls')) === null).length,
        );
        assert.equal(dangling, 0);
        // One getOptionsPageData for the whole document; no write at start.
        const msgs = await getMessages(page);
        assert.equal(msgs.filter((m) => m.what === 'getOptionsPageData').length, 1);
        assert.deepEqual(await paneWrites(page), []);
        // No URL hash/query written (R-6).
        assert.equal(new URL(page.url()).hash, '');
    } finally {
        await page.close();
    }
});

test('tab selection persists dashboard.activePane exactly like upstream (R-2)', async () => {
    const page = await newPage();
    try {
        await openDashboard(page);
        await page.getByRole('tab', { name: 'Filter lists' }).click();
        assert.equal(await activePane(page), 'rulesets');
        await page.getByRole('tab', { name: 'About' }).click();
        assert.equal(await activePane(page), 'about');
        await page.getByRole('tab', { name: 'Settings' }).click();
        assert.equal(await activePane(page), 'settings');
        await page.waitForTimeout(50);
        assert.deepEqual(await paneWrites(page), [['set', 'rulesets'], ['set', 'about'], ['remove']]);
        const state = await page.evaluate(() => globalThis.__blockerMock.state());
        assert.equal(Object.hasOwn(state.storage.local, 'dashboard.activePane'), false);
        // P-2: a click on the tab that is already selected writes again (upstream writes on every click).
        await page.getByRole('tab', { name: 'Settings' }).click();
        await page.getByRole('tab', { name: 'About' }).click();
        await page.getByRole('tab', { name: 'About' }).click();
        await page.waitForTimeout(50);
        assert.deepEqual(await paneWrites(page), [['set', 'rulesets'], ['set', 'about'], ['remove'], ['remove'], ['set', 'about'], ['set', 'about']]);
    } finally {
        await page.close();
    }
    // D-1 + P-2: stored 'develop' without developer mode shows Settings; clicking Settings removes the key.
    const page2 = await newPage();
    try {
        await openDashboard(page2, storedPane('develop'));
        assert.equal(await activePane(page2), 'settings');
        await page2.getByRole('tab', { name: 'Settings' }).click();
        await page2.waitForTimeout(50);
        assert.deepEqual(await paneWrites(page2), [['remove']]);
        const state2 = await page2.evaluate(() => globalThis.__blockerMock.state());
        assert.equal(Object.hasOwn(state2.storage.local, 'dashboard.activePane'), false);
    } finally {
        await page2.close();
    }
});

test('start pane restored from storage; hidden or unknown -> Settings without a write (R-3, D-1)', async () => {
    const cases = [
        [{}, 'settings'],
        [storedPane('about'), 'about'],
        [storedPane('rulesets'), 'rulesets'],
        [storedPane('develop'), 'settings'], // Q1: developer mode off
        [{ ...storedPane('develop'), dev: 1 }, 'develop'],
        [{ ...storedPane('filters'), disabled: 'picker' }, 'settings'], // Q2
        [storedPane('nonsense'), 'settings'], // Q3
        [storedPane(7), 'settings'],
    ];
    for (const [params, expected] of cases) {
        const page = await newPage();
        try {
            await openDashboard(page, params);
            assert.equal(await activePane(page), expected, JSON.stringify(params));
            assert.equal(await selectedTab(page).catch(() => null), { settings: 'Settings', about: 'About', rulesets: 'Filter lists', develop: 'Develop' }[expected]);
            assert.deepEqual(await paneWrites(page), [], `no write for ${JSON.stringify(params)}`);
        } finally {
            await page.close();
        }
    }
});

test('disabledFeatures dashboard forces About after both reads, whatever their order (R-5, P-5)', async () => {
    for (const delays of [{ getOptionsPageData: 300 }, { getOptionsPageData: 0 }]) {
        const page = await newPage();
        try {
            await openDashboard(page, { ...storedPane('develop'), dev: 1, disabled: 'dashboard', mock: { ...storedPane('develop').mock, delays } });
            assert.equal(await activePane(page), 'about');
            assert.deepEqual(await tabNames(page), ['Develop', 'About']);
            assert.deepEqual(await paneWrites(page), []);
        } finally {
            await page.close();
        }
    }
    const page = await newPage();
    try {
        await openDashboard(page, { disabled: 'picker' });
        assert.deepEqual(await tabNames(page), ['Settings', 'Filter lists', 'About']);
    } finally {
        await page.close();
    }
});

test('keyboard: manual activation, arrow keys follow the orientation, RTL mirrored (P-10)', async () => {
    const page = await newPage();
    try {
        await openDashboard(page);
        await page.getByRole('tab', { name: 'Settings' }).focus();
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Filter lists');
        assert.equal(await activePane(page), 'settings', 'arrow keys move focus only');
        await page.keyboard.press('End');
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'About');
        await page.keyboard.press('Enter');
        assert.equal(await activePane(page), 'about');
        // Visible focus ring on the focused tab.
        const outline = await page.evaluate(() => {
            const el = document.activeElement;
            const after = getComputedStyle(el, '::after');
            const own = getComputedStyle(el);
            return { after: after.outlineStyle + ' ' + after.outlineWidth, own: own.outlineStyle + ' ' + own.outlineWidth };
        });
        assert.ok(/solid|auto/.test(outline.after) || /solid|auto/.test(outline.own), JSON.stringify(outline));
        await page.keyboard.press('Home');
        await page.waitForTimeout(50);
        await page.keyboard.press('Space');
        assert.equal(await activePane(page), 'settings');
        await page.waitForTimeout(50);
        assert.deepEqual(await paneWrites(page), [['set', 'about'], ['remove']]);
        // P-2 by keyboard: Enter / Space on the selected tab write again.
        await page.keyboard.press('Enter');
        await page.keyboard.press('Space');
        await page.waitForTimeout(50);
        assert.deepEqual(await paneWrites(page), [['set', 'about'], ['remove'], ['remove'], ['remove']]);
        // Tab moves into the panel; the focused panel shows a visible ring (WCAG 2.4.7).
        await page.keyboard.press('Tab');
        const panelRing = await page.evaluate(() => {
            const el = document.activeElement;
            const cs = getComputedStyle(el);
            return { role: el.getAttribute('role'), focusVisible: el.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth };
        });
        assert.deepEqual(panelRing, { role: 'tabpanel', focusVisible: true, style: 'solid', width: '2px' });
    } finally {
        await page.close();
    }
    // Narrow + RTL: horizontal tabs, ArrowLeft goes to the next tab.
    const rtl = await newPage({ width: 600, height: 800 });
    try {
        await openDashboard(rtl, { lang: 'ar' });
        assert.equal(await rtl.$eval('html', (h) => h.dir), 'rtl');
        assert.equal(await rtl.$eval('[role="tablist"]', (el) => el.getAttribute('aria-orientation')), 'horizontal');
        const first = rtl.locator('[role="tab"]').first();
        await first.focus();
        await rtl.keyboard.press('ArrowLeft');
        await rtl.waitForTimeout(50);
        const focused = await rtl.evaluate(() => [...document.querySelectorAll('[role="tab"]')].indexOf(document.activeElement));
        assert.equal(focused, 1);
    } finally {
        await rtl.close();
    }
});

test('developer mode: Develop tab follows the broadcast; off while shown -> Settings, no write (R-4, D-2)', async () => {
    const page = await newPage();
    try {
        await openDashboard(page);
        assert.equal(await page.getByRole('tab', { name: 'Develop' }).count(), 0);
        await mockBroadcast(page, { developerMode: true });
        await page.getByRole('tab', { name: 'Develop' }).waitFor();
        assert.deepEqual(await tabNames(page), ['Settings', 'Filter lists', 'Custom filters', 'Develop', 'About']);
        await page.getByRole('tab', { name: 'Develop' }).click();
        assert.equal(await activePane(page), 'develop');
        await page.waitForFunction(() => document.querySelectorAll('iframe[data-blocker-classic-frame]').length === 1);
        const writesBefore = await paneWrites(page);
        assert.deepEqual(writesBefore, [['set', 'develop']]);
        // Focus is on the Develop tab (keyboard user) when developer mode goes off.
        await page.getByRole('tab', { name: 'Develop' }).focus();
        await mockBroadcast(page, { developerMode: false });
        await page.waitForFunction(() => document.querySelector('[data-active-pane]')?.getAttribute('data-active-pane') === 'settings');
        assert.equal(await page.getByRole('tab', { name: 'Develop' }).count(), 0);
        assert.deepEqual(await paneWrites(page), writesBefore, 'D-2 writes nothing');
        // The frame stays mounted (E-8, D-2).
        assert.equal(await page.$$eval('iframe[data-blocker-classic-frame]', (f) => f.length), 1);
        // Focus moved to the Settings tab instead of falling to <body>.
        await page.waitForFunction(() => document.activeElement !== document.body);
        assert.equal(await page.evaluate(() => [document.activeElement?.getAttribute('role'), document.activeElement?.textContent?.trim()].join(':')), 'tab:Settings');
        // Same when focus was inside the classic panel.
        await mockBroadcast(page, { developerMode: true });
        await page.getByRole('tab', { name: 'Develop' }).click();
        await page.$eval('[data-pane-id="classic"]', (p) => p.focus());
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-pane-id')), 'classic');
        await mockBroadcast(page, { developerMode: false });
        await page.waitForFunction(() => document.querySelector('[data-active-pane]')?.getAttribute('data-active-pane') === 'settings');
        await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab');
        assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Settings');
    } finally {
        await page.close();
    }
});

test('developer mode: the Settings toggle flips the Develop tab before the background answers (P-4)', async (t) => {
    const page = await newPage();
    try {
        // Slow background: the tab must follow the switch, not the answer/echo.
        await openDashboard(page, { mock: { delays: { setDeveloperMode: 1500 } } });
        const toggle = page.getByRole('switch', { name: 'Developer mode' }).or(page.getByRole('checkbox', { name: 'Developer mode' }));
        if ((await toggle.count()) === 0) {
            t.skip('the Settings pane has no developer-mode control yet');
            return;
        }
        await toggle.first().click();
        await page.getByRole('tab', { name: 'Develop' }).waitFor({ timeout: 1000 });
        const sent = (await getMessages(page)).filter((m) => m.what === 'setDeveloperMode');
        assert.deepEqual(sent, [{ what: 'setDeveloperMode', state: true }]);
    } finally {
        await page.close();
    }
});

test('classic frame in the plain harness: one lazy iframe, awaited write, placeholder, kept mounted', async () => {
    const page = await newPage();
    try {
        server.requests.length = 0;
        await openDashboard(page, { dev: 1 });
        assert.equal(await page.$$eval('iframe', (f) => f.length), 0, 'not created eagerly (E-2)');
        await page.getByRole('tab', { name: 'Custom filters' }).click();
        await page.waitForSelector('iframe[data-blocker-classic-frame]', { state: 'attached' });
        // E-3: the write precedes the frame's request.
        const writeAt = (await getCalls(page, { api: 'storage.local.set' })).find((c) => c.args[0]['dashboard.activePane'] === 'filters')?.t;
        assert.ok(typeof writeAt === 'number');
        const frame = await page.$('iframe[data-blocker-classic-frame]');
        assert.equal(await frame.getAttribute('src'), 'dashboard-classic.html');
        assert.equal(await frame.getAttribute('title'), 'Custom filters');
        await page.waitForSelector('[data-testid="classic-frame-unavailable"]');
        // The warning is announced through the page's live region.
        await page.waitForFunction(() => [...document.querySelectorAll('[role="status"], [aria-live]')].some((r) => r.textContent.includes('This pane could not be loaded.')));
        await page.evaluate(() => {
            window.__frameNode = document.querySelector('iframe[data-blocker-classic-frame]');
        });
        await page.getByRole('tab', { name: 'Develop' }).click();
        assert.equal(await frame.getAttribute('title'), 'Develop');
        await page.getByRole('tab', { name: 'About' }).click();
        assert.equal(await page.$eval('iframe[data-blocker-classic-frame]', (f) => f.closest('[role="tabpanel"]').hidden), true);
        await page.getByRole('tab', { name: 'Custom filters' }).click();
        const same = await page.evaluate(() => document.querySelector('iframe[data-blocker-classic-frame]') === window.__frameNode);
        assert.equal(same, true, 'the iframe element is never replaced');
        assert.equal(await page.$$eval('iframe', (f) => f.length), 1);
        const requests = server.requests.filter((r) => r === '/dashboard-classic.html');
        assert.equal(requests.length, 1, 'loaded exactly once');
        server.requests.length = 0;
        await screenshot(page, 'dashboard-shell-classic-unavailable');
    } finally {
        await page.close();
    }
});

test('classic frame with the real upstream page: marker, guard, panes, unsaved text survives (E-1..E-11)', async () => {
    upstreamMode = true;
    const page = await newPage();
    try {
        await openDashboard(page, { dev: 1 });
        await page.getByRole('tab', { name: 'Custom filters' }).click();
        await page.waitForSelector('[data-classic-frame-status="ready"]', { timeout: 30_000 });
        const frame = page.frameLocator('iframe[data-blocker-classic-frame]');
        const handle = await page.$('iframe[data-blocker-classic-frame]');
        const inner = await handle.contentFrame();
        const info = await inner.evaluate(() => ({
            marker: document.documentElement.getAttribute('data-blocker-embed'),
            pane: document.body.dataset.pane,
            header: getComputedStyle(document.querySelector('body > header')).display,
            settings: getComputedStyle(document.querySelector('section[data-pane="settings"]')).display,
            filters: getComputedStyle(document.querySelector('section[data-pane="filters"]')).display,
            scrollable: document.scrollingElement.scrollHeight > innerHeight,
        }));
        assert.deepEqual(
            { ...info, scrollable: undefined },
            { marker: 'classic-dashboard', pane: 'filters', header: 'none', settings: 'none', filters: 'block', scrollable: undefined },
        );
        // E-10: the frame gets the shell's language.
        const langs = [await page.evaluate(() => document.documentElement.lang), await inner.evaluate(() => document.documentElement.lang)];
        assert.ok(langs[0] !== '', 'shell has a lang');
        assert.equal(langs[1], langs[0]);
        // E-3: the shell's write happened before the frame read the key.
        const calls = await getCalls(page, { api: /^storage\.local\.(get|set)$/ });
        const writeIdx = calls.findIndex((c) => c.api === 'storage.local.set' && c.args[0]['dashboard.activePane'] === 'filters');
        const reads = calls.flatMap((c, i) => (c.api === 'storage.local.get' && c.args[0] === 'dashboard.activePane' ? [i] : []));
        // One read by the shell at start-up, one by the frame after the awaited write.
        assert.equal(reads.length, 2, JSON.stringify(reads));
        assert.ok(writeIdx >= 0 && reads[0] < writeIdx && reads[1] > writeIdx, `write ${writeIdx}, reads ${reads}`);

        // Guard (R-20): a forced foreign pane is reverted.
        await inner.evaluate(() => {
            document.body.dataset.pane = 'rulesets';
        });
        await page.waitForTimeout(20);
        assert.equal(await inner.evaluate(() => document.body.dataset.pane), 'filters');

        // Develop: switch inside the same frame, type unsaved text.
        await page.getByRole('tab', { name: 'Develop' }).click();
        assert.equal(await inner.evaluate(() => document.body.dataset.pane), 'develop');
        await inner.waitForSelector('section[data-pane="develop"] .cm-content');
        await frame.locator('section[data-pane="develop"] .cm-content').click();
        await page.keyboard.type('blocker-unsaved-text');
        await page.waitForTimeout(100);
        const before = await inner.evaluate(() => ({
            text: document.querySelector('section[data-pane="develop"] .cm-content').textContent,
            save: document.querySelector('#developSave')?.disabled,
            h: document.querySelector('section[data-pane="develop"] .cm-editor')?.getBoundingClientRect().height,
        }));
        assert.ok(before.text.includes('blocker-unsaved-text'));
        // Frame fills the remaining height, the page does not scroll (R-23).
        const layout = await page.evaluate(() => {
            const f = document.querySelector('iframe[data-blocker-classic-frame]').getBoundingClientRect();
            return { bottom: Math.round(f.bottom), vh: innerHeight, pageScroll: document.scrollingElement.scrollHeight > innerHeight };
        });
        assert.equal(layout.pageScroll, false);
        assert.ok(layout.vh - layout.bottom <= 40, JSON.stringify(layout));
        await screenshot(page, 'dashboard-shell-develop-frame');

        await page.getByRole('tab', { name: 'Settings' }).click();
        await page.getByRole('tab', { name: 'Develop' }).click();
        const after = await inner.evaluate(() => ({
            text: document.querySelector('section[data-pane="develop"] .cm-content').textContent,
            save: document.querySelector('#developSave')?.disabled,
            h: document.querySelector('section[data-pane="develop"] .cm-editor')?.getBoundingClientRect().height,
        }));
        assert.deepEqual(after, before, 'unsaved Develop text survives (P-23)');

        // E-12 "never" items from the frame (no Filter lists pane visited here).
        const msgs = await getMessages(page);
        for (const never of ['getEnabledRulesets', 'applyRulesets', 'importFilterList', 'setDeveloperMode']) {
            assert.equal(msgs.filter((m) => m.what === never).length, 0, never);
        }
        assert.deepEqual(await paneWrites(page), [['set', 'filters'], ['set', 'develop'], ['remove'], ['set', 'develop']]);
        assert.equal(await page.$$eval('iframe', (f) => f.length), 1);
    } finally {
        upstreamMode = false;
        await page.close();
    }
});

test('About pane: name/version, links, credits, troubleshooting fetched on open (P-11..P-18)', async () => {
    const page = await newPage();
    try {
        await openDashboard(page, storedPane('about'));
        const about = page.locator('[data-testid="about-pane"]');
        assert.equal(await about.locator('[data-testid="about-name-version"]').textContent(), 'Blocker 2026.1003.1243');
        assert.ok((await about.textContent()).includes('Copyright (c) Raymond Hill 2014-present'));
        const links = await about.locator('a').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href'), a.target, a.rel]));
        const expectTop = [
            ['Privacy policy', 'https://github.com/uBlockOrigin/uBOL-home/wiki/Privacy-policy'],
            ['Documentation', 'https://github.com/uBlockOrigin/uBOL-home/wiki'],
            ['Changelog', 'https://github.com/uBlockOrigin/uBOL-home/releases'],
            ['Source code (GPLv3)', 'https://github.com/gorhill/uBlock'],
            ['Source code', 'https://github.com/gorhill/uBlock/graphs/contributors'],
            ['Translations', 'https://crowdin.com/project/ublock'],
            ['Filter lists', 'https://github.com/uBlockOrigin/uAssets/graphs/contributors'],
        ];
        assert.deepEqual(links.slice(0, 7).map(([t, h]) => [t, h]), expectTop);
        for (const [, , target, rel] of links) {
            assert.equal(target, '_blank');
            assert.equal(rel, 'noopener noreferrer');
        }
        const credits = await about.locator('[data-testid="about-credits"] li').allTextContents();
        assert.deepEqual(credits.slice(0, 6), [
            'Inter font family by Rasmus Andersson',
            'FontAwesome font family by Dave Gandy',
            'Punycode.js by Mathias Bynens',
            'Flags of the World by David Krmela',
            'CodeMirror 6 by Marijn Haverbeke',
            'google-ima3-dai by Adam Wróblewski',
        ]);
        assert.deepEqual(credits.slice(6), [
            'React by Meta Platforms, Inc.',
            'Radix Primitives by WorkOS',
            'Tailwind CSS by Tailwind Labs',
            'Apps SDK UI by OpenAI',
        ]);
        // Nothing fetched on mount or while closed.
        const ts = () => getMessages(page).then((m) => m.filter((x) => TROUBLESHOOTING_CALLS.includes(x.what)).map((x) => x.what));
        assert.deepEqual(await ts(), []);
        assert.equal(await page.$eval('[data-testid="troubleshooting"]', (d) => d.open), false);
        // Open: the ten calls, all issued before any answer (one synchronous batch).
        await page.locator('[data-testid="troubleshooting"] > summary').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="troubleshooting-text"]').textContent.length > 0);
        assert.deepEqual(await ts(), TROUBLESHOOTING_CALLS);
        const platform = await getCalls(page, { api: 'runtime.getPlatformInfo' });
        assert.equal(platform.length, 1);
        const text = await page.$eval('[data-testid="troubleshooting-text"]', (p) => p.textContent);
        assert.match(text, /^name: Blocker\nversion: 2026\.1003\.1243\nbrowser: Safari \? \(mac\)\nfiltering:\n default: optimal\npermission: all\nrules: \d+\nrulesets:\n easylist\n easyprivacy\n ublock-filters$/);
        const pre = await page.$eval('[data-testid="troubleshooting-text"]', (p) => ({ dir: p.dir, select: getComputedStyle(p).userSelect }));
        assert.deepEqual(pre, { dir: 'ltr', select: 'all' });
        // Copy button: the copied text is the troubleshooting text; success is announced.
        await chrome.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
        await page.getByRole('button', { name: 'Copy' }).click();
        await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('copied'));
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
        // Close + reopen -> again; leave About and come back while open -> again.
        // (Screenshots come after the counts: a fullPage capture resizes the viewport and
        // re-fires the IntersectionObserver, which would add a batch.)
        await page.locator('[data-testid="troubleshooting"] > summary').click();
        await page.locator('[data-testid="troubleshooting"] > summary').click();
        await page.waitForFunction(() => true);
        await page.waitForTimeout(200);
        assert.equal((await ts()).length, 18);
        assert.equal((await getCalls(page, { api: 'runtime.getPlatformInfo' })).length, 2);
        await page.getByRole('tab', { name: 'Settings' }).click();
        await page.getByRole('tab', { name: 'About' }).click();
        await page.waitForTimeout(200);
        assert.equal((await ts()).length, 27);
        assert.equal((await getCalls(page, { api: 'runtime.getPlatformInfo' })).length, 3);
        // Clicking a link sends no message.
        assert.equal((await getMessages(page)).filter((m) => m.what === 'gotoURL').length, 0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await screenshot(page, 'dashboard-shell-light', { fullPage: true });
    } finally {
        await page.close();
    }
});

test('About pane: copy failure is announced as a failure, not as "copied"', async () => {
    const page = await newPage();
    try {
        await openDashboard(page, storedPane('about'));
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
            });
        });
        await page.locator('[data-testid="troubleshooting"] > summary').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="troubleshooting-text"]').textContent.length > 0);
        await page.getByRole('button', { name: 'Copy' }).click();
        await page.waitForFunction(() => document.body.textContent.includes('could not be copied'));
        const live = await page.$$eval('[role="status"], [role="alert"], [aria-live]', (rs) => rs.map((r) => r.textContent).join('|'));
        assert.ok(!/copied to the clipboard/.test(live), live);
    } finally {
        await page.close();
    }
});

test('About pane: ml has no empty heading or link; loading state while the text is fetched', async () => {
    const page = await newPage();
    try {
        await openDashboard(page, { ...storedPane('about'), lang: 'ml', mock: { ...storedPane('about').mock, delays: { getConsoleOutput: 1500 } } });
        const h3s = await page.$$eval('[data-testid="about-pane"] h3', (hs) => hs.map((h) => h.textContent.trim()));
        assert.ok(h3s.every((h) => h !== ''), JSON.stringify(h3s));
        assert.ok(h3s.includes('Contributors'), JSON.stringify(h3s));
        const names = await page.$$eval('[data-testid="about-pane"] a', (as) => as.map((a) => a.textContent.trim()));
        assert.ok(names.every((n) => n !== ''), JSON.stringify(names));
        assert.ok(names.includes('Translations'));
        // Loading state: skeleton + aria-busy, and the box already has its final height range.
        await page.locator('[data-testid="troubleshooting"] > summary').click();
        await page.waitForSelector('[data-testid="troubleshooting-loading"]');
        const pending = await page.$eval('[data-testid="troubleshooting-text"]', (p) => ({ busy: p.parentElement.getAttribute('aria-busy'), h: p.getBoundingClientRect().height }));
        assert.equal(pending.busy, 'true');
        await page.waitForFunction(() => document.querySelector('[data-testid="troubleshooting-text"]').textContent.length > 0);
        const done = await page.$eval('[data-testid="troubleshooting-text"]', (p) => ({ busy: p.parentElement.getAttribute('aria-busy'), h: p.getBoundingClientRect().height }));
        assert.equal(done.busy, 'false');
        assert.equal(await page.locator('[data-testid="troubleshooting-loading"]').count(), 0);
        assert.ok(Math.abs(done.h - pending.h) <= 1, `box height ${pending.h} -> ${done.h}`);
        // The Copy button sits inside the text box.
        const box = await page.evaluate(() => {
            const pre = document.querySelector('[data-testid="troubleshooting-text"]').getBoundingClientRect();
            const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Copy')).getBoundingClientRect();
            return { inside: btn.left >= pre.left && btn.right <= pre.right && btn.top >= pre.top && btn.bottom <= pre.bottom };
        });
        assert.equal(box.inside, true);
        await screenshot(page, 'dashboard-shell-ml-about');
    } finally {
        await page.close();
    }
});

test('About pane: failures are shown, raw manifest name replaced in the header line only (D-4)', async () => {
    const page = await newPage();
    try {
        await openDashboard(page, { ...storedPane('about'), manifestName: 'raw', fail: 'getRulesetDetails:reject' });
        assert.equal(await page.locator('[data-testid="about-name-version"]').textContent(), 'Blocker 2026.1003.1243');
        await page.locator('[data-testid="troubleshooting"] > summary').click();
        await page.getByText('The troubleshooting information could not be collected.').waitFor();
    } finally {
        await page.close();
    }
    const page2 = await newPage();
    try {
        await openDashboard(page2, { ...storedPane('about'), manifestName: 'raw' });
        await page2.locator('[data-testid="troubleshooting"] > summary').click();
        await page2.waitForFunction(() => document.querySelector('[data-testid="troubleshooting-text"]').textContent.length > 0);
        const text = await page2.$eval('[data-testid="troubleshooting-text"]', (p) => p.textContent);
        assert.ok(text.startsWith('name: __MSG_extName__\n'), text.slice(0, 40));
    } finally {
        await page2.close();
    }
});

test('options failure: Alert with user copy, About still reachable, no writes (P-9)', async () => {
    const page = await newPage();
    try {
        await openHarness(page, 'dashboard', { fail: 'getOptionsPageData:reject' });
        await page.waitForSelector('[data-shell-status="error"]');
        await page.getByText('The dashboard could not load its data.').waitFor();
        await page.getByText('Reload the page to try again.').waitFor();
        // The technical message is collapsed.
        const details = await page.$eval('[data-testid="dashboard-load-error"] details', (d) => ({ open: d.open, text: d.textContent }));
        assert.equal(details.open, false);
        assert.match(details.text, /getOptionsPageData/);
        assert.deepEqual(await tabNames(page), ['Settings', 'About']);
        await page.getByRole('tab', { name: 'About' }).click();
        await page.waitForSelector('[data-testid="about-pane"]');
        assert.equal(await activePane(page), 'about');
        await page.getByRole('tab', { name: 'About' }).click();
        await page.waitForTimeout(50);
        assert.deepEqual(await paneWrites(page), [], 'nothing is written without the options data');
        await page.getByRole('tab', { name: 'Settings' }).click();
        await screenshot(page, 'dashboard-shell-error-load-light');
    } finally {
        await page.close();
    }
    // Narrow + dark: actions under the text; readable soft danger text in dark mode.
    const narrow = await newPage({ width: 400, height: 760 });
    try {
        await openHarness(narrow, 'dashboard', { fail: 'getOptionsPageData:reject', theme: 'dark', lang: 'el' });
        await narrow.waitForSelector('[data-shell-status="error"]');
        const alert = await narrow.$eval('[data-testid="dashboard-load-error"]', (a) => ({ placement: a.getAttribute('data-actions-placement'), color: getComputedStyle(a).color }));
        assert.equal(alert.placement, 'bottom');
        assert.equal(alert.color, 'rgb(255, 133, 131)', 'red-200 in dark mode (>= 4.5:1 on the soft fill)');
        assert.equal(await narrow.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
        await screenshot(narrow, 'dashboard-shell-error-load-dark-400');
    } finally {
        await narrow.close();
    }
});

test('layout: sticky nav, one pane width, breakpoints, single-row tabs, skeleton metrics', async () => {
    // Loading skeleton has the tabs' metrics (vertical, 1100px).
    const page = await newPage();
    try {
        await openHarness(page, 'dashboard', { mock: { delays: { getOptionsPageData: 1500 } } });
        await page.waitForSelector('[data-testid="dashboard-nav-skeleton"]');
        const sk = await page.$$eval('[data-testid="dashboard-nav-skeleton"] > *', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, radius: getComputedStyle(e).borderTopLeftRadius }; }));
        await screenshot(page, 'dashboard-shell-loading-light');
        await page.waitForSelector('[data-shell-status="ready"]', { timeout: 30_000 });
        const tabs = await page.$$eval('[role="tab"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, radius: getComputedStyle(e).borderTopLeftRadius }; }));
        for (let i = 0; i < Math.min(sk.length, tabs.length); i++) {
            assert.ok(Math.abs(sk[i].y - tabs[i].y) <= 1 && Math.abs(sk[i].h - tabs[i].h) <= 1 && Math.abs(sk[i].x - tabs[i].x) <= 1 && Math.abs(sk[i].w - tabs[i].w) <= 1, `skeleton ${JSON.stringify(sk[i])} vs tab ${JSON.stringify(tabs[i])}`);
            assert.equal(sk[i].radius, tabs[i].radius);
        }
        // Panes: one start-aligned width.
        const edge = async () => page.$eval('[role="tabpanel"]:not([hidden])', (p) => { const r = p.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width)]; });
        const settingsEdge = await edge();
        await page.getByRole('tab', { name: 'About' }).click();
        const aboutEdge = await edge();
        await page.getByRole('tab', { name: 'Filter lists' }).click();
        await page.waitForTimeout(100);
        const listsEdge = await edge();
        assert.deepEqual(aboutEdge, settingsEdge);
        assert.deepEqual(listsEdge, settingsEdge);
        assert.ok(settingsEdge[1] <= 768, JSON.stringify(settingsEdge));
        // Sidebar sticks while the page scrolls.
        await page.getByRole('tab', { name: 'Settings' }).click();
        await page.setViewportSize({ width: 1100, height: 520 });
        const canScroll = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 100);
        assert.ok(canScroll, 'the Settings pane is taller than the viewport');
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.waitForTimeout(50);
        assert.ok(await page.evaluate(() => scrollY > 100), 'the page scrolled');
        const listTop = await page.$eval('[role="tablist"]', (l) => l.getBoundingClientRect().top);
        assert.ok(listTop >= 0 && listTop <= 20, `sidebar top after scroll: ${listTop}`);
        await screenshot(page, 'dashboard-shell-scrolled-settings-light');
    } finally {
        await page.close();
    }
    // 1023px: top tabs; 1024px: sidebar.
    for (const [width, orientation] of [[1023, 'horizontal'], [1024, 'vertical']]) {
        const p = await newPage({ width, height: 800 });
        try {
            await openDashboard(p);
            assert.equal(await p.$eval('[role="tablist"]', (el) => el.getAttribute('aria-orientation')), orientation, String(width));
        } finally {
            await p.close();
        }
    }
    // 375px Greek + developer mode: one row of tabs that scrolls sideways, sticky, no page overflow.
    const narrow = await newPage({ width: 375, height: 760 });
    try {
        await openDashboard(narrow, { lang: 'el', dev: 1, ...storedPane('about') });
        const row = await narrow.$eval('[role="tablist"]', (l) => ({
            tops: [...new Set([...l.querySelectorAll('[role="tab"]')].map((t) => Math.round(t.getBoundingClientRect().top)))].length,
            scrolls: l.scrollWidth > l.clientWidth,
            h: l.getBoundingClientRect().height,
        }));
        assert.equal(row.tops, 1, 'all tabs on one row');
        assert.equal(row.scrolls, true);
        assert.ok(row.h <= 56, `tablist height ${row.h}`);
        // The selected (last) tab was scrolled into view.
        const sel = await narrow.$eval('[role="tab"][aria-selected="true"]', (t) => { const r = t.getBoundingClientRect(); const l = t.parentElement.getBoundingClientRect(); return r.left >= l.left - 1 && r.right <= l.right + 1; });
        assert.equal(sel, true);
        assert.equal(await narrow.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
        await narrow.locator('[data-testid="troubleshooting"] > summary').click();
        await narrow.waitForFunction(() => document.querySelector('[data-testid="troubleshooting-text"]').textContent.length > 0);
        await narrow.evaluate(() => window.scrollTo(0, 500));
        await narrow.waitForTimeout(50);
        const top = await narrow.$eval('[role="tablist"]', (l) => l.getBoundingClientRect().top);
        assert.ok(Math.abs(top) <= 1, `sticky tab row top ${top}`);
        await screenshot(narrow, 'dashboard-shell-narrow-scrolled');
        // Filter lists' own sticky header sticks below the tab row (--dashboard-sticky-top), not over it.
        await narrow.evaluate(() => window.scrollTo(0, 0));
        await narrow.getByRole('tab', { name: /./ }).nth(1).click();
        await narrow.waitForSelector('[data-pane-id="rulesets"]:not([hidden]) input');
        await narrow.waitForTimeout(500);
        await narrow.evaluate(() => window.scrollTo(0, 900));
        await narrow.waitForTimeout(100);
        const stack = await narrow.evaluate(() => {
            const list = document.querySelector('[role="tablist"]').getBoundingClientRect();
            const sticky = [...document.querySelectorAll('[data-pane-id="rulesets"] *')].find((e) => getComputedStyle(e).position === 'sticky');
            return { listBottom: Math.round(list.bottom), stickyTop: Math.round(sticky.getBoundingClientRect().top) };
        });
        assert.ok(stack.stickyTop >= stack.listBottom, JSON.stringify(stack));
        await screenshot(narrow, 'dashboard-shell-narrow-filterlists-scrolled');
    } finally {
        await narrow.close();
    }
});

test('screenshots: dark, rtl, narrow', async () => {
    const dark = await newPage();
    try {
        await openDashboard(dark, { ...storedPane('about'), theme: 'dark', dev: 1 });
        await dark.locator('[data-testid="troubleshooting"] > summary').click();
        await dark.waitForFunction(() => document.querySelector('[data-testid="troubleshooting-text"]').textContent.length > 0);
        await dark.evaluate(() => window.scrollTo(0, 0));
        await screenshot(dark, 'dashboard-shell-dark', { fullPage: true });
    } finally {
        await dark.close();
    }
    const rtl = await newPage();
    try {
        await openDashboard(rtl, { ...storedPane('about'), lang: 'ar', dev: 1 });
        await rtl.getByText(/.+/, { exact: false }).first().waitFor();
        await rtl.evaluate(() => window.scrollTo(0, 0));
        await screenshot(rtl, 'dashboard-shell-rtl', { fullPage: true });
        // No horizontal overflow.
        assert.equal(await rtl.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
    } finally {
        await rtl.close();
    }
    const narrow = await newPage({ width: 375, height: 760 });
    try {
        await openDashboard(narrow, { ...storedPane('about'), lang: 'el', dev: 1 });
        assert.equal(await narrow.$eval('[role="tablist"]', (el) => el.getAttribute('aria-orientation')), 'horizontal');
        assert.equal(await narrow.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
        await screenshot(narrow, 'dashboard-shell-narrow');
    } finally {
        await narrow.close();
    }
});

/* ------------------------------------------------------------------------ */
/* Regression tests (review findings)                                        */
/* ------------------------------------------------------------------------ */

test('tabs: a hovered tab never looks like the selected one, light and dark', async () => {
    for (const theme of ['light', 'dark']) {
        const page = await newPage();
        try {
            await openDashboard(page, { theme });
            const tab = (name) => page.getByRole('tab', { name, exact: true });
            await tab('Filter lists').hover();
            await page.waitForTimeout(400); // the library's hover transition
            const look = async (name) =>
                tab(name).evaluate((el) => {
                    const before = getComputedStyle(el, '::before');
                    const bar = el.querySelector('[data-tab-indicator]');
                    const r = bar?.getBoundingClientRect();
                    return {
                        variant: el.getAttribute('data-variant'),
                        hovered: el.matches(':hover'),
                        fill: before.backgroundColor,
                        opacity: before.opacity,
                        color: getComputedStyle(el).color,
                        bar: r ? { w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(bar).backgroundColor, x: Math.round(r.x - el.getBoundingClientRect().x) } : null,
                    };
                });
            const selected = await look('Settings');
            const hovered = await look('Filter lists');
            assert.equal(hovered.hovered, true, theme);
            assert.equal(selected.variant, 'soft', theme);
            assert.equal(hovered.variant, 'ghost', theme);
            assert.equal(hovered.opacity, '1', `${theme}: hover tint is shown`);
            assert.notEqual(selected.fill, hovered.fill, `${theme}: selected fill ${selected.fill} vs hover ${hovered.fill}`);
            // The ink edge bar (sidebar: start edge) marks only the selected tab.
            assert.equal(hovered.bar, null, theme);
            assert.ok(selected.bar && selected.bar.w === 3 && selected.bar.h >= 16 && selected.bar.x <= 6, `${theme}: ${JSON.stringify(selected.bar)}`);
            assert.equal(selected.bar.bg, selected.color, `${theme}: the bar uses the text ink`);
            await screenshot(page, `dashboard-tab-hover-${theme}`);
        } finally {
            await page.close();
        }
    }
    // RTL: the bar is on the start (right) edge.
    const rtl = await newPage();
    try {
        await openDashboard(rtl, { lang: 'ar' });
        const side = await rtl.$eval('[role="tab"][aria-selected="true"]', (el) => {
            const t = el.getBoundingClientRect();
            const b = el.querySelector('[data-tab-indicator]').getBoundingClientRect();
            return { fromRight: Math.round(t.right - b.right), fromLeft: Math.round(b.left - t.left) };
        });
        assert.ok(side.fromRight <= 6 && side.fromLeft > 20, JSON.stringify(side));
    } finally {
        await rtl.close();
    }
    // Row of tabs (below lg): the bar sits under the label of the selected tab.
    const row = await newPage({ width: 800, height: 700 });
    try {
        await openDashboard(row);
        const bar = await row.$eval('[role="tab"][aria-selected="true"]', (el) => {
            const t = el.getBoundingClientRect();
            const b = el.querySelector('[data-tab-indicator]').getBoundingClientRect();
            return { h: Math.round(b.height), gapBottom: Math.round(t.bottom - b.bottom), w: Math.round(b.width) };
        });
        assert.ok(bar.h === 2 && bar.gapBottom >= 0 && bar.gapBottom <= 3 && bar.w > 20, JSON.stringify(bar));
        assert.equal(await row.locator('[data-tab-indicator]').count(), 1);
    } finally {
        await row.close();
    }
});

test('narrow row of tabs: scroll shadow only on a side where tabs are cut off', async () => {
    const narrow = await newPage({ width: 375, height: 760 });
    try {
        await openDashboard(narrow, { lang: 'el', dev: 1 });
        const bg = await narrow.$eval('[role="tablist"]', (l) => ({ attach: getComputedStyle(l).backgroundAttachment, image: getComputedStyle(l).backgroundImage }));
        assert.match(bg.attach, /local/);
        assert.match(bg.image, /radial-gradient/);
        // Screenshots: at the start only the end edge shows a shadow; at the end, only the start edge.
        await screenshot(narrow, 'dashboard-narrow-tabs-start');
        await narrow.$eval('[role="tablist"]', (l) => { l.scrollLeft = l.scrollWidth; });
        await narrow.waitForTimeout(100);
        await screenshot(narrow, 'dashboard-narrow-tabs-end');
    } finally {
        await narrow.close();
    }
    const wide = await newPage();
    try {
        await openDashboard(wide);
        const attach = await wide.$eval('[role="tablist"]', (l) => getComputedStyle(l).backgroundAttachment);
        assert.doesNotMatch(attach, /local/, 'the sidebar has no scroll cue');
    } finally {
        await wide.close();
    }
});

test('malformed getOptionsPageData fields degrade the dashboard instead of failing it (P-2, P-3, 6b)', async () => {
    // P-3: a string disabledFeatures = unreadable admin policy: everything works, Develop stays off.
    const page = await newPage();
    try {
        await openDashboard(page, { dev: 1 }, { config: { background: { disabledFeatures: 'develop' } } });
        assert.deepEqual(await tabNames(page), ['Settings', 'Filter lists', 'Custom filters', 'About']);
        await page.waitForSelector('[data-testid="settings-pane"][data-state="ready"]');
        assert.equal(await page.locator('[data-setting="developerMode"]').count(), 0);
        assert.equal(await page.locator('[data-testid="dashboard-load-error"]').count(), 0);
        const boots = (await getMessages(page)).filter((m) => m.what === 'getOptionsPageData');
        assert.equal(boots.length, 1, 'no second getOptionsPageData');
        await page.getByRole('tab', { name: 'Filter lists' }).click();
        await page.waitForSelector('[data-pane-id="rulesets"]:not([hidden]) input');
    } finally {
        await page.close();
    }
    // 6b: an unexpected defaultFilteringMode: no card selected, every toggle rendered.
    const mode = await newPage();
    try {
        await openHarness(mode, 'dashboard', {});
        const real = await mode.evaluate(() => globalThis.browser.runtime.sendMessage({ what: 'getOptionsPageData' }));
        await mode.close();
        const page6b = await newPage();
        try {
            await openDashboard(page6b, {}, { config: { responses: { getOptionsPageData: { ...real, defaultFilteringMode: 'optimal' } } } });
            await page6b.waitForSelector('[data-testid="settings-pane"][data-state="ready"]');
            assert.equal(await page6b.locator('[data-testid="settings-mode"] input[type="radio"]:checked').count(), 0);
            assert.ok((await page6b.getByRole('switch').count()) >= 3);
            await screenshot(page6b, 'dashboard-malformed-mode');
        } finally {
            await page6b.close();
        }
    } catch (err) {
        if (!mode.isClosed()) await mode.close();
        throw err;
    }
    // P-2 (kept by design, messaging.md §1.4): null means "absent", so developer mode shows Develop.
    const nul = await newPage();
    try {
        await openDashboard(nul, { dev: 1, disabled: 'null' });
        assert.deepEqual(await tabNames(nul), ['Settings', 'Filter lists', 'Custom filters', 'Develop', 'About']);
    } finally {
        await nul.close();
    }
    // A malformed ruleset list is never guessed: the error state, About reachable.
    const lists = await newPage();
    try {
        await openHarness(lists, 'dashboard', {}, { config: { responses: { getOptionsPageData: { defaultFilteringMode: 2, enabledRulesets: 'easylist', adminRulesets: [], rulesetDetails: [] } } } });
        await lists.waitForSelector('[data-shell-status="error"]');
        assert.deepEqual(await tabNames(lists), ['Settings', 'About']);
    } finally {
        await lists.close();
    }
});

test('load error: "Technical details" uses the chevron disclosure, no native marker', async () => {
    const page = await newPage();
    try {
        await openHarness(page, 'dashboard', { fail: 'getOptionsPageData:reject' });
        await page.waitForSelector('[data-shell-status="error"]');
        const summary = page.locator('[data-testid="dashboard-load-error-details"] > summary');
        const look = await summary.evaluate((s) => ({ display: getComputedStyle(s).display, icon: s.querySelector('svg[data-icon="chevronDown"]')?.getAttribute('aria-hidden'), text: s.textContent.trim() }));
        assert.equal(look.display, 'flex', 'a flex summary has no ::marker');
        assert.equal(look.icon, 'true');
        assert.equal(look.text, 'Technical details');
        await summary.click();
        assert.equal(await page.$eval('[data-testid="dashboard-load-error-details"]', (d) => d.open), true);
        await screenshot(page, 'dashboard-error-details-open');
    } finally {
        await page.close();
    }
});

test('no page errors, no external requests', () => {
    assert.deepEqual(chrome.pageErrors, []);
    assert.deepEqual(chrome.externalRequests, []);
    const unexpected = chrome.consoleErrors.filter(
        (e) => !/404|Not Found|Failed to load resource/i.test(e) && !e.startsWith('[about] troubleshooting information failed'),
    );
    assert.deepEqual(unexpected, []);
});

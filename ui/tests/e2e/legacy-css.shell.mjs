/**
 * The generated css/default.css inside the REAL React dashboard (harness build)
 * with the upstream classic page in its frame (docs/specs/legacy-tokens.md 6.2,
 * 6.5, parity line L-17).
 *
 *   npm run build:harness && node --test tests/e2e/legacy-css.shell.mjs
 *   (BLOCKER_HARNESS_DIR / BLOCKER_SCREENSHOT_DIR for private builds)
 *
 * Same frame set-up as tests/e2e/dashboard.shell.mjs "upstream" mode
 * (dashboard-classic.html, js/, css/, lib/, _locales/ from PRISTINE, child
 * frames get the parent's mock browser), but css/default.css is the file
 * generated from the current sources, not PRISTINE + the R-18 rules.
 * BLOCKER_LEGACY_CSS_FILE=<file> serves that file instead (e.g. a staged
 * css/default.css, or an older build to see these checks fail).
 * Screenshots (build/screenshots): legacy-shell-*.png.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { generateLegacyCss } from '../../src/styles/legacy/generate.mjs';
import { readGeneratorInputs } from '../../src/styles/legacy/sources.mjs';
import {
    DASHBOARD_VIEWPORT,
    getCalls,
    HARNESS_DIR,
    launchChrome,
    openHarness,
    screenshot,
    startStaticServer,
} from './helpers/index.mjs';
import { PRISTINE_DIR as PRISTINE } from './lib/harness.mjs';
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

let server;
let generatedCss;
const chromes = [];

function upstreamFile(pathname) {
    if (pathname === '/dashboard-classic.html') return path.join(PRISTINE, 'dashboard.html');
    if (/^\/(js|css|lib|_locales|img)\//.test(pathname)) return path.join(PRISTINE, pathname);
    return null;
}

/** A Chrome whose context serves the upstream frame files and the generated css. */
async function chromeFor(colorScheme) {
    const chrome = await launchChrome({ viewport: DASHBOARD_VIEWPORT, colorScheme, deviceScaleFactor: 1 });
    chromes.push(chrome);
    const fontRequests = [];
    chrome.context.on('request', (r) => { if (/\/css\/fonts\//.test(r.url())) fontRequests.push(r.url()); });
    await chrome.context.route(
        (url) => upstreamFile(new URL(url).pathname) !== null,
        async (route) => {
            const p = new URL(route.request().url()).pathname;
            if (p === '/css/default.css') {
                await route.fulfill({ status: 200, contentType: TYPES['.css'], body: generatedCss });
                return;
            }
            const file = upstreamFile(p);
            if (file === null || !existsSync(file)) {
                await route.fulfill({ status: 404, body: 'not found' });
                return;
            }
            await route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
        },
    );
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
    return { chrome, fontRequests };
}

before(async () => {
    assert.ok(existsSync(PRISTINE), `PRISTINE missing: ${PRISTINE}`);
    assert.ok(existsSync(path.join(HARNESS_DIR, 'dashboard.html')), `harness not built at ${HARNESS_DIR} (npm run build:harness)`);
    generatedCss = process.env.BLOCKER_LEGACY_CSS_FILE
        ? readFileSync(path.resolve(process.env.BLOCKER_LEGACY_CSS_FILE), 'utf8')
        : generateLegacyCss(readGeneratorInputs().inputs).css;
    server = await startStaticServer(HARNESS_DIR);
});

after(async () => {
    for (const c of chromes) await c.close();
    await server?.close();
});

async function openShell(chrome, params) {
    const page = await chrome.context.newPage();
    await page.setViewportSize(DASHBOARD_VIEWPORT);
    await openHarness(page, 'dashboard', { dev: 1, ...params }, { baseURL: server.url });
    await page.waitForSelector('[data-shell-status="ready"]', { timeout: 30_000 });
    return page;
}

/** Inline-start edge (left in LTR, right in RTL) and width of an element, in page coordinates. */
const edgesOf = (rect, rtl) => ({ start: Math.round(rtl ? rect.right : rect.left), width: Math.round(rect.width) });

async function reactPaneEdges(page, rtl) {
    const rect = await page.$eval('[data-pane-id="settings"]', (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
    });
    return edgesOf(rect, rtl);
}

/** Selects a pane by id (tab names are localised). */
const selectPane = (page, id) => page.click(`[role="tab"][id$="-trigger-${id}"]`);

async function openClassic(page, id) {
    await selectPane(page, id);
    await page.waitForSelector('[data-classic-frame-status="ready"]', { timeout: 30_000 });
    const handle = await page.$('iframe[data-blocker-classic-frame]');
    const frame = await handle.contentFrame();
    return { handle, frame };
}

async function classicSectionEdges(handle, frame, pane, rtl) {
    const box = await handle.boundingBox();
    const r = await frame.$eval(`section[data-pane="${pane}"]`, (el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // Content box: where the text starts (sections have 4px inline padding upstream).
        const ps = parseFloat(cs.paddingInlineStart);
        const pe = parseFloat(cs.paddingInlineEnd);
        const rtlDoc = getComputedStyle(document.body).direction === 'rtl';
        return {
            left: b.left + (rtlDoc ? pe : ps),
            right: b.right - (rtlDoc ? ps : pe),
            width: b.width,
            display: cs.display,
        };
    });
    return { ...edgesOf({ left: box.x + r.left, right: box.x + r.right, width: r.width }, rtl), display: r.display };
}

for (const [label, scheme, params] of [
    ['light', 'light', {}],
    ['dark', 'dark', {}],
    ['rtl-ar', 'light', { lang: 'ar' }],
]) {
    test(`L-17 (${label}): classic Custom filters and Develop start where the React panes start, 48rem max, header and nav hidden`, async () => {
        const rtl = label.startsWith('rtl');
        const { chrome, fontRequests } = await chromeFor(scheme);
        const page = await openShell(chrome, params);
        try {
            const react = await reactPaneEdges(page, rtl);
            assert.ok(react.width > 0 && react.width <= 768, `React pane width ${react.width}`);

            const { handle, frame } = await openClassic(page, 'filters');
            const embed = await frame.evaluate(() => ({
                marker: document.documentElement.getAttribute('data-blocker-embed'),
                header: getComputedStyle(document.querySelector('body > header')).display,
                navFocusable: [...document.querySelectorAll('#dashboard-nav .tabButton')].some((b) => b.getClientRects().length > 0),
                bodyAlign: getComputedStyle(document.body).alignItems,
                dir: getComputedStyle(document.body).direction,
            }));
            assert.equal(embed.marker, 'classic-dashboard');
            assert.equal(embed.header, 'none');
            assert.equal(embed.navFocusable, false);
            assert.equal(embed.bodyAlign, 'flex-start');
            assert.equal(embed.dir, rtl ? 'rtl' : 'ltr');

            const filters = await classicSectionEdges(handle, frame, 'filters', rtl);
            assert.equal(filters.display, 'block');
            assert.ok(Math.abs(filters.start - react.start) <= 4, `filters start ${filters.start} vs React ${react.start} (${label})`);
            assert.ok(filters.width <= 768 && filters.width >= Math.min(react.width, 768) - 8, `filters width ${filters.width} vs React ${react.width}`);
            await screenshot(page, `legacy-shell-filters-${label}`, { animations: 'disabled' });

            // Develop: same column, same frame.
            await selectPane(page, 'develop');
            await frame.waitForFunction(() => document.body.dataset.pane === 'develop', null, { timeout: 10_000 });
            await frame.waitForSelector('section[data-pane="develop"] .cm-editor .cm-line', { timeout: 30_000 });
            const develop = await classicSectionEdges(handle, frame, 'develop', rtl);
            assert.equal(develop.display, 'block');
            assert.ok(Math.abs(develop.start - react.start) <= 4, `develop start ${develop.start} vs React ${react.start} (${label})`);
            if (rtl) {
                // B7: the gutter separator is on the text side of a right-hand gutter.
                const g = await frame.$eval('section[data-pane="develop"] .cm-gutters', (el) => {
                    const cs = getComputedStyle(el);
                    const gutter = el.getBoundingClientRect();
                    const content = el.parentElement.querySelector('.cm-content').getBoundingClientRect();
                    return { left: cs.borderLeftWidth, right: cs.borderRightWidth, gutterRight: gutter.left > content.left };
                });
                assert.deepEqual(g, { left: '1px', right: '0px', gutterRight: true }, 'RTL gutter separator');
            }
            // Keyboard focus into the editor: the B7 outline, not CodeMirror's dotted one.
            await frame.click('section[data-pane="develop"] .cm-content');
            const outline = await frame.$eval('section[data-pane="develop"] .cm-editor', (el) => {
                const cs = getComputedStyle(el);
                return [el.classList.contains('cm-focused'), cs.outlineStyle, cs.outlineWidth, cs.outlineColor];
            });
            assert.deepEqual(outline, [true, 'solid', '2px', scheme === 'dark' ? 'rgb(51, 156, 255)' : 'rgb(1, 105, 204)']);
            await screenshot(page, `legacy-shell-develop-${label}`, { animations: 'disabled' });
            assert.deepEqual(fontRequests, [], 'no font requests');
            // Nothing in the frame wrote the pane key (the nav is hidden; R-20 guard never needed).
            const removes = await getCalls(page, { api: 'storage.local.remove' });
            assert.deepEqual(removes, [], JSON.stringify(removes));
        } finally {
            await page.close();
        }
    });
}

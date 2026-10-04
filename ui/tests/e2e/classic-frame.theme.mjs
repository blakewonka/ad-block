/**
 * Live OS theme switch with the classic frame open (dashboard-shell.md P-32,
 * legacy-tokens.md 6.4, review finding V4 of the legacy CSS).
 *
 *   npm run build:harness && node --test tests/e2e/classic-frame.theme.mjs
 *   (BLOCKER_HARNESS_DIR / BLOCKER_SCREENSHOT_DIR for private builds)
 *
 * The REAL React dashboard (harness build) embeds the REAL upstream classic
 * page: dashboard-classic.html, js/, css/, lib/, _locales/ and img/ come from
 * PRISTINE, css/default.css is the file generated from the current sources
 * (same set-up as tests/e2e/legacy-css.shell.mjs; child frames get the
 * parent's mock browser). BLOCKER_LEGACY_CSS_FILE=<file> serves that file
 * instead (e.g. a staged css/default.css).
 *
 * For each direction the page loads in one scheme, the Develop editor gets
 * unsaved text, then `page.emulateMedia({ colorScheme })` switches the OS
 * scheme live. The frame must follow the shell (classes as upstream theme.js
 * sets them, color-scheme for native controls) and match a frame that was
 * LOADED in the new scheme, without being reloaded (the unsaved text and a
 * window sentinel survive).
 * Screenshots (build/screenshots): classic-frame-theme-*.png.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { generateLegacyCss } from '../../src/styles/legacy/generate.mjs';
import { readGeneratorInputs } from '../../src/styles/legacy/sources.mjs';
import { DASHBOARD_VIEWPORT, HARNESS_DIR, launchChrome, openHarness, screenshot, startStaticServer } from './helpers/index.mjs';
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
const PROBE_TEXT = 'blocker-theme-probe';

let server;
let generatedCss;
const chromes = [];

function upstreamFile(pathname) {
    if (pathname === '/dashboard-classic.html') return path.join(PRISTINE, 'dashboard.html');
    if (/^\/(js|css|lib|_locales|img)\//.test(pathname)) return path.join(PRISTINE, pathname);
    return null;
}

async function chromeFor(colorScheme) {
    const chrome = await launchChrome({ viewport: DASHBOARD_VIEWPORT, colorScheme, deviceScaleFactor: 1 });
    chromes.push(chrome);
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
    return chrome;
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

const selectPane = (page, id) => page.click(`[role="tab"][id$="-trigger-${id}"]`);

/** Opens the shell, then the Develop pane; returns the classic frame once its editor exists. */
async function openDevelop(chrome) {
    const page = await chrome.context.newPage();
    await page.setViewportSize(DASHBOARD_VIEWPORT);
    await openHarness(page, 'dashboard', { dev: 1 }, { baseURL: server.url });
    await page.waitForSelector('[data-shell-status="ready"]', { timeout: 30_000 });
    await selectPane(page, 'develop');
    await page.waitForSelector('[data-classic-frame-status="ready"]', { timeout: 30_000 });
    const frame = await (await page.$('iframe[data-blocker-classic-frame]')).contentFrame();
    await frame.waitForFunction(() => document.body.dataset.pane === 'develop', null, { timeout: 10_000 });
    await frame.waitForSelector('section[data-pane="develop"] .cm-editor .cm-line', { timeout: 30_000 });
    return { page, frame };
}

/** Types unsaved text at the end of the Develop editor (also used to compare token colours with the reference). */
async function typeProbe(page, frame) {
    await frame.click('section[data-pane="develop"] .cm-content');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(`\n${PROBE_TEXT}`);
    await frame.waitForFunction((t) => document.querySelector('section[data-pane="develop"] .cm-content').textContent.includes(t), PROBE_TEXT);
    // The probe line is not valid there: upstream marks it `.badline` after its async validation. Wait for it so
    // both snapshots see the same decorations.
    await frame.waitForSelector('section[data-pane="develop"] .cm-line.badline', { timeout: 10_000 });
}

/** Everything the theme decides, inside the frame and in the shell around it. */
async function snapshot(page, frame) {
    const shell = await page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        body: getComputedStyle(document.body).backgroundColor,
    }));
    const inFrame = await frame.evaluate(() => {
        const root = document.documentElement;
        const cs = (sel) => {
            const el = document.querySelector(sel);
            return el === null ? null : getComputedStyle(el);
        };
        const editor = cs('section[data-pane="develop"] .cm-editor');
        const gutters = cs('section[data-pane="develop"] .cm-gutters');
        const select = cs('section[data-pane="develop"] select');
        return {
            dark: root.classList.contains('dark'),
            light: root.classList.contains('light'),
            colorScheme: getComputedStyle(root).colorScheme,
            body: getComputedStyle(document.body).backgroundColor,
            bodyInk: getComputedStyle(document.body).color,
            editorBg: editor?.backgroundColor ?? null,
            gutterBg: gutters?.backgroundColor ?? null,
            gutterInk: gutters?.color ?? null,
            selectScheme: select?.colorScheme ?? null,
            selectBg: select?.backgroundColor ?? null,
            editorInk: editor?.color ?? null,
            // Ink of every distinct token class in the editor text (YAML-like keys, values, the probe line).
            tokens: Object.fromEntries(
                [...document.querySelectorAll('section[data-pane="develop"] .cm-line, section[data-pane="develop"] .cm-line span')]
                    .map((el) => [`${el.tagName}.${[...el.classList].filter((c) => !/^ͼ/.test(c)).join('.')}`, getComputedStyle(el).color])
                    .sort(),
            ),
            lineBgs: [...new Set([...document.querySelectorAll('section[data-pane="develop"] .cm-line')].map((el) => `${el.className.replace(/ͼ\w+/g, '')}=${getComputedStyle(el).backgroundColor}`))].sort(),
        };
    });
    return { shell, frame: inFrame };
}

for (const [from, to] of [
    ['light', 'dark'],
    ['dark', 'light'],
]) {
    test(`P-32 / V4: OS ${from} -> ${to} while the classic frame is open: the frame follows the shell live, without a reload`, async () => {
        // Reference: a frame LOADED in the target scheme.
        const refChrome = await chromeFor(to);
        const ref = await openDevelop(refChrome);
        await typeProbe(ref.page, ref.frame);
        const expected = await snapshot(ref.page, ref.frame);
        await ref.page.close();
        assert.equal(expected.frame[to], true, `reference frame has .${to}`);

        const chrome = await chromeFor(from);
        const { page, frame } = await openDevelop(chrome);
        try {
            const before = await snapshot(page, frame);
            assert.equal(before.shell.theme, from);
            assert.equal(before.frame[from], true, `frame starts .${from}`);
            assert.equal(before.frame.colorScheme, from);
            assert.notEqual(before.frame.body, expected.frame.body, 'the two schemes differ (sanity)');

            // Unsaved editor text and a sentinel: both must survive (no reload, R-21).
            await frame.evaluate(() => { window.__blockerNoReload = 1; });
            await typeProbe(page, frame);

            await page.emulateMedia({ colorScheme: to });
            await page.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, to, { timeout: 5_000 });
            await frame.waitForFunction((t) => document.documentElement.classList.contains(t), to, { timeout: 5_000 });

            const now = await snapshot(page, frame);
            if (process.env.BLOCKER_THEME_DEBUG) console.log(JSON.stringify({ from, to, before, now, expected }, null, 1));
            assert.equal(now.shell.theme, to);
            assert.equal(now.frame[to], true, `frame html has .${to}`);
            assert.equal(now.frame[from], false, `frame html lost .${from}`);
            assert.equal(now.frame.colorScheme, to, 'frame color-scheme follows (native controls, scrollbars)');
            assert.equal(now.frame.selectScheme, to, 'native select follows');
            // Same colours as a frame loaded in the new scheme.
            assert.equal(now.frame.body, expected.frame.body, 'frame body background');
            assert.equal(now.frame.bodyInk, expected.frame.bodyInk, 'frame body ink');
            assert.equal(now.frame.editorBg, expected.frame.editorBg, 'editor background');
            assert.equal(now.frame.editorInk, expected.frame.editorInk, 'editor ink');
            assert.deepEqual(now.frame.tokens, expected.frame.tokens, 'editor text and token inks');
            assert.deepEqual(now.frame.lineBgs, expected.frame.lineBgs, 'editor line backgrounds (active line, bad line)');
            assert.equal(now.frame.gutterBg, expected.frame.gutterBg, 'editor gutter background');
            assert.equal(now.frame.gutterInk, expected.frame.gutterInk, 'editor gutter ink');
            assert.equal(now.frame.selectBg, expected.frame.selectBg, 'native select background');
            assert.equal(now.shell.body, expected.shell.body, 'shell body background');

            // Not reloaded: sentinel and unsaved text are still there.
            const kept = await frame.evaluate((t) => ({
                sentinel: window.__blockerNoReload,
                text: document.querySelector('section[data-pane="develop"] .cm-content').textContent.includes(t),
            }), PROBE_TEXT);
            assert.deepEqual(kept, { sentinel: 1, text: true });

            await page.mouse.click(5, 5);
            await screenshot(page, `classic-frame-theme-develop-${from}-to-${to}`, { animations: 'disabled' });

            // Custom filters, same frame, same (new) scheme.
            await selectPane(page, 'filters');
            await frame.waitForFunction(() => document.body.dataset.pane === 'filters', null, { timeout: 10_000 });
            const filters = await frame.evaluate(() => ({
                body: getComputedStyle(document.body).backgroundColor,
                section: getComputedStyle(document.querySelector('section[data-pane="filters"]')).display,
            }));
            assert.deepEqual(filters, { body: expected.frame.body, section: 'block' });
            await screenshot(page, `classic-frame-theme-filters-${from}-to-${to}`, { animations: 'disabled' });

            // And back: the frame follows the second switch too.
            await page.emulateMedia({ colorScheme: from });
            await frame.waitForFunction((t) => document.documentElement.classList.contains(t), from, { timeout: 5_000 });
            const back = await snapshot(page, frame);
            assert.equal(back.frame.body, before.frame.body, 'frame body background after switching back');
            assert.equal(back.frame.colorScheme, from);
            assert.equal(await frame.evaluate(() => window.__blockerNoReload), 1);
        } finally {
            await page.close();
        }
    });
}

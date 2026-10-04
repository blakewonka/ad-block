/**
 * Container window in headless system Chrome (docs/specs/container.md §12.3).
 *
 * The built page is served from a folder shaped like the app's
 * Contents/Resources (Base.lproj/Main.html next to ../Script.js, ../Style.css
 * and ../Icon.png = PRISTINE/img/icon_512.png), at the window size 425 x 325,
 * under its own meta CSP `default-src 'self'` (Chrome enforces it like WebKit;
 * it is a proxy, not a substitute for WKWebView).
 *
 *   npm run build:container && node --test tests/e2e/container.browser.mjs
 *   BLOCKER_CONTAINER_DIR=<private build> BLOCKER_SCREENSHOT_DIR=<dir> node --test tests/e2e/container.browser.mjs
 *
 * Screenshots (build/screenshots): container-{light,dark}-{unknown,on,off}.png,
 * container-light-preferences-unknown.png, container-{light,dark}-fallback-focus.png,
 * container-light-doublelen.png.
 */
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { CONTAINER_DIR, FIRST_RENDER_TIMEOUT, launchChrome, screenshotPath, startStaticServer, UI_ROOT } from './lib/harness.mjs';

/** Window picture (Resources/Icon.png): the committed app-window icon. */
const ICON = path.resolve(UI_ROOT, '../assets/icons/app-window/Icon.png');
const HAVE_BUILD = existsSync(path.join(CONTAINER_DIR, 'Script.js'));
const skip = HAVE_BUILD ? false : `container build not found at ${CONTAINER_DIR} (run npm run build:container)`;

const WINDOW = Object.freeze({ width: 425, height: 325 });
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const T = {
    prefs: {
        unknown: 'You can turn on Blocker’s extension in Safari Extensions preferences.',
        on: 'Blocker’s extension is currently on. You can turn it off in Safari Extensions preferences.',
        off: 'Blocker’s extension is currently off. You can turn it on in Safari Extensions preferences.',
        button: 'Quit and Open Safari Extensions Preferences…',
    },
    settings: {
        unknown: 'You can turn on Blocker’s extension in the Extensions section of Safari Settings.',
        on: 'Blocker’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.',
        off: 'Blocker’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.',
        button: 'Quit and Open Safari Settings…',
    },
};
const SENTENCES = [T.prefs.unknown, T.prefs.on, T.prefs.off, T.settings.unknown, T.settings.on, T.settings.off];

/**
 * Runs in the page before any of its scripts (document start), like the WKWebView
 * probe of spec Appendix A: records CSP violations, errors, the order in which
 * `window.show` is assigned vs React's scheduler initialising (it constructs a
 * MessageChannel at module evaluation), optionally installs the webkit stub
 * (present at evaluation, as in the app) and optionally calls show() the moment
 * it is assigned (`?early=<enabled>,<useSettings>`), i.e. before React exists.
 */
function initScript() {
    const probe = (window.__probe = { csp: [], errors: [], order: [], posted: [] });
    document.addEventListener('securitypolicyviolation', (e) =>
        probe.csp.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile || ''}:${e.lineNumber || ''}`),
    );
    window.addEventListener('error', (e) => probe.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => probe.errors.push(`unhandledrejection ${String(e.reason)}`));

    const params = new URLSearchParams(location.search);
    if (params.get('webkit') !== '0') {
        window.webkit = { messageHandlers: { controller: { postMessage: (m) => probe.posted.push(m) } } };
    }
    const early = params.get('early');
    let showFn;
    Object.defineProperty(window, 'show', {
        configurable: true,
        enumerable: true,
        get: () => showFn,
        set: (fn) => {
            showFn = fn;
            probe.order.push('show');
            if (early !== null && typeof fn === 'function') {
                const [enabled, settings] = early.split(',');
                const parse = (v) => (v === 'true' ? true : v === 'false' ? false : undefined);
                probe.earlyResult = fn(parse(enabled), parse(settings));
            }
        },
    });
    // ?fail=1: the first window 'error' listener the PAGE adds is mount()'s pre-mount
    // watch; fire an error right after Script.js finishes evaluating (a microtask,
    // before React's first commit), so the real bundle takes its plain-DOM fallback.
    if (params.get('fail') === '1') {
        const add = window.addEventListener;
        let forced = false;
        window.addEventListener = function (type, listener, options) {
            add.call(this, type, listener, options);
            if (type === 'error' && !forced) {
                forced = true;
                queueMicrotask(() => window.dispatchEvent(new ErrorEvent('error', { message: 'forced pre-mount failure' })));
            }
        };
    }
    const MC = window.MessageChannel;
    window.MessageChannel = class extends MC {
        constructor() {
            super();
            if (!probe.order.some((o) => o.startsWith('MessageChannel'))) {
                probe.order.push(`MessageChannel theme=${document.documentElement.getAttribute('data-theme')}`);
            }
        }
    };
}

/** @type {string} */
let resources;
/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof launchChrome>>} */
let chrome;

before(async () => {
    if (!HAVE_BUILD) return;
    // Contents/Resources-shaped copy of the build (+ the converter's Icon.png).
    resources = mkdtempSync(path.join(os.tmpdir(), 'blocker-container-'));
    cpSync(CONTAINER_DIR, resources, { recursive: true });
    assert.ok(existsSync(ICON), `icon not found at ${ICON}`);
    copyFileSync(ICON, path.join(resources, 'Icon.png'));
    server = await startStaticServer(resources);
    chrome = await launchChrome({ viewport: WINDOW });
});

after(async () => {
    await chrome?.close();
    await server?.close();
    if (resources) rmSync(resources, { recursive: true, force: true });
});

/**
 * Opens the page in a fresh context (own colour scheme), returns helpers.
 * @param {{ scheme?: 'light' | 'dark', query?: string }} [options]
 */
async function openWindow({ scheme = 'light', query = '' } = {}) {
    const context = await chrome.browser.newContext({
        viewport: WINDOW,
        colorScheme: scheme,
        deviceScaleFactor: 2,
        serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const badResponses = [];
    const foreignRequests = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
        if (r.status() >= 400) badResponses.push(`${r.url()} ${r.status()}`);
    });
    page.on('request', (r) => {
        if (!r.url().startsWith(server.url + '/')) foreignRequests.push(r.url());
    });
    await page.addInitScript(initScript);
    await page.goto(`${server.url}/Base.lproj/Main.html${query}`, { waitUntil: 'load' });
    await page.locator('button').first().waitFor({ state: 'visible', timeout: FIRST_RENDER_TIMEOUT });

    const probe = () => page.evaluate(() => window.__probe);
    const state = () =>
        page.evaluate((sentences) => {
            const text = document.body.textContent ?? '';
            const status = document.querySelector('[role="status"]');
            return {
                sentences: sentences.filter((s) => text.includes(s)),
                status: status?.textContent ?? null,
                live: status?.getAttribute('aria-live') ?? null,
                buttons: [...document.querySelectorAll('button')].map((b) => b.textContent),
                icon: (() => {
                    const img = document.querySelector('img[alt="Blocker Icon"]');
                    if (!img) return null;
                    const r = img.getBoundingClientRect();
                    return { src: img.getAttribute('src'), w: r.width, h: r.height, natural: img.naturalWidth };
                })(),
                heading: document.querySelector('h1')?.textContent ?? null,
                lang: document.documentElement.getAttribute('lang'),
                decorative: document.querySelectorAll('[aria-hidden="true"]').length,
                banned: document.querySelectorAll('a, form, style, [style]').length,
                fallback: document.querySelector('[data-container-fallback]') !== null,
                dataState: document.querySelector('main')?.getAttribute('data-state') ?? null,
                scrollH: document.documentElement.scrollHeight,
                scrollW: document.documentElement.scrollWidth,
                theme: document.documentElement.getAttribute('data-theme'),
            };
        }, SENTENCES);
    /** Waits until the page shows `sentence` (React renders asynchronously). */
    const waitFor = (sentence) =>
        page.waitForFunction((s) => document.querySelector('[role="status"]')?.textContent === s, sentence, {
            timeout: 5_000,
        });
    const close = () => context.close();
    return { page, probe, state, waitFor, close, pageErrors, consoleErrors, badResponses, foreignRequests };
}

/** The common invariants of every visible state. */
function assertWindow(s, sentence, button, kind) {
    assert.deepEqual(s.sentences, [sentence], 'exactly one state sentence in the DOM');
    assert.equal(s.status, sentence, 'sentence inside the status region');
    assert.equal(s.live, 'polite');
    assert.deepEqual(s.buttons, [button], 'exactly one button, expected label');
    assert.equal(s.heading, 'Blocker');
    assert.equal(s.lang, 'en', 'html[lang="en"] (WCAG 3.1.1)');
    assert.equal(s.decorative, 0, 'no decorative status dot');
    assert.deepEqual(s.icon, { src: '../Icon.png', w: 128, h: 128, natural: 512 }, 'icon 128x128 CSS px, loaded');
    assert.equal(s.banned, 0, 'no a/form/style/[style]');
    assert.equal(s.fallback, false, 'React page, not the plain fallback');
    assert.equal(s.dataState, kind);
    assert.ok(s.scrollH <= WINDOW.height, `fits the window height (scrollHeight ${s.scrollH})`);
    assert.ok(s.scrollW <= WINDOW.width, `fits the window width (scrollWidth ${s.scrollW})`);
}

/** WCAG contrast ratio of two computed `rgb(...)` colours (opaque). */
function contrast(a, b) {
    const lum = (c) => {
        const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
            const x = Number(v) / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** Geometry and colours of the visible parts (React page or fallback). */
function measure(page) {
    return page.evaluate(() => {
        const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
        };
        const h1 = document.querySelector('h1');
        const p = document.querySelector('[role="status"] p');
        const btn = document.querySelector('button');
        const img = document.querySelector('img');
        // Line boxes of the sentence (text-balance): widths of each rendered line.
        const range = document.createRange();
        range.selectNodeContents(p);
        const lines = [];
        for (const r of range.getClientRects()) {
            const last = lines[lines.length - 1];
            if (last && Math.abs(last.top - r.top) < 2) last.width += r.width;
            else lines.push({ top: r.top, width: r.width });
        }
        return {
            img: rect(img),
            h1: rect(h1),
            p: rect(p),
            btn: rect(btn),
            lines: lines.map((l) => l.width),
            colors: {
                h1: getComputedStyle(h1).color,
                p: getComputedStyle(p).color,
                bg: getComputedStyle(document.body).backgroundColor,
            },
        };
    });
}

async function assertClean(w) {
    const p = await w.probe();
    assert.deepEqual(p.csp, [], 'zero CSP violations');
    assert.deepEqual(p.errors, [], 'no window errors');
    assert.deepEqual(w.pageErrors, [], 'no page errors');
    assert.deepEqual(w.consoleErrors, [], 'no console errors');
    assert.deepEqual(w.badResponses, [], 'no failed request');
    assert.deepEqual(w.foreignRequests, [], 'no request left the local folder');
}

describe('container window in Chrome (spec §12.3)', { skip }, () => {
    for (const scheme of /** @type {const} */ (['light', 'dark'])) {
        test(`${scheme}: show() after mount, all three states, Settings wording, screenshots, zero CSP violations`, async () => {
            const w = await openWindow({ scheme });
            try {
                const p0 = await w.probe();
                assert.equal(p0.order[0], 'show', 'show is assigned first');
                assert.equal(p0.order[1], `MessageChannel theme=${scheme}`, 'React scheduler starts after show and the theme');
                assert.equal(await w.page.evaluate(() => typeof window.show), 'function');

                // Initial (no call): unknown / Preferences — no OS guessing.
                assertWindow(await w.state(), T.prefs.unknown, T.prefs.button, 'unknown');
                assert.equal((await w.state()).theme, scheme);
                if (scheme === 'light') {
                    await w.page.screenshot({ path: await screenshotPath('container-light-preferences-unknown.png'), animations: 'disabled' });
                }

                // The real-app calls (macOS 13+: second argument true), in a row on one document.
                for (const [enabled, kind] of /** @type {const} */ ([
                    [true, 'on'],
                    [false, 'off'],
                    [undefined, 'unknown'],
                ])) {
                    const result = await w.page.evaluate(
                        ([e]) => window.show(e === null ? undefined : e, true),
                        [enabled === undefined ? null : enabled],
                    );
                    assert.equal(result, undefined, 'show returns undefined');
                    await w.waitFor(T.settings[kind]);
                    assertWindow(await w.state(), T.settings[kind], T.settings.button, kind);
                    await w.page.screenshot({ path: await screenshotPath(`container-${scheme}-${kind}.png`), animations: 'disabled' });
                }
                // Back to "on": the page survives repeated calls (upstream does not, spec §4.3).
                await w.page.evaluate(() => window.show(true, true));
                await w.waitFor(T.settings.on);
                assertWindow(await w.state(), T.settings.on, T.settings.button, 'on');

                // Design review fixes: secondary sentence colour with AA contrast, balanced
                // lines, title + sentence grouped, more room before the button, all inside the window.
                for (const sentence of [T.settings.on, T.settings.off, T.settings.unknown]) {
                    const kind = sentence === T.settings.on ? 'on' : sentence === T.settings.off ? 'off' : 'unknown';
                    await w.page.evaluate((k) => window.show(k === 'on' ? true : k === 'off' ? false : undefined, true), kind);
                    await w.waitFor(sentence);
                    const m = await measure(w.page);
                    assert.notEqual(m.colors.p, m.colors.h1, 'sentence colour differs from the title');
                    const ratio = contrast(m.colors.p, m.colors.bg);
                    assert.ok(ratio >= 4.5, `sentence contrast ${ratio.toFixed(2)} >= 4.5`);
                    assert.ok(m.lines.length <= 2, `sentence fits two lines (${m.lines.length})`);
                    if (m.lines.length === 2) {
                        const [a, b] = m.lines;
                        assert.ok(Math.min(a, b) / Math.max(a, b) >= 0.6, `balanced lines ${a.toFixed(0)} / ${b.toFixed(0)}`);
                    }
                    const titleGap = m.p.top - m.h1.bottom;
                    const actionGap = m.btn.top - m.p.bottom;
                    assert.ok(titleGap < m.h1.top - m.img.bottom, `title and sentence grouped (${titleGap}px)`);
                    assert.ok(actionGap > titleGap + 8, `more room before the button (${actionGap}px vs ${titleGap}px)`);
                    assert.ok(m.btn.left >= 0 && m.btn.right <= WINDOW.width, 'button inside the window');
                }
                await w.page.evaluate(() => window.show(true, true));
                await w.waitFor(T.settings.on);

                // Library Button look survives the CSP; the page has its own surface background.
                const look = await w.page.evaluate(() => {
                    const btn = document.querySelector('button');
                    return {
                        fill: getComputedStyle(btn, '::before').backgroundColor,
                        bodyBg: getComputedStyle(document.body).backgroundColor,
                    };
                });
                assert.notEqual(look.fill, TRANSPARENT, 'library Button is filled');
                assert.notEqual(look.bodyBg, TRANSPARENT, 'body has the surface background');
                assert.equal(look.bodyBg, scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(33, 33, 33)');

                // Upstream behaviour CSS (template Style.css:1-5).
                const behaviour = await w.page.evaluate(() =>
                    ['img', 'p', 'button', 'h1'].map((sel) => {
                        const cs = getComputedStyle(document.querySelector(sel));
                        return {
                            sel,
                            userSelect: cs.userSelect || cs.webkitUserSelect,
                            cursor: cs.cursor,
                            drag: cs.getPropertyValue('-webkit-user-drag'),
                        };
                    }),
                );
                for (const b of behaviour) {
                    assert.equal(b.userSelect, 'none', `${b.sel}: user-select none`);
                    assert.equal(b.cursor, 'default', `${b.sel}: cursor default`);
                    if (b.drag !== '') assert.equal(b.drag, 'none', `${b.sel}: -webkit-user-drag none`);
                }

                // Live appearance change without reload.
                const other = scheme === 'light' ? 'dark' : 'light';
                await w.page.emulateMedia({ colorScheme: other });
                await w.page.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, other);
                const flipped = await w.page.evaluate(() => ({
                    cls: document.documentElement.className,
                    bg: getComputedStyle(document.body).backgroundColor,
                }));
                assert.match(flipped.cls, new RegExp(`\\b${other}\\b`));
                assert.notEqual(flipped.bg, look.bodyBg, 'background follows the appearance');

                await assertClean(w);

                // Positive control: the CSP is enforced here and the listener sees violations.
                await w.page.evaluate(() => {
                    const el = document.createElement('style');
                    el.textContent = 'body{outline:1px solid red}';
                    document.head.append(el);
                    el.remove();
                });
                await w.page.waitForFunction(() => window.__probe.csp.length > 0, null, { timeout: 5_000 });
                assert.match((await w.probe()).csp[0], /^style-src-elem /, 'a runtime <style> is reported (control)');
            } finally {
                await w.close();
            }
        });
    }

    test('Preferences wording on a fresh page (all three states) and one-way Settings switch', async () => {
        const w = await openWindow();
        try {
            for (const [enabled, kind] of /** @type {const} */ ([
                [true, 'on'],
                [false, 'off'],
                [null, 'unknown'],
            ])) {
                await w.page.evaluate((e) => window.show(e === null ? undefined : e, false), enabled);
                await w.waitFor(T.prefs[kind]);
                assertWindow(await w.state(), T.prefs[kind], T.prefs.button, kind);
            }
            await w.page.evaluate(() => window.show(false, true));
            await w.waitFor(T.settings.off);
            await w.page.evaluate(() => window.show(true, false));
            await w.waitFor(T.settings.on); // stays Settings
            assertWindow(await w.state(), T.settings.on, T.settings.button, 'on');
            for (const args of [[], [{}, {}], ['x', 0], [1, null], [null, 0]]) {
                assert.equal(await w.page.evaluate((a) => window.show(...a), args), undefined);
            }
            await w.waitFor(T.settings.unknown);
            await assertClean(w);
        } finally {
            await w.close();
        }
    });

    for (const scheme of /** @type {const} */ (['light', 'dark'])) {
        test(`${scheme}: show() called before React initialised is kept (show(false, true) at assignment)`, async () => {
            const w = await openWindow({ scheme, query: '?early=false,true' });
            try {
                const p = await w.probe();
                assert.equal(p.earlyResult, undefined, 'the early call returned undefined');
                assert.equal(p.order[0], 'show');
                assert.ok(p.order[1]?.startsWith('MessageChannel'), 'the early call happened before React existed');
                await w.waitFor(T.settings.off);
                assertWindow(await w.state(), T.settings.off, T.settings.button, 'off');
                await assertClean(w);
            } finally {
                await w.close();
            }
        });
    }

    for (const scheme of /** @type {const} */ (['light', 'dark'])) {
        test(`${scheme}: pre-theme first paint already has the themed surface and text colours`, async () => {
            // Script.js replaced by an empty script: data-theme is never set, so only
            // Style.css paints (what a first paint before the deferred script would show).
            const context = await chrome.browser.newContext({ viewport: WINDOW, colorScheme: scheme, serviceWorkers: 'block' });
            try {
                const page = await context.newPage();
                await page.route('**/Script.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
                await page.goto(`${server.url}/Base.lproj/Main.html`, { waitUntil: 'load' });
                const pre = await page.evaluate(() => ({
                    theme: document.documentElement.getAttribute('data-theme'),
                    bg: getComputedStyle(document.body).backgroundColor,
                    color: getComputedStyle(document.body).color,
                }));
                assert.equal(pre.theme, null);
                assert.equal(pre.bg, scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(33, 33, 33)', 'same as the themed surface');
                assert.equal(pre.color, scheme === 'light' ? 'rgb(13, 13, 13)' : 'rgb(255, 255, 255)', 'same as the themed text');
                // The themed page agrees (guards the literal dark values in container.css against token drift).
                await page.unroute('**/Script.js');
                await page.reload({ waitUntil: 'load' });
                await page.locator('button').first().waitFor({ state: 'visible', timeout: FIRST_RENDER_TIMEOUT });
                const themed = await page.evaluate(() => ({
                    theme: document.documentElement.getAttribute('data-theme'),
                    bg: getComputedStyle(document.body).backgroundColor,
                    color: getComputedStyle(document.querySelector('h1')).color,
                }));
                assert.equal(themed.theme, scheme);
                assert.deepEqual({ bg: themed.bg, color: themed.color }, { bg: pre.bg, color: pre.color });
            } finally {
                await context.close();
            }
        });

        test(`${scheme}: plain-DOM fallback (real bundle, forced pre-mount error) has token hover/pressed and the library focus ring`, async () => {
            const w = await openWindow({ scheme, query: '?fail=1&early=false,true' });
            try {
                await w.page.waitForSelector('main[data-container-fallback]', { timeout: 5_000 });
                await w.waitFor(T.settings.off);
                const s = await w.state();
                assert.deepEqual(s.sentences, [T.settings.off]);
                assert.deepEqual(s.buttons, [T.settings.button]);
                assert.equal(s.lang, 'en');
                assert.equal(s.decorative, 0);
                assert.ok(s.scrollH <= WINDOW.height && s.scrollW <= WINDOW.width, 'fits the window');
                // Later show() calls still update the fallback.
                await w.page.evaluate(() => window.show(true, true));
                await w.waitFor(T.settings.on);

                const colours = () =>
                    w.page.evaluate(() => {
                        const cs = getComputedStyle(document.querySelector('button'));
                        return { bg: cs.backgroundColor, outlineColor: cs.outlineColor, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
                    });
                const rest = await colours();
                await w.page.mouse.move(5, 5);
                await w.page.keyboard.press('Tab');
                assert.equal(await w.page.evaluate(() => document.activeElement?.tagName), 'BUTTON', 'Tab reaches the button');
                const focused = await colours();
                assert.equal(focused.outlineStyle, 'solid');
                assert.equal(focused.outlineWidth, '2px');
                // The token's colour, resolved the same way (CSSOM write in the test only; the CSP allows it).
                const ringRgb = await w.page.evaluate(() => {
                    const el = document.createElement('i');
                    el.style.color = 'var(--color-ring)';
                    document.body.append(el);
                    const c = getComputedStyle(el).color;
                    el.remove();
                    return c;
                });
                assert.equal(focused.outlineColor, ringRgb, 'focus ring uses --color-ring, not the UA focus colour');
                await w.page.screenshot({ path: await screenshotPath(`container-${scheme}-fallback-focus.png`), animations: 'disabled' });

                const box = await w.page.locator('button').boundingBox();
                await w.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                const hover = await colours();
                assert.notEqual(hover.bg, rest.bg, 'hover changes the fill');
                await w.page.mouse.down();
                const pressed = await colours();
                assert.notEqual(pressed.bg, rest.bg, 'pressed changes the fill');
                await w.page.mouse.up();
                assert.deepEqual((await w.probe()).posted, ['open-preferences']);

                const p = await w.probe();
                assert.deepEqual(p.csp, [], 'zero CSP violations');
                assert.deepEqual(p.errors, ['forced pre-mount failure'], 'only the forced error');
                assert.deepEqual(w.badResponses, []);
                assert.deepEqual(w.foreignRequests, []);
            } finally {
                await w.close();
            }
        });
    }

    test('labels twice as long still fit the window width: the sentence and the button wrap', async () => {
        const w = await openWindow({ query: '?early=true,false' });
        try {
            await w.waitFor(T.prefs.on);
            // Stress the CSS only (UI rule §6.7 2x strings): double the rendered texts in place.
            await w.page.evaluate(() => {
                const p = document.querySelector('[role="status"] p');
                p.textContent = `${p.textContent} ${p.textContent}`;
                const walker = document.createTreeWalker(document.querySelector('button'), NodeFilter.SHOW_TEXT);
                const node = walker.nextNode();
                node.textContent = `${node.textContent} ${node.textContent}`;
            });
            const m = await w.page.evaluate(() => {
                const r = document.querySelector('button').getBoundingClientRect();
                return { left: r.left, right: r.right, height: r.height, scrollW: document.documentElement.scrollWidth };
            });
            assert.ok(m.left >= 0, `button start reachable (left ${m.left})`);
            assert.ok(m.right <= WINDOW.width, `button end inside (right ${m.right})`);
            assert.ok(m.scrollW <= WINDOW.width, `no horizontal scroll (${m.scrollW})`);
            assert.ok(m.height > 36, 'the long label wrapped onto more lines');
            await w.page.screenshot({ path: await screenshotPath('container-light-doublelen.png'), animations: 'disabled' });
        } finally {
            await w.close();
        }
    });

    test('the button posts exactly the string "open-preferences", once per click', async () => {
        const w = await openWindow({ query: '?early=true,true' });
        try {
            await w.waitFor(T.settings.on);
            const button = w.page.getByRole('button', { name: T.settings.button });
            await button.click();
            let posted = (await w.probe()).posted;
            assert.deepEqual(posted, ['open-preferences']);
            assert.equal(typeof posted[0], 'string');
            // Keyboard activation of the native <button>.
            await button.focus();
            await w.page.keyboard.press('Enter');
            await w.page.keyboard.press('Space');
            posted = (await w.probe()).posted;
            assert.deepEqual(posted, ['open-preferences', 'open-preferences', 'open-preferences']);
            assert.ok(posted.every((m) => m === 'open-preferences' && typeof m === 'string'));
            // The page did not navigate.
            assert.match(w.page.url(), /\/Base\.lproj\/Main\.html\?early=true,true$/);
            await assertClean(w);
        } finally {
            await w.close();
        }
    });

    test('without window.webkit the button does nothing and throws nothing', async () => {
        const w = await openWindow({ query: '?webkit=0' });
        try {
            assert.equal(await w.page.evaluate(() => typeof window.webkit), 'undefined');
            await w.page.getByRole('button', { name: T.prefs.button }).click();
            await w.page.waitForTimeout(100);
            await assertClean(w);
        } finally {
            await w.close();
        }
    });
});

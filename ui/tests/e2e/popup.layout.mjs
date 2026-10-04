/**
 * Popup layout, look and accessibility checks (regression tests for the visual,
 * accessibility/localisation and parity reviews). Behaviour parity stays in
 * popup.parity.mjs.
 *
 *   npm run build:harness   (or a private build + BLOCKER_HARNESS_DIR)
 *   node --test tests/e2e/popup.layout.mjs
 *
 * The first-paint test also needs a built extension: BLOCKER_EXT_DIR (default dist/extension);
 * it is skipped when that folder has no popup.html.
 *
 * Screenshots (BLOCKER_SCREENSHOT_DIR or build/screenshots): popup-*.png.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { HARNESS_DIR, POPUP_VIEWPORT, launchChrome, openHarness, screenshot, startStaticServer } from './helpers/index.mjs';

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT_DIR = process.env.BLOCKER_EXT_DIR ?? join(UI_ROOT, 'dist', 'extension');
const LOCALES_DIR = join(UI_ROOT, 'src', 'dev', 'fixtures', 'locales');

const POPUP_HEIGHT = 456; // POPUP_HEIGHT_PX in src/popup/Popup.tsx
const clip = { x: 0, y: 0, width: 340, height: POPUP_HEIGHT };

let server;
let extServer = null;
let chrome;

before(async () => {
    // The extension server first: openHarness() uses the most recently started server.
    if (existsSync(join(EXT_DIR, 'popup.html'))) extServer = await startStaticServer(EXT_DIR);
    server = await startStaticServer(HARNESS_DIR);
    chrome = await launchChrome({ viewport: POPUP_VIEWPORT });
});

after(async () => {
    await chrome?.close();
    await server?.close();
    await extServer?.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const radioSel = (level) => `[data-level="${level}"] [role="radio"]`;

async function open(params = {}, { state = 'any' } = {}) {
    const page = await chrome.context.newPage();
    await openHarness(page, 'popup', params);
    await page.waitForFunction(
        (want) => {
            const s = document.querySelector('[data-testid="popup"]')?.getAttribute('data-state');
            return s !== undefined && s !== null && s !== 'loading' && (want === 'any' || s === want);
        },
        state,
        { timeout: 15_000 },
    );
    return page;
}

/** Element boxes, rounded. */
function boxes(page, selector) {
    return page.evaluate(
        (sel) =>
            [...document.querySelectorAll(sel)].map((el) => {
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }),
        selector,
    );
}

function mainMetrics(page) {
    return page.evaluate(() => {
        const main = document.querySelector('[data-testid="popup-main"]');
        return { client: main.clientHeight, scroll: main.scrollHeight, top: main.scrollTop };
    });
}

/**
 * In-page contrast helpers (WCAG relative luminance). Colours are resolved through a canvas,
 * so any CSS colour syntax works; alpha is composited over the given background.
 */
const CONTRAST_LIB = `
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const surface = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3);
`;

/* ------------------------------------------------------------------------ */
/* Size from the first paint                                                 */
/* ------------------------------------------------------------------------ */

describe('size from the first paint', () => {
    test('built popup.html: <body> is 340 x POPUP_HEIGHT before any app script runs', async (t) => {
        if (extServer === null) {
            t.skip(`no built extension in ${EXT_DIR} (set BLOCKER_EXT_DIR)`);
            return;
        }
        const page = await chrome.context.newPage();
        const counts = [chrome.consoleErrors.length, chrome.failedRequests.length];
        // Every app module is blocked: only the HTML, theme-init.js and the stylesheet load.
        await page.route('**/*.js', (route) => (route.request().url().endsWith('/ui/theme-init.js') ? route.continue() : route.abort()));
        try {
            await page.goto(`${extServer.url}/popup.html`, { waitUntil: 'load' });
            const m = await page.evaluate(() => ({
                body: [document.body.getBoundingClientRect().width, document.body.getBoundingClientRect().height],
                rootChildren: document.getElementById('root')?.childElementCount,
                bg: getComputedStyle(document.body).backgroundColor,
            }));
            assert.equal(m.rootChildren, 0, 'the app did not run');
            assert.deepEqual(m.body, [340, POPUP_HEIGHT]);
            assert.notEqual(m.bg, 'rgba(0, 0, 0, 0)', 'body paints the surface');
        } finally {
            await page.close();
            // The aborted app scripts are expected here; keep them out of the global check.
            chrome.consoleErrors.splice(counts[0]);
            chrome.failedRequests.splice(counts[1]);
        }
    });

    test('harness: body, skeleton and READY all have the same 340 x POPUP_HEIGHT box', async () => {
        const page = await chrome.context.newPage();
        await openHarness(page, 'popup', { delay: 1500 });
        const body0 = await page.evaluate(() => [document.body.offsetWidth, document.body.offsetHeight]);
        const skel = await boxes(page, '[data-testid="popup"]');
        // Skeleton tool rows are drawn where the real rows will be.
        const skelRows = await boxes(page, '[data-testid="tool-skeleton-row"]');
        await page.waitForFunction(() => document.querySelector('[data-testid="popup"]')?.getAttribute('data-state') === 'ready');
        const ready = await boxes(page, '[data-testid="popup"]');
        const rows = await boxes(page, '[data-testid="tools-section"] button');
        assert.deepEqual(body0, [340, POPUP_HEIGHT]);
        assert.deepEqual(skel, ready);
        assert.equal(skelRows.length, rows.length);
        skelRows.forEach((r, i) => assert.deepEqual(r, rows[i], `skeleton row ${i} = tool row ${i}`));
        await page.close();
    });
});

/* ------------------------------------------------------------------------ */
/* Fit: every locale, 4 tools; messages never move the tools                 */
/* ------------------------------------------------------------------------ */

describe('fit', () => {
    test('all 71 locales with 4 tools and dev mode: the middle area does not scroll', async () => {
        const locales = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
        assert.equal(locales.length, 71);
        const over = [];
        const page = await chrome.context.newPage();
        for (const lang of locales) {
            await openHarness(page, 'popup', { lang, customFilters: 1, dev: 1 });
            await page.waitForFunction(() => document.querySelector('[data-testid="popup"]')?.getAttribute('data-state') === 'ready');
            const m = await mainMetrics(page);
            const tools = await page.locator('[data-testid="tools-section"] button').count();
            assert.equal(tools, 4, lang);
            if (m.scroll > m.client) over.push(`${lang}: ${m.scroll}/${m.client}`);
        }
        await page.close();
        assert.deepEqual(over, []);
    });

    test('English, 4 tools + a 2-line error: everything fits and the tools do not move', async () => {
        const page = await open({ customFilters: 1, dev: 1, scenario: 'error-on-apply' });
        const before = await boxes(page, '[data-testid="tools-section"] button');
        await page.locator(radioSel(0)).click();
        await page.waitForSelector('[data-blocker-status] [data-variant]');
        await page.mouse.move(5, 5);
        await sleep(300);
        const afterRows = await boxes(page, '[data-testid="tools-section"] button');
        const alert = (await boxes(page, '[data-blocker-status] [data-variant]'))[0];
        const m = await mainMetrics(page);
        assert.deepEqual(afterRows, before, 'tools stay where they were');
        assert.ok(alert.h >= 60, `the message wraps to 2 lines (${alert.h} px)`);
        assert.ok(alert.y >= before.at(-1).y + before.at(-1).h, 'the message is below the tools');
        assert.equal(m.scroll, m.client, 'nothing scrolls');
        await screenshot(page, 'popup-error-on-apply-all-tools', { clip });
        await page.close();
    });

    test('Bulgarian, 4 tools + error: the middle area scrolls the message into view and shows scroll shadows', async () => {
        const page = await open({ lang: 'bg', customFilters: 1, dev: 1, scenario: 'error-on-apply', theme: 'dark' });
        const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="popup-main"]')).backgroundImage);
        assert.match(bg, /linear-gradient/);
        // A dark shadow strong enough to see on #212121 (light keeps the library 0.12).
        const cueAlpha = (p) => p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="popup-main"]')).getPropertyValue('--popup-scroll-cue-alpha').trim());
        assert.equal(Number(await cueAlpha(page)), 0.6);
        assert.match(bg, /rgba\(0, 0, 0, 0\.6\)/);
        const light = await open({ lang: 'bg' });
        assert.equal(Number(await cueAlpha(light)), 0.12);
        await light.close();
        await page.locator(radioSel(0)).click();
        await page.waitForSelector('[data-blocker-status] [data-variant]');
        await sleep(400);
        const m = await mainMetrics(page);
        assert.ok(m.scroll > m.client, 'needs to scroll');
        assert.ok(m.top > 0, 'scrolled to the message');
        const alert = (await boxes(page, '[data-blocker-status] [data-variant]'))[0];
        const main = (await boxes(page, '[data-testid="popup-main"]'))[0];
        assert.ok(alert.y + alert.h <= main.y + main.h, 'message fully visible');
        await screenshot(page, 'popup-long-bg-error-dark', { clip });
        await page.close();
    });
});

/* ------------------------------------------------------------------------ */
/* Mode control: no tooltip, contrast, read-only                             */
/* ------------------------------------------------------------------------ */

describe('mode control', () => {
    test('no tooltip on hover or keyboard focus; the caption preview stays visible inside the popup', async () => {
        const page = await open({ lang: 'ml' });
        await page.locator(radioSel(3)).hover();
        await sleep(900);
        assert.equal(await page.locator('[role="tooltip"]').count(), 0);
        assert.equal(await page.locator('[data-testid="mode-caption"] [data-part="target"]').isVisible(), true);
        await screenshot(page, 'popup-hover-preview-ml', { clip });
        await page.mouse.move(5, 5);
        await page.locator(radioSel(1)).focus();
        await sleep(200);
        await page.keyboard.press('ArrowRight');
        await sleep(900);
        assert.equal(await page.locator('[role="tooltip"]').count(), 0);
        // Descriptions stay available to assistive technology.
        const described = await page.locator(radioSel(2)).getAttribute('aria-describedby');
        assert.ok(described && (await page.locator(`[id="${described}"]`).textContent()).length > 0);
        await page.close();
    });

    for (const theme of ['light', 'dark']) {
        test(`${theme}: level glyphs and the selected outline have >= 3:1 against the track (WCAG 1.4.11)`, async () => {
            for (const level of [0, 1]) {
                const page = await open({ theme, level });
                const r = await page.evaluate(`(() => { ${CONTRAST_LIB}
                    const group = document.querySelector('[role=radiogroup]');
                    const track = over(rgba(getComputedStyle(group).backgroundColor), surface);
                    const ts = getComputedStyle(group.firstElementChild);
                    const thumb = over(rgba(ts.backgroundColor), track);
                    const out = { outline: Math.min(cr(over(rgba(ts.outlineColor), track), track), cr(over(rgba(ts.outlineColor), thumb), thumb)), outlineWidth: ts.outlineWidth, glyphs: {} };
                    for (const lvl of [0, 1, 2, 3]) {
                        const btn = document.querySelector('[data-level="' + lvl + '"] [role=radio]');
                        const bg = btn.getAttribute('aria-checked') === 'true' ? thumb : track;
                        const ratios = [...btn.querySelectorAll('rect')].map((rect) => {
                            const cs = getComputedStyle(rect);
                            return cr(over(rgba(rect.hasAttribute('data-filled') ? cs.fill : cs.stroke), bg), bg);
                        });
                        out.glyphs[lvl] = Math.min(...ratios);
                    }
                    return out; })()`);
                assert.equal(r.outlineWidth, '1px');
                assert.ok(r.outline >= 3, `${theme} level ${level}: outline ${r.outline}`);
                for (const [lvl, ratio] of Object.entries(r.glyphs)) {
                    assert.ok(ratio >= 3, `${theme} open at ${level}: level ${lvl} glyph ${ratio.toFixed(2)}`);
                }
                if (level === 0) await screenshot(page, `popup-level-0-${theme}`, { clip });
                await page.close();
            }
        });
    }

    test('admin-locked: options aria-disabled, explained, no hover highlight, unselected dimmed', async () => {
        const page = await open({ scenario: 'admin-locked', theme: 'dark' });
        for (const l of [0, 1, 2, 3]) {
            assert.equal(await page.locator(radioSel(l)).getAttribute('aria-disabled'), 'true');
            const focusable = await page.locator(radioSel(l)).evaluate((el) => {
                el.focus();
                return !el.disabled && document.activeElement === el;
            });
            assert.equal(focusable, true, 'still focusable (the level can be read)');
        }
        const name = await page.evaluate(() => {
            const id = document.querySelector('[role=radiogroup]').getAttribute('aria-labelledby');
            return document.getElementById(id).textContent;
        });
        assert.match(name, /Managed by your administrator/);
        await page.evaluate(() => document.activeElement?.blur());
        await page.locator(radioSel(3)).hover();
        await sleep(300);
        const look = await page.evaluate(() => {
            const b = document.querySelector('[data-level="3"] [role=radio]');
            return { before: getComputedStyle(b, '::before').opacity, opacity: getComputedStyle(b).opacity };
        });
        assert.equal(look.before, '0', 'no hover highlight');
        assert.ok(Number(look.opacity) < 1, 'dimmed');
        assert.equal(await page.locator('[role="tooltip"]').count(), 0);
        await screenshot(page, 'popup-admin-locked-hover-dark', { clip });
        await page.close();
    });
});

/* ------------------------------------------------------------------------ */
/* Messages                                                                   */
/* ------------------------------------------------------------------------ */

describe('messages', () => {
    for (const theme of ['light', 'dark']) {
        test(`${theme}: alert text >= 4.5:1 and its icon hidden from assistive technology`, async () => {
            for (const [params, sel] of [
                [{ scenario: 'error-on-apply' }, radioSel(0)], // danger
                [{ mock: { responses: { setFilteringMode: 0 } } }, radioSel(3)], // warning
            ]) {
                const page = await open({ ...params, theme });
                await page.locator(sel).click();
                await page.waitForSelector('[data-blocker-status] [data-variant]');
                await sleep(200);
                const r = await page.evaluate(`(() => { ${CONTRAST_LIB}
                    const alert = document.querySelector('[data-blocker-status] [data-variant]');
                    const bg = over(rgba(getComputedStyle(alert).backgroundColor), surface);
                    const ink = alert.querySelector('.text-default');
                    return { color: alert.dataset.color, text: cr(over(rgba(getComputedStyle(ink).color), bg), bg),
                             hidden: [...alert.querySelectorAll('svg')].every((s) => s.getAttribute('aria-hidden') === 'true') }; })()`);
                assert.ok(r.text >= 4.5, `${theme} ${r.color}: ${r.text}`);
                assert.equal(r.hidden, true, 'indicator icon aria-hidden');
                await screenshot(page, `popup-alert-${r.color}-${theme}`, { clip });
                await page.close();
            }
        });
    }

    test('ar: the English fallback message is lang="en" dir="ltr"', async () => {
        const page = await open({ lang: 'ar', theme: 'dark', mock: { responses: { setFilteringMode: 0 } } });
        await page.locator(radioSel(3)).click();
        await page.waitForSelector('[data-blocker-status] [data-variant]');
        const span = page.locator('[data-blocker-status] [lang="en"]');
        assert.equal(await span.getAttribute('dir'), 'ltr');
        assert.match(await span.innerText(), /^The filtering mode in force on this website is: .+\.$/);
        await page.mouse.move(5, 5);
        await sleep(200);
        await screenshot(page, 'popup-rtl-ar-warning-dark', { clip });
        await page.close();
        // English UI: no lang override.
        const en = await open({ mock: { responses: { setFilteringMode: 0 } } });
        await en.locator(radioSel(3)).click();
        await en.waitForSelector('[data-blocker-status] [data-variant]');
        assert.equal(await en.locator('[data-blocker-status] [lang]').count(), 0);
        await en.close();
    });

    test('busy overlay: controls under it are inert, focus returns afterwards; spinner on its own chip', async () => {
        const page = await open({ scenario: 'slow' });
        await page.locator(radioSel(1)).focus();
        await sleep(200); // Radix roving focus registers a programmatic focus on the next tick
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Space'); // level 0
        await page.waitForSelector('[data-testid="busy-overlay"]', { timeout: 3000 });
        assert.equal(await page.locator('main').evaluate((m) => m.inert), true);
        assert.equal(await page.locator('footer').evaluate((f) => f.inert), true);
        await page.keyboard.press('Tab');
        const focusedInside = await page.evaluate(() => document.activeElement?.closest('main, footer') !== null && document.activeElement !== document.body);
        assert.equal(focusedInside, false, 'Tab cannot reach the controls under the overlay');
        const chip = (await boxes(page, '[data-testid="busy-indicator"]'))[0];
        const main = (await boxes(page, '[data-testid="popup-main"]'))[0];
        assert.ok(Math.abs(chip.y + chip.h / 2 - (main.y + main.h / 2)) <= 1, 'centred on the middle area');
        await screenshot(page, 'popup-busy-keyboard', { clip });
        await page.waitForSelector('[data-testid="busy-overlay"]', { state: 'detached', timeout: 8000 });
        assert.equal(await page.locator('main').evaluate((m) => m.inert), false);
        await page.waitForFunction(() => document.activeElement?.closest('[data-level]')?.getAttribute('data-level') === '0', undefined, { timeout: 2000 });
        await page.close();
    });
});

/* ------------------------------------------------------------------------ */
/* Header, rows, ribbon, states                                              */
/* ------------------------------------------------------------------------ */

describe('layout details', () => {
    for (const [lang, theme] of [['en', 'light'], ['ar', 'dark']]) {
        test(`${lang}: tool rows span the content width like the mode control; ribbon on the 16 px grid`, async () => {
            const page = await open({ lang, theme, customFilters: 1, dev: 1 });
            const group = (await boxes(page, '[role="radiogroup"]'))[0];
            const rows = await boxes(page, '[data-testid="tools-section"] button');
            for (const r of rows) {
                assert.equal(r.x, group.x, 'same start edge');
                assert.equal(r.w, group.w, 'same width');
            }
            assert.deepEqual([group.x, group.w], [16, 308]);
            const ribbon = await boxes(page, '[data-testid="ribbon"] button');
            const edge = lang === 'ar' ? Math.min(...ribbon.map((b) => b.x)) : Math.max(...ribbon.map((b) => b.x + b.w));
            assert.equal(edge, lang === 'ar' ? 16 : 324);
            // Headings are smaller than the actions they label; actions use the default ink.
            const type = await page.evaluate(() => ({
                h2: getComputedStyle(document.querySelector('[data-testid="tools-section"] h2')).fontSize,
                tool: getComputedStyle(document.querySelector('#gotoZapper span:last-child span, #gotoZapper')).fontSize,
                toolInk: getComputedStyle(document.querySelector('#gotoZapper')).color,
                ink: getComputedStyle(document.querySelector('[data-testid="hostname"]')).color,
            }));
            assert.ok(parseFloat(type.h2) < parseFloat(type.tool), `${type.h2} < ${type.tool}`);
            assert.equal(type.toolInk, type.ink);
            await page.locator('#gotoPicker').hover();
            await sleep(250);
            await screenshot(page, `popup-hover-tool-${lang}-${theme}`, { clip });
            await page.close();
        });
    }

    test('long hostname: breaks after dots, at most 2 lines, middle ellipsis keeps the end', async () => {
        const host = 'very-long-subdomain-name.another-example-company.co.uk.example-cdn.net';
        const page = await open({ lang: 'el', theme: 'dark', url: `https://${host}/x` });
        const h1 = page.locator('[data-testid="hostname"]');
        assert.equal(await h1.getAttribute('title'), host);
        const shown = await h1.innerText();
        assert.ok(shown.includes('…'), shown);
        assert.ok(shown.replace(/\s/g, '').endsWith('co.uk.example-cdn.net'), shown);
        assert.ok((await h1.locator('wbr').count()) > 0);
        const m = await h1.evaluate((el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight, lh: parseFloat(getComputedStyle(el).lineHeight) }));
        assert.ok(m.h <= 2 * m.lh + 0.5 && m.sh <= 2 * m.lh + 0.5, `2 lines max: ${JSON.stringify(m)}`);
        await screenshot(page, 'popup-long-hostname-dark', { clip });
        await page.close();
    });

    test('every feature forbidden: no empty footer; error state uses the empty-state pattern', async () => {
        const page = await open({ disabled: 'zapper,picker,report,dashboard' });
        assert.equal(await page.locator('[data-testid="ribbon"]').count(), 0);
        assert.equal(await page.locator('[data-testid="popup"]').evaluate((el) => el.getBoundingClientRect().height), POPUP_HEIGHT);
        await screenshot(page, 'popup-all-forbidden', { clip });
        await page.close();
        const err = await open({ theme: 'dark', mock: { responses: { popupPanelData: { level: '2' } } } });
        assert.equal(await err.locator('[data-testid="load-error"]').isVisible(), true);
        await screenshot(err, 'popup-load-error-malformed-dark', { clip });
        await err.close();
    });

    test('no console errors, page errors, failed or external requests', () => {
        assert.deepEqual(chrome.pageErrors, []);
        assert.deepEqual(chrome.consoleErrors, []);
        assert.deepEqual(chrome.failedRequests, []);
        assert.deepEqual(chrome.externalRequests, []);
    });
});

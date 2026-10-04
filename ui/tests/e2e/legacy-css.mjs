/**
 * Browser checks for the generated legacy stylesheet (docs/specs/legacy-tokens.md 7.2,
 * parity lines L-2 ... L-13 and L-16) over a scratch copy of PRISTINE, plus optional
 * before/after screenshots.
 * L-17 (inside the React dashboard) is tests/e2e/legacy-css.shell.mjs.
 *
 * The upstream vanilla pages are served unchanged from a scratch copy of
 * PRISTINE (PRISTINE itself is only read), once with the upstream
 * css/default.css ("before") and once with the generated one ("after"). A
 * small WebExtension stub (tests/e2e/legacy/ext-stub.mjs) is injected as an
 * init script so the pages render outside the extension. The overlays
 * (picker/zapper/unpicker) are started the real way: a host page runs the
 * upstream content scripts js/scripting/tool-overlay.js + <tool>.js, which
 * create the transparent full-viewport iframe.
 *
 * Environment:
 *   BLOCKER_LEGACY_SCRATCH=<dir>   where the two site copies go (default: a fresh temp dir, removed afterwards)
 *   BLOCKER_LEGACY_SCREENSHOTS=1   also write legacy-<view>-<scheme>.png (before | after) and
 *                                  legacy-focus-<view>-<scheme>.png (after) into BLOCKER_SCREENSHOT_DIR
 *   BLOCKER_PRISTINE_DIR           PRISTINE override (default build/pristine/safari)
 *   BLOCKER_LEGACY_CSS_FILE=<file> test that file as the "after" css instead of generating it
 *                                  (e.g. the staged css/default.css, or an older build)
 * Does not need the harness build.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { generateLegacyCss } from '../../src/styles/legacy/generate.mjs';
import { readGeneratorInputs } from '../../src/styles/legacy/sources.mjs';
import { installExtStub, stubData } from './legacy/ext-stub.mjs';
import { FIRST_RENDER_TIMEOUT, PRISTINE_DIR as PRISTINE, UI_ROOT, launchChrome, screenshotPath, startStaticServer } from './lib/harness.mjs';
const SHOTS = process.env.BLOCKER_LEGACY_SCREENSHOTS === '1';
const userScratch = process.env.BLOCKER_LEGACY_SCRATCH ? path.resolve(process.env.BLOCKER_LEGACY_SCRATCH) : null;

const HOST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>Overlay host</title>
<style>
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #f6e7c8; color: #222; }
  header { background: linear-gradient(90deg, #e4572e, #f3a712, #29335c); color: #fff; padding: 24px 32px; font-size: 28px; font-weight: 700; }
  main { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; padding: 24px 32px; }
  .ad-banner { background: repeating-linear-gradient(45deg, #ffd23f, #ffd23f 12px, #ee4266 12px, #ee4266 24px); height: 90px; display: grid; place-items: center; font-weight: 700; color: #fff; }
  article p { margin: 0 0 12px; }
  #sidebar { background: #3bceac; padding: 16px; border-radius: 8px; color: #0b3d2e; }
  #sidebar .promo { background: #0ead69; color: #fff; padding: 12px; border-radius: 6px; margin-top: 12px; }
</style>
</head>
<body>
<header>Sample web page behind the overlay</header>
<main>
  <article>
    <div class="ad-banner" id="target">AD BANNER</div>
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. The page behind the overlay must stay visible: the overlay frame is transparent.</p>
    <p>Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>
    <div data-sponsored="1">Sponsored block</div>
  </article>
  <aside id="sidebar">Sidebar<div class="promo">Promo</div></aside>
</main>
<script>
  // Same files, same order as upstream js/popup.js injects them.
  const tool = new URLSearchParams(location.search).get('tool') || 'picker';
  const files = tool === 'zapper'
    ? ['tool-overlay', 'zapper']
    : ['css-procedural-api', 'tool-overlay', tool];
  const next = () => {
    const f = files.shift();
    if (!f) { return; }
    const s = document.createElement('script');
    s.src = '/js/scripting/' + f + '.js';
    s.onload = next;
    document.body.append(s);
  };
  next();
</script>
</body>
</html>
`;

let scratch;
let generated;
let sites;
let chrome;
let stubSource;

function cloneTree(from, to) {
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        execFileSync('/bin/cp', ['-cR', from, to]);
    } catch {
        fs.cpSync(from, to, { recursive: true, filter: src => !src.includes(`${path.sep}rulesets${path.sep}`) });
    }
}

async function makeSite(name, cssText) {
    const dir = path.join(scratch, name);
    cloneTree(PRISTINE, dir);
    if (cssText !== null) { fs.writeFileSync(path.join(dir, 'css', 'default.css'), cssText); }
    fs.mkdirSync(path.join(dir, '__legacy'), { recursive: true });
    fs.writeFileSync(path.join(dir, '__legacy', 'host.html'), HOST_HTML);
    const server = await startStaticServer(dir);
    return { dir, server };
}

before(async () => {
    assert.ok(fs.existsSync(path.join(PRISTINE, 'css', 'default.css')), `PRISTINE not found at ${PRISTINE}`);
    scratch = userScratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'blocker-legacy-css-'));
    generated = generateLegacyCss(readGeneratorInputs().inputs);
    sites = {
        before: await makeSite('before', null),
        after: await makeSite('after', process.env.BLOCKER_LEGACY_CSS_FILE
            ? fs.readFileSync(path.resolve(process.env.BLOCKER_LEGACY_CSS_FILE), 'utf8')
            : generated.css),
    };
    const data = stubData({
        messages: JSON.parse(fs.readFileSync(path.join(PRISTINE, '_locales', 'en', 'messages.json'), 'utf8')),
        rulesetDetails: JSON.parse(fs.readFileSync(path.join(UI_ROOT, 'src', 'dev', 'fixtures', 'ruleset-details.json'), 'utf8')),
        manifest: JSON.parse(fs.readFileSync(path.join(PRISTINE, 'manifest.json'), 'utf8')),
    });
    stubSource = `(${installExtStub.toString()})(${JSON.stringify(data)});`;
    chrome = await launchChrome({ deviceScaleFactor: 1, viewport: { width: 1000, height: 760 } });
});

after(async () => {
    await chrome?.close();
    for (const s of Object.values(sites ?? {})) { await s.server.close(); }
    if (scratch && !userScratch) { fs.rmSync(scratch, { recursive: true, force: true }); }
});

/** New context (own color scheme / JS switch) with the stub installed. */
async function newContext({ colorScheme = 'light', javaScriptEnabled = true, viewport = { width: 1000, height: 760 } } = {}) {
    const context = await chrome.browser.newContext({ colorScheme, javaScriptEnabled, viewport, deviceScaleFactor: 1, locale: 'en-US', serviceWorkers: 'block' });
    await context.addInitScript({ content: stubSource });
    return context;
}

async function openPage(context, url) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => requests.push(r.url()));
    await page.goto(url, { waitUntil: 'load', timeout: FIRST_RENDER_TIMEOUT });
    return { page, errors, requests };
}

const waitDashboardReady = page => page.waitForFunction(() => document.body && !document.body.classList.contains('loading'), null, { timeout: FIRST_RENDER_TIMEOUT });

async function showPane(page, pane, { embed = false } = {}) {
    await waitDashboardReady(page);
    await page.evaluate(([p, e]) => {
        if (e) { document.documentElement.setAttribute('data-blocker-embed', 'classic-dashboard'); }
        document.body.dataset.pane = p;
    }, [pane, embed]);
    if (pane === 'develop') {
        await page.waitForSelector('section[data-pane="develop"] .cm-editor .cm-line', { timeout: FIRST_RENDER_TIMEOUT });
    }
    if (pane === 'filters') {
        await page.waitForTimeout(300);
    }
}

async function startOverlay(page, tool) {
    const frameEl = await page.waitForSelector('iframe', { state: 'attached', timeout: FIRST_RENDER_TIMEOUT });
    await page.waitForFunction(() => {
        const f = document.querySelector('iframe');
        return f && [...f.attributes].some(a => a.name.endsWith('-loaded'));
    }, null, { timeout: FIRST_RENDER_TIMEOUT });
    const frame = await frameEl.contentFrame();
    await frame.waitForFunction(() => !document.body.classList.contains('loading'), null, { timeout: FIRST_RENDER_TIMEOUT });
    if (tool === 'picker') {
        // Click the ad banner: the click hits the overlay's svg, the content
        // script answers candidatesAtPoint, the dialog opens.
        const box = await (await page.$('#target')).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await frame.waitForSelector('#candidateFilters li', { timeout: 10_000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
    return frame;
}

const VIEWS = [
    { id: 'dashboard-settings', url: '/dashboard.html', prepare: p => waitDashboardReady(p) },
    { id: 'dashboard-filters-embedded', url: '/dashboard.html', prepare: p => showPane(p, 'filters', { embed: true }) },
    { id: 'dashboard-develop-embedded', url: '/dashboard.html', prepare: p => showPane(p, 'develop', { embed: true }) },
    { id: 'picker', url: '/__legacy/host.html?tool=picker', prepare: p => startOverlay(p, 'picker') },
    { id: 'zapper', url: '/__legacy/host.html?tool=zapper', prepare: p => startOverlay(p, 'zapper') },
    { id: 'unpicker', url: '/__legacy/host.html?tool=unpicker', prepare: p => startOverlay(p, 'unpicker') },
    { id: 'report', url: '/report.html?url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=2&tabid=7', prepare: p => p.waitForTimeout(400) },
    { id: 'matched-rules', url: '/matched-rules.html?tab=7', prepare: p => p.waitForSelector('#matchedEntries > *', { timeout: 10_000 }).catch(() => {}) },
    { id: 'strictblock', url: '/strictblock.html#https://tracker.example.net/landing?id=42', prepare: p => p.waitForTimeout(400) },
    // The classic popup (popup-classic.html in STAGE = upstream popup.html), the React popup's fallback.
    { id: 'popup-classic', url: '/popup.html', viewport: { width: 360, height: 560 }, prepare: p => p.waitForFunction(() => !document.body.classList.contains('loading') && document.querySelector('.filteringModeSlider[data-level]'), null, { timeout: 10_000 }).then(() => p.waitForTimeout(200)) },
];

const viewById = id => VIEWS.find(v => v.id === id);

async function renderView(siteName, view, colorScheme) {
    const context = await newContext({ colorScheme, ...(view.viewport ? { viewport: view.viewport } : {}) });
    try {
        const { page, errors, requests } = await openPage(context, `${sites[siteName].server.url}${view.url}`);
        await view.prepare(page);
        await page.evaluate(() => document.fonts?.ready);
        const png = SHOTS ? await page.screenshot({ animations: 'disabled' }) : null;
        return { page, errors, requests, png, context };
    } catch (err) {
        await context.close();
        throw err;
    }
}

/* ---------------------------------------------------------------- L-3 / L-4 */

test('L-3/L-4: all 256 names are defined and no colour variable is invalid (dashboard, popup, report, matched-rules, strictblock)', async () => {
    const names = [...generated.light.keys()];
    assert.equal(names.length, 256);
    for (const scheme of ['light', 'dark']) {
        for (const id of ['dashboard-settings', 'popup-classic', 'report', 'matched-rules', 'strictblock']) {
            const r = await renderView('after', viewById(id), scheme);
            try {
                const res = await r.page.evaluate(list => {
                    const cs = getComputedStyle(document.documentElement);
                    const empty = list.filter(n => cs.getPropertyValue(n).trim() === '');
                    const parent = document.createElement('div');
                    parent.style.color = 'rgb(1, 2, 3)';
                    document.body.append(parent);
                    const invalid = [];
                    let colours = 0;
                    for (const n of list) {
                        const v = cs.getPropertyValue(n).trim();
                        // Colour-valued names: the substituted value parses as a colour,
                        // or it is a broken rgb(...) a triplet consumer would produce.
                        if (!CSS.supports('color', v) && !/^(?:rgb|#)/.test(v)) { continue; }
                        colours += 1;
                        const span = document.createElement('span');
                        span.style.color = `var(${n})`;
                        parent.append(span);
                        if (getComputedStyle(span).color === 'rgb(1, 2, 3)') { invalid.push(`${n}=${v}`); }
                    }
                    parent.remove();
                    return { empty, invalid, colours };
                }, names);
                assert.deepEqual(res.empty, [], `${id} ${scheme}: empty names`);
                assert.deepEqual(res.invalid, [], `${id} ${scheme}: invalid colour names`);
                assert.ok(res.colours > 100, `${id} ${scheme}: only ${res.colours} colour names probed`);
            } finally {
                await r.context.close();
            }
        }
    }
});

/* ---------------------------------------------------------------- L-5 */

test('L-5: overlay frames keep a transparent html/body and no color-scheme, in both schemes', async () => {
    for (const scheme of ['light', 'dark']) {
        for (const id of ['picker', 'zapper', 'unpicker']) {
            const r = await renderView('after', viewById(id), scheme);
            try {
                const frame = await (await r.page.$('iframe')).contentFrame();
                const got = await frame.evaluate(() => ({
                    html: getComputedStyle(document.documentElement).backgroundColor,
                    body: getComputedStyle(document.body).backgroundColor,
                    scheme: getComputedStyle(document.documentElement).colorScheme,
                    dark: document.documentElement.classList.contains('dark'),
                    // The panel surface (--surface-1): the aside, or zapper's buttons (zapper-ui.css:15).
                    asideBg: getComputedStyle(document.querySelector('#ubol-zapper aside > div') ?? document.querySelector('aside')).backgroundColor,
                }));
                assert.equal(got.html, 'rgba(0, 0, 0, 0)', `${id} ${scheme} html`);
                assert.equal(got.body, 'rgba(0, 0, 0, 0)', `${id} ${scheme} body`);
                assert.equal(got.scheme, 'normal', `${id} ${scheme} color-scheme`);
                assert.equal(got.dark, scheme === 'dark', `${id} ${scheme} theme.js class`);
                assert.equal(got.asideBg, scheme === 'dark' ? 'rgb(33, 33, 33)' : 'rgb(255, 255, 255)', `${id} ${scheme} panel = --surface-1`);
            } finally {
                await r.context.close();
            }
        }
    }
});

/* ---------------------------------------------------------------- L-6 / L-7 */

const bodyColours = page => page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return [cs.backgroundColor, cs.color];
});

test('L-6: classic dashboard body colours after theme.js', async () => {
    for (const [scheme, want] of [['light', ['rgb(255, 255, 255)', 'rgb(13, 13, 13)']], ['dark', ['rgb(33, 33, 33)', 'rgb(255, 255, 255)']]]) {
        const r = await renderView('after', viewById('dashboard-settings'), scheme);
        try {
            assert.deepEqual(await bodyColours(r.page), want, scheme);
        } finally {
            await r.context.close();
        }
    }
});

test('L-7: behaviour matrix of spec 5.2 (no JS dark; live switches keep the load scheme)', async () => {
    // (a) JavaScript disabled, OS dark: fully dark from the media query alone.
    const noJs = await newContext({ colorScheme: 'dark', javaScriptEnabled: false });
    try {
        const { page } = await openPage(noJs, `${sites.after.server.url}/report.html`);
        assert.deepEqual(await bodyColours(page), ['rgb(33, 33, 33)', 'rgb(255, 255, 255)'], 'no-JS dark');
    } finally { await noJs.close(); }
    // (b) loaded light, OS switches to dark: stays light.
    let r = await renderView('after', viewById('dashboard-settings'), 'light');
    try {
        await r.page.emulateMedia({ colorScheme: 'dark' });
        assert.deepEqual(await bodyColours(r.page), ['rgb(255, 255, 255)', 'rgb(13, 13, 13)'], 'light -> dark');
    } finally { await r.context.close(); }
    // (c) loaded dark, OS switches to light: stays dark.
    r = await renderView('after', viewById('dashboard-settings'), 'dark');
    try {
        await r.page.emulateMedia({ colorScheme: 'light' });
        assert.deepEqual(await bodyColours(r.page), ['rgb(33, 33, 33)', 'rgb(255, 255, 255)'], 'dark -> light');
    } finally { await r.context.close(); }
});

/* ---------------------------------------------------------------- L-8 */

test('L-8: prefers-contrast: more', async () => {
    const r = await renderView('after', viewById('dashboard-settings'), 'light');
    try {
        const read = () => r.page.evaluate(() => {
            const cs = getComputedStyle(document.documentElement);
            return [cs.getPropertyValue('--button-border-size').trim(), cs.getPropertyValue('--native-control-opacity').trim()];
        });
        assert.deepEqual(await read(), ['0', '0']);
        await r.page.emulateMedia({ contrast: 'more' });
        assert.deepEqual(await read(), ['1px', '1']);
    } finally { await r.context.close(); }
});

/* ---------------------------------------------------------------- L-9 */

test('L-9: embed marker hides the classic header and the foreign panes only when present', async () => {
    const r = await renderView('after', viewById('dashboard-settings'), 'light');
    try {
        const state = () => r.page.evaluate(() => {
            const d = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'missing'; };
            return {
                header: d('body > header'),
                settings: d('section[data-pane="settings"]'),
                rulesets: d('section[data-pane="rulesets"]'),
                filters: d('section[data-pane="filters"]'),
                develop: d('section[data-pane="develop"]'),
                about: d('section[data-pane="about"]'),
                busy: d('section[data-pane="busy"]'),
            };
        });
        let s = await state();
        assert.equal(s.header, 'block');
        assert.equal(s.settings, 'block');
        await r.page.evaluate(() => document.documentElement.setAttribute('data-blocker-embed', 'classic-dashboard'));
        for (const pane of ['settings', 'rulesets', 'about', 'busy']) {
            await r.page.evaluate(p => {
                document.body.dataset.pane = p;
                document.body.classList.toggle('busy', p === 'busy');
            }, pane);
            s = await state();
            assert.equal(s.header, 'none', `header with pane ${pane}`);
            for (const k of ['settings', 'rulesets', 'about', 'busy']) { assert.equal(s[k], 'none', `${k} with pane ${pane}`); }
        }
        await r.page.evaluate(() => document.body.classList.remove('busy'));
        for (const pane of ['filters', 'develop']) {
            await r.page.evaluate(p => { document.body.dataset.pane = p; }, pane);
            s = await state();
            assert.equal(s[pane], 'block', `${pane} visible with the marker`);
        }
    } finally { await r.context.close(); }
});

/* ---------------------------------------------------------------- L-10, L-2 */

test('L-10/L-2: no font requests; no console error that the upstream stylesheet does not also produce', async () => {
    for (const scheme of ['light', 'dark']) {
        for (const view of VIEWS) {
            const a = await renderView('after', view, scheme);
            const b = await renderView('before', view, scheme);
            try {
                const fonts = a.requests.filter(u => /\/css\/fonts\//.test(u));
                assert.deepEqual(fonts, [], `${view.id} ${scheme}: font requests`);
                const extra = a.errors.filter(e => !b.errors.includes(e));
                assert.deepEqual(extra, [], `${view.id} ${scheme}: console errors only with the generated css`);
                const remote = a.requests.filter(u => !u.startsWith(sites.after.server.url) && !u.startsWith('data:') && !u.startsWith('blob:') && u !== 'about:blank');
                assert.deepEqual(remote, [], `${view.id} ${scheme}: requests outside the local server`);
                if (SHOTS) { await saveComposite(view.id, scheme, b.png, a.png); }
            } finally {
                await a.context.close();
                await b.context.close();
            }
        }
    }
});

/* ---------------------------------------------------------------- L-11 / L-12 */

test('L-11/L-12: Develop editor chrome colours and focused selection', async () => {
    const want = {
        light: { editor: 'rgb(255, 255, 255)', gutterBg: 'rgb(249, 249, 249)', gutterInk: 'rgb(93, 93, 93)', activeLine: 'rgba(13, 13, 13, 0.02)', activeLineGutter: 'rgba(13, 13, 13, 0.02)', cursor: 'rgb(13, 13, 13)', ring: 'rgb(1, 105, 204)' },
        dark: { editor: 'rgb(13, 13, 13)', gutterBg: 'rgb(24, 24, 24)', gutterInk: 'rgb(175, 175, 175)', activeLine: 'rgba(255, 255, 255, 0.06)', activeLineGutter: 'rgba(255, 255, 255, 0.06)', cursor: 'rgb(255, 255, 255)', ring: 'rgb(51, 156, 255)' },
    };
    for (const scheme of ['light', 'dark']) {
        const r = await renderView('after', viewById('dashboard-develop-embedded'), scheme);
        try {
            // Caret only (no selection yet): the active line and its gutter are drawn.
            await r.page.click('section[data-pane="develop"] .cm-content');
            await r.page.waitForSelector('section[data-pane="develop"] .cm-activeLine', { timeout: 5_000 });
            const caret = await r.page.evaluate(() => {
                const cs = s => { const e = document.querySelector(`section[data-pane="develop"] ${s}`); return e ? getComputedStyle(e) : null; };
                const editor = cs('.cm-editor');
                return {
                    activeLine: cs('.cm-activeLine')?.backgroundColor ?? 'none',
                    activeLineGutter: cs('.cm-activeLineGutter')?.backgroundColor ?? 'none',
                    outline: [editor.outlineStyle, editor.outlineWidth, editor.outlineColor, editor.outlineOffset],
                };
            });
            assert.equal(caret.activeLine, want[scheme].activeLine, `${scheme} activeLine`);
            assert.equal(caret.activeLineGutter, want[scheme].activeLineGutter, `${scheme} activeLineGutter`);
            // V5/L-16: the focused editor shows the B7 ring, not CodeMirror's 1px dotted #212121.
            assert.deepEqual(caret.outline, ['solid', '2px', want[scheme].ring, '0px'], `${scheme} focused editor outline`);
            await r.page.keyboard.press('ControlOrMeta+a');
            await r.page.waitForSelector('section[data-pane="develop"] .cm-selectionLayer .cm-selectionBackground', { state: 'attached', timeout: 5_000 });
            const got = await r.page.evaluate(() => {
                const q = s => document.querySelector(`section[data-pane="develop"] ${s}`);
                const cs = s => { const e = q(s); return e ? getComputedStyle(e) : null; };
                return {
                    editor: cs('.cm-editor').backgroundColor,
                    gutterBg: cs('.cm-gutters').backgroundColor,
                    gutterInk: cs('.cm-gutters').color,
                    cursor: cs('.cm-cursor')?.borderLeftColor ?? 'none',
                    selection: cs('.cm-selectionLayer .cm-selectionBackground')?.backgroundColor ?? 'none',
                    focused: q('.cm-editor').classList.contains('cm-focused'),
                };
            });
            for (const k of ['editor', 'gutterBg', 'gutterInk', 'cursor']) {
                assert.equal(got[k], want[scheme][k], `${scheme} ${k}`);
            }
            assert.equal(got.focused, true, `${scheme} editor focused`);
            assert.equal(got.selection, 'rgba(2, 133, 255, 0.25)', `${scheme} focused selection`);
        } finally { await r.context.close(); }
    }
});

/* ---------------------------------------------------------------- L-16 */

/** Presses Tab (in `page`, focus inside `target`) until `pick(activeElement)` holds; returns its description. */
async function tabUntil(page, target, pick, max = 25) {
    for (let i = 0; i < max; i++) {
        await page.keyboard.press('Tab');
        const hit = await target.evaluate(pick);
        if (hit) { return hit; }
    }
    return null;
}

const ACCENT = { light: 'rgb(1, 105, 204)', dark: 'rgb(51, 156, 255)' };
const ringOf = el => { const cs = getComputedStyle(el); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor]; };

test('L-16: keyboard focus is visible (picker button, report and strictblock checkboxes, classic popup); overlays start without a ring', async () => {
    for (const scheme of ['light', 'dark']) {
        // Overlays: nothing matches :focus-visible right after start-up (no ring around the page).
        for (const id of ['picker', 'zapper', 'unpicker']) {
            const r = await renderView('after', viewById(id), scheme);
            try {
                const frame = await (await r.page.$('iframe')).contentFrame();
                const fv = await frame.evaluate(() => document.querySelector(':focus-visible')?.outerHTML.slice(0, 80) ?? null);
                assert.equal(fv, null, `${id} ${scheme}: element ringed at start-up`);
                if (id === 'picker') {
                    const hit = await tabUntil(r.page, frame, () => {
                        const el = document.activeElement;
                        return el && el.tagName === 'BUTTON' && el.matches(':focus-visible') ? el.id || el.textContent.trim() : null;
                    });
                    assert.ok(hit, `${scheme}: no picker button reached with Tab`);
                    const ring = await frame.evaluate(`(${ringOf.toString()})(document.activeElement)`);
                    assert.deepEqual(ring, ['solid', '2px', ACCENT[scheme]], `${scheme} picker button ${hit}`);
                    if (SHOTS) { await r.page.screenshot({ path: await screenshotPath(`legacy-focus-picker-${scheme}.png`), animations: 'disabled' }); }
                }
            } finally { await r.context.close(); }
        }
        // Checkboxes drawn as an svg over an invisible input: the svg gets the ring.
        for (const id of ['report', 'strictblock']) {
            const r = await renderView('after', viewById(id), scheme);
            try {
                const hit = await tabUntil(r.page, r.page, () => {
                    const el = document.activeElement;
                    return el && el.matches('.checkbox > input[type="checkbox"]') ? el.closest('label')?.id || el.parentElement.parentElement.id || 'checkbox' : null;
                });
                assert.ok(hit, `${id} ${scheme}: no checkbox reached with Tab`);
                const ring = await r.page.evaluate(`(${ringOf.toString()})(document.activeElement.nextElementSibling)`);
                assert.deepEqual(ring, ['solid', '2px', ACCENT[scheme]], `${id} ${scheme} checkbox svg`);
                if (SHOTS) { await r.page.screenshot({ path: await screenshotPath(`legacy-focus-${id}-${scheme}.png`), animations: 'disabled' }); }
            } finally { await r.context.close(); }
        }
        // Classic popup (popup.css:37 removes every outline).
        const r = await renderView('after', viewById('popup-classic'), scheme);
        try {
            const hit = await tabUntil(r.page, r.page, () => {
                const el = document.activeElement;
                return el && el !== document.body && el.matches(':focus-visible') ? el.id || el.className || el.tagName : null;
            });
            assert.ok(hit, `popup ${scheme}: nothing reached with Tab`);
            const ring = await r.page.evaluate(`(${ringOf.toString()})(document.activeElement)`);
            assert.deepEqual(ring, ['solid', '2px', ACCENT[scheme]], `popup ${scheme} ${hit}`);
            if (SHOTS) { await r.page.screenshot({ path: await screenshotPath(`legacy-focus-popup-classic-${scheme}.png`), animations: 'disabled' }); }
        } finally { await r.context.close(); }
    }
});

/* ---------------------------------------------------------------- L-13 */

test('L-13: the React pages never link css/default.css and the generated file imports nothing', () => {
    for (const f of ['popup.html', 'dashboard.html']) {
        const html = fs.readFileSync(path.join(UI_ROOT, f), 'utf8');
        assert.ok(!html.includes('css/default.css'), f);
    }
    assert.ok(!/@import/i.test(generated.css));
});

/* ---------------------------------------------------------------- screenshots */

async function saveComposite(viewId, scheme, beforePng, afterPng) {
    const context = await chrome.browser.newContext({ viewport: { width: 2040, height: 820 }, deviceScaleFactor: 1, colorScheme: 'light' });
    try {
        const page = await context.newPage();
        const img = buf => `data:image/png;base64,${buf.toString('base64')}`;
        await page.setContent(`<!doctype html><html><body style="margin:0;background:#888;font:600 14px system-ui,sans-serif;color:#fff">
            <div style="display:flex;gap:20px;padding:10px 10px 10px">
              <figure style="margin:0"><figcaption style="padding:0 0 6px">BEFORE (upstream css/default.css) - ${viewId} - ${scheme}</figcaption><img src="${img(beforePng)}" style="display:block;outline:1px solid #000"></figure>
              <figure style="margin:0"><figcaption style="padding:0 0 6px">AFTER (generated css/default.css) - ${viewId} - ${scheme}</figcaption><img src="${img(afterPng)}" style="display:block;outline:1px solid #000"></figure>
            </div></body></html>`);
        await page.waitForFunction(() => [...document.images].every(i => i.complete));
        await page.screenshot({ path: await screenshotPath(`legacy-${viewId}-${scheme}.png`), fullPage: true, animations: 'disabled' });
    } finally {
        await context.close();
    }
}

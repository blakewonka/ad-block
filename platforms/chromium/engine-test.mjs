#!/usr/bin/env node
/*
 * engine-test.mjs — drive the Blocker UI against the REAL extension engine in
 * Google Chrome: real toolbar popup, real service worker, real DNR rulesets,
 * real network requests. Optional developer tool (not part of scripts/build.sh).
 *
 *   node platforms/chromium/engine-test.mjs [--dir build/stage/chromium] [--channel chrome|msedge|chromium]
 *                                           [--executable PATH] [--screenshots DIR] [--headed]
 *
 * Needs ui/node_modules (playwright-core) and an installed Google Chrome. The
 * browser runs with a NEW temporary profile that is deleted afterwards. Every
 * host name is resolved to 127.0.0.1 (--host-resolver-rules), so the "ad"
 * requests of the test page reach a local server, never the internet.
 *
 * How it works:
 *   - the extension is loaded with the DevTools command Extensions.loadUnpacked
 *     (branded Chrome 137+ ignores --load-extension);
 *   - the toolbar popup is opened for real with chrome.action.openPopup() from
 *     the service worker, so the popup finds its tab exactly as for a user; it is
 *     driven through a second DevTools connection (connectOverCDP), because
 *     Playwright's launch connection does not expose action popups;
 *   - the test page http://blocker-test.localhost:<port>/ loads one script from
 *     itself and three from ad/tracker hosts; a script whose `error` event fires
 *     (the server always answers 200) was blocked. The server log and Chrome's
 *     net::ERR_BLOCKED_BY_CLIENT confirm it.
 *
 * Scenario:
 *   1. default lists: ads + pgl-only host blocked, cookie-notice host allowed;
 *   2. popup: "no filtering" -> page reloads, nothing blocked, background state 0;
 *      "complete" -> blocked again, generic cosmetic filtering hides an ad slot;
 *      back to "optimal";
 *   3. dashboard (opened from the popup): Filter lists — turn "Peter Lowe's"
 *      (pgl) off and "cookie notices" (annoyances-cookies) on -> the background's
 *      enabled rulesets follow, the pgl-only host loads, the cookie host is
 *      blocked, ads stay blocked;
 *      Settings — default mode basic -> background default 1, then optimal again;
 *   4. no uncaught error and no console error on our pages.
 */

import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { REPO, UI, fail, isDir, isFile, rel, runMain } from '../../scripts/lib/common.mjs';

const NAME = 'engine-test';
const SITE_HOST = 'blocker-test.localhost';

/* Hosts chosen from the rulesets themselves: each is blocked by exactly the list named. */
const PROBES = [
    { name: 'first', host: SITE_HOST, note: 'first party, never blocked' },
    { name: 'ads', host: 'ad.doubleclick.net', note: 'EasyList / Peter Lowe (default lists)' },
    { name: 'pgl', host: '180hits.de', note: "only Peter Lowe's list (pgl, default on)" },
    { name: 'cookies', host: 'appconsent.io', note: 'only cookie notices (annoyances-cookies, default off)' },
];
/* Generic cosmetic candidates (hidden only in "complete" mode). */
const COSMETIC = ['ad-banner', 'adsbygoogle', 'advertisement', 'ad-slot', 'banner-ad'];

function parseArgs(argv) {
    const o = { dir: path.join(REPO, 'build', 'stage', 'chromium'), channel: 'chrome', headless: true };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const v = argv[i + 1];
        if (a === '--dir' && v) { o.dir = path.resolve(v); i++; }
        else if (a === '--channel' && v) { o.channel = v; i++; }
        else if (a === '--executable' && v) { o.executable = path.resolve(v); i++; }
        else if (a === '--screenshots' && v) { o.screenshots = path.resolve(v); i++; }
        else if (a === '--headed') o.headless = false;
        else fail(`unknown argument ${a}`);
    }
    return o;
}

function loadPlaywright() {
    const req = createRequire(path.join(UI, 'package.json'));
    try {
        return req('playwright-core');
    } catch {
        fail('playwright-core not found; run `npm --prefix ui ci --ignore-scripts` first');
    }
}

function testPage(port) {
    const probes = PROBES.map(p => [p.name, `http://${p.host}:${port}/probe/${p.name}.js`]);
    const slots = COSMETIC.map(c => `<div class="${c}" data-cosmetic="${c}" style="width:300px;height:40px;background:#fc6">${c}</div>`).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Blocker engine test</title>
<script>
window.__probes = {};
window.__probeDone = Promise.all(${JSON.stringify(probes)}.map(([name, url]) => new Promise(resolve => {
    const s = document.createElement('script');
    s.src = url + '?t=' + Date.now();
    s.onload = () => { window.__probes[name] = 'loaded'; resolve(); };
    s.onerror = () => { window.__probes[name] = 'blocked'; resolve(); };
    document.head.appendChild(s);
}))).then(() => window.__probes);
</script></head>
<body style="font:16px system-ui;margin:24px"><h1>Blocker engine test page</h1>
<p>Scripts from ad hosts below; the cosmetic slots are hidden in "complete" mode.</p>
${slots}
</body></html>`;
}

function startServer(hits) {
    const server = http.createServer((req, res) => {
        const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
        const url = new URL(req.url, 'http://x');
        if (url.pathname.startsWith('/probe/')) {
            hits.push(`${host}${url.pathname}`);
            res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
            res.end('/* probe */');
            return;
        }
        if (host === SITE_HOST && url.pathname === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(testPage(server.address().port));
            return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (!isDir(o.dir) || !isFile(path.join(o.dir, 'manifest.json'))) {
        fail(`not an extension folder: ${o.dir} (build it with scripts/build.sh chromium)`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(o.dir, 'manifest.json'), 'utf8'));
    const manifestHasFeedback = (manifest.permissions ?? []).includes('declarativeNetRequestFeedback');
    const { chromium } = loadPlaywright();
    if (o.screenshots) fs.mkdirSync(o.screenshots, { recursive: true });

    const results = [];
    const ok = (name, pass, detail = '') => {
        results.push({ name, pass, detail });
        console.log(`${NAME}: ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
        return pass;
    };
    const pageProblems = [];
    const pageWarnings = [];
    const watch = (page, label) => {
        page.on('pageerror', e => pageProblems.push(`${label}: uncaught ${e.message}`));
        page.on('console', msg => {
            if (msg.type() === 'error') pageProblems.push(`${label}: console.error ${msg.text()}`);
            else if (msg.type() === 'warning') pageWarnings.push(`${label}: ${msg.text()}`);
        });
    };
    const shot = async (page, name) => {
        if (o.screenshots) await page.screenshot({ path: path.join(o.screenshots, `${name}.png`) });
    };

    const hits = [];
    const server = await startServer(hits);
    const port = server.address().port;
    const siteURL = `http://${SITE_HOST}:${port}/`;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blocker-engine-'));
    let ctx;
    let cdpBrowser;
    try {
        ctx = await chromium.launchPersistentContext(userData, {
            ...(o.executable ? { executablePath: o.executable } : { channel: o.channel }),
            headless: o.headless,
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
                '--enable-unsafe-extension-debugging',
                '--no-first-run',
                '--no-default-browser-check',
                // Every host (ad hosts included) goes to the local server.
                '--host-resolver-rules=MAP * 127.0.0.1',
                // Second DevTools connection, used for the toolbar popup only.
                '--remote-debugging-port=0',
            ],
            viewport: { width: 1100, height: 800 },
        });
        console.log(`${NAME}: browser ${ctx.browser()?.version() ?? '?'}; extension ${rel(o.dir)}`);

        /* ---------- load ---------- */
        const cdp = await ctx.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: o.dir });
        ok('extension loads (Extensions.loadUnpacked)', typeof id === 'string', id);
        const base = `chrome-extension://${id}`;
        const sw = ctx.serviceWorkers().find(w => w.url().startsWith(base))
            ?? await ctx.waitForEvent('serviceworker', { predicate: w => w.url().startsWith(base), timeout: 20_000 });
        const enabledAtStart = await sw.evaluate(async () => {
            for (let i = 0; i < 60; i++) {
                const ids = await chrome.declarativeNetRequest.getEnabledRulesets();
                if (ids.length !== 0) return ids;
                await new Promise(r => setTimeout(r, 250));
            }
            return [];
        });
        ok('service worker up, default rulesets enabled', enabledAtStart.includes('easylist') && enabledAtStart.includes('pgl'),
            enabledAtStart.join(', '));

        const devPort = fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
        cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${devPort}`);

        // Background helpers: the engine's view of a URL, and its stored state.
        const engineMatches = url => sw.evaluate(async ({ url, initiator }) => {
            const r = await chrome.declarativeNetRequest.testMatchOutcome({ url, type: 'script', initiator, tabId: -1 });
            return r.matchedRules.map(m => `${m.rulesetId}#${m.ruleId}`);
        }, { url, initiator: siteURL.slice(0, -1) });
        const enabledRulesets = () => sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());

        /* ---------- the test page ---------- */
        const site = ctx.pages()[0] ?? await ctx.newPage();
        const blockedByClient = [];
        site.on('requestfailed', r => {
            if (r.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT') blockedByClient.push(new URL(r.url()).hostname);
        });
        const resetLogs = () => {
            hits.length = 0;
            blockedByClient.length = 0;
        };
        // Without `reload`, the page was just reloaded by the popup (logs reset before the click).
        const probeSite = async (label, { reload = true } = {}) => {
            if (reload) {
                resetLogs();
                await site.goto(siteURL, { waitUntil: 'load' });
            }
            const probes = await site.evaluate(() => window.__probeDone);
            // Cosmetic filtering is applied asynchronously by content scripts.
            await site.waitForTimeout(1500);
            const hidden = await site.evaluate(() => [...document.querySelectorAll('[data-cosmetic]')]
                .filter(e => getComputedStyle(e).display === 'none' || e.offsetParent === null)
                .map(e => e.dataset.cosmetic));
            const summary = Object.entries(probes).map(([k, v]) => `${k}=${v}`).join(' ');
            console.log(`${NAME}: [${label}] ${summary}; server hits: ${hits.map(h => h.split('/')[0]).join(', ') || '-'}; `
                + `ERR_BLOCKED_BY_CLIENT: ${[...new Set(blockedByClient)].join(', ') || '-'}; hidden: ${hidden.join(', ') || '-'}`);
            return { probes, hidden, hits: [...hits], blocked: [...new Set(blockedByClient)] };
        };
        // A "blocked" probe must also be absent from the server log and reported by Chrome.
        const consistent = r => PROBES.every(p => {
            const reached = r.hits.some(h => h.startsWith(`${p.host}/probe/`));
            return r.probes[p.name] === 'blocked'
                ? !reached && r.blocked.includes(p.host)
                : r.probes[p.name] === 'loaded' && reached;
        });
        const expectProbes = (label, r, want) => {
            const got = Object.fromEntries(PROBES.map(p => [p.name, r.probes[p.name]]));
            const pass = PROBES.every(p => got[p.name] === want[p.name]) && consistent(r);
            return ok(label, pass, Object.entries(got).map(([k, v]) => `${k}=${v}`).join(' '));
        };

        const r1 = await probeSite('default lists, optimal');
        expectProbes('page: default lists block ads + pgl host, allow first party + cookie host', r1,
            { first: 'loaded', ads: 'blocked', pgl: 'blocked', cookies: 'loaded' });
        ok('engine agrees (testMatchOutcome)', (await engineMatches(`http://180hits.de:${port}/probe/pgl.js`)).some(m => m.startsWith('pgl#'))
            && (await engineMatches(`http://appconsent.io:${port}/probe/cookies.js`)).length === 0);
        await shot(site, 'chrome-site-optimal');

        /* ---------- the real toolbar popup ---------- */
        // Finds the popup page in a DevTools connection; a connection made before the popup
        // existed does not always report it, so a fresh connection is tried as well.
        const findPopup = async (browser, ms) => {
            const t0 = Date.now();
            for (;;) {
                for (const c of browser.contexts()) {
                    const p = c.pages().find(pg => !pg.isClosed() && pg.url().startsWith(`${base}/popup.html`));
                    if (p !== undefined) return p;
                }
                if (Date.now() - t0 >= ms) return null;
                await new Promise(r => setTimeout(r, 100));
            }
        };
        const openPopup = async () => {
            const stale = await findPopup(cdpBrowser, 0);
            if (stale !== null) await stale.close().catch(() => {});
            let opened = '';
            for (let i = 0; i < 10 && opened !== 'ok'; i++) {
                if (i !== 0) await new Promise(r => setTimeout(r, 300));
                await site.bringToFront();
                opened = await sw.evaluate(async () => {
                    try { await chrome.action.openPopup(); return 'ok'; } catch (e) { return String(e?.message ?? e); }
                });
            }
            if (opened !== 'ok') throw new Error(`chrome.action.openPopup(): ${opened}`);
            let popup = await findPopup(cdpBrowser, 3_000);
            if (popup === null) {
                await cdpBrowser.close().catch(() => {});
                cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${devPort}`);
                popup = await findPopup(cdpBrowser, 10_000);
            }
            if (popup === null) throw new Error('the toolbar popup did not appear');
            watch(popup, 'popup');
            await popup.waitForSelector('[data-testid="popup"][data-state="ready"]', { timeout: 15_000 });
            return popup;
        };
        const popupLevel = popup => popup.locator('[data-testid="popup"]').getAttribute('data-current-level');
        // The background keeps every mode in storage.local "filteringModeDetails" as
        // { none: [...], basic: [...], optimal: [...], complete: [...] } (mode-manager.js);
        // "all-urls" in one of them is the default mode, a site without an entry follows it.
        const levelOfSite = () => sw.evaluate(async () => {
            const { filteringModeDetails: details } = await chrome.storage.local.get('filteringModeDetails');
            const names = ['none', 'basic', 'optimal', 'complete'];
            const defaultFilteringMode = names.findIndex(k => (details?.[k] ?? []).includes('all-urls'));
            return { details, defaultFilteringMode };
        });

        let popup = await openPopup();
        const host = await popup.locator('[data-testid="hostname"]').innerText();
        ok('popup (chrome.action.openPopup) shows the test site', host.replace(/\s/g, '') === SITE_HOST, host);
        ok('popup: level optimal (2)', await popupLevel(popup) === '2');
        await shot(popup, 'chrome-popup-optimal');

        const setLevelInPopup = async (level, label) => {
            resetLogs();
            const reloaded = site.waitForEvent('load', { timeout: 15_000 }).then(() => true, () => false);
            await popup.locator(`[data-level="${level}"] [role="radio"]`).click();
            await popup.waitForFunction(l => document.querySelector('[data-testid="popup"]')?.getAttribute('data-current-level') === String(l)
                && document.querySelector('[data-testid="busy-overlay"]') === null, level, { timeout: 15_000 });
            const didReload = await reloaded;
            ok(`popup -> ${label}: the tab reloads (auto-reload on)`, didReload);
            const state = await levelOfSite();
            return state;
        };

        let st = await setLevelInPopup(0, 'no filtering');
        console.log(`${NAME}: background filteringModeDetails after "no filtering": ${JSON.stringify(st.details)}`);
        ok('background: site is in "no filtering" (none)', JSON.stringify(st.details?.none ?? []).includes(SITE_HOST));
        const r2 = await probeSite('site = no filtering', { reload: false });
        expectProbes('page: nothing blocked in "no filtering"', r2, { first: 'loaded', ads: 'loaded', pgl: 'loaded', cookies: 'loaded' });
        ok('page: no cosmetic hiding in "no filtering"', r2.hidden.length === 0, r2.hidden.join(', '));
        if (popup.isClosed()) popup = await openPopup();
        ok('popup: shows level 0 after the reload', await popupLevel(popup) === '0');
        await shot(popup, 'chrome-popup-no-filtering');

        st = await setLevelInPopup(3, 'complete');
        ok('background: site is in "complete"', JSON.stringify(st.details?.complete ?? []).includes(SITE_HOST)
            && !JSON.stringify(st.details?.none ?? []).includes(SITE_HOST), JSON.stringify(st.details));
        const r3 = await probeSite('site = complete', { reload: false });
        expectProbes('page: blocking back in "complete"', r3, { first: 'loaded', ads: 'blocked', pgl: 'blocked', cookies: 'loaded' });
        ok('page: generic cosmetic filtering hides an ad slot in "complete"', r3.hidden.length > 0, r3.hidden.join(', '));
        await shot(site, 'chrome-site-complete');
        if (popup.isClosed()) popup = await openPopup();
        await shot(popup, 'chrome-popup-complete');

        st = await setLevelInPopup(2, 'optimal');
        ok('background: site follows the default again (no per-site entry)',
            !['none', 'basic', 'complete'].some(k => JSON.stringify(st.details?.[k] ?? []).includes(SITE_HOST)), JSON.stringify(st.details));

        /* ---------- dashboard, opened from the popup ---------- */
        if (popup.isClosed()) popup = await openPopup();
        const dashOpened = ctx.waitForEvent('page', { predicate: p => p.url().startsWith(`${base}/dashboard.html`), timeout: 15_000 });
        await popup.locator('#gotoDashboard').click();
        const dash = await dashOpened.catch(() => null);
        ok('popup dashboard button opens dashboard.html in a tab', dash !== null);
        if (dash === null) throw new Error('no dashboard');
        watch(dash, 'dashboard');
        await dash.setViewportSize({ width: 1100, height: 900 });
        const tab = paneId => dash.locator(`[role="tab"][id$="-trigger-${paneId}"]`);
        await tab('rulesets').waitFor({ timeout: 15_000 });
        await tab('rulesets').click();
        const pane = dash.locator('[data-pane-id="rulesets"]');
        const leaf = rid => pane.locator(`[data-testid="leaf-checkbox-${rid}"]`);
        await leaf('pgl').waitFor({ timeout: 15_000 });
        ok('Filter lists: pgl checked, annoyances-cookies unchecked (real background)',
            await leaf('pgl').isChecked() && !(await leaf('annoyances-cookies').isChecked().catch(() => false)));
        // Expand collapsed groups until the cookie-notice list is reachable.
        for (const t of await pane.locator('[data-testid="group-toggle"][aria-expanded="false"]').all()) {
            if (await leaf('annoyances-cookies').isVisible()) break;
            await t.click();
        }
        await leaf('pgl').click();
        await leaf('annoyances-cookies').click();
        let enabledNow = [];
        for (let i = 0; i < 60; i++) {
            enabledNow = await enabledRulesets();
            if (!enabledNow.includes('pgl') && enabledNow.includes('annoyances-cookies')) break;
            await dash.waitForTimeout(250);
        }
        ok('background: enabled rulesets follow the dashboard (-pgl +annoyances-cookies)',
            !enabledNow.includes('pgl') && enabledNow.includes('annoyances-cookies') && enabledNow.includes('easylist'), enabledNow.join(', '));
        // Screenshot once the pane no longer says "Saving…".
        await dash.waitForFunction(() => !(document.querySelector('[data-testid="filter-lists-commit-status"]')?.textContent ?? '').includes('Saving'),
            null, { timeout: 10_000 }).catch(() => {});
        await shot(dash, 'chrome-dashboard-filter-lists');
        ok('engine agrees: pgl host no longer matched, cookie host matched',
            (await engineMatches(`http://180hits.de:${port}/probe/pgl.js`)).length === 0
            && (await engineMatches(`http://appconsent.io:${port}/probe/cookies.js`)).some(m => m.startsWith('annoyances-cookies#')));

        const r4 = await probeSite('-pgl +annoyances-cookies');
        expectProbes('page: pgl host loads, cookie host blocked, ads still blocked', r4,
            { first: 'loaded', ads: 'blocked', pgl: 'loaded', cookies: 'blocked' });

        // Reopen the dashboard: the pane reads the new state back from the background.
        await dash.reload();
        await tab('rulesets').click();
        await leaf('pgl').waitFor({ timeout: 15_000 });
        ok('Filter lists after reload: pgl off, annoyances-cookies on',
            !(await leaf('pgl').isChecked()) && await leaf('annoyances-cookies').isChecked().catch(() => false));

        // Settings: the default filtering mode.
        await tab('settings').click();
        const radio = name => dash.locator('[data-pane-id="settings"]').getByRole('radio', { name, exact: true });
        await radio('optimal').waitFor({ timeout: 15_000 });
        ok('Settings: optimal is the default', await radio('optimal').isChecked());
        await radio('basic').click();
        let def;
        for (let i = 0; i < 40; i++) {
            def = (await levelOfSite()).defaultFilteringMode;
            if (def === 1) break;
            await dash.waitForTimeout(250);
        }
        ok('background: default mode basic (1)', def === 1, String(def));
        await shot(dash, 'chrome-dashboard-settings');
        if (popup.isClosed()) popup = await openPopup();
        ok('popup follows the new default (basic)', await popupLevel(popup) === '1');
        await popup.close().catch(() => {});
        const r5 = await probeSite('default basic');
        expectProbes('page: network blocking still on in basic', r5, { first: 'loaded', ads: 'blocked', pgl: 'loaded', cookies: 'blocked' });
        await radio('optimal').click();
        for (let i = 0; i < 40; i++) {
            def = (await levelOfSite()).defaultFilteringMode;
            if (def === 2) break;
            await dash.waitForTimeout(250);
        }
        ok('background: default mode back to optimal (2)', def === 2, String(def));

        // Settings: strict blocking (Chromium only). A navigation to a blocked host shows
        // upstream's strictblock.html page; with the toggle off the navigation goes through.
        // 0019x.com: strict-block rule in EasyList and no pop-up filter (a pop-up filter makes
        // upstream close the tab). Not a host of a list toggled above: upstream's applyRulesets
        // does not rebuild the strict-block session rules (ruleset-manager.js), so those follow
        // the lists enabled when the rules were last built.
        const strictURL = `http://0019x.com:${port}/landing`;
        // The tab first shows the test site: a NEW tab whose first navigation goes to an ad host
        // is closed by upstream's pop-up blocking, which is not what is tested here.
        const nav = await ctx.newPage();
        await nav.goto(siteURL);
        await nav.goto(strictURL).catch(() => {});
        await nav.waitForURL(u => u.href.startsWith(`${base}/strictblock.html`), { timeout: 10_000 }).catch(() => {});
        ok('strict blocking on: navigation to a blocked host shows strictblock.html', nav.url().startsWith(`${base}/strictblock.html`),
            nav.url().slice(0, 60));
        const strictToggle = dash.locator('[data-testid="settings-toggle-strictBlockMode"]');
        ok('Settings: strict blocking toggle is on', await strictToggle.isChecked());
        // upstream ruleset-manager.js: strict-block rules are session rules of priority 29.
        const strictRules = () => sw.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules())
            .filter(r => r.priority === 29 && r.action.type === 'redirect').length);
        const strictBefore = await strictRules();
        await strictToggle.click();
        let strictAfter = strictBefore;
        for (let i = 0; i < 40 && strictAfter !== 0; i++) {
            await dash.waitForTimeout(250);
            strictAfter = await strictRules();
        }
        ok('background: strict-block session rules removed', strictBefore > 0 && strictAfter === 0, `${strictBefore} -> ${strictAfter}`);
        const navError = await nav.goto(strictURL).then(() => '', e => e.message.split('\n')[0]);
        const mainFrameMatch = await sw.evaluate(async url => (await chrome.declarativeNetRequest.testMatchOutcome({ url, type: 'main_frame', tabId: -1 }))
            .matchedRules.map(m => `${m.rulesetId}#${m.ruleId}`), strictURL);
        // The local server answers this path with "not found".
        const body = nav.isClosed() ? '' : (await nav.locator('body').innerText().catch(() => '')).trim();
        ok('strict blocking off: the same navigation reaches the site', !nav.isClosed() && nav.url() === strictURL && body === 'not found',
            `${nav.isClosed() ? 'tab closed' : nav.url().slice(0, 60)}; ${navError || body.slice(0, 60)}; main_frame rules: ${mainFrameMatch.join(', ') || '-'}`);
        await strictToggle.click();
        await nav.close().catch(() => {});

        // Settings: developer mode -> the popup offers "matched rules" (sideloaded build with
        // declarativeNetRequestFeedback only), which lists what the engine blocked on the tab.
        if (manifestHasFeedback) {
            const devToggle = dash.locator('[data-testid="settings-toggle-developerMode"]');
            await devToggle.click();
            await dash.waitForFunction(() => document.querySelector('[data-testid="settings-toggle-developerMode"]')?.getAttribute('aria-checked') === 'true'
                || document.querySelector('[data-testid="settings-toggle-developerMode"]')?.checked === true, null, { timeout: 5_000 }).catch(() => {});
            ok('Settings: developer mode on', await devToggle.isChecked());
            await probeSite('before matched rules');
            popup = await openPopup();
            const matchedButton = popup.locator('#gotoMatchedRules');
            ok('popup: "matched rules" button with developer mode', await matchedButton.count() === 1);
            if (await matchedButton.count() === 1) {
                await shot(popup, 'chrome-popup-developer');
                const win = ctx.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
                await matchedButton.click();
                const mr = await win;
                if (mr !== null) {
                    await mr.waitForLoadState('load').catch(() => {});
                    await mr.waitForFunction(() => document.body.innerText.includes('doubleclick'), null, { timeout: 10_000 }).catch(() => {});
                    const text = await mr.locator('body').innerText().catch(() => '');
                    ok('matched-rules.html lists the blocked ad host', mr.url().includes('/matched-rules.html?tab=') && text.includes('ad.doubleclick.net'),
                        mr.url().slice(base.length));
                    await mr.close().catch(() => {});
                } else {
                    ok('matched-rules.html lists the blocked ad host', false, 'no window');
                }
            }
            await devToggle.click();
        }

        // Custom filters: upstream's classic editor inside our dashboard (iframe). A cosmetic
        // filter added there must hide the test page's heading.
        await tab('filters').click();
        const frameHandle = await dash.waitForSelector('[data-pane-id="classic"] iframe, iframe', { timeout: 15_000 }).catch(() => null);
        const frame = await frameHandle?.contentFrame();
        let customOk = false;
        if (frame) {
            await frame.waitForLoadState('load').catch(() => {});
            const details = frame.locator('section[data-pane="filters"] details.importFromText');
            await details.locator('summary').click();
            await details.locator('textarea').fill(`${SITE_HOST}##h1`);
            await details.locator('p > button').first().click();
            let stored = [];
            for (let i = 0; i < 40; i++) {
                stored = await dash.evaluate(() => chrome.runtime.sendMessage({ what: 'getAllCustomFilters' })).catch(() => []);
                if (JSON.stringify(stored).includes(SITE_HOST)) break;
                await dash.waitForTimeout(250);
            }
            ok('Custom filters (classic iframe): the filter reaches the background', JSON.stringify(stored).includes(SITE_HOST),
                JSON.stringify(stored).slice(0, 80));
            await shot(dash, 'chrome-dashboard-custom-filters');
            await site.goto(siteURL, { waitUntil: 'load' });
            for (let i = 0; i < 20 && !customOk; i++) {
                customOk = await site.evaluate(() => getComputedStyle(document.querySelector('h1')).display === 'none');
                if (!customOk) await site.waitForTimeout(250);
            }
        }
        ok('page: the custom cosmetic filter hides the heading', customOk);

        // Popup tools: "Remove an element" and "Create a custom filter" inject upstream's overlay
        // (an iframe of zapper-ui.html / picker-ui.html) into the page, and close the popup.
        for (const [button, ui] of [['#gotoZapper', 'zapper-ui.html'], ['#gotoPicker', 'picker-ui.html']]) {
            await site.goto(siteURL, { waitUntil: 'load' });
            popup = await openPopup();
            await popup.locator(button).click();
            // The overlay iframe gets its URL through `location` (no src attribute): look at the frames.
            let injected = false;
            for (let i = 0; i < 50 && !injected; i++) {
                injected = site.frames().some(f => f.url().startsWith(`${base}/${ui}`));
                if (!injected) await site.waitForTimeout(200);
            }
            // The overlay's CSS comes from the background (insertCSS): the frame then covers the viewport.
            const covers = injected && await site.waitForFunction(() => [...document.documentElement.children].some(e => {
                if (e.tagName !== 'IFRAME') return false;
                const r = e.getBoundingClientRect();
                return r.width >= innerWidth - 1 && r.height >= innerHeight - 1;
            }), null, { timeout: 10_000 }).then(() => true, () => false);
            const closed = popup.isClosed() || await popup.waitForEvent('close', { timeout: 5_000 }).then(() => true, () => popup.isClosed());
            ok(`popup ${button}: ${ui} overlay injected and full-viewport, popup closed`, injected && covers && closed,
                `injected ${injected}, full-viewport ${covers}, closed ${closed}`);
            if (injected && ui === 'zapper-ui.html') await shot(site, 'chrome-site-zapper');
        }

        // Popup "Report an issue": opens upstream's report.html for this tab and mode.
        popup = await openPopup();
        const reportOpened = ctx.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
        await popup.locator('#gotoReport').click();
        const report = await reportOpened;
        if (report !== null) await report.waitForLoadState('load').catch(() => {});
        const reportURL = report === null ? '' : new URL(report.url());
        ok('popup #gotoReport: report.html for the site opens', reportURL !== '' && reportURL.pathname === '/report.html'
            && reportURL.searchParams.get('url') === siteURL && reportURL.searchParams.get('mode') !== null, report?.url().slice(base.length, base.length + 90));
        await report?.close().catch(() => {});
        await popup.close().catch(() => {});

        /* ---------- errors ---------- */
        ok('no page errors / console errors on our pages', pageProblems.length === 0, pageProblems.slice(0, 5).join(' | '));
        for (const w of new Set(pageWarnings)) console.log(`${NAME}: note: console.warn on ${w.slice(0, 200)}`);
    } finally {
        await cdpBrowser?.close().catch(() => {});
        await ctx?.close().catch(() => {});
        server.close();
        fs.rmSync(userData, { recursive: true, force: true });
    }
    const failed = results.filter(r => !r.pass).length;
    console.log(`${NAME}: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
    return failed === 0 ? 0 : 1;
}

runMain(NAME, main);

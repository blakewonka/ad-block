#!/usr/bin/env node
/*
 * smoke-test.mjs — load a Chrome / Edge package folder into a throw-away
 * headless browser and check that the extension and our pages work.
 * Optional developer tool (not part of scripts/build.sh).
 *
 *   node platforms/chromium/smoke-test.mjs [--dir build/package/chromium] [--channel chrome|msedge|chromium]
 *                                          [--executable PATH] [--screenshots DIR] [--headed]
 *
 * Needs: ui/node_modules (playwright-core, from `npm --prefix ui ci`) and an
 * installed Google Chrome (default), Microsoft Edge (--channel msedge) or any
 * Chromium binary (--executable). The browser runs with a NEW temporary profile
 * that is deleted afterwards; your own browser profile is never touched.
 *
 * Branded Chrome (137+) ignores --load-extension, so the extension is loaded
 * through the DevTools protocol (`Extensions.loadUnpacked`, needs
 * --enable-unsafe-extension-debugging over the DevTools pipe).
 *
 * Checks:
 *   1. the extension loads and its service worker starts;
 *   2. the service worker sees the expected manifest (name "Blocker"; in a
 *      release package no declarativeNetRequestFeedback) and its default
 *      rulesets are enabled;
 *   3. popup.html for a local test page (http://127.0.0.1:<port>/) renders the
 *      React popup in the "ready" state with the hostname; popup.html opened on
 *      its own renders the "not a website" state;
 *   4. dashboard.html renders; Settings (with the Chromium-only "strict
 *      blocking" toggle), Filter lists, Custom filters (classic iframe) and About
 *      panes open;
 *   5. no uncaught page error and no console error on any of our pages.
 */

import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { REPO, UI, fail, isDir, isFile, rel, runMain } from '../../scripts/lib/common.mjs';

const NAME = 'smoke-test';

function parseArgs(argv) {
    const o = { dir: path.join(REPO, 'build', 'package', 'chromium'), channel: 'chrome', headless: true };
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

function startServer() {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Blocker smoke test</title></head>'
        + '<body><h1>Blocker smoke test page</h1></body></html>';
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (!isDir(o.dir) || !isFile(path.join(o.dir, 'manifest.json'))) {
        fail(`not an extension folder: ${o.dir} (build it with scripts/build.sh chromium|edge)`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(o.dir, 'manifest.json'), 'utf8'));
    const isRelease = !(manifest.permissions ?? []).includes('declarativeNetRequestFeedback');
    const { chromium } = loadPlaywright();
    if (o.screenshots) fs.mkdirSync(o.screenshots, { recursive: true });

    const results = [];
    const ok = (name, pass, detail = '') => {
        results.push({ name, pass, detail });
        console.log(`${NAME}: ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
    };
    const pageProblems = [];

    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blocker-smoke-'));
    const server = await startServer();
    const origin = `http://127.0.0.1:${server.address().port}`;
    let ctx;
    try {
        ctx = await chromium.launchPersistentContext(userData, {
            ...(o.executable ? { executablePath: o.executable } : { channel: o.channel }),
            headless: o.headless,
            ignoreDefaultArgs: ['--disable-extensions'],
            args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
            viewport: { width: 1200, height: 900 },
        });
        console.log(`${NAME}: browser ${ctx.browser()?.version() ?? '?'}; package ${rel(o.dir)} (${isRelease ? 'release' : 'dev'})`);

        // 1. load
        const cdp = await ctx.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: o.dir });
        ok('extension loads (Extensions.loadUnpacked)', typeof id === 'string', id);
        const base = `chrome-extension://${id}`;
        const sw = ctx.serviceWorkers().find(w => w.url().startsWith(base))
            ?? await ctx.waitForEvent('serviceworker', { predicate: w => w.url().startsWith(base), timeout: 20_000 });
        ok('service worker starts', Boolean(sw), sw?.url().slice(base.length));

        // 2. background view
        const bg = await sw.evaluate(async () => {
            const m = chrome.runtime.getManifest();
            // Give the first-run setup a moment to enable the default rulesets.
            let enabled = [];
            for (let i = 0; i < 40; i++) {
                enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
                if (enabled.length !== 0) break;
                await new Promise(r => setTimeout(r, 250));
            }
            return { name: chrome.i18n.getMessage('extName'), shortName: m.short_name, permissions: m.permissions, enabled };
        });
        ok('extension name is "Blocker"', bg.name === 'Blocker' && bg.shortName === 'Blocker', `${bg.name} / ${bg.shortName}`);
        ok(isRelease ? 'no declarativeNetRequestFeedback (release)' : 'declarativeNetRequestFeedback present (dev)',
            bg.permissions.includes('declarativeNetRequestFeedback') === !isRelease);
        const defaults = (manifest.declarative_net_request?.rule_resources ?? []).filter(r => r.enabled).map(r => r.id).sort();
        const enabled = [...bg.enabled].sort();
        ok('default rulesets enabled', defaults.length !== 0 && defaults.every(r => enabled.includes(r)), enabled.join(', '));

        const watch = (page, label) => {
            page.on('pageerror', e => pageProblems.push(`${label}: uncaught ${e.message}`));
            page.on('console', msg => {
                if (msg.type() === 'error') pageProblems.push(`${label}: console.error ${msg.text()}`);
            });
        };
        const shot = async (page, name) => {
            if (o.screenshots) await page.screenshot({ path: path.join(o.screenshots, `${name}.png`) });
        };

        // 3a. popup for a real web page: the popup asks tabs.query for the active
        // tab, which is the popup's own tab here, so point it at the test page.
        const site = await ctx.newPage();
        await site.goto(`${origin}/`);
        const popup = await ctx.newPage();
        watch(popup, 'popup');
        await popup.addInitScript(url => {
            const query = chrome.tabs.query.bind(chrome.tabs);
            chrome.tabs.query = async () => (await query({})).filter(t => t.url === url).slice(0, 1);
        }, `${origin}/`);
        await popup.setViewportSize({ width: 340, height: 456 });
        await popup.goto(`${base}/popup.html`);
        await popup.waitForSelector('[data-testid="popup"][data-state="ready"]', { timeout: 15_000 })
            .then(() => ok('popup: ready state for 127.0.0.1', true), e => ok('popup: ready state for 127.0.0.1', false, e.message.split('\n')[0]));
        const host = await popup.locator('[data-testid="hostname"]').innerText().catch(() => '');
        ok('popup: shows the hostname', host.includes('127.0.0.1'), host);
        const level = await popup.locator('[data-testid="popup"]').getAttribute('data-current-level').catch(() => null);
        ok('popup: has a filtering level', level !== null, `level ${level}`);
        const dashButton = await popup.locator('#gotoDashboard').count();
        ok('popup: dashboard button', dashButton === 1);
        await shot(popup, 'popup-site');
        await popup.close();

        // 3b. popup on its own (no website)
        const popup2 = await ctx.newPage();
        watch(popup2, 'popup (no website)');
        await popup2.setViewportSize({ width: 340, height: 456 });
        await popup2.goto(`${base}/popup.html`);
        await popup2.waitForSelector('[data-testid="popup"][data-state="no-website"]', { timeout: 15_000 })
            .then(() => ok('popup: "not a website" state', true), e => ok('popup: "not a website" state', false, e.message.split('\n')[0]));
        await popup2.close();

        // 4. dashboard
        const dash = await ctx.newPage();
        watch(dash, 'dashboard');
        await dash.goto(`${base}/dashboard.html`);
        const tab = paneId => dash.locator(`[role="tab"][id$="-trigger-${paneId}"]`);
        await tab('settings').waitFor({ timeout: 15_000 })
            .then(() => ok('dashboard: tabs render', true), e => ok('dashboard: tabs render', false, e.message.split('\n')[0]));
        await tab('settings').click();
        const strict = await dash.getByText('Enable strict blocking').count();
        ok('dashboard: Settings shows "Enable strict blocking" (Chromium only)', strict > 0);
        await shot(dash, 'dashboard-settings');
        await tab('rulesets').click();
        const panel = dash.locator('[data-pane-id="rulesets"]');
        await panel.locator('input[type="checkbox"], [role="switch"], [role="checkbox"]').first().waitFor({ timeout: 15_000 })
            .then(() => ok('dashboard: Filter lists pane lists rulesets', true), e => ok('dashboard: Filter lists pane lists rulesets', false, e.message.split('\n')[0]));
        await shot(dash, 'dashboard-filter-lists');
        await tab('filters').click();
        const frame = await dash.waitForSelector('iframe', { timeout: 15_000 }).then(h => h.contentFrame()).catch(() => null);
        let classicOk = false;
        if (frame) {
            await frame.waitForLoadState('load').catch(() => {});
            classicOk = frame.url().includes('dashboard-classic.html') && await frame.locator('body').count() === 1;
        }
        ok('dashboard: Custom filters (classic iframe) loads', classicOk, frame?.url().slice(base.length));
        await shot(dash, 'dashboard-custom-filters');
        await tab('about').click();
        const aboutText = await dash.locator('[data-pane-id="about"]').innerText({ timeout: 10_000 }).catch(() => '');
        ok('dashboard: About shows the version', aboutText.includes(manifest.version), manifest.version);
        await shot(dash, 'dashboard-about');
        await dash.close();

        // 5. errors
        ok('no page errors / console errors on our pages', pageProblems.length === 0, pageProblems.slice(0, 5).join(' | '));
    } finally {
        await ctx?.close().catch(() => {});
        server.close();
        fs.rmSync(userData, { recursive: true, force: true });
    }
    const failed = results.filter(r => !r.pass).length;
    console.log(`${NAME}: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
    return failed === 0 ? 0 : 1;
}

runMain(NAME, main);

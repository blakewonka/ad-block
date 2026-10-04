/**
 * Browser-test helpers for the harness pages (mock browser API, src/dev/mock-ext.ts).
 *
 *   import { startStaticServer, launchChrome, openHarness, getCalls, getMessages,
 *            screenshot, HARNESS_DIR } from './helpers/index.mjs';
 *
 *   const server = await startStaticServer(HARNESS_DIR);          // random free port on 127.0.0.1
 *   const chrome = await launchChrome({ viewport: POPUP_VIEWPORT });
 *   await openHarness(chrome.page, 'popup', { scenario: 'slow', lang: 'ar', theme: 'dark' });
 *   const msgs = await getMessages(chrome.page);                 // [{ what: 'popupPanelData', ... }]
 *   await screenshot(chrome.page, 'popup-ar-dark');              // build/screenshots/popup-ar-dark.png
 *   await chrome.close(); await server.close();
 *
 * The harness must be built first: `npm run build:harness` (dist/harness, or
 * BLOCKER_HARNESS_DIR for another build). Every switch accepted by
 * openHarness() is documented in docs/mock-harness.md.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright-core';

import {
    browserLaunchError,
    E2E_CHANNEL,
    FIRST_RENDER_TIMEOUT,
    HARNESS_DIR,
    SCREENSHOT_DIR,
    screenshotPath,
    startStaticServer as startBaseServer,
} from '../lib/harness.mjs';

export { E2E_CHANNEL, FIRST_RENDER_TIMEOUT, HARNESS_DIR, SCREENSHOT_DIR };

/** Popup viewport: the popup is fixed at 340 px wide (UI rule §6.9). */
export const POPUP_VIEWPORT = Object.freeze({ width: 340, height: 520 });
/** A typical dashboard viewport. */
export const DASHBOARD_VIEWPORT = Object.freeze({ width: 1100, height: 800 });
/**
 * A phone (iPhone 15/16/17 size in CSS px), for the touch layouts. Pass with
 * `launchChrome({ viewport: PHONE_VIEWPORT, ...TOUCH_DEVICE })`: Chrome then answers
 * `(hover: none) and (pointer: coarse)` like Safari on iOS and Firefox for Android.
 */
export const PHONE_VIEWPORT = Object.freeze({ width: 390, height: 844 });
export const TOUCH_DEVICE = Object.freeze({ hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

/**
 * APIs that are recorded but hidden by getCalls() unless `{ all: true }`:
 * pure lookups that every render makes and that parity assertions never count.
 */
export const PURE_APIS = Object.freeze(['i18n.getMessage', 'i18n.getUILanguage', 'runtime.getURL', 'runtime.getManifest']);

let lastServerURL = process.env.BLOCKER_HARNESS_URL || '';

/**
 * Serves `dir` read-only on http://127.0.0.1:<random free port>.
 * The URL of the most recent server becomes openHarness()'s default base URL.
 * @param {string} dir
 * @returns {Promise<{ url: string, port: number, requests: string[], close: () => Promise<void> }>}
 */
export async function startStaticServer(dir = HARNESS_DIR) {
    const server = await startBaseServer(dir);
    lastServerURL = server.url;
    return server;
}

/**
 * Launches the e2e browser (playwright-core, headless; channel E2E_CHANNEL from
 * BLOCKER_E2E_CHANNEL, default "chrome" = the system Google Chrome, "chromium" in CI)
 * with a fresh temporary user-data directory that close() deletes.
 * @param {{ viewport?: { width: number, height: number }, colorScheme?: 'light' | 'dark',
 *           deviceScaleFactor?: number, locale?: string, reducedMotion?: 'reduce' | 'no-preference',
 *           hasTouch?: boolean, isMobile?: boolean }} [options]
 * @returns {Promise<{ context: import('playwright-core').BrowserContext,
 *                     page: import('playwright-core').Page,
 *                     userDataDir: string,
 *                     consoleErrors: string[], pageErrors: string[], failedRequests: string[],
 *                     externalRequests: string[],
 *                     close: () => Promise<void> }>}
 */
export async function launchChrome(options = {}) {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'blocker-ui-chrome-'));
    let context;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            channel: E2E_CHANNEL,
            headless: true,
            timeout: 60_000,
            viewport: options.viewport ?? { width: 1024, height: 768 },
            colorScheme: options.colorScheme ?? 'light',
            reducedMotion: options.reducedMotion ?? 'no-preference',
            deviceScaleFactor: options.deviceScaleFactor ?? 2,
            locale: options.locale ?? 'en-US',
            serviceWorkers: 'block',
            acceptDownloads: true,
            ...(options.hasTouch !== undefined ? { hasTouch: options.hasTouch } : {}),
            ...(options.isMobile !== undefined ? { isMobile: options.isMobile } : {}),
        });
    } catch (err) {
        await rm(userDataDir, { recursive: true, force: true });
        throw browserLaunchError(err);
    }
    const page = context.pages()[0] ?? (await context.newPage());
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const externalRequests = [];
    const watch = (p) => {
        p.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        p.on('pageerror', (err) => pageErrors.push(String(err)));
        p.on('requestfailed', (req) => failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`));
        p.on('response', (res) => {
            if (res.status() >= 400) failedRequests.push(`${res.url()} (HTTP ${res.status()})`);
        });
        p.on('request', (req) => {
            const url = req.url();
            if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url) && !url.startsWith('data:') && !url.startsWith('blob:')) {
                externalRequests.push(url);
            }
        });
    };
    watch(page);
    context.on('page', watch);
    return {
        context,
        page,
        userDataDir,
        consoleErrors,
        pageErrors,
        failedRequests,
        externalRequests,
        close: async () => {
            await context.close().catch(() => {});
            await rm(userDataDir, { recursive: true, force: true });
        },
    };
}

/** True when the user-data directory of a closed launchChrome() is gone. */
export function userDataDirRemoved(chrome) {
    return !existsSync(chrome.userDataDir);
}

/**
 * Builds the query string of a harness URL. Scalars are used as is, arrays are
 * comma-joined, objects (for `mock`) are JSON-encoded.
 * @param {Record<string, unknown>} params
 */
export function harnessQuery(params = {}) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) qs.set(key, value.join(','));
        else if (value !== null && typeof value === 'object') qs.set(key, JSON.stringify(value));
        else qs.set(key, String(value));
    }
    const text = qs.toString();
    return text === '' ? '' : `?${text}`;
}

/**
 * Opens a harness page (`popup`, `dashboard` or `gallery`) and waits until the
 * mock is installed and the React root has rendered something.
 * @param {import('playwright-core').Page} page
 * @param {'popup' | 'dashboard' | 'gallery' | string} name
 * @param {Record<string, unknown>} [params] query-string switches (docs/mock-harness.md)
 * @param {{ baseURL?: string, config?: object, waitForMount?: boolean, timeout?: number }} [options]
 *        `config`: a MockOptions object installed as globalThis.__BLOCKER_MOCK_CONFIG__ before any
 *        page script runs (highest precedence; may contain things a URL cannot, e.g. `undefined`-free
 *        nested fixtures). It stays installed for later navigations of this page.
 * @returns {Promise<string>} the URL that was opened
 */
export async function openHarness(page, name, params = {}, options = {}) {
    const base = (options.baseURL ?? lastServerURL).replace(/\/$/, '');
    if (!base) throw new Error('openHarness: no base URL; call startStaticServer() first or pass { baseURL }.');
    if (options.config !== undefined) {
        await page.addInitScript((config) => {
            globalThis.__BLOCKER_MOCK_CONFIG__ = config;
        }, options.config);
    }
    const url = `${base}/${name}.html${harnessQuery(params)}`;
    await page.goto(url, { waitUntil: 'load' });
    const timeout = options.timeout ?? FIRST_RENDER_TIMEOUT;
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-harness'), undefined, { timeout });
    const harness = await page.evaluate(() => document.documentElement.getAttribute('data-harness'));
    if (harness !== 'mock-installed') {
        throw new Error(`openHarness(${name}): html[data-harness] is "${harness}", expected "mock-installed"`);
    }
    if (options.waitForMount !== false) {
        await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, undefined, { timeout });
    }
    return url;
}

/**
 * The call record (window.__blockerCalls): `{ api, args, t }[]`.
 * By default PURE_APIS are left out; `{ all: true }` returns everything.
 * `api` (string or RegExp) keeps only matching calls.
 * @param {import('playwright-core').Page} page
 * @param {{ all?: boolean, api?: string | RegExp }} [filter]
 */
export async function getCalls(page, filter = {}) {
    const calls = await page.evaluate(() => globalThis.__blockerCalls ?? null);
    if (calls === null) throw new Error('getCalls: window.__blockerCalls is missing (is this a harness page?)');
    return calls.filter((c) => {
        if (!filter.all && PURE_APIS.includes(c.api)) return false;
        if (filter.api instanceof RegExp) return filter.api.test(c.api);
        if (typeof filter.api === 'string') return c.api === filter.api;
        return true;
    });
}

/** The objects passed to runtime.sendMessage, in order. */
export async function getMessages(page) {
    const calls = await getCalls(page, { api: 'runtime.sendMessage' });
    return calls.map((c) => (c.args.length > 1 && typeof c.args[0] === 'string' ? c.args[1] : c.args[0]));
}

/** Empties the call record in place. */
export async function clearCalls(page) {
    await page.evaluate(() => globalThis.__blockerMock?.clearCalls());
}

/** Background + storage snapshot of the mock (window.__blockerMock.state()). */
export async function getMockState(page) {
    return page.evaluate(() => globalThis.__blockerMock.state());
}

/** Posts on BroadcastChannel('uBOL') as the background would. */
export async function mockBroadcast(page, message) {
    await page.evaluate((m) => globalThis.__blockerMock.broadcast(m), message);
}

/**
 * Saves a PNG of the page into build/screenshots/<name>.png (or
 * BLOCKER_SCREENSHOT_DIR) with animations disabled, and returns its path.
 * @param {import('playwright-core').Page} page
 * @param {string} name file name with or without `.png`
 * @param {import('playwright-core').PageScreenshotOptions} [options]
 */
export async function screenshot(page, name, options = {}) {
    const file = await screenshotPath(name.endsWith('.png') ? name : `${name}.png`);
    await page.screenshot({ animations: 'disabled', ...options, path: file });
    return file;
}

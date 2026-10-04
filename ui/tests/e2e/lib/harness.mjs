/**
 * Shared helpers for the browser tests.
 *
 *   import { startStaticServer, launchChrome, HARNESS_DIR, screenshotPath } from './lib/harness.mjs';
 *
 * - Tests drive a Chromium browser through playwright-core, headless. By default
 *   that is the installed Google Chrome (`channel: 'chrome'`) and nothing is
 *   downloaded; BLOCKER_E2E_CHANNEL picks another one (see E2E_CHANNEL below).
 * - `chromium.launch()` always starts Chrome with a fresh temporary profile
 *   directory that Playwright deletes on close (throw-away profile).
 * - The built harness is served by a tiny static server bound to 127.0.0.1 on
 *   a random free port (port 0), so parallel runs never collide.
 * - The first launch of Chrome after a while can take 5-15 s on a busy machine
 *   (later ones about 1 s): give the first `waitFor` of a test file a generous
 *   timeout (FIRST_RENDER_TIMEOUT).
 *
 * Environment overrides (for private builds):
 *   BLOCKER_HARNESS_DIR      built harness folder        (default: ui/dist/harness)
 *   BLOCKER_CONTAINER_DIR    built container folder      (default: ui/dist/container)
 *   BLOCKER_SCREENSHOT_DIR   where screenshots are saved (default: build/screenshots at the repository root)
 *   BLOCKER_PRISTINE_DIR     PRISTINE, the renamed upstream Safari build
 *                            (default: build/pristine/safari, made by scripts/build.sh)
 *   BLOCKER_E2E_CHANNEL      Playwright browser channel (default: chrome)
 *                              chrome    the installed Google Chrome (local default)
 *                              chromium  Playwright's own Chromium, used in CI; install it once with
 *                                        `npx --prefix ui playwright-core install --no-shell chromium`
 *                              msedge, chrome-beta, ...  any other installed branded channel
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

export const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const fromEnv = (name, fallback) => path.resolve(process.env[name] || path.join(UI_ROOT, fallback));

export const HARNESS_DIR = fromEnv('BLOCKER_HARNESS_DIR', 'dist/harness');
export const CONTAINER_DIR = fromEnv('BLOCKER_CONTAINER_DIR', 'dist/container');
export const SCREENSHOT_DIR = fromEnv('BLOCKER_SCREENSHOT_DIR', '../build/screenshots');
/** PRISTINE (the renamed upstream Safari build) used by tests that serve upstream pages. */
export const PRISTINE_DIR = fromEnv('BLOCKER_PRISTINE_DIR', '../build/pristine/safari');

/**
 * Playwright channel of the browser every e2e test launches: BLOCKER_E2E_CHANNEL,
 * default 'chrome' (the installed Google Chrome). CI sets 'chromium' (Playwright's
 * own Chromium build, new headless mode). Both launch helpers use this value.
 */
export const E2E_CHANNEL = (() => {
    const value = (process.env.BLOCKER_E2E_CHANNEL ?? '').trim() || 'chrome';
    if (!/^[a-z][a-z0-9-]*$/.test(value)) {
        throw new Error(`BLOCKER_E2E_CHANNEL: not a Playwright channel name: ${JSON.stringify(value)}`);
    }
    return value;
})();

/** Human-readable name of the e2e browser, for messages. */
export const E2E_BROWSER_NAME = E2E_CHANNEL === 'chrome' ? 'Google Chrome' : `channel "${E2E_CHANNEL}"`;

/**
 * The error thrown when the e2e browser cannot be launched, with a hint that
 * matches the selected channel.
 * @param {unknown} err the launch error
 */
export function browserLaunchError(err) {
    const hint =
        E2E_CHANNEL === 'chrome'
            ? 'Is Google Chrome installed? Or set BLOCKER_E2E_CHANNEL=chromium and run ' +
              '`npx --prefix ui playwright-core install --no-shell chromium`.'
            : E2E_CHANNEL === 'chromium'
              ? "Install Playwright's Chromium first: `npx --prefix ui playwright-core install --no-shell chromium` " +
                '(on Linux add --with-deps).'
              : `Is the browser for channel "${E2E_CHANNEL}" installed?`;
    return new Error(
        `Could not launch ${E2E_BROWSER_NAME} through playwright-core (channel "${E2E_CHANNEL}", headless; ` +
            `BLOCKER_E2E_CHANNEL selects the channel). ${hint}\n` +
            (err instanceof Error ? err.message : String(err)),
    );
}

/** Timeout (ms) for the first render after a cold Chrome start. */
export const FIRST_RENDER_TIMEOUT = 30_000;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves `rootDir` read-only on http://127.0.0.1:<random port>/.
 * @param {string} rootDir absolute folder to serve
 * @returns {Promise<{ url: string, port: number, requests: string[], close: () => Promise<void> }>}
 *          `url` has no trailing slash; `requests` records every requested path.
 */
export async function startStaticServer(rootDir) {
    const root = path.resolve(rootDir);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
        throw new Error(`startStaticServer: "${root}" does not exist. Build it first (e.g. npm run build:harness).`);
    }
    const requests = [];
    const server = http.createServer((req, res) => {
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
        } catch {
            res.writeHead(400).end('bad request');
            return;
        }
        requests.push(pathname);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end('method not allowed');
            return;
        }
        let file = path.resolve(root, '.' + pathname);
        if (file !== root && !file.startsWith(root + path.sep)) {
            res.writeHead(403).end('forbidden');
            return;
        }
        if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!existsSync(file) || !statSync(file).isFile()) {
            if (pathname === '/favicon.ico') {
                // Chrome asks for it on its own; a 404 would show up as a console error in every test.
                res.writeHead(204).end();
                return;
            }
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
            return;
        }
        res.writeHead(200, {
            'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
            'cache-control': 'no-store',
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        createReadStream(file).pipe(res);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    return {
        url: `http://127.0.0.1:${port}`,
        port,
        requests,
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections?.();
                server.close(() => resolve());
            }),
    };
}

/**
 * Launches the e2e browser (E2E_CHANNEL; default the system Google Chrome),
 * headless, with a throw-away profile.
 * @param {{ viewport?: { width: number, height: number }, colorScheme?: 'light' | 'dark',
 *           deviceScaleFactor?: number, locale?: string }} [options]
 * @returns {Promise<{ browser: import('playwright-core').Browser,
 *                     context: import('playwright-core').BrowserContext,
 *                     page: import('playwright-core').Page,
 *                     consoleErrors: string[], pageErrors: string[], failedRequests: string[],
 *                     close: () => Promise<void> }>}
 */
export async function launchChrome(options = {}) {
    let browser;
    try {
        // No `userDataDir` is passed: Playwright creates a temporary profile and deletes it on close.
        browser = await chromium.launch({ channel: E2E_CHANNEL, headless: true, timeout: 60_000 });
    } catch (err) {
        throw browserLaunchError(err);
    }
    const context = await browser.newContext({
        viewport: options.viewport ?? { width: 1024, height: 768 },
        colorScheme: options.colorScheme ?? 'light',
        deviceScaleFactor: options.deviceScaleFactor ?? 2,
        locale: options.locale ?? 'en-US',
        // Our UI must never talk to the network; only the local static server is reachable.
        serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('requestfailed', (req) => failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`));
    page.on('response', (res) => {
        if (res.status() >= 400) failedRequests.push(`${res.url()} (HTTP ${res.status()})`);
    });
    return {
        browser,
        context,
        page,
        consoleErrors,
        pageErrors,
        failedRequests,
        close: async () => {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        },
    };
}

/**
 * Absolute path for a screenshot file; creates the folder.
 * @param {string} name file name, e.g. "popup-light.png"
 */
export async function screenshotPath(name) {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    return path.join(SCREENSHOT_DIR, name);
}

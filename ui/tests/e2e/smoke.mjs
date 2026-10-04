/**
 * Smoke test: proves that the e2e browser can be driven (playwright-core,
 * headless, throw-away profile; the system Google Chrome by default, or the
 * channel named by BLOCKER_E2E_CHANNEL, e.g. "chromium" in CI) and that
 * the built pages render the library.
 *
 *   npm run build:harness && npm run build:container
 *   node tests/e2e/smoke.mjs          (or: npm run e2e)
 *
 * Screenshots (build/screenshots): scaffold-popup.png, scaffold-popup-dark.png,
 * scaffold-container.png.
 */
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { after, before, test } from 'node:test';

import {
    CONTAINER_DIR,
    FIRST_RENDER_TIMEOUT,
    HARNESS_DIR,
    launchChrome,
    screenshotPath,
    startStaticServer,
} from './lib/harness.mjs';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof launchChrome>>} */
let chrome;

before(async () => {
    server = await startStaticServer(HARNESS_DIR);
    chrome = await launchChrome({ viewport: { width: 340, height: 300 } });
});

after(async () => {
    await chrome?.close();
    await server?.close();
});

/**
 * Waits for a locator; on timeout the error says what the page looked like.
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {{ consoleErrors?: string[], pageErrors?: string[], failedRequests?: string[] }} [logs]
 */
async function waitVisible(page, locator, logs = {}) {
    try {
        await locator.waitFor({ state: 'visible', timeout: FIRST_RENDER_TIMEOUT });
    } catch (err) {
        const state = await page
            .evaluate(() => ({
                harness: document.documentElement.getAttribute('data-harness'),
                theme: document.documentElement.getAttribute('data-theme'),
                body: document.body.innerHTML.slice(0, 600),
            }))
            .catch((e) => ({ evaluateFailed: String(e) }));
        throw new Error(
            `${err instanceof Error ? err.message : String(err)}\n` +
                `page state: ${JSON.stringify(state)}\n` +
                `console errors: ${JSON.stringify(logs.consoleErrors ?? [])}\n` +
                `page errors: ${JSON.stringify(logs.pageErrors ?? [])}\n` +
                `failed requests: ${JSON.stringify(logs.failedRequests ?? [])}`,
        );
    }
}

test('harness popup renders the library Button and Badge in Chrome', async () => {
    const { page, consoleErrors, pageErrors, failedRequests } = chrome;

    const externalRequests = [];
    page.on('request', (req) => {
        if (!req.url().startsWith(server.url + '/')) externalRequests.push(req.url());
    });

    await page.goto(`${server.url}/popup.html`, { waitUntil: 'load' });

    // Wait for the popup's READY state.
    const button = page.getByRole('button', { name: 'Remove an element' });
    await waitVisible(page, button, chrome);
    assert.equal(await button.isVisible(), true, 'tool Button text is visible');
    assert.equal(await page.getByTestId('mode-badge').isVisible(), true, 'mode Badge is visible');

    // The mock was installed before the app entry was loaded (harness/boot/boot.ts).
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-harness')), 'mock-installed');
    assert.equal(await page.evaluate(() => Boolean(globalThis.__BLOCKER_MOCK__)), true);

    // theme-init.js ran (the context is forced to the light scheme by launchChrome()).
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('light')), true);

    // The stylesheet is applied: 340px body, library surface colour, a filled library Button.
    // (The library paints the Button fill on its ::before pseudo-element, not on the element.)
    const styles = await page.evaluate(() => {
        const btn = document.querySelector('[role="radio"][aria-checked="true"]');
        const badge = document.querySelector('[data-testid="mode-badge"]');
        return {
            bodyWidth: document.body.getBoundingClientRect().width,
            bodyBackground: getComputedStyle(document.body).backgroundColor,
            surfaceToken: getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim(),
            buttonFill: getComputedStyle(btn, '::before').backgroundColor,
            buttonHeight: btn.getBoundingClientRect().height,
            buttonWidth: btn.getBoundingClientRect().width,
            badgeBackground: badge ? getComputedStyle(badge).backgroundColor : null,
        };
    });
    assert.equal(styles.bodyWidth, 340, 'body is 340px wide');
    assert.notEqual(styles.surfaceToken, '', '--color-surface token is defined');
    assert.notEqual(styles.bodyBackground, TRANSPARENT, 'body has a background (bg-surface)');
    // The selected SegmentedControl option is a library control drawn by the library CSS.
    assert.ok(styles.buttonHeight > 0 && styles.buttonWidth > 0, 'library SegmentedControl option is laid out');
    assert.ok(styles.badgeBackground && styles.badgeBackground !== TRANSPARENT, 'library Badge is tinted');

    // Light screenshot first, before any scheme switch. `animations: 'disabled'`
    // fast-forwards the library's colour transitions, so the picture shows the
    // settled look rather than a mid-transition grey.
    const file = await screenshotPath('scaffold-popup.png');
    await page.screenshot({ path: file, animations: 'disabled' });
    assert.ok(existsSync(file) && statSync(file).size > 1000, 'screenshot was written');

    // Dark scheme: theme-init.js follows the change, the surface colour flips.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(darkBackground, styles.bodyBackground, 'surface colour changes in dark mode');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('light')), false);
    await page.screenshot({ path: await screenshotPath('scaffold-popup-dark.png'), animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');

    assert.deepEqual(externalRequests, [], 'no request left the local static server');
    assert.deepEqual(failedRequests, [], 'no failed request');
    assert.deepEqual(pageErrors, [], 'no uncaught page error');
    assert.deepEqual(consoleErrors, [], 'no console error');
});

test('harness dashboard and gallery pages mount', async () => {
    const { context } = chrome;
    for (const [file, text, role = 'button'] of [
        // Wait for the dashboard's Settings tab.
        ['dashboard.html', 'Settings', 'tab'],
        ['gallery.html', 'Primary'],
    ]) {
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(String(err)));
        await page.goto(`${server.url}/${file}`, { waitUntil: 'load' });
        await waitVisible(page, page.getByRole(role, { name: text }), { pageErrors });
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-harness')), 'mock-installed');
        assert.deepEqual(pageErrors, [], `${file}: no uncaught page error`);
        await page.close();
    }
});

test('container page (classic IIFE, CSP default-src self) mounts and reacts to show()', async (t) => {
    if (!existsSync(CONTAINER_DIR)) {
        t.skip(`container build not found at ${CONTAINER_DIR} (run npm run build:container)`);
        return;
    }
    const containerServer = await startStaticServer(CONTAINER_DIR);
    const page = await chrome.context.newPage();
    const errors = [];
    const cspViolations = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.exposeFunction('__reportCsp', (v) => cspViolations.push(v));
    await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (ev) => {
            window.__reportCsp(`${ev.violatedDirective} ${ev.blockedURI}`);
        });
    });
    try {
        await page.setViewportSize({ width: 425, height: 325 });
        // ../Icon.png is written by the converter next to Script.js, not by build:container.
        await page.route('**/Icon.png', (route) => route.fulfill({ status: 204 }));
        await page.goto(`${containerServer.url}/Base.lproj/Main.html`, { waitUntil: 'load' });
        await waitVisible(page, page.getByRole('button', { name: /Quit and Open Safari/ }), { pageErrors: errors });
        assert.equal(await page.evaluate(() => typeof window.show), 'function', 'global show() exists');
        // Texts and states are covered by tests/e2e/container.*.mjs.

        await page.evaluate(() => window.show(true, true));
        await page.getByRole('button', { name: 'Quit and Open Safari Settings…' }).waitFor({ state: 'visible' });

        // The button posts "open-preferences" to the Swift message handler.
        await page.evaluate(() => {
            window.__posted = [];
            window.webkit = { messageHandlers: { controller: { postMessage: (m) => window.__posted.push(m) } } };
        });
        await page.getByRole('button', { name: 'Quit and Open Safari Settings…' }).click();
        assert.deepEqual(await page.evaluate(() => window.__posted), ['open-preferences']);

        const buttonFill = await page.evaluate(
            () => getComputedStyle(document.querySelector('button'), '::before').backgroundColor,
        );
        assert.notEqual(buttonFill, TRANSPARENT, 'Style.css is applied under the page CSP');

        await page.screenshot({ path: await screenshotPath('scaffold-container.png'), animations: 'disabled' });
        assert.deepEqual(cspViolations, [], 'no CSP violation under default-src self');
        assert.deepEqual(errors, [], 'no page/console error');
    } finally {
        await page.close();
        await containerServer.close();
    }
});

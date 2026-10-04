/**
 * src/lib/ext.ts: API resolution, no import-time side effects, thin accessors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeBrowser, installFakeBrowser } from './fake-browser';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('import', () => {
    it('has no import-time side effects and does not need an API to load', async () => {
        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('chrome', undefined);
        // Loading must not call getBrowser() (it would throw here).
        const mod = await import('@/lib/ext');
        expect(typeof mod.getBrowser).toBe('function');
        expect(mod.hasBrowserApi()).toBe(false);
        // The other lib modules load without an API too.
        await expect(import('@/lib/bridge')).resolves.toBeDefined();
        await expect(import('@/lib/storage')).resolves.toBeDefined();
        await expect(import('@/lib/i18n')).resolves.toBeDefined();
        await expect(import('@/lib/theme')).resolves.toBeDefined();
    });

    it('resolves the API at call time (a mock installed after import is seen)', async () => {
        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('chrome', undefined);
        const { getBrowser } = await import('@/lib/ext');
        expect(() => getBrowser()).toThrow();
        const fake = installFakeBrowser();
        expect(getBrowser()).toBe(fake);
    });
});

describe('getBrowser', () => {
    it('prefers globalThis.browser over globalThis.chrome', async () => {
        const { getBrowser } = await import('@/lib/ext');
        const b = createFakeBrowser();
        const c = createFakeBrowser();
        vi.stubGlobal('browser', b);
        vi.stubGlobal('chrome', c);
        expect(getBrowser()).toBe(b);
    });

    it('falls back to globalThis.chrome', async () => {
        const { getBrowser } = await import('@/lib/ext');
        const c = createFakeBrowser();
        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('chrome', c);
        expect(getBrowser()).toBe(c);
    });

    it('ignores objects without a runtime (plain-page chrome object, DOM element named "browser")', async () => {
        const { getBrowser, hasBrowserApi } = await import('@/lib/ext');
        const el = document.createElement('div');
        vi.stubGlobal('browser', el);
        vi.stubGlobal('chrome', { loadTimes: () => {} });
        expect(hasBrowserApi()).toBe(false);
        expect(() => getBrowser()).toThrow(/no WebExtension API found/);
    });

    it('throws ExtApiUnavailableError with a clear message when nothing is present', async () => {
        const { getBrowser, ExtApiUnavailableError } = await import('@/lib/ext');
        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('chrome', undefined);
        expect(() => getBrowser()).toThrow(ExtApiUnavailableError);
        expect(() => getBrowser()).toThrow(/globalThis\.browser.*globalThis\.chrome/);
    });
});

describe('accessors', () => {
    it('i18n facade passes exactly one argument', async () => {
        const { i18n } = await import('@/lib/ext');
        const fake = installFakeBrowser(createFakeBrowser({ messages: { extName: 'Blocker' } }));
        expect(i18n.getMessage('extName')).toBe('Blocker');
        expect(fake.i18n.getMessage).toHaveBeenCalledWith('extName');
        expect(fake.i18n.getMessage.mock.calls[0]).toHaveLength(1);
        expect(i18n.getUILanguage()).toBe('en-US');
    });

    it('requestOrigins calls permissions.request synchronously with { origins }', async () => {
        const { requestOrigins } = await import('@/lib/ext');
        const fake = installFakeBrowser();
        const p = requestOrigins(['*://*.www.example.com/*']);
        expect(fake.permissions.request).toHaveBeenCalledTimes(1);
        expect(fake.permissions.request).toHaveBeenCalledWith({ origins: ['*://*.www.example.com/*'] });
        await expect(p).resolves.toBe(true);
    });

    it('requestOrigins turns a synchronous throw into a rejection', async () => {
        const { requestOrigins } = await import('@/lib/ext');
        const fake = installFakeBrowser();
        fake.permissions.request.mockImplementation(() => { throw new Error('invalid pattern'); });
        let p: Promise<boolean> | undefined;
        expect(() => { p = requestOrigins(['*://*.[::1]/*']); }).not.toThrow();
        await expect(p).rejects.toThrow('invalid pattern');
    });

    it('getPlatformInfo rejects when the API lacks it', async () => {
        const { getPlatformInfo } = await import('@/lib/ext');
        const fake = installFakeBrowser();
        await expect(getPlatformInfo()).resolves.toEqual({ os: 'mac' });
        delete fake.runtime.getPlatformInfo;
        await expect(getPlatformInfo()).rejects.toThrow(/getPlatformInfo/);
    });

    it('getURL, getManifest, openOptionsPage, hasScripting, isSafari', async () => {
        const ext = await import('@/lib/ext');
        const fake = installFakeBrowser();
        expect(ext.getURL('/report.html')).toBe('safari-web-extension://ABCDEF/report.html');
        expect(ext.getManifest()).toEqual({ name: 'Blocker', version: '2026.1003.1243' });
        await ext.openOptionsPage();
        expect(fake.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
        expect(ext.hasScripting()).toBe(true);
        expect(ext.isSafari()).toBe(true);
        delete fake.scripting;
        expect(ext.hasScripting()).toBe(false);
        fake.runtime.getURL.mockReturnValue('chrome-extension://abc/');
        expect(ext.isSafari()).toBe(false);
    });

    it('webextFlavor follows the runtime.getURL scheme like upstream js/ext.js:30-34', async () => {
        const ext = await import('@/lib/ext');
        const fake = installFakeBrowser();
        expect(ext.webextFlavor()).toBe('safari');
        fake.runtime.getURL.mockReturnValue('moz-extension://0a1b2c/');
        expect(ext.webextFlavor()).toBe('firefox');
        expect(ext.isSafari()).toBe(false);
        fake.runtime.getURL.mockReturnValue('chrome-extension://abc/');
        expect(ext.webextFlavor()).toBe('chromium');
        // Edge, Brave and Opera also use chrome-extension:; any other scheme counts as Chromium too.
        fake.runtime.getURL.mockReturnValue('extension://abc/');
        expect(ext.webextFlavor()).toBe('chromium');
        fake.runtime.getURL.mockImplementation(() => {
            throw new Error('gone');
        });
        expect(ext.webextFlavor()).toBe('chromium');
        expect(ext.isSafari()).toBe(false);
    });
});

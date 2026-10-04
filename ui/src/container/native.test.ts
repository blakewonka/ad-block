/**
 * window.show() store, openPreferences() and theme init of the container window
 * (docs/specs/container.md §4.4, §5.3, §8; parity checklist rows 1, 8, 9, 11, 16-18, 25).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Native = typeof import('./native');

async function freshNative(): Promise<Native> {
    vi.resetModules();
    return import('./native');
}

beforeEach(() => {
    delete window.show;
    delete window.webkit;
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.removeAttribute('lang');
});

afterEach(() => {
    delete window.webkit;
});

describe('evaluation side effects', () => {
    it('assigns window.show synchronously when the module is evaluated', async () => {
        expect(window.show).toBeUndefined();
        const native = await freshNative();
        expect(typeof window.show).toBe('function');
        expect(window.show).toBe(native.show);
    });

    it('sets html[data-theme] and the light/dark class from prefers-color-scheme, and follows changes', async () => {
        let changeListener: ((ev: MediaQueryListEvent) => void) | undefined;
        const mql = {
            matches: true,
            addEventListener: (_type: string, fn: (ev: MediaQueryListEvent) => void) => {
                changeListener = fn;
            },
        } as unknown as MediaQueryList;
        const spy = vi.spyOn(window, 'matchMedia').mockReturnValue(mql);
        await freshNative();
        expect(spy).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
        const root = document.documentElement;
        expect(root.getAttribute('data-theme')).toBe('dark');
        expect(root.classList.contains('dark')).toBe(true);
        expect(root.classList.contains('light')).toBe(false);

        changeListener?.({ matches: false } as MediaQueryListEvent);
        expect(root.getAttribute('data-theme')).toBe('light');
        expect(root.classList.contains('light')).toBe(true);
        expect(root.classList.contains('dark')).toBe(false);
    });

    it('sets html[lang]="en" at evaluation (WCAG 3.1.1; Main.html line 2 is a bare <html>)', async () => {
        expect(document.documentElement.hasAttribute('lang')).toBe(false);
        await freshNative();
        expect(document.documentElement.getAttribute('lang')).toBe('en');
    });

    it('keeps a language the document already declares', async () => {
        const native = await freshNative();
        const el = document.createElement('html');
        el.setAttribute('lang', 'en-GB');
        native.initLang(el);
        expect(el.getAttribute('lang')).toBe('en-GB');
        const bare = document.createElement('html');
        native.initLang(bare);
        expect(bare.getAttribute('lang')).toBe('en');
    });

    it('does not throw when matchMedia is unusable', async () => {
        vi.spyOn(window, 'matchMedia').mockImplementation(() => {
            throw new Error('no matchMedia');
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(freshNative()).resolves.toBeDefined();
        expect(typeof window.show).toBe('function');
    });
});

describe('show(enabled, useSettingsInsteadOfPreferences)', () => {
    it('starts unknown with the Preferences wording', async () => {
        const { getState } = await freshNative();
        expect(getState()).toEqual({ enabled: undefined, useSettings: false });
    });

    it.each([
        [[true, true], { enabled: true, useSettings: true }],
        [[false, true], { enabled: false, useSettings: true }],
        [[true, false], { enabled: true, useSettings: false }],
        [[false, false], { enabled: false, useSettings: false }],
        [[undefined, false], { enabled: undefined, useSettings: false }],
        [['x', false], { enabled: undefined, useSettings: false }],
        [[1, false], { enabled: undefined, useSettings: false }],
        [[null, false], { enabled: undefined, useSettings: false }],
        [[undefined, true], { enabled: undefined, useSettings: true }],
        [[true, 1], { enabled: true, useSettings: true }],
        [[true, {}], { enabled: true, useSettings: true }],
        [[true, 0], { enabled: true, useSettings: false }],
        [[true, ''], { enabled: true, useSettings: false }],
    ] as const)('show(%j) -> %j on a fresh page', async (args, expected) => {
        const { getState } = await freshNative();
        window.show?.(...args);
        expect(getState()).toEqual(expected);
    });

    it('keeps the Settings wording once selected (one-way, upstream Script.js:2-7)', async () => {
        const { getState } = await freshNative();
        window.show?.(true, true);
        window.show?.(false, false);
        expect(getState()).toEqual({ enabled: false, useSettings: true });
        window.show?.(true);
        expect(getState()).toEqual({ enabled: true, useSettings: true });
        window.show?.();
        expect(getState()).toEqual({ enabled: undefined, useSettings: true });
    });

    it('accepts any number of calls; each replaces the state and notifies subscribers', async () => {
        const { getState, subscribe } = await freshNative();
        const seen: Array<boolean | undefined> = [];
        const unsubscribe = subscribe(() => seen.push(getState().enabled));
        window.show?.(true, true);
        window.show?.(false, true);
        window.show?.(true, true);
        expect(seen).toEqual([true, false, true]);
        unsubscribe();
        window.show?.(false, true);
        expect(seen).toEqual([true, false, true]);
    });

    it('never throws and returns undefined, whatever the arguments', async () => {
        await freshNative();
        const show = window.show as (...args: unknown[]) => unknown;
        expect(show()).toBeUndefined();
        expect(show({}, {})).toBeUndefined();
        expect(show(Symbol('x'), 1)).toBeUndefined();
        expect(show(null, 0)).toBeUndefined();
        expect(show(true, true, 'extra')).toBeUndefined();
    });

    it('isolates a failing subscriber: others still run, show() does not throw', async () => {
        const { subscribe } = await freshNative();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const good = vi.fn();
        subscribe(() => {
            throw new Error('boom');
        });
        subscribe(good);
        expect(() => window.show?.(true, true)).not.toThrow();
        expect(good).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('returns the same state object between calls (useSyncExternalStore requirement)', async () => {
        const { getState } = await freshNative();
        const a = getState();
        expect(getState()).toBe(a);
        window.show?.(true, true);
        const b = getState();
        expect(b).not.toBe(a);
        expect(getState()).toBe(b);
        expect(Object.isFrozen(b)).toBe(true);
    });
});

describe('openPreferences()', () => {
    it('posts exactly the string "open-preferences" to webkit.messageHandlers.controller', async () => {
        const { openPreferences, OPEN_PREFERENCES } = await freshNative();
        const posted: unknown[] = [];
        window.webkit = { messageHandlers: { controller: { postMessage: (m: string) => void posted.push(m) } } };
        openPreferences();
        expect(posted).toEqual(['open-preferences']);
        expect(typeof posted[0]).toBe('string');
        expect(OPEN_PREFERENCES).toBe('open-preferences');
        openPreferences();
        expect(posted).toEqual(['open-preferences', 'open-preferences']);
    });

    it('does not throw without webkit, without a controller, or when postMessage throws', async () => {
        const { openPreferences } = await freshNative();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => openPreferences()).not.toThrow();
        window.webkit = {};
        expect(() => openPreferences()).not.toThrow();
        window.webkit = { messageHandlers: {} };
        expect(() => openPreferences()).not.toThrow();
        window.webkit = {
            messageHandlers: {
                controller: {
                    postMessage: () => {
                        throw new Error('native side gone');
                    },
                },
            },
        };
        expect(() => openPreferences()).not.toThrow();
    });
});

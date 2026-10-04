/**
 * public/ui/theme-init.js — UI rule §6.8 (docs/specs/README.md).
 * The script is a classic script, so it is evaluated here from its source text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import source from '../../public/ui/theme-init.js?raw';

type Listener = (ev: { matches: boolean }) => void;

function stubMatchMedia(initiallyDark: boolean) {
    const listeners: Listener[] = [];
    const queries: string[] = [];
    const mql = {
        matches: initiallyDark,
        addEventListener: (type: string, fn: Listener) => {
            if (type === 'change') listeners.push(fn);
        },
    };
    vi.stubGlobal('matchMedia', (query: string) => {
        queries.push(query);
        return mql;
    });
    return {
        queries,
        emit(dark: boolean) {
            mql.matches = dark;
            listeners.forEach((fn) => fn({ matches: dark }));
        },
    };
}

function runScript(): void {
    // Classic-script evaluation: `self` and `document` come from the test window.
    new Function(source)();
}

const html = document.documentElement;

afterEach(() => {
    vi.unstubAllGlobals();
    html.removeAttribute('data-theme');
    html.classList.remove('dark', 'light');
});

describe('theme-init.js', () => {
    it('is a classic script: no import/export and no top-level bindings leak', () => {
        expect(source).not.toMatch(/^\s*(import|export)\s/m);
        expect(source.trim().startsWith('/*')).toBe(true);
        expect(source).toMatch(/\(function \(\) \{/);
    });

    it('sets data-theme="dark" and the legacy class when the OS scheme is dark', () => {
        const media = stubMatchMedia(true);
        runScript();
        expect(media.queries).toEqual(['(prefers-color-scheme: dark)']);
        expect(html.getAttribute('data-theme')).toBe('dark');
        expect(html.classList.contains('dark')).toBe(true);
        expect(html.classList.contains('light')).toBe(false);
    });

    it('sets data-theme="light" and the legacy class when the OS scheme is light', () => {
        stubMatchMedia(false);
        runScript();
        expect(html.getAttribute('data-theme')).toBe('light');
        expect(html.classList.contains('light')).toBe(true);
        expect(html.classList.contains('dark')).toBe(false);
    });

    it('follows later changes of the OS scheme in both directions', () => {
        const media = stubMatchMedia(false);
        runScript();
        media.emit(true);
        expect(html.getAttribute('data-theme')).toBe('dark');
        expect(html.className.split(/\s+/).filter(Boolean).sort()).toEqual(['dark']);
        media.emit(false);
        expect(html.getAttribute('data-theme')).toBe('light');
        expect(html.className.split(/\s+/).filter(Boolean).sort()).toEqual(['light']);
    });

    it('keeps other classes on <html> untouched', () => {
        html.classList.add('desktop');
        stubMatchMedia(true);
        runScript();
        expect(html.classList.contains('desktop')).toBe(true);
        html.classList.remove('desktop');
    });

    it('falls back to light when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);
        runScript();
        expect(html.getAttribute('data-theme')).toBe('light');
        expect(html.classList.contains('light')).toBe(true);
    });
});

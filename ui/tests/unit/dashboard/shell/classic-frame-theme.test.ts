/**
 * The classic frame follows the shell's theme live (dashboard-shell.md P-32,
 * legacy-tokens.md 6.4): the parent marks the frame's `<html>` exactly the way
 * upstream `js/theme.js` does (class `dark` xor `light`) plus `color-scheme`,
 * at setup, on every shell theme change, and after the frame's own theme.js
 * writes; never by reloading the frame.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { applyThemeToDocument, ClassicFrameController, type ClassicThemeSource } from '@/dashboard/panes/Classic';
import type { Theme } from '@/lib/theme';

const CLASSIC_BODY = '<header></header><section data-pane="settings"></section><section data-pane="filters"></section><section data-pane="develop"></section>';

function classicDoc(): Document {
    const doc = document.implementation.createHTMLDocument('x');
    doc.body.innerHTML = CLASSIC_BODY;
    Object.defineProperty(doc, 'location', { value: { pathname: '/dashboard-classic.html' }, configurable: true });
    return doc;
}

function fakeIframe(doc: Document) {
    const srcSets: string[] = [];
    const loads: Array<() => void> = [];
    const iframe = {
        get contentDocument() {
            return doc;
        },
        set src(value: string) {
            srcSets.push(value);
        },
        addEventListener: (type: string, fn: () => void) => {
            if (type === 'load') loads.push(fn);
        },
        removeEventListener: () => {},
        ownerDocument: document,
    } as unknown as HTMLIFrameElement;
    return { iframe, srcSets, fireLoad: () => loads.forEach((fn) => fn()) };
}

function manualTheme(initial: Theme) {
    let theme = initial;
    const listeners = new Set<() => void>();
    const source: ClassicThemeSource = {
        get: () => theme,
        subscribe: (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
    return {
        source,
        listeners,
        set(next: Theme) {
            theme = next;
            listeners.forEach((fn) => fn());
        },
    };
}

/** Runs the poll synchronously: the document is already the classic one, so setup happens at start(). */
function startController(doc: Document, themeSource?: ClassicThemeSource) {
    const f = fakeIframe(doc);
    const c = new ClassicFrameController({
        iframe: f.iframe,
        desired: 'develop',
        onStatus: () => {},
        requestFrame: () => 1,
        cancelFrame: () => {},
        themeSource,
    });
    c.start();
    return { c, ...f };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const marks = (doc: Document) => ({
    dark: doc.documentElement.classList.contains('dark'),
    light: doc.documentElement.classList.contains('light'),
    colorScheme: doc.documentElement.style.colorScheme,
});

describe('applyThemeToDocument', () => {
    it('sets dark xor light like upstream theme.js, plus color-scheme, and keeps other classes', () => {
        const doc = classicDoc();
        doc.documentElement.className = 'desktop light';
        applyThemeToDocument(doc, 'dark');
        expect(marks(doc)).toEqual({ dark: true, light: false, colorScheme: 'dark' });
        expect(doc.documentElement.classList.contains('desktop')).toBe(true);
        applyThemeToDocument(doc, 'light');
        expect(marks(doc)).toEqual({ dark: false, light: true, colorScheme: 'light' });
        expect(doc.documentElement.classList.contains('desktop')).toBe(true);
    });

    it('writes nothing when the document already matches (safe inside a MutationObserver)', async () => {
        const doc = classicDoc();
        applyThemeToDocument(doc, 'dark');
        const records: MutationRecord[] = [];
        const mo = new MutationObserver((r) => records.push(...r));
        mo.observe(doc.documentElement, { attributes: true });
        applyThemeToDocument(doc, 'dark');
        await flush();
        mo.disconnect();
        expect(records).toEqual([]);
    });
});

describe('ClassicFrameController theme mirror', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('data-theme');
    });

    it('mirrors the shell theme at setup and on every change, without touching src', () => {
        const doc = classicDoc();
        const theme = manualTheme('dark');
        const { c, srcSets } = startController(doc, theme.source);
        expect(c.setupVia).toBe('poll');
        expect(marks(doc)).toEqual({ dark: true, light: false, colorScheme: 'dark' });
        expect(c.getFrameTheme()).toBe('dark');
        theme.set('light');
        expect(marks(doc)).toEqual({ dark: false, light: true, colorScheme: 'light' });
        theme.set('dark');
        expect(marks(doc)).toEqual({ dark: true, light: false, colorScheme: 'dark' });
        expect(srcSets).toEqual(['dashboard-classic.html']);
        c.dispose();
    });

    it("undoes a different class written later by the frame's own theme.js (it runs after setup)", async () => {
        const doc = classicDoc();
        const theme = manualTheme('dark');
        const { c } = startController(doc, theme.source);
        // theme.js in the frame, answering its own matchMedia with "light".
        doc.documentElement.classList.toggle('dark', false);
        doc.documentElement.classList.toggle('light', true);
        await flush();
        expect(marks(doc)).toEqual({ dark: true, light: false, colorScheme: 'dark' });
        c.dispose();
    });

    it('re-applies at load', () => {
        const doc = classicDoc();
        const theme = manualTheme('light');
        const { c, fireLoad } = startController(doc, theme.source);
        doc.documentElement.className = '';
        doc.documentElement.style.colorScheme = '';
        fireLoad();
        expect(marks(doc)).toEqual({ dark: false, light: true, colorScheme: 'light' });
        c.dispose();
    });

    it('stops following after dispose', async () => {
        const doc = classicDoc();
        const theme = manualTheme('light');
        const { c } = startController(doc, theme.source);
        expect(theme.listeners.size).toBe(1);
        c.dispose();
        expect(theme.listeners.size).toBe(0);
        doc.documentElement.classList.replace('light', 'dark');
        await flush();
        expect(doc.documentElement.classList.contains('dark')).toBe(true);
    });

    it('by default follows html[data-theme] of the shell document (theme-init.js)', async () => {
        document.documentElement.setAttribute('data-theme', 'dark');
        const doc = classicDoc();
        const { c } = startController(doc);
        expect(marks(doc)).toEqual({ dark: true, light: false, colorScheme: 'dark' });
        document.documentElement.setAttribute('data-theme', 'light');
        await flush();
        expect(marks(doc)).toEqual({ dark: false, light: true, colorScheme: 'light' });
        c.dispose();
    });
});

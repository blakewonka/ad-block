/**
 * src/lib/theme.ts: reads html[data-theme] (written by public/ui/theme-init.js), never writes it.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTheme, subscribeTheme, useTheme } from '@/lib/theme';

const root = document.documentElement;

/** MutationObserver callbacks run as microtasks. */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

afterEach(() => {
    root.removeAttribute('data-theme');
    vi.unstubAllGlobals();
});

describe('getTheme', () => {
    it('reads html[data-theme]', () => {
        root.setAttribute('data-theme', 'dark');
        expect(getTheme()).toBe('dark');
        root.setAttribute('data-theme', 'light');
        expect(getTheme()).toBe('light');
    });

    it('falls back to prefers-color-scheme when the attribute is missing or invalid', () => {
        vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-color-scheme: dark)', media: q, addEventListener() {}, removeEventListener() {} }));
        expect(getTheme()).toBe('dark');
        root.setAttribute('data-theme', 'sepia');
        expect(getTheme()).toBe('dark');
        vi.stubGlobal('matchMedia', undefined);
        expect(getTheme()).toBe('light');
    });

    it('does not write the attribute', () => {
        getTheme();
        expect(root.hasAttribute('data-theme')).toBe(false);
    });
});

describe('subscribeTheme', () => {
    it('notifies on change only, and stops after unsubscribe', async () => {
        root.setAttribute('data-theme', 'light');
        const fn = vi.fn();
        const off = subscribeTheme(fn);
        expect(fn).not.toHaveBeenCalled();
        root.setAttribute('data-theme', 'dark');
        await flush();
        expect(fn).toHaveBeenCalledWith('dark');
        root.setAttribute('data-theme', 'dark');
        await flush();
        expect(fn).toHaveBeenCalledTimes(1);
        off();
        off();
        root.setAttribute('data-theme', 'light');
        await flush();
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('useTheme', () => {
    it('re-renders when theme-init flips the attribute', async () => {
        root.setAttribute('data-theme', 'light');
        function Probe() { return <span>{useTheme()}</span>; }
        const { container } = render(<Probe />);
        expect(container.textContent).toBe('light');
        await act(async () => {
            root.setAttribute('data-theme', 'dark');
            await flush();
        });
        expect(container.textContent).toBe('dark');
    });
});

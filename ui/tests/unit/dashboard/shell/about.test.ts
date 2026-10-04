/**
 * About pane helpers:
 * - messages that are empty in `ml` fall back to English (i18n.md §5.1 item 7);
 * - the copy helper reports clipboard failures instead of claiming success.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aboutText, copyText } from '@/dashboard/panes/About/AboutPane';
import { createMockExt, resolveMockConfig } from '@/dev/mock-ext';

const g = globalThis as Record<string, unknown>;

function installLang(lang: string): void {
    g.browser = createMockExt(resolveMockConfig({ lang }), { calls: [] }).browser;
}

afterEach(() => {
    delete g.browser;
});

describe('aboutText', () => {
    it('ml: the empty Contributors / Translations messages fall back to English', () => {
        installLang('ml');
        expect(aboutText('aboutContributors')).toBe('Contributors');
        expect(aboutText('aboutTranslations')).toBe('Translations');
        // Other keys keep the locale's own text.
        expect(aboutText('aboutSourceCode')).not.toBe('');
    });

    it('en and de: the translation wins', () => {
        installLang('en');
        expect(aboutText('aboutContributors')).toBe('Contributors');
        installLang('de');
        expect(aboutText('aboutTranslations')).not.toBe('Translations');
        expect(aboutText('aboutTranslations')).not.toBe('');
    });
});

describe('copyText', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    afterEach(() => {
        if (original) Object.defineProperty(globalThis.navigator, 'clipboard', original);
        else delete (globalThis.navigator as unknown as Record<string, unknown>).clipboard;
    });

    function setClipboard(value: unknown): void {
        Object.defineProperty(globalThis.navigator, 'clipboard', { value, configurable: true });
    }

    it('resolves true when the write succeeds', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        setClipboard({ writeText });
        await expect(copyText('abc')).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith('abc');
    });

    it('resolves false when the write rejects, throws, or the API is missing', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        setClipboard({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
        await expect(copyText('abc')).resolves.toBe(false);
        setClipboard({
            writeText: () => {
                throw new Error('boom');
            },
        });
        await expect(copyText('abc')).resolves.toBe(false);
        setClipboard(undefined);
        await expect(copyText('abc')).resolves.toBe(false);
    });
});

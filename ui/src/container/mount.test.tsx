/**
 * Mount + plain-DOM fallback of the container window
 * (docs/specs/container.md §11.2.11; parity checklist row 29).
 */
import { act } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEXTS } from './texts';

// Each test re-imports the module graph (vi.doMock needs it); that is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let root: HTMLElement;

// The first import of the library (inline-transformed by Vite) can take 5-30 s on a
// loaded machine; pay it once here, under a hook timeout, instead of inside the first
// test (vi.resetModules() re-evaluates modules but keeps their transforms).
beforeAll(async () => {
    await import('@openai/apps-sdk-ui/components/Button');
    await import('./App');
}, 180_000);

beforeEach(() => {
    vi.resetModules();
    delete window.show;
    delete window.webkit;
    document.body.replaceChildren();
    root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
});

afterEach(() => {
    vi.doUnmock('react-dom/client');
    vi.doUnmock('./App');
    document.body.replaceChildren();
});

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

function expectFallback(sentence: string, button: string): void {
    const main = root.querySelector('main[data-container-fallback]');
    expect(main).not.toBeNull();
    expect(root.querySelectorAll('img[src="../Icon.png"][alt="Blocker Icon"]')).toHaveLength(1);
    expect(root.querySelector('h1')?.textContent).toBe('Blocker');
    const status = root.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toBe(sentence);
    const buttons = root.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe(button);
    expect(root.querySelectorAll('a, form, style, [style]')).toHaveLength(0);
    // Same structure as the React page: no decorative dot, sentence alone in the live region.
    expect(status?.children).toHaveLength(1);
    expect(root.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    // Token hover/pressed fills and the library ring colour, not the UA focus colour.
    expect(buttons[0]?.className.split(' ')).toEqual(
        expect.arrayContaining([
            'hover:bg-primary-solid-hover',
            'active:bg-primary-solid-active',
            'focus-visible:outline-2',
            'focus-visible:outline-(--color-ring)',
            'whitespace-normal',
            'max-w-full',
        ]),
    );
}

describe('mount()', () => {
    it('renders the React page into #root', async () => {
        await import('./native');
        const { mount } = await import('./mount');
        mount(root);
        await flush();
        expect(root.querySelector('main[data-container-fallback]')).toBeNull();
        expect(root.querySelector('[role="status"]')?.textContent).toBe(TEXTS.preferences.unknown);
        act(() => window.show?.(true, true));
        expect(root.querySelector('[role="status"]')?.textContent).toBe(TEXTS.settings.on);
    });

    it('falls back to plain DOM when createRoot throws, and keeps following show()', async () => {
        vi.doMock('react-dom/client', () => ({
            createRoot: () => {
                throw new Error('createRoot broken');
            },
        }));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await import('./native');
        window.show?.(false, true); // before mount: must not be lost
        const { mount } = await import('./mount');
        expect(() => mount(root)).not.toThrow();
        await flush();
        expectFallback(TEXTS.settings.off, TEXTS.settings.button);
        expect(errorSpy).toHaveBeenCalled();

        window.show?.(true, true);
        expectFallback(TEXTS.settings.on, TEXTS.settings.button);
        window.show?.('x', false);
        expectFallback(TEXTS.settings.unknown, TEXTS.settings.button);

        const posted: unknown[] = [];
        window.webkit = { messageHandlers: { controller: { postMessage: (m: string) => void posted.push(m) } } };
        root.querySelector('button')?.click();
        expect(posted).toEqual(['open-preferences']);
        delete window.webkit;
        expect(() => root.querySelector('button')?.click()).not.toThrow();
    });

    it('falls back to plain DOM when the app throws while rendering (error boundary)', async () => {
        vi.doMock('./App', () => ({
            ContainerApp: () => {
                throw new Error('render broken');
            },
        }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await import('./native');
        const { mount } = await import('./mount');
        mount(root);
        await flush();
        expectFallback(TEXTS.preferences.unknown, TEXTS.preferences.button);
        window.show?.(true, false);
        expectFallback(TEXTS.preferences.on, TEXTS.preferences.button);
    });

    it('falls back when a window error fires before the tree commits', async () => {
        vi.doMock('react-dom/client', () => ({
            createRoot: () => ({
                render: () => {
                    window.dispatchEvent(new ErrorEvent('error', { message: 'early failure' }));
                },
                unmount: () => {},
            }),
        }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await import('./native');
        const { mount } = await import('./mount');
        mount(root);
        await flush();
        expectFallback(TEXTS.preferences.unknown, TEXTS.preferences.button);
    });

    it('creates #root when it is missing', async () => {
        await import('./native');
        const { mount } = await import('./mount');
        root.remove();
        mount(null);
        await flush();
        const created = document.getElementById('root');
        expect(created).not.toBeNull();
        expect(created?.querySelector('[role="status"]')?.textContent).toBe(TEXTS.preferences.unknown);
    });
});

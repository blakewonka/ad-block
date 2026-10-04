/**
 * Rendered container window (docs/specs/container.md §6.3, §11.2.4-7; parity rows 3-7, 13-16).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as App from './App';
import { resetStateForTests, show } from './native';
import { TEXTS } from './texts';

const ALL_SENTENCES = [
    ...Object.values(TEXTS.preferences),
    ...Object.values(TEXTS.settings),
].filter((s) => !s.startsWith('Quit'));

function sentencesInDom(): string[] {
    const text = document.body.textContent ?? '';
    return ALL_SENTENCES.filter((s) => text.includes(s));
}

// The components are imported once (re-importing the library per test is slow); the store is reset instead.
beforeEach(() => {
    resetStateForTests();
    window.show = show;
    delete window.webkit;
});

describe('ContainerApp', () => {
    it('shows icon, title, the unknown/Preferences sentence and the Preferences button before any show()', async () => {
        render(<App.ContainerApp />);
        const img = screen.getByRole('img', { name: 'Blocker Icon' });
        expect(img).toHaveAttribute('src', '../Icon.png');
        expect(img).toHaveAttribute('width', '128');
        expect(img).toHaveAttribute('height', '128');
        expect(screen.getByRole('heading', { level: 1, name: 'Blocker' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(TEXTS.preferences.unknown);
        expect(screen.getByRole('button')).toHaveTextContent(TEXTS.preferences.button);
        expect(sentencesInDom()).toEqual([TEXTS.preferences.unknown]);
    });

    it('status region holds only the sentence (no decorative dot), balanced and in the secondary text colour', () => {
        render(<App.ContainerApp />);
        const status = screen.getByRole('status');
        expect(status.children).toHaveLength(1);
        const p = status.firstElementChild as HTMLElement;
        expect(p.tagName).toBe('P');
        expect(p.children).toHaveLength(0);
        expect(p.textContent).toBe(TEXTS.preferences.unknown);
        expect(p.className.split(' ')).toEqual(expect.arrayContaining(['text-balance', 'text-secondary']));
        expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
        // The max-w-[23rem] cap never applied (px-8 already limits the measure); it is gone.
        expect(document.querySelector('main')?.innerHTML).not.toContain('max-w-[');
        // Title + sentence form one group; the button sits after it with extra room.
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.parentElement).toBe(status.parentElement);
        expect(screen.getByRole('button').className).toContain('mt-2');
    });

    it('lets the button label wrap inside the window instead of overflowing (library Button is nowrap)', () => {
        render(<App.ContainerApp />);
        const cls = screen.getByRole('button').className.split(' ');
        expect(cls).toEqual(expect.arrayContaining(['whitespace-normal', 'max-w-full', 'h-auto', 'min-h-(--button-size)']));
    });

    it('reads a show() call made before mount', async () => {
        window.show?.(false, true);
        render(<App.ContainerApp />);
        expect(screen.getByRole('status')).toHaveTextContent(TEXTS.settings.off);
        expect(screen.getByRole('button')).toHaveTextContent(TEXTS.settings.button);
    });

    it.each([
        [[true, true], TEXTS.settings.on, TEXTS.settings.button, 'on'],
        [[false, true], TEXTS.settings.off, TEXTS.settings.button, 'off'],
        [[undefined, true], TEXTS.settings.unknown, TEXTS.settings.button, 'unknown'],
        [[true, false], TEXTS.preferences.on, TEXTS.preferences.button, 'on'],
        [[false, false], TEXTS.preferences.off, TEXTS.preferences.button, 'off'],
        [['x', false], TEXTS.preferences.unknown, TEXTS.preferences.button, 'unknown'],
    ] as const)('after show(%j): sentence, button and data-state', async (args, sentence, button, kind) => {
        const { container } = render(<App.ContainerApp />);
        act(() => window.show?.(...args));
        expect(screen.getByRole('status')).toHaveTextContent(sentence);
        expect(screen.getByRole('button')).toHaveTextContent(button);
        expect(sentencesInDom()).toEqual([sentence]);
        expect(container.querySelector('main')).toHaveAttribute('data-state', kind);
    });

    it('survives repeated calls with the icon, one button and the live region intact', async () => {
        render(<App.ContainerApp />);
        for (const [enabled, sentence] of [
            [true, TEXTS.settings.on],
            [false, TEXTS.settings.off],
            [true, TEXTS.settings.on],
        ] as const) {
            act(() => window.show?.(enabled, true));
            expect(sentencesInDom()).toEqual([sentence]);
            expect(document.querySelectorAll('button')).toHaveLength(1);
            expect(document.querySelectorAll('img[alt="Blocker Icon"]')).toHaveLength(1);
            expect(document.querySelectorAll('a, form, style')).toHaveLength(0);
            const status = screen.getByRole('status');
            expect(status).toHaveAttribute('aria-live', 'polite');
            expect(status).toHaveTextContent(sentence);
        }
    });

    it('keeps the Settings wording after a later show(_, false)', async () => {
        render(<App.ContainerApp />);
        act(() => window.show?.(true, true));
        act(() => window.show?.(false, false));
        expect(screen.getByRole('status')).toHaveTextContent(TEXTS.settings.off);
        expect(screen.getByRole('button')).toHaveTextContent(TEXTS.settings.button);
    });

    it('posts the bare string "open-preferences" once per click', async () => {
        const posted: unknown[] = [];
        window.webkit = { messageHandlers: { controller: { postMessage: (m: string) => void posted.push(m) } } };
        render(<App.ContainerApp />);
        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('type', 'button');
        fireEvent.click(button);
        expect(posted).toEqual(['open-preferences']);
        fireEvent.click(button);
        expect(posted).toEqual(['open-preferences', 'open-preferences']);
    });

    it('does not throw on click when there is no webkit', async () => {
        render(<App.ContainerApp />);
        expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow();
    });

    it('calls onMounted after the first commit', async () => {
        const onMounted = vi.fn();
        render(<App.ContainerApp onMounted={onMounted} />);
        expect(onMounted).toHaveBeenCalled();
    });
});

import { describe, expect, it, vi } from 'vitest';

import { createMountGuard, type GuardWindow } from '@/popup/fallback';

function fakeWindow() {
    const target = new EventTarget();
    const replace = vi.fn();
    const win: GuardWindow = {
        addEventListener: (type, l) => target.addEventListener(type, l),
        removeEventListener: (type, l) => target.removeEventListener(type, l),
        location: { replace },
    };
    return { win, target, replace };
}

const quiet = { error: vi.fn() };

describe('mount guard (UI rule §6.9)', () => {
    it('an error before mount replaces the page with popup-classic.html, once', () => {
        const { win, target, replace } = fakeWindow();
        const guard = createMountGuard(win, quiet);
        target.dispatchEvent(new Event('error'));
        target.dispatchEvent(new Event('error'));
        expect(replace).toHaveBeenCalledTimes(1);
        expect(replace).toHaveBeenCalledWith('popup-classic.html');
        expect(guard.fellBack).toBe(true);
    });

    it('an unhandled rejection before mount falls back too', () => {
        const { win, target, replace } = fakeWindow();
        createMountGuard(win, quiet);
        target.dispatchEvent(new Event('unhandledrejection'));
        expect(replace).toHaveBeenCalledWith('popup-classic.html');
    });

    it('after markMounted, window errors are ignored', () => {
        const { win, target, replace } = fakeWindow();
        const guard = createMountGuard(win, quiet);
        guard.markMounted();
        guard.markMounted();
        target.dispatchEvent(new Event('error'));
        target.dispatchEvent(new Event('unhandledrejection'));
        expect(replace).not.toHaveBeenCalled();
        expect(guard.mounted).toBe(true);
    });

    it('fallBack() works directly (chunk load failure, error boundary)', () => {
        const { win, replace } = fakeWindow();
        const guard = createMountGuard(win, quiet);
        guard.markMounted();
        guard.fallBack(new Error('render failed'));
        expect(replace).toHaveBeenCalledWith('popup-classic.html');
    });

    it('a throwing logger does not stop the fallback', () => {
        const { win, replace } = fakeWindow();
        const guard = createMountGuard(win, { error: () => { throw new Error('no console'); } });
        guard.fallBack('x');
        expect(replace).toHaveBeenCalledTimes(1);
    });
});

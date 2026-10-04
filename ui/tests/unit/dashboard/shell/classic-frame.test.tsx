/**
 * ClassicFrame overlays: the stalled Alert offers a
 * user-triggered Reload; the "unavailable" warning is announced through the
 * page's status region. The controller is replaced by a stub that reports a
 * status, so no real frame is loaded.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatusProvider, StatusRegion } from '@/components/StatusRegion';

let report: ((status: string) => void) | null = null;

vi.mock('@/dashboard/panes/Classic/classic-frame-controller', () => ({
    ClassicFrameController: class {
        constructor(options: { onStatus: (s: string) => void }) {
            report = options.onStatus;
        }
        start() {}
        setDesired() {}
        dispose() {}
    },
}));

const { ClassicFrame } = await import('@/dashboard/panes/Classic/ClassicFrame');

function renderFrame() {
    return render(
        <StatusProvider>
            <ClassicFrame pane="filters" title="Custom filters" />
            <StatusRegion />
        </StatusProvider>,
    );
}

describe('ClassicFrame overlays', () => {
    it('warming: a skeleton shaped like the frame column, no padding offset', () => {
        renderFrame();
        const sk = screen.getByTestId('classic-frame-skeleton');
        // Start-aligned 48rem column, like the embedded classic content (legacy-tokens.md 6.5).
        expect(sk).toHaveClass('max-w-3xl');
        expect(sk).not.toHaveClass('mx-auto');
        expect(sk.parentElement?.className ?? '').not.toMatch(/\bp-4\b/);
    });

    it('stalled: danger Alert with a Reload button that reloads only when clicked', () => {
        const reload = vi.fn();
        const original = window.location;
        Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
        try {
            renderFrame();
            act(() => report?.('stalled'));
            const button = screen.getByRole('button', { name: 'Reload' });
            expect(reload).not.toHaveBeenCalled();
            act(() => button.click());
            expect(reload).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('classic-frame-stalled').querySelector('[role="alert"]')).not.toBeNull();
        } finally {
            Object.defineProperty(window, 'location', { configurable: true, value: original });
        }
    });

    it('unavailable: the warning is announced in the status region', () => {
        renderFrame();
        act(() => report?.('unavailable'));
        expect(screen.getByTestId('classic-frame-unavailable')).toBeInTheDocument();
        const live = Array.from(document.querySelectorAll('[aria-live], [role="status"]')).map((n) => n.textContent).join('|');
        expect(live).toContain('This pane could not be loaded.');
    });
});

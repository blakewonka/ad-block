import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { clampLevel, LevelMeter } from './LevelMeter';

function bars(container: HTMLElement) {
    return Array.from(container.querySelectorAll('rect'));
}

describe('LevelMeter', () => {
    it.each([0, 1, 2, 3])('level %i fills exactly that many of the three bars', (level) => {
        const { container } = render(<LevelMeter level={level} />);
        const rects = bars(container);
        expect(rects).toHaveLength(3);
        expect(rects.filter((r) => r.hasAttribute('data-filled'))).toHaveLength(level);
        // Filled bars come first (shortest to tallest).
        rects.forEach((r, i) => expect(r.hasAttribute('data-filled')).toBe(i < level));
    });

    it('is decorative: aria-hidden, not focusable, no accessible name', () => {
        const { container } = render(<LevelMeter level={2} />);
        const svg = container.querySelector('svg')!;
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('focusable', 'false');
        expect(svg.querySelector('title')).toBeNull();
    });

    it('colours filled bars with --blocker-level-N and empty ones with currentColor', () => {
        for (const level of [1, 2, 3]) {
            const { container, unmount } = render(<LevelMeter level={level} />);
            const [first, , last] = bars(container);
            expect(first.getAttribute('class')).toContain(`var(--blocker-level-${level},`);
            if (level < 3) expect(last.getAttribute('class')).toContain('fill-current');
            unmount();
        }
    });

    it('draws level 0 in --blocker-level-0 (gray) in colour tone', () => {
        const { container } = render(<LevelMeter level={0} />);
        for (const r of bars(container)) {
            expect(r.getAttribute('class')).toContain('var(--blocker-level-0,');
        }
    });

    it('empty bars are outlined (>= 3:1 non-text contrast) inside the same box as a filled bar', () => {
        for (const tone of ['color', 'mono'] as const) {
            const { container, unmount } = render(<LevelMeter level={0} tone={tone} />);
            for (const r of bars(container)) {
                expect(r.getAttribute('class')).toMatch(/\bstroke-/);
                expect(r.getAttribute('class')).not.toMatch(/\bopacity-/);
                expect(r).toHaveAttribute('stroke-width', '1');
            }
            const [first] = bars(container);
            // Bar 1 is x 2..6, y 9..15; the 1-unit outline is centred 0.5 inside it.
            expect(first).toHaveAttribute('x', '2.5');
            expect(first).toHaveAttribute('width', '3');
            expect(first).toHaveAttribute('height', '5');
            unmount();
        }
        const { container } = render(<LevelMeter level={3} />);
        for (const r of bars(container)) expect(r).not.toHaveAttribute('stroke-width');
    });

    it('mono tone paints with currentColor', () => {
        const { container } = render(<LevelMeter level={3} tone="mono" />);
        for (const r of bars(container)) {
            expect(r.getAttribute('class')).toContain('fill-current');
            expect(r.getAttribute('class')).not.toContain('--blocker-level');
        }
    });

    it('clamps and rounds out-of-range levels', () => {
        expect(clampLevel(-1)).toBe(0);
        expect(clampLevel(7)).toBe(3);
        expect(clampLevel(1.6)).toBe(2);
        expect(clampLevel(Number.NaN)).toBe(0);
        const { container } = render(<LevelMeter level={9} />);
        expect(container.querySelector('svg')).toHaveAttribute('data-level', '3');
    });

    it('accepts sizes and extra classes', () => {
        const { container } = render(<LevelMeter level={1} size="sm" className="text-secondary" />);
        const cls = container.querySelector('svg')!.getAttribute('class')!;
        expect(cls).toContain('h-4');
        expect(cls).toContain('text-secondary');
    });
});

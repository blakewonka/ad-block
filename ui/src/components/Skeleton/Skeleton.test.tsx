import { isInaccessible, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

const PHYSICAL = /^(?:[\w-]+:)*-?(?:ml|mr|pl|pr|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|text-left|text-right|float-left|float-right)(?:-|$)/;

describe('Skeleton', () => {
    it('is a decorative, static block by default', () => {
        render(<Skeleton data-testid="sk" className="h-8 w-40" />);
        const sk = screen.getByTestId('sk');
        expect(sk).toHaveAttribute('aria-hidden', 'true');
        expect(sk).toHaveAttribute('data-skeleton', 'rect');
        expect(sk).toHaveClass('rounded-md', 'h-8', 'w-40', 'bg-primary-soft-alpha');
        expect(sk.className).not.toMatch(/animate/);
    });

    it('is hidden from the accessibility tree', () => {
        render(<Skeleton data-testid="sk" shape="text" lines={2} />);
        const sk = screen.getByTestId('sk');
        expect(isInaccessible(sk)).toBe(true);
        sk.querySelectorAll('*').forEach((line) => expect(isInaccessible(line as Element)).toBe(true));
    });

    it('pulses only under motion-safe (no animation with reduced motion)', () => {
        render(<Skeleton data-testid="sk" pulse />);
        const classes = Array.from(screen.getByTestId('sk').classList).filter((c) => c.includes('animate'));
        expect(classes).toEqual(['motion-safe:animate-pulse']);
    });

    it.each([
        ['circle', 'rounded-full'],
        ['pill', 'rounded-full'],
        ['text', 'h-3'],
    ] as const)('shape %s', (shape, cls) => {
        render(<Skeleton data-testid="sk" shape={shape} />);
        expect(screen.getByTestId('sk')).toHaveClass(cls);
    });

    it('never adds a width that would fight a width given by the caller', () => {
        render(
            <>
                <Skeleton data-testid="one" shape="text" className="w-40" />
                <Skeleton data-testid="many" shape="text" lines={2} className="w-40" />
            </>,
        );
        for (const id of ['one', 'many']) {
            const widths = Array.from(screen.getByTestId(id).classList).filter((c) => /^w-/.test(c));
            expect(widths).toEqual(['w-40']);
        }
    });

    it('renders several text lines, the last one shorter', () => {
        render(<Skeleton data-testid="sk" shape="text" lines={3} pulse />);
        const root = screen.getByTestId('sk');
        expect(root).toHaveAttribute('aria-hidden', 'true');
        const lines = root.querySelectorAll('[data-skeleton="text"]');
        expect(lines).toHaveLength(3);
        expect(lines[2]).toHaveClass('w-3/5');
        expect(lines[0]).toHaveClass('w-full', 'motion-safe:animate-pulse');
    });

    it('forwards its ref and uses no physical-direction classes', () => {
        const ref = createRef<HTMLDivElement>();
        const { container } = render(<Skeleton ref={ref} shape="text" lines={2} />);
        expect(ref.current).toBeInstanceOf(HTMLDivElement);
        const classes = Array.from(container.querySelectorAll('*')).flatMap((el) => Array.from(el.classList));
        expect(classes.filter((c) => PHYSICAL.test(c))).toEqual([]);
    });
});

import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

/** Physical (non-logical) direction utilities that would not mirror under dir="rtl". */
const PHYSICAL = /^(?:[\w-]+:)*-?(?:ml|mr|pl|pr|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|text-left|text-right|float-left|float-right)(?:-|$)/;
function physicalClasses(root: HTMLElement): string[] {
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    return all.flatMap((el) => Array.from(el.classList)).filter((c) => PHYSICAL.test(c));
}

describe('Card', () => {
    it('renders its children in an elevated surface by default', () => {
        render(<Card data-testid="card">content</Card>);
        const card = screen.getByTestId('card');
        expect(card.tagName).toBe('DIV');
        expect(card).toHaveTextContent('content');
        expect(card).toHaveAttribute('data-variant', 'elevated');
        expect(card).toHaveClass('bg-surface-elevated', 'border', 'border-subtle', 'rounded-2xl', 'p-4');
    });

    it.each([
        ['outline', 'bg-surface', 'border-default'],
        ['subtle', 'bg-surface-secondary', 'border-transparent'],
    ] as const)('variant %s', (variant, bg, border) => {
        render(
            <Card data-testid="card" variant={variant}>
                x
            </Card>,
        );
        expect(screen.getByTestId('card')).toHaveClass(bg, border);
    });

    it.each([
        ['none', 'p-0'],
        ['sm', 'p-3'],
        ['md', 'p-4'],
        ['lg', 'p-6'],
    ] as const)('padding %s', (padding, cls) => {
        render(
            <Card data-testid="card" padding={padding}>
                x
            </Card>,
        );
        expect(screen.getByTestId('card')).toHaveClass(cls);
    });

    it('supports radius, extra classes and other elements', () => {
        render(
            <Card as="section" aria-label="Named card" radius="xl" className="gap-2">
                x
            </Card>,
        );
        const card = screen.getByRole('region', { name: 'Named card' });
        expect(card.tagName).toBe('SECTION');
        expect(card).toHaveClass('rounded-xl', 'gap-2');
        expect(card).not.toHaveClass('rounded-2xl');
    });

    it('forwards its ref to the DOM element', () => {
        const ref = createRef<HTMLElement>();
        render(<Card ref={ref}>x</Card>);
        expect(ref.current).toBeInstanceOf(HTMLElement);
    });

    it('uses no physical-direction utilities (RTL-safe)', () => {
        const { container } = render(
            <div dir="rtl">
                <Card variant="outline">x</Card>
            </div>,
        );
        expect(physicalClasses(container)).toEqual([]);
    });
});

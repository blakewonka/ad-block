import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Section } from './Section';

const PHYSICAL = /^(?:[\w-]+:)*-?(?:ml|mr|pl|pr|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|text-left|text-right|float-left|float-right)(?:-|$)/;
function physicalClasses(root: HTMLElement): string[] {
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    return all.flatMap((el) => Array.from(el.classList)).filter((c) => PHYSICAL.test(c));
}

describe('Section', () => {
    it.each([2, 3, 4, 5, 6] as const)('renders an h%i with the given level', (level) => {
        render(
            <Section level={level} title="Title">
                body
            </Section>,
        );
        const heading = screen.getByRole('heading', { level, name: 'Title' });
        expect(heading.tagName).toBe(`H${level}`);
        expect(screen.getByText('body')).toBeInTheDocument();
    });

    it('is a region named by its heading and described by its description', () => {
        render(
            <Section level={2} title="Behaviour" description="How the extension behaves">
                body
            </Section>,
        );
        const region = screen.getByRole('region', { name: 'Behaviour' });
        expect(region.tagName).toBe('SECTION');
        expect(region).toHaveAccessibleDescription('How the extension behaves');
    });

    it('omits the description element when none is given', () => {
        const { container } = render(<Section level={3} title="T" />);
        expect(container.querySelector('p')).toBeNull();
        expect(container.querySelector('section')).not.toHaveAttribute('aria-describedby');
    });

    it('maps size to the library heading scale independently of the level', () => {
        render(<Section level={2} size="xs" title="Small h2" />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveClass('heading-xs');
    });

    it('renders actions next to the heading', () => {
        render(<Section level={2} title="T" actions={<button type="button">Act</button>} />);
        expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
    });

    it('as="div" is not a labelled landmark', () => {
        const { container } = render(<Section as="div" level={2} title="T" description="D" />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.tagName).toBe('DIV');
        expect(root).not.toHaveAttribute('aria-labelledby');
        expect(screen.queryByRole('region')).toBeNull();
    });

    it('accepts a custom heading id and forwards its ref', () => {
        const ref = createRef<HTMLElement>();
        render(<Section ref={ref} level={2} title="T" headingId="my-heading" />);
        expect(screen.getByRole('heading')).toHaveAttribute('id', 'my-heading');
        expect(ref.current).toHaveAttribute('aria-labelledby', 'my-heading');
    });

    it('uses logical alignment only (RTL-safe)', () => {
        const { container } = render(
            <div dir="rtl">
                <Section level={2} title="T" description="D" actions={<span>a</span>}>
                    x
                </Section>
            </div>,
        );
        expect(physicalClasses(container)).toEqual([]);
        expect(screen.getByRole('heading')).toHaveClass('text-start');
        expect(screen.getByText('a').parentElement).toHaveClass('ms-auto');
    });
});

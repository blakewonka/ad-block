import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { PageShell } from './PageShell';

const PHYSICAL = /^(?:[\w-]+:)*-?(?:ml|mr|pl|pr|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|text-left|text-right|float-left|float-right)(?:-|$)/;
function physicalClasses(root: HTMLElement): string[] {
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    return all.flatMap((el) => Array.from(el.classList)).filter((c) => PHYSICAL.test(c));
}

describe('PageShell', () => {
    it('renders a banner and a main landmark on the page background', () => {
        render(
            <PageShell data-testid="shell" header={<h1>Title</h1>} mainId="content">
                <p>body</p>
            </PageShell>,
        );
        const shell = screen.getByTestId('shell');
        expect(shell).toHaveClass('bg-surface', 'text-default', 'min-h-dvh');
        const banner = screen.getByRole('banner');
        expect(banner).toContainElement(screen.getByRole('heading', { level: 1, name: 'Title' }));
        const main = screen.getByRole('main');
        expect(main).toHaveAttribute('id', 'content');
        expect(main).toHaveTextContent('body');
        // header comes before main in document order
        expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('omits the header element when no header is given', () => {
        render(<PageShell>x</PageShell>);
        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.getByRole('main')).toBeInTheDocument();
    });

    it.each([
        ['popup', 'w-popup'],
        ['narrow', 'max-w-2xl'],
        ['page', 'max-w-page'],
        ['wide', 'max-w-7xl'],
        ['full', 'w-full'],
    ] as const)('width %s', (width, cls) => {
        render(<PageShell width={width}>x</PageShell>);
        const column = screen.getByRole('main').parentElement as HTMLElement;
        expect(column).toHaveClass('mx-auto', cls);
    });

    it('fillViewport=false leaves the height to the content (popup)', () => {
        render(
            <PageShell data-testid="shell" width="popup" fillViewport={false}>
                x
            </PageShell>,
        );
        expect(screen.getByTestId('shell')).not.toHaveClass('min-h-dvh');
    });

    it('passes extra classes and forwards its ref', () => {
        const ref = createRef<HTMLDivElement>();
        render(
            <PageShell ref={ref} className="extra" mainClassName="gap-6" headerClassName="hdr" header={<span>h</span>}>
                x
            </PageShell>,
        );
        expect(ref.current).toHaveClass('extra');
        expect(screen.getByRole('main')).toHaveClass('gap-6');
        expect(screen.getByRole('banner')).toHaveClass('hdr');
    });

    it('landmarks={false} renders the same slots without landmarks (previews)', () => {
        const { container } = render(
            <PageShell landmarks={false} header={<span>h</span>}>
                body
            </PageShell>,
        );
        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.queryByRole('main')).toBeNull();
        expect(container.querySelector('[data-slot="header"]')).toHaveTextContent('h');
        expect(container.querySelector('[data-slot="main"]')).toHaveTextContent('body');
    });

    it('centres with logical margins only (RTL-safe)', () => {
        const { container } = render(
            <div dir="rtl">
                <PageShell header={<span>h</span>} padding="lg">
                    x
                </PageShell>
            </div>,
        );
        expect(physicalClasses(container)).toEqual([]);
    });
});

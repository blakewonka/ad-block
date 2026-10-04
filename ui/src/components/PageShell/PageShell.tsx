/**
 * PageShell — page frame: page background (bg-surface, UI rule §6.8), a centred
 * column with a max width, a <header> slot and the page's single <main>.
 *
 *
 *   <PageShell header={<DashboardHeader/>} width="page">…panes…</PageShell>
 *   <PageShell width="popup" padding="sm">…</PageShell>     340px column (--blocker-popup-width)
 *
 * Render one PageShell per document: it owns the <main> landmark. Text is inherited
 * (text-default); the shell renders no text of its own.
 */
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export type PageShellWidth = 'popup' | 'narrow' | 'page' | 'wide' | 'full';

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
    /** Content of the <header> landmark, above <main>, in the same centred column. Omitted when absent. */
    header?: ReactNode;
    /** Column width: popup 340px (exact), narrow 40rem, page 60rem (default), wide 80rem, full = no cap. */
    width?: PageShellWidth;
    /** Column padding: none, sm 12px, md 16px (default), lg 24px / 32px from the md breakpoint. */
    padding?: 'none' | 'sm' | 'md' | 'lg';
    /** Fill the viewport height (min-h-dvh). Default true; set false for the popup, whose height
     *  must come from its content. */
    fillViewport?: boolean;
    /** Extra classes for the <main> element (e.g. a gap). */
    mainClassName?: string;
    /** id for the <main> element (target of a skip link). */
    mainId?: string;
    /** Extra classes for the <header> element. */
    headerClassName?: string;
    /** Default true. false renders plain <div>s instead of <header>/<main>, for previews of a
     *  shell inside another page (a document may only have one <main>). */
    landmarks?: boolean;
}

export const PAGE_SHELL_WIDTH_CLASSES: Record<PageShellWidth, string> = {
    popup: 'w-popup max-w-popup',
    narrow: 'w-full max-w-2xl',
    page: 'w-full max-w-page',
    wide: 'w-full max-w-7xl',
    full: 'w-full',
};

const PADDING_CLASSES = {
    none: 'p-0',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6 md:p-8',
} as const;

export const PageShell = forwardRef<HTMLDivElement, PageShellProps>(function PageShell(
    {
        header,
        width = 'page',
        padding = 'md',
        fillViewport = true,
        mainClassName,
        mainId,
        headerClassName,
        landmarks = true,
        className,
        children,
        ...rest
    },
    ref,
) {
    const rootClasses = ['bg-surface text-default', fillViewport ? 'min-h-dvh' : '', className ?? '']
        .filter(Boolean)
        .join(' ');
    const columnClasses = [
        'mx-auto flex min-w-0 flex-col gap-4',
        PAGE_SHELL_WIDTH_CLASSES[width],
        PADDING_CLASSES[padding],
    ].join(' ');

    const Header = landmarks ? 'header' : 'div';
    const Main = landmarks ? 'main' : 'div';

    return (
        <div ref={ref} className={rootClasses} data-width={width} {...rest}>
            <div className={columnClasses}>
                {header != null && header !== false && (
                    <Header
                        data-slot="header"
                        className={['min-w-0', headerClassName ?? ''].filter(Boolean).join(' ')}
                    >
                        {header}
                    </Header>
                )}
                <Main
                    id={mainId}
                    data-slot="main"
                    className={['flex min-w-0 flex-col', mainClassName ?? ''].filter(Boolean).join(' ')}
                >
                    {children}
                </Main>
            </div>
        </div>
    );
});

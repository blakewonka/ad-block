/**
 * Section — a titled block: heading + optional description + optional actions + children.
 *
 *
 * The heading LEVEL is semantic and must be passed by the page (2 under the page's h1,
 * 3 inside an h2 section, ...). Its visual SIZE is independent (`size`).
 * The <section> is labelled by its heading (aria-labelledby) and described by the
 * description (aria-describedby), so it is announced as a named region.
 *
 *   <Section level={2} title={t('settingsBehaviorLegend')} description={...}>
 *     <Card padding="none">…rows…</Card>
 *   </Section>
 *
 * All text arrives through props; the component renders no text of its own.
 */
import { forwardRef, useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';

export type HeadingLevel = 2 | 3 | 4 | 5 | 6;
export type SectionHeadingSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
    /** Heading content (already localised). */
    title: ReactNode;
    /** Semantic heading level: renders <h2>..<h6>. Required, so every page decides its outline. */
    level: HeadingLevel;
    /** Visual heading size from the library scale: xs 16px, sm 18px (default), md 20px, lg 24px. */
    size?: SectionHeadingSize;
    /** Optional supporting text under the heading (text-secondary, 14px). */
    description?: ReactNode;
    /** Optional controls placed at the inline-end of the heading (e.g. a Button). */
    actions?: ReactNode;
    /** Space between the header block and the children: sm 8px, md 12px (default), lg 16px. */
    gap?: 'sm' | 'md' | 'lg';
    /** Override the generated heading id (the section's aria-labelledby points at it). */
    headingId?: string;
    /** Render a plain <div> instead of <section> (e.g. when nested inside another landmark). */
    as?: 'section' | 'div';
}

export const SECTION_HEADING_SIZE_CLASSES: Record<SectionHeadingSize, string> = {
    xs: 'heading-xs',
    sm: 'heading-sm',
    md: 'heading-md',
    lg: 'heading-lg',
};

const GAP_CLASSES = { sm: 'gap-2', md: 'gap-3', lg: 'gap-4' } as const;

export const Section = forwardRef<HTMLElement, SectionProps>(function Section(
    {
        title,
        level,
        size = 'sm',
        description,
        actions,
        gap = 'md',
        headingId,
        as = 'section',
        className,
        children,
        ...rest
    },
    ref,
) {
    const autoId = useId();
    const titleId = headingId ?? `${autoId}-title`;
    const descriptionId = description != null && description !== false ? `${autoId}-description` : undefined;
    const Heading = `h${level}` as const;
    const Element = as;

    return (
        <Element
            ref={ref as Ref<never>}
            // Naming a generic <div> is not allowed by ARIA 1.2, so only the <section> is labelled.
            aria-labelledby={as === 'section' ? titleId : undefined}
            aria-describedby={as === 'section' ? descriptionId : undefined}
            className={['flex min-w-0 flex-col', GAP_CLASSES[gap], className ?? ''].filter(Boolean).join(' ')}
            {...rest}
        >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
                    <Heading id={titleId} className={`${SECTION_HEADING_SIZE_CLASSES[size]} text-default text-start break-words`}>
                        {title}
                    </Heading>
                    {descriptionId !== undefined && (
                        <p id={descriptionId} className="text-sm text-secondary text-start break-words">
                            {description}
                        </p>
                    )}
                </div>
                {actions != null && actions !== false && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2 ms-auto">{actions}</div>
                )}
            </div>
            {children}
        </Element>
    );
});

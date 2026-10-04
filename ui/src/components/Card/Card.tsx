/**
 * Card — surface container (the library has none).
 * Built from library tokens and Tailwind utilities only.
 *
 *   <Card>…</Card>                                  elevated surface, subtle border, radius 2xl, padding md
 *   <Card variant="outline" padding="sm" radius="xl">
 *   <Card as="section" aria-labelledby={id}>       any landmark/semantic element you need
 *
 * Text colour is inherited (text-default comes from html); the card does not
 * add any text of its own. `className` is appended last; it does not remove
 * the variant classes, so add rather than fight them.
 */
import { forwardRef, type HTMLAttributes, type Ref } from 'react';

export type CardVariant = 'elevated' | 'outline' | 'subtle';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardRadius = 'lg' | 'xl' | '2xl';
export type CardElement = 'div' | 'section' | 'article' | 'aside' | 'li' | 'fieldset';

export interface CardProps extends HTMLAttributes<HTMLElement> {
    /** `elevated` (default): bg-surface-elevated + subtle border + small shadow.
     *  `outline`: page surface + regular border. `subtle`: bg-surface-secondary, no border. */
    variant?: CardVariant;
    /** Inner padding: none 0, sm 12px, md 16px (default), lg 24px. */
    padding?: CardPadding;
    /** Corner radius from the library scale: lg 10px, xl 12px, 2xl 16px (default). */
    radius?: CardRadius;
    /** Element to render. Defaults to `div`. */
    as?: CardElement;
}

export const CARD_VARIANT_CLASSES: Record<CardVariant, string> = {
    elevated: 'bg-surface-elevated border border-subtle shadow-sm',
    outline: 'bg-surface border border-default',
    subtle: 'bg-surface-secondary border border-transparent',
};

export const CARD_PADDING_CLASSES: Record<CardPadding, string> = {
    none: 'p-0',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
};

export const CARD_RADIUS_CLASSES: Record<CardRadius, string> = {
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
};

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
    { variant = 'elevated', padding = 'md', radius = '2xl', as = 'div', className, children, ...rest },
    ref,
) {
    const Element = as;
    const classes = [
        'block min-w-0',
        CARD_VARIANT_CLASSES[variant],
        CARD_PADDING_CLASSES[padding],
        CARD_RADIUS_CLASSES[radius],
        // fieldset: drop the UA margin (min-inline-size is already reset by min-w-0).
        as === 'fieldset' ? 'm-0' : '',
        className ?? '',
    ]
        .filter(Boolean)
        .join(' ');
    return (
        <Element
            // The union of element refs is not expressible per tag; every option is an HTMLElement.
            ref={ref as Ref<never>}
            className={classes}
            data-variant={variant}
            {...rest}
        >
            {children}
        </Element>
    );
});

/**
 * Skeleton — static placeholder block shown while data loads (e.g. the popup renders a
 * skeleton of its final size so its height never changes, UI rule §6.9).
 *
 *
 * Size it with Tailwind classes (`className="h-8 w-40"`); `shape="text"` gives a block
 * one text line tall (it fills its block container; inside a flex row give it a width),
 * `lines` stacks several (the last one shorter). The block never shrinks (shrink-0), so a
 * width you set is the width you get.
 *
 * The block is decorative (aria-hidden). Announce loading on the container instead,
 * e.g. aria-busy="true" on the region being filled. The optional pulse runs only under
 * `motion-safe:`; with prefers-reduced-motion the block is completely static (and the
 * global reduced-motion rule in blocker-tokens.css would stop it anyway).
 */
import { forwardRef, type HTMLAttributes } from 'react';

export type SkeletonShape = 'rect' | 'text' | 'circle' | 'pill';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    /** rect (radius md, default), text (one 14px line), circle, pill. */
    shape?: SkeletonShape;
    /** For shape="text": number of lines (default 1). The last of several lines is 60% wide. */
    lines?: number;
    /** Gentle opacity pulse when the user allows motion. Default false: a static block. */
    pulse?: boolean;
}

export const SKELETON_SHAPE_CLASSES: Record<SkeletonShape, string> = {
    rect: 'rounded-md',
    // A 20px line box with a 12px bar, matching text-sm.
    text: 'h-3 my-1 rounded-xs',
    circle: 'rounded-full aspect-square',
    pill: 'rounded-full',
};

const BASE = 'block shrink-0 bg-primary-soft-alpha';
const PULSE = 'motion-safe:animate-pulse';

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
    { shape = 'rect', lines = 1, pulse = false, className, ...rest },
    ref,
) {
    const own = [BASE, SKELETON_SHAPE_CLASSES[shape], pulse ? PULSE : ''];
    const count = shape === 'text' ? Math.max(1, Math.floor(lines)) : 1;

    if (count === 1) {
        return (
            <div
                ref={ref}
                aria-hidden="true"
                data-skeleton={shape}
                className={[...own, className ?? ''].filter(Boolean).join(' ')}
                {...rest}
            />
        );
    }

    return (
        <div
            ref={ref}
            aria-hidden="true"
            data-skeleton="lines"
            className={['flex flex-col', className ?? ''].filter(Boolean).join(' ')}
            {...rest}
        >
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    data-skeleton="text"
                    className={[...own, i === count - 1 ? 'w-3/5' : 'w-full'].filter(Boolean).join(' ')}
                />
            ))}
        </div>
    );
});

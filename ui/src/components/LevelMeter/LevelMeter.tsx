/**
 * LevelMeter — a small "signal strength" glyph for a filtering level 0..3.
 *
 *
 * Three bars of increasing height; `level` of them are filled:
 *   0 none      no bar filled
 *   1 basic     1 bar   (--blocker-level-1, blue)
 *   2 optimal   2 bars  (--blocker-level-2, green)
 *   3 complete  3 bars  (--blocker-level-3, purple)
 * Empty bars are drawn as a full-strength 1-unit outline in currentColor with a faint
 * fill, so they keep >= 3:1 non-text contrast (WCAG 1.4.11) on light and dark surfaces
 * while still reading as "empty" next to the solid filled bars. The outline sits inside
 * the bar's box, so empty and filled bars have the same outer size. Level 0 in colour
 * tone draws its three empty bars in --blocker-level-0 (gray) instead, so "no filtering"
 * reads as a deliberate gray state.
 * The number of filled bars carries the level on its own; the glyph does not rely on colour.
 *
 * `tone="mono"` paints the filled bars with currentColor instead of the level colour
 * (used for the options that are not selected, so only the selected one is coloured).
 *
 * Purely decorative: always aria-hidden. The accessible name of a level comes from the
 * surrounding control (e.g. the aria-label of a ModeSelector option).
 *
 * Colour variables this component relies on (defined in src/styles/blocker-tokens.css
 * by the tokens task): --blocker-level-0, --blocker-level-1,
 * --blocker-level-2, --blocker-level-3. Each has a fallback to the library's
 * semantic colours, so the glyph also renders before/without the tokens.
 */

export type MeterLevel = 0 | 1 | 2 | 3;

export interface LevelMeterProps {
    /** Filtering level 0..3. Values outside are clamped; non-integers are rounded. */
    level: number;
    /** `color` (default): filled bars in the level colour. `mono`: filled bars in currentColor. */
    tone?: 'color' | 'mono';
    /** sm 20x16 px, md 25x20 px (default), lg 30x24 px. */
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

// Literal class names (Tailwind only generates classes it can find verbatim in source).
const FILLED_CLASS: Record<MeterLevel, string> = {
    0: 'fill-[var(--blocker-level-0,var(--color-text-secondary))]', // never used: level 0 has no filled bar
    1: 'fill-[var(--blocker-level-1,var(--color-background-info-solid))]',
    2: 'fill-[var(--blocker-level-2,var(--color-background-success-solid))]',
    3: 'fill-[var(--blocker-level-3,var(--color-background-discovery-solid))]',
};
const EMPTY_CLASS = 'fill-current stroke-current [fill-opacity:0.2]';
const EMPTY_CLASS_LEVEL0 =
    'fill-[var(--blocker-level-0,var(--color-text-secondary))] stroke-[color:var(--blocker-level-0,var(--color-text-secondary))] [fill-opacity:0.2]';
/** Stroke width of an empty bar's outline, in viewBox units (inset by half of it). */
const OUTLINE = 1;
const FILLED_CLASS_MONO = 'fill-current';

const SIZE_CLASS = {
    sm: 'h-4 w-5',
    md: 'h-5 w-[25px]',
    lg: 'h-6 w-[30px]',
} as const;

// viewBox 0 0 20 16: bars 4 wide, 2 apart, bottom-aligned at y = 15.
const BARS = [
    { x: 2, y: 9, height: 6 },
    { x: 8, y: 5, height: 10 },
    { x: 14, y: 1, height: 14 },
] as const;

export function clampLevel(level: number): MeterLevel {
    if (!Number.isFinite(level)) return 0;
    return Math.min(3, Math.max(0, Math.round(level))) as MeterLevel;
}

export function LevelMeter({ level, tone = 'color', size = 'md', className }: LevelMeterProps) {
    const n = clampLevel(level);
    const filledClass = tone === 'mono' ? FILLED_CLASS_MONO : FILLED_CLASS[n];
    const emptyClass = tone === 'color' && n === 0 ? EMPTY_CLASS_LEVEL0 : EMPTY_CLASS;
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 20 16"
            className={['inline-block shrink-0 align-middle', SIZE_CLASS[size], className].filter(Boolean).join(' ')}
            data-level={n}
            data-tone={tone}
        >
            {BARS.map((bar, i) => {
                const filled = i < n;
                const inset = filled ? 0 : OUTLINE / 2;
                return (
                    <rect
                        key={bar.x}
                        x={bar.x + inset}
                        y={bar.y + inset}
                        width={4 - 2 * inset}
                        height={bar.height - 2 * inset}
                        rx={1 - inset}
                        strokeWidth={filled ? undefined : OUTLINE}
                        className={filled ? filledClass : emptyClass}
                        data-filled={filled ? '' : undefined}
                    />
                );
            })}
        </svg>
    );
}

/**
 * ModeSelector — single-choice control for the filtering level.
 *
 *   <ModeSelector
 *     label={t('popupFilteringModeLabel')}
 *     value={level}
 *     onChange={commitFilteringMode}          // called synchronously inside the gesture
 *     levels={[0, 1, 2, 3]}
 *     names={{ 0: t('filteringMode0Name'), 1: ..., 2: ..., 3: ... }}
 *     busy={committing}
 *     size="popup"
 *   />
 *
 * Built on the library's SegmentedControl (a Radix ToggleGroup type="single"):
 * role="radiogroup" with one role="radio" button per level. Each option shows a
 * LevelMeter glyph only — localized mode names do not fit inside four segments at 340px
 * (61 of 71 locales have a name over 10 characters) — and carries the name as its
 * aria-label. A Tooltip per option shows the name (and the description, if given). An
 * always-visible caption below shows the selected name, or "current -> target" while
 * another option is hovered or keyboard-focused (upstream popup hover preview).
 *
 * Interaction contract (verified in ModeSelector.test.tsx):
 * - `onChange(level)` is called SYNCHRONOUSLY from the click handler of the option
 *   (pointer click, or Space/Enter, which the browser turns into a click on a <button>),
 *   so the caller may call `browser.permissions.request()` inside it while the user
 *   gesture is still active.
 * - Arrow keys (and Home/End) only MOVE FOCUS between options (Radix roving focus); they
 *   never select. Selection always happens through Space/Enter or a click, i.e. inside a
 *   real gesture. RTL: ArrowLeft moves to the next option in DOM order.
 * - Controlled: the component never shows a level the parent did not pass in `value`.
 *   When the parent rejects a change (does not update `value`, or reverts it later), the
 *   selection snaps back.
 * - `onChange` is not called for: the level already selected, a level in
 *   `disabledLevels`, a level not in `levels`, or while `busy` / `readOnly`.
 * - `value` not in `levels` (e.g. default mode 0 with levels [1,2,3]): no option is
 *   checked, as upstream's settings page shows no radio checked.
 *
 * `busy`: a commit is in progress. Options stay focusable (no focus loss), clicks are
 * ignored, the group gets aria-busy="true", and the hover preview is suppressed.
 * `readOnly`: admin policy forbids changing the level (upstream `data-forbid~=filteringMode`):
 * the control stays visible with the current level, but nothing can be selected. The options
 * stay focusable (the level can still be read) and carry aria-disabled="true" (Chrome does
 * not expose aria-readonly on a radiogroup); hover/press highlights are suppressed and the
 * options that are not selected are dimmed.
 * `tooltips={false}`: no per-option Tooltip (the popup: its fixed-height window has no room for the
 * description tooltips, which covered the caption's hover preview). Names stay available
 * through aria-label and the caption; descriptions through aria-describedby.
 * The selected thumb has a 1 px outline so the selection keeps >= 3:1 against the track
 * (WCAG 1.4.11) even for level 0, whose glyph is gray in both states.
 *
 * Styling: only logical properties; direction comes from `dir` (default: the document's
 * direction, else a Radix DirectionProvider above). The SegmentedControl thumb animation is
 * switched off under prefers-reduced-motion. All text comes from props (already localised).
 */
import { SegmentedControl } from '@openai/apps-sdk-ui/components/SegmentedControl';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { Direction } from 'radix-ui';
import { Fragment, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LevelMeter } from '../LevelMeter';

export type ModeSelectorSize = 'popup' | 'settings';

export interface ModeSelectorProps {
    /** Level shown as selected (controlled). */
    value: number;
    /** Called synchronously inside the click/keyboard handler with the requested level. */
    onChange: (level: number) => void;
    /** Levels offered, in display order (e.g. [0,1,2,3] in the popup, [1,2,3] in settings). */
    levels: readonly number[];
    /** Localised mode name per level (aria-label of the option, tooltip, caption). */
    names: Readonly<Record<number, string>>;
    /** Optional localised description per level (tooltip; shown under the caption in "settings" size). */
    descriptions?: Readonly<Record<number, string>>;
    /** Levels that are shown but cannot be selected. */
    disabledLevels?: readonly number[];
    /** A change is being committed: ignore further changes, set aria-busy. */
    busy?: boolean;
    /** Show the current level but allow no change (admin policy). */
    readOnly?: boolean;
    /** "popup" (default): full width, 36px tall. "settings": 40px tall, max 28rem wide, shows the description. */
    size?: ModeSelectorSize;
    /** Show a Tooltip with the name (and description) on each option. @default true */
    tooltips?: boolean;
    /** Accessible name of the radiogroup (localised). Use this or `labelledBy`. */
    label?: string;
    /** id of an element that names the radiogroup (e.g. SettingRow's labelId). */
    labelledBy?: string;
    /** Text direction. Default: document direction (html[dir]), else the Radix Direction context, else ltr. */
    dir?: 'ltr' | 'rtl';
    /** id for the radiogroup element. */
    id?: string;
    className?: string;
}

function documentDir(): 'ltr' | 'rtl' | undefined {
    if (typeof document === 'undefined') return undefined;
    const d = (document.documentElement.getAttribute('dir') ?? document.body?.getAttribute('dir') ?? '').toLowerCase();
    return d === 'rtl' ? 'rtl' : d === 'ltr' ? 'ltr' : undefined;
}

export function ModeSelector({
    value,
    onChange,
    levels,
    names,
    descriptions,
    disabledLevels,
    busy = false,
    readOnly = false,
    size = 'popup',
    tooltips = true,
    label,
    labelledBy,
    dir: dirProp,
    id,
    className,
}: ModeSelectorProps) {
    const contextDir = Direction.useDirection();
    const dir = dirProp ?? documentDir() ?? contextDir;
    const baseId = useId();

    const [hovered, setHovered] = useState<number | null>(null);
    const [focused, setFocused] = useState<number | null>(null);
    const pointerDownRef = useRef(false);

    const inert = busy || readOnly;
    const disabledSet = new Set(disabledLevels ?? []);

    const handleChange = (next: string) => {
        const level = Number(next);
        if (inert) return;
        if (!Number.isInteger(level) || !levels.includes(level)) return;
        if (disabledSet.has(level) || level === value) return;
        onChange(level);
    };

    const name = (level: number) => (names[level] ?? '').trim();
    const description = (level: number) => (descriptions?.[level] ?? '').trim();
    const descId = (level: number) => `${baseId}-desc-${level}`;

    const target = inert ? null : (hovered ?? focused);
    const showPreview = target !== null && target !== value;
    const arrow = dir === 'rtl' ? '←' : '→';

    const isSettings = size === 'settings';
    const groupName = labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': label ?? '' };
    const selectedDescription = isSettings && levels.includes(value) ? description(value) : '';

    return (
        <div
            dir={dir}
            className={[
                'flex min-w-0 flex-col',
                isSettings ? 'w-full max-w-md gap-2' : 'w-full gap-1.5',
                className,
            ]
                .filter(Boolean)
                .join(' ')}
            data-size={size}
            data-busy={busy ? '' : undefined}
            data-readonly={readOnly ? '' : undefined}
            onPointerDown={() => {
                pointerDownRef.current = true;
            }}
            onPointerUp={() => {
                pointerDownRef.current = false;
            }}
            onKeyDown={() => {
                pointerDownRef.current = false;
            }}
        >
            <Direction.Provider dir={dir}>
                <SegmentedControl
                    {...(groupName as { 'aria-label': string })}
                    {...{ id, 'aria-busy': busy ? true : undefined, 'aria-readonly': readOnly ? true : undefined }}
                    value={String(value)}
                    onChange={handleChange}
                    block
                    pill={false}
                    size={isSettings ? 'xl' : 'lg'}
                    className={[
                        // Touch screens: 44px options (36px / 40px with a mouse).
                        'touch:[--segmented-control-size:var(--control-size-2xl)]',
                        // Thumb = first child div of the control; its transition is set inline by the library.
                        'motion-reduce:[&>div:first-child]:transition-none!',
                        'motion-reduce:[&_button]:transition-none!',
                        // Selected-state outline (inside the thumb, keeps the library's shadow):
                        // >= 3:1 against the track in light and dark.
                        '[&>div:first-child]:outline-1 [&>div:first-child]:-outline-offset-1 [&>div:first-child]:outline-(--color-text-secondary)',
                        busy ? 'cursor-progress [&_button]:cursor-progress' : '',
                        readOnly
                            ? '[&_button]:cursor-default [&_button]:before:opacity-0! [&_button[data-state=off]]:text-secondary! [&_button[data-state=off]]:opacity-60'
                            : '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                >
                    {levels.map((level) => {
                        const levelName = name(level);
                        const levelDesc = description(level);
                        const selected = level === value;
                        const optionProps: Record<string, string> = {
                            ...(levelDesc ? { 'aria-describedby': descId(level) } : {}),
                            ...(readOnly ? { 'aria-disabled': 'true' } : {}),
                        };
                        const option = (
                            // Tooltip trigger + hover/focus tracking. A wrapper is needed: the
                            // tooltip trigger's own data-state would otherwise replace the
                            // option's data-state="on|off" that the library styles and its
                            // thumb rely on.
                            <span
                                className="flex min-w-0 flex-1 [&>button]:min-w-0 [&>button]:flex-1"
                                data-level={level}
                                onPointerEnter={(e: ReactPointerEvent) => {
                                    if (e.pointerType !== 'touch') setHovered(level);
                                }}
                                onPointerLeave={() => {
                                    setHovered((h) => (h === level ? null : h));
                                }}
                                onFocus={() => {
                                    if (!pointerDownRef.current) setFocused(level);
                                }}
                                onBlur={() => {
                                    setFocused((f) => (f === level ? null : f));
                                }}
                            >
                                <SegmentedControl.Option
                                    value={String(level)}
                                    aria-label={levelName}
                                    disabled={disabledSet.has(level)}
                                    {...optionProps}
                                >
                                    <LevelMeter
                                        level={level}
                                        tone={selected ? 'color' : 'mono'}
                                        size={isSettings ? 'lg' : 'md'}
                                    />
                                </SegmentedControl.Option>
                            </span>
                        );
                        if (!tooltips) return <Fragment key={level}>{option}</Fragment>;
                        return (
                            <Tooltip
                                key={level}
                                content={
                                    levelDesc ? (
                                        <span className="flex flex-col gap-1">
                                            <span className="font-semibold">{levelName}</span>
                                            <span className="whitespace-pre-line">{levelDesc}</span>
                                        </span>
                                    ) : (
                                        levelName
                                    )
                                }
                                compact={!levelDesc}
                                side="top"
                                maxWidth={280}
                            >
                                {option}
                            </Tooltip>
                        );
                    })}
                </SegmentedControl>
            </Direction.Provider>

            {/* Descriptions referenced by aria-describedby (hidden elements may be referenced). */}
            {levels.map((level) =>
                description(level) ? (
                    <span key={level} id={descId(level)} hidden>
                        {description(level)}
                    </span>
                ) : null,
            )}

            {/* Caption: redundant with the radios' names and checked state for assistive
                technology, so it is hidden from it to avoid double announcements. */}
            <p
                aria-hidden="true"
                data-testid="mode-caption"
                className={[
                    'flex min-w-0 items-center gap-1.5',
                    isSettings ? 'h-6 text-base' : 'h-5 text-sm',
                ].join(' ')}
            >
                <span className="min-w-0 truncate font-semibold text-default" data-part="current">
                    {name(value)}
                </span>
                {showPreview ? (
                    <>
                        <span className="shrink-0 text-secondary">{arrow}</span>
                        <span className="min-w-0 truncate text-secondary" data-part="target">
                            {name(target)}
                        </span>
                    </>
                ) : null}
            </p>
            {selectedDescription ? (
                <p className="text-sm whitespace-pre-line text-secondary" data-part="description">
                    {selectedDescription}
                </p>
            ) : null}
        </div>
    );
}

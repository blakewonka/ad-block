/**
 * Default-filtering-mode options as selectable cards (settings.md §1, §3).
 *
 *
 * Upstream renders each option as one <label> wrapping a native radio, its
 * level illustration, its name and its description, so the whole card selects
 * (dashboard.html:48-92). This component does the same with NATIVE radios:
 *
 * - Pointer: a click anywhere on the card is a click on the radio.
 * - Keyboard: Tab reaches the group's checked radio; arrow keys move AND select,
 *   exactly like upstream (§3.2 "native radios also fire change on arrow-key
 *   navigation, and that path behaves identically, permission request
 *   included"). The browser turns the arrow keydown into a simulated click on
 *   the radio (Blink/WebKit RadioInputType::handleKeydownEvent), so React's
 *   onChange — and therefore `onChange` here — runs synchronously inside the
 *   key event: the permission request keeps its user gesture (§3.3). Radix's
 *   RadioGroup was not used because it selects on arrow keys from a setTimeout.
 * - RTL arrow mapping is the browser's own.
 *
 * Controlled: a radio is checked only when `value` says so. A change that the
 * parent ignores (or reverts later) snaps back. Level 0 checks nothing.
 * `pendingLevel` shows a spinner on that card while the change is in flight.
 *
 * Each radio is named by its card's name (`aria-labelledby`) and described by
 * the card's description (`aria-describedby`). Names are the catalogue's
 * lower-case strings, capitalised by CSS only (§14 line 46).
 */
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';
import { useId, type ChangeEvent, type ReactNode } from 'react';

import { LevelMeter } from '@/components/LevelMeter';

export type CardLevel = 1 | 2 | 3;

export interface ModeCardsProps {
    /** Shown level; 0 (or any value not in 1..3) checks nothing. */
    value: number;
    /** Level whose change is in flight (spinner + aria-busy), or null. */
    pendingLevel: number | null;
    /** Localised names (catalogue strings). */
    names: Record<CardLevel, string>;
    /** Localised descriptions (may keep paragraph breaks). */
    descriptions: Record<CardLevel, ReactNode>;
    /** id of the group's visible heading. */
    labelledBy: string;
    /** Called synchronously from the radio's change (pointer or keyboard). */
    onChange: (level: CardLevel) => void;
}

const LEVELS: readonly CardLevel[] = [1, 2, 3];

// Complete static class strings: Tailwind only generates what it finds verbatim.
const CARD_SELECTED: Record<CardLevel, string> = {
    1: 'border-level-1 shadow-[inset_0_0_0_1px_var(--blocker-level-1)]',
    2: 'border-level-2 shadow-[inset_0_0_0_1px_var(--blocker-level-2)]',
    3: 'border-level-3 shadow-[inset_0_0_0_1px_var(--blocker-level-3)]',
};
const NAME_SELECTED: Record<CardLevel, string> = {
    1: 'text-level-1-on-soft',
    2: 'text-level-2-on-soft',
    3: 'text-level-3-on-soft',
};
const RADIO_CHECKED: Record<CardLevel, string> = {
    1: 'checked:border-level-1',
    2: 'checked:border-level-2',
    3: 'checked:border-level-3',
};

export function ModeCards({ value, pendingLevel, names, descriptions, labelledBy, onChange }: ModeCardsProps) {
    const baseId = useId();
    const groupName = `${baseId}-mode`;

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const level = Number(event.currentTarget.value);
        if (level === 1 || level === 2 || level === 3) onChange(level);
    };

    return (
        // Container query: three columns only when the PANE (not the window) is
        // at least 42rem wide, otherwise one card per row.
        <div className="@container min-w-0">
            <div
                role="radiogroup"
                aria-labelledby={labelledBy}
                aria-busy={pendingLevel !== null || undefined}
                className="grid min-w-0 grid-cols-1 gap-3 @2xl:grid-cols-3"
                data-testid="settings-mode-options"
            >
                {LEVELS.map((level) => {
                    const selected = value === level;
                    const nameId = `${baseId}-name-${level}`;
                    const descriptionId = `${baseId}-description-${level}`;
                    return (
                        <label
                            key={level}
                            data-level-card={level}
                            data-selected={selected ? '' : undefined}
                            className={[
                                'flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border bg-surface p-3 transition-colors',
                                selected ? CARD_SELECTED[level] : 'border-default hover:border-strong',
                            ].join(' ')}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <input
                                    type="radio"
                                    name={groupName}
                                    value={level}
                                    checked={selected}
                                    onChange={handleChange}
                                    aria-labelledby={nameId}
                                    aria-describedby={descriptionId}
                                    className={[
                                        'm-0 size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-(--color-text-secondary) bg-surface transition-[border-width]',
                                        'checked:border-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                                        RADIO_CHECKED[level],
                                    ].join(' ')}
                                />
                                <LevelMeter level={level} tone={selected ? 'color' : 'mono'} size="sm" />
                                <span
                                    id={nameId}
                                    className={[
                                        'min-w-0 text-sm font-semibold capitalize break-words',
                                        selected ? NAME_SELECTED[level] : 'text-default',
                                    ].join(' ')}
                                >
                                    {names[level]}
                                </span>
                                {pendingLevel === level ? (
                                    <LoadingIndicator size={16} className="ms-auto shrink-0" aria-hidden="true" data-testid="settings-mode-pending" />
                                ) : null}
                            </span>
                            <p
                                id={descriptionId}
                                className={['text-sm whitespace-pre-line break-words', selected ? 'text-default' : 'text-secondary'].join(' ')}
                            >
                                {descriptions[level]}
                            </p>
                        </label>
                    );
                })}
            </div>
        </div>
    );
}

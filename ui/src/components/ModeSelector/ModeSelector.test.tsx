import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModeSelector, type ModeSelectorProps } from './ModeSelector';

const NAMES = { 0: 'no filtering', 1: 'basic', 2: 'optimal', 3: 'complete' };
const DESCRIPTIONS = {
    1: 'Basic network filtering.\n\nNo permission needed.',
    2: 'Advanced network filtering.',
    3: 'Everything.',
};

function renderSelector(props: Partial<ModeSelectorProps> = {}) {
    const onChange = props.onChange ?? vi.fn();
    const utils = render(
        <ModeSelector
            label="filtering mode"
            value={1}
            levels={[0, 1, 2, 3]}
            names={NAMES}
            {...props}
            onChange={onChange}
        />,
    );
    return { ...utils, onChange };
}

/** Parent that accepts every change. */
function Accepting({ initial = 1, onChange }: { initial?: number; onChange?: (l: number) => void }) {
    const [value, setValue] = useState(initial);
    return (
        <ModeSelector
            label="filtering mode"
            value={value}
            levels={[0, 1, 2, 3]}
            names={NAMES}
            onChange={(l) => {
                onChange?.(l);
                setValue(l);
            }}
        />
    );
}

/** Parent that shows the change optimistically, then reverts it when the async check fails. */
function RejectingAsync({ check }: { check: (l: number) => Promise<boolean> }) {
    const [value, setValue] = useState(1);
    return (
        <ModeSelector
            label="filtering mode"
            value={value}
            levels={[0, 1, 2, 3]}
            names={NAMES}
            onChange={(l) => {
                const before = value;
                setValue(l);
                void check(l).then((ok) => {
                    if (!ok) setValue(before);
                });
            }}
        />
    );
}

const radio = (name: string) => screen.getByRole('radio', { name });
const caption = () => screen.getByTestId('mode-caption');

/*
 * "Inside the user gesture" probe: true only while a trusted-like input event
 * (click / keydown / keyup / pointer*) is being dispatched. A window capture listener
 * runs first, a window bubble listener runs last (after React's root listener), so a
 * callback made synchronously by a React handler sees `true`, and anything deferred to a
 * timer, microtask or effect sees `false`.
 */
let dispatching = false;
const GESTURE_EVENTS = ['click', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'];
const onCapture = () => {
    dispatching = true;
};
const onBubble = () => {
    dispatching = false;
};
beforeEach(() => {
    dispatching = false;
    for (const type of GESTURE_EVENTS) {
        window.addEventListener(type, onCapture, true);
        window.addEventListener(type, onBubble, false);
    }
});
afterEach(() => {
    for (const type of GESTURE_EVENTS) {
        window.removeEventListener(type, onCapture, true);
        window.removeEventListener(type, onBubble, false);
    }
    document.documentElement.removeAttribute('dir');
});

describe('ModeSelector: semantics', () => {
    it('renders a named radiogroup with one named radio per level', () => {
        renderSelector();
        const group = screen.getByRole('radiogroup', { name: 'filtering mode' });
        const radios = within(group).getAllByRole('radio');
        expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['no filtering', 'basic', 'optimal', 'complete']);
        expect(radio('basic')).toHaveAttribute('aria-checked', 'true');
        for (const name of ['no filtering', 'optimal', 'complete']) {
            expect(radio(name)).toHaveAttribute('aria-checked', 'false');
        }
    });

    it('can be named by aria-labelledby instead', () => {
        render(
            <>
                <h3 id="dfm">Default filtering mode</h3>
                <ModeSelector labelledBy="dfm" value={2} onChange={vi.fn()} levels={[1, 2, 3]} names={NAMES} />
            </>,
        );
        expect(screen.getByRole('radiogroup', { name: 'Default filtering mode' })).toBeInTheDocument();
    });

    it('offers only the configured subset of levels, in order', () => {
        renderSelector({ levels: [1, 2, 3], value: 2, size: 'settings' });
        expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
            'basic',
            'optimal',
            'complete',
        ]);
        expect(screen.queryByRole('radio', { name: 'no filtering' })).toBeNull();
    });

    it('checks no radio when the value is not one of the levels (default mode 0 in settings)', () => {
        renderSelector({ levels: [1, 2, 3], value: 0 });
        for (const r of screen.getAllByRole('radio')) {
            expect(r).toHaveAttribute('aria-checked', 'false');
        }
    });

    it('draws a decorative LevelMeter in every option', () => {
        renderSelector();
        for (const [level, name] of Object.entries(NAMES)) {
            const svg = radio(name).querySelector('svg');
            expect(svg).not.toBeNull();
            expect(svg).toHaveAttribute('aria-hidden', 'true');
            expect(svg).toHaveAttribute('data-level', level);
        }
        // Only the selected option is coloured.
        expect(radio('basic').querySelector('svg')).toHaveAttribute('data-tone', 'color');
        expect(radio('optimal').querySelector('svg')).toHaveAttribute('data-tone', 'mono');
    });

    it('links each option to its description when descriptions are given', () => {
        renderSelector({ levels: [1, 2, 3], value: 1, descriptions: DESCRIPTIONS, size: 'settings' });
        expect(radio('basic')).toHaveAccessibleDescription(/Basic network filtering/);
        expect(radio('complete')).toHaveAccessibleDescription('Everything.');
        // settings size shows the selected description under the caption
        expect(screen.getByText(/Basic network filtering\./, { selector: '[data-part="description"]' })).toBeVisible();
    });
});

describe('ModeSelector: pointer selection', () => {
    it('calls onChange synchronously inside the click dispatch', () => {
        let insideGesture: boolean | undefined;
        const onChange = vi.fn(() => {
            insideGesture = dispatching;
        });
        renderSelector({ onChange });
        fireEvent.click(radio('optimal'));
        // No await between the click and this assertion: the call already happened.
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(2);
        expect(insideGesture).toBe(true);
    });

    it('calls onChange inside the gesture with a full user-event click sequence', async () => {
        const user = userEvent.setup();
        const seen: boolean[] = [];
        const onChange = vi.fn(() => {
            seen.push(dispatching);
        });
        renderSelector({ onChange });
        await user.click(radio('complete'));
        expect(onChange).toHaveBeenCalledExactlyOnceWith(3);
        expect(seen).toEqual([true]);
    });

    it('does not call onChange for the level already selected', async () => {
        const user = userEvent.setup();
        const { onChange } = renderSelector({ value: 2 });
        await user.click(radio('optimal'));
        expect(onChange).not.toHaveBeenCalled();
        expect(radio('optimal')).toHaveAttribute('aria-checked', 'true');
    });

    it('moves the selection when the parent accepts', async () => {
        const user = userEvent.setup();
        const spy = vi.fn();
        render(<Accepting onChange={spy} />);
        await user.click(radio('complete'));
        expect(spy).toHaveBeenCalledWith(3);
        expect(radio('complete')).toHaveAttribute('aria-checked', 'true');
        expect(radio('basic')).toHaveAttribute('aria-checked', 'false');
    });
});

describe('ModeSelector: keyboard', () => {
    it('arrow keys move focus only; Space selects inside the gesture', async () => {
        const user = userEvent.setup();
        const seen: boolean[] = [];
        const onChange = vi.fn(() => {
            seen.push(dispatching);
        });
        renderSelector({ onChange, value: 1 });

        await user.tab();
        expect(radio('basic')).toHaveFocus(); // Tab enters on the checked option

        await user.keyboard('{ArrowRight}');
        await waitFor(() => expect(radio('optimal')).toHaveFocus());
        await user.keyboard('{ArrowRight}');
        await waitFor(() => expect(radio('complete')).toHaveFocus());

        // Give any timer-based "select on focus" a chance to fire: there must be none.
        await new Promise((r) => setTimeout(r, 50));
        expect(onChange).not.toHaveBeenCalled();
        expect(radio('basic')).toHaveAttribute('aria-checked', 'true');

        await user.keyboard(' ');
        expect(onChange).toHaveBeenCalledExactlyOnceWith(3);
        expect(seen).toEqual([true]);
    });

    it('Enter selects the focused option inside the gesture', async () => {
        const user = userEvent.setup();
        const seen: boolean[] = [];
        const onChange = vi.fn(() => {
            seen.push(dispatching);
        });
        renderSelector({ onChange, value: 1 });
        await user.tab();
        await user.keyboard('{ArrowLeft}');
        await waitFor(() => expect(radio('no filtering')).toHaveFocus());
        expect(onChange).not.toHaveBeenCalled();
        await user.keyboard('{Enter}');
        expect(onChange).toHaveBeenCalledExactlyOnceWith(0);
        expect(seen).toEqual([true]);
    });

    it('Home / End move focus to the first / last option without selecting; no wrap-around', async () => {
        const user = userEvent.setup();
        const { onChange } = renderSelector({ value: 2 });
        await user.tab();
        expect(radio('optimal')).toHaveFocus();
        await user.keyboard('{End}');
        await waitFor(() => expect(radio('complete')).toHaveFocus());
        await user.keyboard('{ArrowRight}'); // loop=false: stays on the last option
        await new Promise((r) => setTimeout(r, 20));
        expect(radio('complete')).toHaveFocus();
        await user.keyboard('{Home}');
        await waitFor(() => expect(radio('no filtering')).toHaveFocus());
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keyboard focus on another option shows the "current -> target" preview', async () => {
        const user = userEvent.setup();
        renderSelector({ value: 1 });
        expect(caption()).toHaveTextContent(/^basic$/);
        await user.tab();
        await user.keyboard('{ArrowRight}');
        await waitFor(() => expect(radio('optimal')).toHaveFocus());
        expect(caption()).toHaveTextContent('basic→optimal');
        await user.tab(); // leave the group
        expect(caption()).toHaveTextContent(/^basic$/);
    });
});

describe('ModeSelector: rejected changes snap back', () => {
    it('stays on the old level when the parent ignores the change', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn(); // parent does not update `value`
        renderSelector({ onChange, value: 1 });
        await user.click(radio('complete'));
        expect(onChange).toHaveBeenCalledWith(3);
        expect(radio('complete')).toHaveAttribute('aria-checked', 'false');
        expect(radio('basic')).toHaveAttribute('aria-checked', 'true');
        expect(radio('complete').querySelector('svg')).toHaveAttribute('data-tone', 'mono');
    });

    it('returns to the old level when the parent reverts after an async refusal', async () => {
        const user = userEvent.setup();
        let resolve!: (ok: boolean) => void;
        const check = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
        render(<RejectingAsync check={check} />);

        await user.click(radio('optimal'));
        expect(check).toHaveBeenCalledWith(2);
        expect(radio('optimal')).toHaveAttribute('aria-checked', 'true'); // optimistic

        await act(async () => resolve(false));
        expect(radio('optimal')).toHaveAttribute('aria-checked', 'false');
        expect(radio('basic')).toHaveAttribute('aria-checked', 'true');
        expect(caption()).toHaveTextContent(/^basic/);
    });
});

describe('ModeSelector: disabled, busy, read-only', () => {
    it('never selects a disabled level', async () => {
        const user = userEvent.setup();
        const { onChange } = renderSelector({ disabledLevels: [3] });
        expect(radio('complete')).toBeDisabled();
        await user.click(radio('complete'));
        fireEvent.click(radio('complete'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('ignores changes while busy but keeps the options focusable', async () => {
        const user = userEvent.setup();
        const { onChange } = renderSelector({ busy: true });
        expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'true');
        await user.click(radio('optimal'));
        expect(onChange).not.toHaveBeenCalled();
        expect(radio('optimal')).toBeEnabled();
        expect(radio('basic')).toHaveAttribute('aria-checked', 'true');
    });

    it('read-only shows the level and allows no change', async () => {
        const user = userEvent.setup();
        const { onChange } = renderSelector({ readOnly: true, value: 2 });
        expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-readonly', 'true');
        // Assistive technology learns it from each option (Chrome ignores aria-readonly on a group).
        for (const name of Object.values(NAMES)) {
            expect(radio(name)).toHaveAttribute('aria-disabled', 'true');
            expect(radio(name)).toBeEnabled(); // still focusable, so the level can be read
        }
        await user.click(radio('complete'));
        await user.keyboard(' ');
        expect(onChange).not.toHaveBeenCalled();
        expect(radio('optimal')).toHaveAttribute('aria-checked', 'true');
        expect(caption()).toHaveTextContent(/^optimal$/);
    });
});

describe('ModeSelector: tooltips prop', () => {
    it('tooltips={false}: no tooltip on hover or focus; names, descriptions and preview stay', async () => {
        const user = userEvent.setup();
        renderSelector({ tooltips: false, descriptions: DESCRIPTIONS });
        await user.hover(radio('optimal'));
        await act(async () => {
            await new Promise((r) => setTimeout(r, 400));
        });
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(caption()).toHaveTextContent('basic→optimal');
        expect(radio('optimal')).toHaveAccessibleDescription('Advanced network filtering.');
        // No Radix tooltip trigger around the option (the trigger adds data-state to it).
        expect(radio('optimal').closest('[data-level]')).not.toHaveAttribute('data-state');
    });

    it('tooltips (default): each option is a tooltip trigger', () => {
        renderSelector();
        expect(radio('optimal').closest('[data-level]')).toHaveAttribute('data-state', 'closed');
    });

    it('options are not aria-disabled when the control is not read-only', () => {
        renderSelector();
        for (const name of Object.values(NAMES)) expect(radio(name)).not.toHaveAttribute('aria-disabled');
    });
});

describe('ModeSelector: hover preview', () => {
    it('shows "current -> target" while the pointer is over another option, not for touch', () => {
        renderSelector({ value: 1 });
        const optionWrapper = radio('complete').parentElement as HTMLElement;
        fireEvent.pointerEnter(optionWrapper, { pointerType: 'mouse' });
        expect(caption()).toHaveTextContent('basic→complete');
        expect(caption().querySelector('[data-part="target"]')).toHaveTextContent('complete');
        fireEvent.pointerLeave(optionWrapper, { pointerType: 'mouse' });
        expect(caption()).toHaveTextContent(/^basic$/);

        fireEvent.pointerEnter(optionWrapper, { pointerType: 'touch' });
        expect(caption()).toHaveTextContent(/^basic$/);
    });

    it('shows no preview when hovering the selected option', () => {
        renderSelector({ value: 1 });
        fireEvent.pointerEnter(radio('basic').parentElement as HTMLElement, { pointerType: 'mouse' });
        expect(caption()).toHaveTextContent(/^basic$/);
    });

    it('shows no preview while busy', () => {
        renderSelector({ value: 1, busy: true });
        fireEvent.pointerEnter(radio('complete').parentElement as HTMLElement, { pointerType: 'mouse' });
        expect(caption()).toHaveTextContent(/^basic$/);
    });
});

describe('ModeSelector: RTL', () => {
    it('sets dir="rtl", maps ArrowLeft to the next option and uses a left arrow in the caption', async () => {
        const user = userEvent.setup();
        const { container, onChange } = renderSelector({ dir: 'rtl', value: 1 });
        expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
        expect(screen.getByRole('radiogroup')).toHaveAttribute('dir', 'rtl');

        await user.tab();
        expect(radio('basic')).toHaveFocus();
        await user.keyboard('{ArrowLeft}');
        await waitFor(() => expect(radio('optimal')).toHaveFocus());
        expect(caption()).toHaveTextContent('basic←optimal');
        await user.keyboard('{ArrowRight}');
        await waitFor(() => expect(radio('basic')).toHaveFocus());
        expect(onChange).not.toHaveBeenCalled();
    });

    it('follows html[dir="rtl"] when no dir prop is given', () => {
        document.documentElement.setAttribute('dir', 'rtl');
        const { container } = renderSelector();
        expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    });

    it('defaults to ltr', () => {
        const { container } = renderSelector();
        expect(container.firstElementChild).toHaveAttribute('dir', 'ltr');
    });
});

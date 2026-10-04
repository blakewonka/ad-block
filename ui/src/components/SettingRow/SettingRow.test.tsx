import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { SettingRow } from './SettingRow';

const PHYSICAL = /^(?:[\w-]+:)*-?(?:ml|mr|pl|pr|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|text-left|text-right|float-left|float-right)(?:-|$)/;
function physicalClasses(root: HTMLElement): string[] {
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    return all.flatMap((el) => Array.from(el.classList)).filter((c) => PHYSICAL.test(c));
}

describe('SettingRow', () => {
    it('labels a native control through <label for> and describes it', () => {
        render(
            <SettingRow
                label="Auto reload"
                description="Reload the page after a change"
                control={({ id, describedBy }) => <input type="checkbox" id={id} aria-describedby={describedBy} />}
            />,
        );
        const box = screen.getByLabelText('Auto reload');
        expect(box).toHaveAttribute('type', 'checkbox');
        expect(box).toHaveAccessibleName('Auto reload');
        expect(box).toHaveAccessibleDescription('Reload the page after a change');
    });

    it('labels the library Switch, and clicking the label toggles it', async () => {
        render(
            <SettingRow
                label="Show blocked count"
                control={({ id, describedBy }) => <Switch id={id} aria-describedby={describedBy} />}
            />,
        );
        const sw = screen.getByRole('switch', { name: 'Show blocked count' });
        expect(sw).toHaveAttribute('aria-checked', 'false');
        await userEvent.click(screen.getByText('Show blocked count'));
        expect(sw).toHaveAttribute('aria-checked', 'true');
        expect(sw).not.toHaveAttribute('aria-describedby');
    });

    it('gives composite controls a labelId for aria-labelledby', () => {
        render(
            <SettingRow
                label="Default mode"
                control={({ labelId }) => (
                    <div role="radiogroup" aria-labelledby={labelId}>
                        <input type="radio" name="m" aria-label="one" />
                    </div>
                )}
            />,
        );
        expect(screen.getByRole('radiogroup', { name: 'Default mode' })).toBeInTheDocument();
    });

    it('accepts a plain node with an explicit controlId', () => {
        render(<SettingRow label="Name" controlId="name-input" control={<input id="name-input" />} />);
        expect(screen.getByLabelText('Name')).toHaveAttribute('id', 'name-input');
    });

    it('generates unique ids per row', () => {
        render(
            <>
                <SettingRow label="A" control={({ id }) => <input id={id} />} />
                <SettingRow label="B" control={({ id }) => <input id={id} />} />
            </>,
        );
        expect(screen.getByLabelText('A').id).not.toBe(screen.getByLabelText('B').id);
    });

    it('renders extra children under the description', () => {
        render(
            <SettingRow label="L" description="D" control={null}>
                <span>extra</span>
            </SettingRow>,
        );
        expect(screen.getByText('extra')).toBeInTheDocument();
    });

    it('wraps: the text column has a flex basis, the row wraps, the control sits at the inline-end', () => {
        render(<SettingRow data-testid="row" label="L" control={<button type="button">C</button>} />);
        const row = screen.getByTestId('row');
        expect(row).toHaveClass('flex', 'flex-wrap');
        expect(screen.getByText('L').parentElement).toHaveClass('flex-[1_1_12rem]', 'min-w-0', 'text-start');
        expect(screen.getByRole('button').parentElement).toHaveClass('ms-auto');
    });

    it('stacked puts the control on its own line', () => {
        render(<SettingRow stacked label="L" control={<button type="button">C</button>} />);
        expect(screen.getByText('L').parentElement).toHaveClass('basis-full');
        expect(screen.getByRole('button').parentElement).toHaveClass('me-auto');
    });

    it('disabled dims the texts and tells the control', () => {
        let seen: boolean | undefined;
        render(
            <SettingRow
                data-testid="row"
                disabled
                label="L"
                description="D"
                control={({ id, disabled }) => {
                    seen = disabled;
                    return <input id={id} disabled={disabled} />;
                }}
            />,
        );
        expect(seen).toBe(true);
        expect(screen.getByTestId('row')).toHaveAttribute('data-disabled');
        expect(screen.getByText('L')).toHaveClass('text-disabled');
        expect(screen.getByLabelText('L')).toBeDisabled();
    });

    it('forwards its ref', () => {
        const ref = createRef<HTMLDivElement>();
        render(<SettingRow ref={ref} label="L" control={null} />);
        expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it('uses logical properties only (RTL-safe), including inset padding', () => {
        const { container } = render(
            <div dir="rtl">
                <SettingRow inset label="L" description="D" control={({ id }) => <Switch id={id} />} />
                <SettingRow stacked label="L2" control={({ id }) => <input id={id} />} />
            </div>,
        );
        expect(physicalClasses(container)).toEqual([]);
        expect(container.querySelector('[class*="ps-4"]')).toHaveClass('pe-4');
    });
});

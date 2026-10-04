import { Button } from '@openai/apps-sdk-ui/components/Button';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

type Props = Partial<ConfirmDialogProps>;

function WithTrigger(props: Props) {
    return (
        <>
            <button type="button">Before</button>
            <ConfirmDialog
                title="Reset settings?"
                description="All settings return to their defaults."
                confirmLabel="Reset"
                cancelLabel="Cancel"
                onConfirm={() => {}}
                trigger={
                    <Button color="danger" variant="outline">
                        Reset to default
                    </Button>
                }
                {...props}
            />
            <button type="button">After</button>
        </>
    );
}

/** Controlled, opened by the page's own button (no `trigger`). */
function Controlled(props: Props & { useReturnRef?: boolean }) {
    const { useReturnRef, onOpenChange, ...rest } = props;
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
        <>
            <button type="button" ref={ref} onClick={() => setOpen(true)}>
                Open dialog
            </button>
            <button type="button">Elsewhere</button>
            <ConfirmDialog
                title="Remove list?"
                description={<p>This cannot be undone.</p>}
                confirmLabel="Remove"
                cancelLabel="Keep"
                onConfirm={() => {}}
                open={open}
                onOpenChange={(next) => {
                    onOpenChange?.(next);
                    setOpen(next);
                }}
                returnFocusRef={useReturnRef ? ref : undefined}
                {...rest}
            />
        </>
    );
}

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('ConfirmDialog: semantics and focus', () => {
    it('opens from the trigger as a labelled, described alertdialog with focus on Cancel', async () => {
        const user = userEvent.setup();
        render(<WithTrigger danger />);
        expect(screen.queryByRole('alertdialog')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        const dialog = await screen.findByRole('alertdialog', { name: 'Reset settings?' });
        expect(dialog).toHaveAccessibleDescription('All settings return to their defaults.');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

        const confirm = screen.getByRole('button', { name: 'Reset' });
        expect(confirm).toHaveAttribute('data-color', 'danger');
        expect(confirm).toHaveAttribute('data-variant', 'solid');
    });

    it('non-danger confirm uses the primary colour', async () => {
        const user = userEvent.setup();
        render(<WithTrigger />);
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        expect(await screen.findByRole('button', { name: 'Reset' })).toHaveAttribute('data-color', 'primary');
    });

    it('hides the rest of the page from assistive tech while open', async () => {
        const user = userEvent.setup();
        render(<WithTrigger />);
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        await screen.findByRole('alertdialog');
        expect(screen.queryByRole('button', { name: 'Before' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Before', hidden: true })).toBeInTheDocument();
    });

    it('traps Tab inside the dialog', async () => {
        const user = userEvent.setup();
        render(<WithTrigger />);
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        const cancel = await screen.findByRole('button', { name: 'Cancel' });
        const confirm = screen.getByRole('button', { name: 'Reset' });
        expect(cancel).toHaveFocus();
        await user.tab();
        expect(confirm).toHaveFocus();
        await user.tab();
        expect(cancel).toHaveFocus();
        await user.tab({ shift: true });
        expect(confirm).toHaveFocus();
    });

    it('Escape closes and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        const onOpenChange = vi.fn();
        render(<WithTrigger onOpenChange={onOpenChange} />);
        const trigger = screen.getByRole('button', { name: 'Reset to default' });
        await user.click(trigger);
        await screen.findByRole('alertdialog');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(trigger).toHaveFocus();
    });

    it('Cancel closes without confirming and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(<WithTrigger onConfirm={onConfirm} />);
        const trigger = screen.getByRole('button', { name: 'Reset to default' });
        await user.click(trigger);
        await user.click(await screen.findByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(onConfirm).not.toHaveBeenCalled();
        expect(trigger).toHaveFocus();
    });

    it('controlled without trigger: focus returns to the element focused at open', async () => {
        const user = userEvent.setup();
        render(<Controlled />);
        const opener = screen.getByRole('button', { name: 'Open dialog' });
        opener.focus();
        await user.keyboard('{Enter}');
        const dialog = await screen.findByRole('alertdialog', { name: 'Remove list?' });
        // A ReactNode description with block content is rendered in a div.
        expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
        expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(opener).toHaveFocus();
    });

    it('controlled without trigger: returnFocusRef wins when nothing had focus (Safari mouse click)', async () => {
        const user = userEvent.setup();
        render(<Controlled useReturnRef />);
        const opener = screen.getByRole('button', { name: 'Open dialog' });
        // Simulate Safari: clicking does not focus the button.
        act(() => opener.click());
        expect(opener).not.toHaveFocus();
        await screen.findByRole('alertdialog');
        await user.click(screen.getByRole('button', { name: 'Keep' }));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(opener).toHaveFocus();
    });

    it('does not set aria-describedby when there is no description', async () => {
        const user = userEvent.setup();
        render(<WithTrigger description={undefined} />);
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).not.toHaveAttribute('aria-describedby');
    });

    it('uncontrolled defaultOpen renders open', () => {
        render(<WithTrigger defaultOpen />);
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
});

describe('ConfirmDialog: confirm', () => {
    it('sync onConfirm: called once, dialog closes', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        const onOpenChange = vi.fn();
        render(<WithTrigger onConfirm={onConfirm} onOpenChange={onOpenChange} />);
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        await user.click(await screen.findByRole('button', { name: 'Reset' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    it('returning false keeps the dialog open', async () => {
        const user = userEvent.setup();
        render(<WithTrigger onConfirm={() => false} />);
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        await user.click(await screen.findByRole('button', { name: 'Reset' }));
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('async onConfirm: busy state, Cancel/Escape/double-click ignored, closes on resolve', async () => {
        const user = userEvent.setup();
        const pending = deferred();
        const onConfirm = vi.fn(() => pending.promise);
        const onOpenChange = vi.fn();
        render(<Controlled onConfirm={onConfirm} onOpenChange={onOpenChange} />);
        await user.click(screen.getByRole('button', { name: 'Open dialog' }));
        const confirm = await screen.findByRole('button', { name: 'Remove' });
        await user.click(confirm);

        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toHaveAttribute('aria-busy', 'true');
        expect(confirm).toHaveAttribute('aria-disabled', 'true');
        expect(confirm).toHaveAttribute('data-loading', '');
        // Still focusable (not disabled), so focus stays inside the dialog.
        expect(confirm).not.toBeDisabled();
        expect(confirm).toHaveFocus();

        await user.click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);

        await user.keyboard('{Escape}');
        await user.click(screen.getByRole('button', { name: 'Keep' }));
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
        expect(onOpenChange).not.toHaveBeenCalledWith(false);

        await act(async () => pending.resolve());
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(screen.getByRole('button', { name: 'Open dialog' })).toHaveFocus();
    });

    it('async rejection: stays open, busy cleared, onError receives the error', async () => {
        const user = userEvent.setup();
        const pending = deferred();
        const onError = vi.fn();
        render(<WithTrigger onConfirm={() => pending.promise} onError={onError} />);
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        const confirm = await screen.findByRole('button', { name: 'Reset' });
        await user.click(confirm);
        expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true');

        const failure = new Error('bridge failed');
        await act(async () => pending.reject(failure));
        expect(onError).toHaveBeenCalledWith(failure);
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).not.toHaveAttribute('aria-busy');
        expect(confirm).not.toHaveAttribute('aria-disabled', 'true');

        // Cancel works again.
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    });

    it('a throwing onConfirm without onError is reported with console.error and the dialog stays open', async () => {
        const user = userEvent.setup();
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <WithTrigger
                onConfirm={() => {
                    throw new Error('boom');
                }}
            />,
        );
        await user.click(screen.getByRole('button', { name: 'Reset to default' }));
        await user.click(await screen.findByRole('button', { name: 'Reset' }));
        expect(spy).toHaveBeenCalledWith('ConfirmDialog: onConfirm failed', expect.any(Error));
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
});

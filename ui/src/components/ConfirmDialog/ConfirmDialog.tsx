/**
 * ConfirmDialog — modal confirmation (the library has no Dialog component).
 * Built on Radix AlertDialog (`radix-ui`), styled
 * with the library's --dialog-* tokens, actions are library Buttons.
 *
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *       open={open} onOpenChange={setOpen}
 *       trigger={<Button color="danger" variant="outline">{t('resetToDefaultButton')}</Button>}
 *       title={…} description={…}
 *       confirmLabel={t('resetToDefaultButton')} cancelLabel={tNew('cancelButton', 'Cancel')}
 *       danger
 *       onConfirm={async () => { await bridge.resetSettings(); announce(…); }}
 *   />
 *
 * Behaviour
 * - role="alertdialog", aria-modal, labelled by the title, described by the
 *   description. Focus moves to Cancel on open, Tab is trapped inside, the
 *   rest of the page is aria-hidden, Escape = Cancel, clicking the backdrop
 *   does nothing (alert dialogs need an explicit choice).
 * - Focus returns on close to: the `trigger` (when given), else
 *   `returnFocusRef`, else the element that had focus when the dialog opened.
 *   Safari does not focus a button on mouse click, so pages that open the
 *   dialog from their own button should pass `trigger` or `returnFocusRef`.
 * - onConfirm may return a promise: the confirm Button shows the library
 *   loading indicator, the dialog gets aria-busy, Cancel/Escape are ignored,
 *   and the dialog closes when the promise resolves. Returning (or resolving
 *   to) `false` keeps it open. A rejection keeps it open, clears the busy
 *   state and is passed to `onError` (or console.error when there is none):
 *   catch errors inside onConfirm and announce them (useAnnounce) instead.
 * - Open/closed may be controlled (`open` + `onOpenChange`) or not
 *   (`defaultOpen`, opened by `trigger`).
 *
 * CSP note: while open, Radix's scroll lock (react-remove-scroll-bar via
 * react-style-singleton) appends one runtime <style> element to <head>.
 * Allowed on extension pages; under `default-src 'self'` (container window)
 * it would be blocked.
 *
 * All text arrives through props; the component renders no text of its own.
 */
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { AlertDialog } from 'radix-ui';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
    type RefObject,
} from 'react';

export type ConfirmResult = void | boolean;

export interface ConfirmDialogProps {
    /** Dialog heading (already localised). */
    title: ReactNode;
    /** Supporting text; may contain block elements (rendered in a <div>). */
    description?: ReactNode;
    /** Extra content under the description (e.g. a list of affected items). */
    children?: ReactNode;
    confirmLabel: ReactNode;
    cancelLabel: ReactNode;
    /** Destructive action: confirm Button uses the library "danger" colour. */
    danger?: boolean;
    /** Called on confirm. Return/resolve `false` to keep the dialog open. */
    onConfirm: () => ConfirmResult | Promise<ConfirmResult>;
    /** Controlled open state. */
    open?: boolean;
    /** Initial open state when uncontrolled. @default false */
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Element that opens the dialog (rendered as the Radix trigger; gets focus back on close). */
    trigger?: ReactElement;
    /** Element to focus on close when there is no `trigger`. */
    returnFocusRef?: RefObject<HTMLElement | null>;
    /** Receives a rejection/throw from onConfirm. */
    onError?: (error: unknown) => void;
    /** Extra classes on the dialog panel. */
    className?: string;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

const ACTION_BUTTON_CLASSES = 'h-auto min-h-(--button-size) max-w-full whitespace-normal py-1 leading-snug';

export function ConfirmDialog({
    title,
    description,
    children,
    confirmLabel,
    cancelLabel,
    danger = false,
    onConfirm,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    trigger,
    returnFocusRef,
    onError,
    className,
}: ConfirmDialogProps) {
    const controlled = openProp !== undefined;
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const open = controlled ? openProp : uncontrolledOpen;

    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    busyRef.current = busy;

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Remember what had focus when the dialog opened (before Radix moves focus).
    const openerRef = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
        if (open) {
            const active = document.activeElement;
            openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
        } else {
            setBusy(false);
        }
    }, [open]);

    const setOpen = useCallback(
        (next: boolean) => {
            if (!controlled) {
                setUncontrolledOpen(next);
            }
            onOpenChange?.(next);
        },
        [controlled, onOpenChange],
    );

    // Radix-originated changes: trigger click, Cancel, Escape.
    const handleRadixOpenChange = useCallback(
        (next: boolean) => {
            if (!next && busyRef.current) {
                return;
            }
            setOpen(next);
        },
        [setOpen],
    );

    const report = useCallback(
        (error: unknown) => {
            if (onError) {
                onError(error);
            } else {
                console.error('ConfirmDialog: onConfirm failed', error);
            }
        },
        [onError],
    );

    const handleConfirm = () => {
        if (busyRef.current) {
            return;
        }
        let result: ConfirmResult | Promise<ConfirmResult>;
        try {
            result = onConfirm();
        } catch (error) {
            report(error);
            return;
        }
        if (!isPromiseLike(result)) {
            if (result !== false) {
                setOpen(false);
            }
            return;
        }
        busyRef.current = true;
        setBusy(true);
        Promise.resolve(result).then(
            (value) => {
                if (!mountedRef.current) return;
                busyRef.current = false;
                setBusy(false);
                if (value !== false) {
                    setOpen(false);
                }
            },
            (error: unknown) => {
                if (mountedRef.current) {
                    busyRef.current = false;
                    setBusy(false);
                }
                report(error);
            },
        );
    };

    const handleCloseAutoFocus = (event: Event) => {
        if (trigger !== undefined) {
            return; // Radix focuses the trigger.
        }
        const target = returnFocusRef?.current ?? openerRef.current;
        event.preventDefault();
        if (target && target.isConnected) {
            target.focus();
        }
    };

    return (
        <AlertDialog.Root open={open} onOpenChange={handleRadixOpenChange}>
            {trigger !== undefined ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
            <AlertDialog.Portal>
                <AlertDialog.Overlay
                    data-blocker-dialog-overlay=""
                    className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-(--dialog-backdrop-dim-background) p-4"
                >
                    <AlertDialog.Content
                        onCloseAutoFocus={handleCloseAutoFocus}
                        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
                        // Radix only aria-hides the rest of the page; state modality explicitly too.
                        aria-modal="true"
                        aria-busy={busy || undefined}
                        className={[
                            'relative w-full min-w-(--dialog-min-width) max-w-(--dialog-max-width) rounded-2xl border border-subtle bg-surface-elevated p-(--dialog-container-inner-padding) text-default shadow-xl focus:outline-none',
                            className,
                        ]
                            .filter(Boolean)
                            .join(' ')}
                    >
                        <AlertDialog.Title className="heading-xs text-default">{title}</AlertDialog.Title>
                        {description !== undefined ? (
                            <AlertDialog.Description asChild>
                                <div className="mt-2 text-sm text-secondary">{description}</div>
                            </AlertDialog.Description>
                        ) : null}
                        {children !== undefined ? <div className="mt-3 text-sm">{children}</div> : null}
                        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                            <AlertDialog.Cancel asChild>
                                <Button
                                    color="secondary"
                                    variant="soft"
                                    aria-disabled={busy || undefined}
                                    className={ACTION_BUTTON_CLASSES}
                                    onClick={(event) => {
                                        if (busyRef.current) event.preventDefault();
                                    }}
                                >
                                    {cancelLabel}
                                </Button>
                            </AlertDialog.Cancel>
                            <Button
                                color={danger ? 'danger' : 'primary'}
                                variant="solid"
                                loading={busy}
                                // Keep the button focusable while busy (the default makes it
                                // disabled, which would drop focus out of the dialog).
                                inert={false}
                                aria-disabled={busy || undefined}
                                data-blocker-confirm=""
                                className={ACTION_BUTTON_CLASSES}
                                onClick={handleConfirm}
                            >
                                {confirmLabel}
                            </Button>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Overlay>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
}

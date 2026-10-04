/**
 * SettingRow — label + optional description on the inline-start side, a control at the
 * inline-end.
 *
 * Label association. The row renders a real <label for={controlId}> and a description
 * element, and hands their ids to the control:
 *
 *   <SettingRow
 *     label={t('autoReloadLabel')}
 *     description={t('autoReloadLegend')}
 *     control={({ id, describedBy }) => (
 *       <Switch id={id} aria-describedby={describedBy} checked={on} onCheckedChange={set} />
 *     )}
 *   />
 *
 * - Labelable controls (input, button, select, textarea — the library's Switch,
 *   Checkbox and Select triggers are buttons) are named by the <label for>, and
 *   clicking the label activates them.
 * - Composite controls (radiogroup, SegmentedControl, a group of buttons) cannot be
 *   targeted by <label for>; give them `aria-labelledby={labelId}` instead.
 * - A control rendered as a plain node must carry `id={controlId}` itself (pass the
 *   same `controlId` prop to the row).
 *
 * Layout. A flex row that wraps: when the control is too wide to sit next to the text
 * (long translation, wide Select), it drops onto its own line, still aligned to the
 * inline-end. `stacked` forces the two-line layout, with the control under the text at
 * the inline-start (useful for full-width inputs). Only logical properties are used
 * (ms-auto, text-start, ps-/pe-), so the row mirrors under dir="rtl".
 *
 * The row adds no text of its own; everything visible comes in through props.
 */
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

export interface SettingRowControlProps {
    /** Put on the control element: the row's <label for> points at it. */
    id: string;
    /** id of the row's <label> element: use as aria-labelledby on composite controls. */
    labelId: string;
    /** id of the description element, or undefined when there is none. */
    descriptionId: string | undefined;
    /** Ready-made value for aria-describedby (same as descriptionId). */
    describedBy: string | undefined;
    /** True when the row was rendered with `disabled`. */
    disabled: boolean;
}

export interface SettingRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    /** Visible label (already localised). Rendered as a <label for={controlId}>. */
    label: ReactNode;
    /** Optional supporting text under the label (text-secondary). */
    description?: ReactNode;
    /** The control, or a function that receives the ids it needs to be associated. */
    control: ReactNode | ((ids: SettingRowControlProps) => ReactNode);
    /** id for the control. Defaults to a generated id. Required in practice when `control` is a node. */
    controlId?: string;
    /** Always put the control on its own line below the text. */
    stacked?: boolean;
    /** Dims the label and description (the control must be disabled by the caller). */
    disabled?: boolean;
    /** Optional extra content under the description (e.g. a warning Alert or a link). */
    children?: ReactNode;
    /** Vertical padding of the row: sm 8px, md 12px (default). Horizontal padding: `inset`. */
    density?: 'sm' | 'md';
    /** Horizontal padding (ps-4 pe-4) for rows placed edge to edge inside a Card with padding="none". */
    inset?: boolean;
}

export const SettingRow = forwardRef<HTMLDivElement, SettingRowProps>(function SettingRow(
    {
        label,
        description,
        control,
        controlId,
        stacked = false,
        disabled = false,
        children,
        density = 'md',
        inset = false,
        className,
        ...rest
    },
    ref,
) {
    const autoId = useId();
    const id = controlId ?? `${autoId}-control`;
    const labelId = `${autoId}-label`;
    const hasDescription = description != null && description !== false && description !== '';
    const descriptionId = hasDescription ? `${autoId}-description` : undefined;

    const renderedControl =
        typeof control === 'function'
            ? control({ id, labelId, descriptionId, describedBy: descriptionId, disabled })
            : control;

    const classes = [
        'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2',
        density === 'sm' ? 'py-2' : 'py-3',
        inset ? 'ps-4 pe-4' : '',
        className ?? '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            ref={ref}
            className={classes}
            data-stacked={stacked ? '' : undefined}
            data-disabled={disabled ? '' : undefined}
            {...rest}
        >
            <div
                className={[
                    'flex min-w-0 flex-col gap-0.5 text-start',
                    // Basis 12rem: the control wraps below once the text column would be narrower.
                    stacked ? 'basis-full' : 'flex-[1_1_12rem]',
                ].join(' ')}
            >
                <label
                    id={labelId}
                    htmlFor={id}
                    className={`text-sm font-medium break-words ${disabled ? 'text-disabled' : 'text-default'}`}
                >
                    {label}
                </label>
                {hasDescription && (
                    <p
                        id={descriptionId}
                        className={`text-sm break-words ${disabled ? 'text-disabled' : 'text-secondary'}`}
                    >
                        {description}
                    </p>
                )}
                {children}
            </div>
            <div className={['flex max-w-full min-w-0 items-center', stacked ? 'me-auto' : 'ms-auto'].join(' ')}>
                {renderedControl}
            </div>
        </div>
    );
});

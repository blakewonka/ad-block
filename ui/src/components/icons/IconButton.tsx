/**
 * IconButton — an icon-only library Button (ghost, uniform) with a Tooltip and a
 * REQUIRED accessible name.
 *
 *   <IconButton icon="trash" label={t('removeButton')} onClick={remove} />
 *
 * - `label` becomes the button's aria-label and, unless `tooltip` is given, the tooltip
 *   text. Pass `tooltip={null}` to render no tooltip (e.g. when visible text nearby
 *   already says the same thing).
 * - Every other prop goes to the library Button (size, color, disabled, loading,
 *   onClick, ...). Defaults: color "secondary", variant "ghost", uniform.
 * - Direction-dependent icons (chevrons, arrows) are mirrored under dir="rtl".
 * - A disabled button gets no pointer events, so its tooltip does not open on hover;
 *   the aria-label still names it.
 */
import { Button, type ButtonProps } from '@openai/apps-sdk-ui/components/Button';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import type { ReactNode } from 'react';
import { AppIcon } from './AppIcon';
import type { IconName } from './icons';

export interface IconButtonProps
    extends Omit<ButtonProps, 'children' | 'color' | 'uniform' | 'aria-label' | 'aria-labelledby'> {
    /** Semantic icon name from icons.ts. */
    icon: IconName;
    /** Accessible name (already localised). Required: an icon-only button has no other name. */
    label: string;
    /** Tooltip content. Defaults to `label`; `null` renders no tooltip. */
    tooltip?: ReactNode | null;
    /** Preferred tooltip side. Default "top". */
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    /** Library Button colour. Default "secondary". */
    color?: ButtonProps['color'];
}

export function IconButton({
    icon,
    label,
    tooltip,
    tooltipSide = 'top',
    color = 'secondary',
    variant = 'ghost',
    ...buttonProps
}: IconButtonProps) {
    if (import.meta.env.DEV && label.trim() === '') {
        console.warn(`IconButton "${icon}": empty label, the button has no accessible name`);
    }
    const button = (
        <Button {...buttonProps} color={color} variant={variant} uniform aria-label={label}>
            <AppIcon name={icon} />
        </Button>
    );
    const content = tooltip === undefined ? label : tooltip;
    if (content === null) {
        return button;
    }
    return (
        <Tooltip content={content} side={tooltipSide} compact>
            {button}
        </Tooltip>
    );
}

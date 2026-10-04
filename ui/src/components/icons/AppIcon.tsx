/**
 * AppIcon — renders one icon of the semantic map (icons.ts) as a decorative SVG.
 *
 *
 *   <AppIcon name="zapper" className="size-4" />
 *
 * Always aria-hidden: the accessible name comes from the surrounding control (a button's
 * aria-label or visible text). Direction-dependent icons (MIRROR_IN_RTL) are flipped
 * under dir="rtl" with a CSS transform, so no second icon is needed.
 */
import { iconMirrorsInRtl, icons, type IconName } from './icons';

export interface AppIconProps {
    name: IconName;
    /** Size and colour classes; the SVG is 1em x 1em and uses currentColor by default. */
    className?: string;
}

export function AppIcon({ name, className }: AppIconProps) {
    const Svg = icons[name];
    const cls = [iconMirrorsInRtl(name) ? 'rtl:-scale-x-100' : '', 'shrink-0', className].filter(Boolean).join(' ');
    return <Svg aria-hidden="true" focusable="false" className={cls} data-icon={name} />;
}

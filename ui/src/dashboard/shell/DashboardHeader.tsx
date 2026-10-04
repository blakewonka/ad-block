/**
 * Dashboard header (dashboard-shell.md §3): the upstream logo `img/ublock.svg`
 * (relative to dashboard.html, R-8) named by `extName` (D-3: alt = t('extName'),
 * not the stale hard-coded "uBO Lite"), followed by the product name.
 * The visible name repeats the image's accessible name, so it is aria-hidden
 * while the image is shown. If the image cannot load, only the text remains.
 *
 * Logo contrast in dark mode (#800000 on #212121, 1.47:1) is accepted: the file
 * is the product logotype required by R-8, which WCAG 1.4.11 exempts; its name
 * is carried by `alt` and repeated as visible text next to it.
 */
import { useState } from 'react';

import { t } from '@/lib/i18n';

export const DASHBOARD_LOGO_SRC = 'img/ublock.svg';
/** Id of the <h1>; it also names the tablist (accessible name "Blocker", no stale dashboardName). */
export const DASHBOARD_TITLE_ID = 'dashboard-title';

export function DashboardHeader() {
    const [logoOk, setLogoOk] = useState(true);
    const name = t('extName');
    return (
        <div className="flex min-w-0 items-center gap-3">
            <h1
                id={DASHBOARD_TITLE_ID}
                className="flex min-w-0 items-center gap-3 heading-sm text-default"
                data-testid="dashboard-title"
            >
                {logoOk && (
                    <img
                        src={DASHBOARD_LOGO_SRC}
                        alt={name}
                        title={name}
                        width={32}
                        height={32}
                        className="size-8 shrink-0"
                        onError={() => setLogoOk(false)}
                    />
                )}
                <span aria-hidden={logoOk ? true : undefined} className="truncate">
                    {name}
                </span>
            </h1>
        </div>
    );
}

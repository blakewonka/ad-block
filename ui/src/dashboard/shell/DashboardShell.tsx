/**
 * The React dashboard frame (dashboard-shell.md §2-§3, §5):
 * header, a real tablist (one scrollable row of tabs below 1024px, a sidebar
 * from 1024px, manual activation), the three React panes, and ONE persistent
 * classic iframe for "Custom filters" and "Develop".
 *
 * Panel layout:
 * - React panes are mounted the first time they are shown and then kept
 *   mounted (hidden) like upstream's sections, so their state survives tab
 *   switches and the About troubleshooting observer refires on return (R-13).
 *   They share one start-aligned reading width (PANE_WIDTH).
 * - The classic frame lives in one kept-mounted TabPanel whose `value` is the
 *   classic pane currently (or last) shown; the panel element never moves, so
 *   the iframe is never re-parented or reloaded (R-21). The other classic pane
 *   gets an empty panel so every tab's aria-controls points at an element.
 * - While a classic pane is shown, the page itself does not scroll: the shell
 *   fills the viewport and the iframe fills the remaining space (R-23).
 * - Upstream's header + nav are sticky (dashboard.css:1-6): the sidebar sticks
 *   at the top from 1024px, the row of tabs sticks at the top below it.
 */
import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { useEffect, useRef, type MouseEvent, type KeyboardEvent, type PointerEvent } from 'react';

import { AppIcon } from '@/components/icons';
import { PageShell } from '@/components/PageShell';
import { Skeleton } from '@/components/Skeleton';
import { StatusRegion } from '@/components/StatusRegion';
import { TabPanel, Tabs, useMediaQuery, type TabItem } from '@/components/Tabs';
import { ClassicFrame, ClassicFrameSkeleton } from '@/dashboard/panes/Classic';
import { PANES, REACT_PANE_COMPONENTS, type ReactPaneId } from '@/dashboard/panes';
import { t, tNew } from '@/lib/i18n';

import { DASHBOARD_TITLE_ID, DashboardHeader } from './DashboardHeader';
import { PaneErrorBoundary } from './PaneErrorBoundary';
import { isClassicPane, isPaneId, PANE_LABEL_KEYS, type ClassicPaneId, type PaneId } from './panes';
import { useDashboardShell } from './useDashboardShell';

const REACT_PANE_IDS: readonly ReactPaneId[] = ['settings', 'rulesets', 'about'];

/**
 * Height of the sticky row of tabs below lg (32px tabs + 2 x 8px padding), 0 with the
 * sidebar. Panes with their own sticky header (Filter lists) stick below it:
 * `top-(--dashboard-sticky-top,0px)`.
 */
const STICKY_TOP_VAR = '[--dashboard-sticky-top:3rem] lg:[--dashboard-sticky-top:0px]';

/** Root classes while a classic pane is shown: exactly one viewport, no page scroll. */
const FRAME_MODE_ROOT = 'flex h-dvh flex-col overflow-hidden [&>div]:min-h-0 [&>div]:flex-1';

/** One reading width for every React pane, start-aligned next to the nav. */
export const PANE_WIDTH = 'max-w-3xl';

/**
 * Tablist: below lg one row that scrolls sideways (no ragged wrapping) and
 * sticks to the top; from lg a sidebar that sticks below the top edge.
 */
const TABLIST_CLASSES =
    'max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:flex-nowrap max-lg:overflow-x-auto max-lg:bg-surface max-lg:px-1 max-lg:py-2 max-lg:[&>*]:shrink-0 lg:sticky lg:top-4';

/**
 * Overflow cue of the sideways-scrolling row (below lg): the
 * pure-CSS "scroll shadow". Two surface-coloured covers scroll with the tabs
 * (`local`) and two soft shadows stay at the row's edges (`scroll`). A shadow
 * shows only on a side where tabs are cut off; when the row does not overflow,
 * or at either end, the covers hide it. Physical sides, so it works the same
 * in RTL (the covers sit at the content's physical ends). No JS, no layout change.
 */
const TABLIST_SCROLL_CUE =
    'max-lg:[background:linear-gradient(to_right,var(--color-surface)_30%,transparent)_left_center/32px_100%_no-repeat_local,linear-gradient(to_left,var(--color-surface)_30%,transparent)_right_center/32px_100%_no-repeat_local,radial-gradient(farthest-side_at_0_50%,var(--alpha-25),transparent)_left_center/12px_100%_no-repeat_scroll,radial-gradient(farthest-side_at_100%_50%,var(--alpha-25),transparent)_right_center/12px_100%_no-repeat_scroll,var(--color-surface)]';

function otherClassic(pane: ClassicPaneId): ClassicPaneId {
    return pane === 'filters' ? 'develop' : 'filters';
}

function errorText(err: unknown): string {
    if (err instanceof Error) { return err.message; }
    return err === null || err === undefined ? '' : String(err);
}

/* ------------------------------------------------------------------------ */
/* Skeletons (counterpart of upstream body.loading, R-4, P-9)                */
/* ------------------------------------------------------------------------ */

/** Same metrics as the real tabs: 32px tall, radius of a non-pill md Button, 4px apart. */
function NavSkeleton() {
    return (
        <div
            className="flex min-w-0 flex-row gap-1 overflow-hidden px-1 py-2 lg:w-56 lg:max-w-[40%] lg:shrink-0 lg:flex-col lg:p-0"
            aria-hidden="true"
            data-testid="dashboard-nav-skeleton"
        >
            {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-24 rounded-lg lg:w-full" />
            ))}
        </div>
    );
}

function SettingsBodySkeleton() {
    return (
        <>
            <Skeleton className="h-6 w-48 max-w-full" />
            <Skeleton shape="text" lines={2} />
            <Skeleton className="h-80 w-full rounded-xl" />
        </>
    );
}

function FilterListsBodySkeleton() {
    return (
        <>
            <Skeleton className="h-9 w-full rounded-lg" />
            {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
            ))}
        </>
    );
}

function AboutBodySkeleton() {
    return (
        <>
            <div className="flex flex-col gap-1">
                <Skeleton className="h-6 w-56 max-w-full" />
                <Skeleton shape="text" className="w-64 max-w-full" />
            </div>
            <Skeleton shape="text" lines={4} className="w-48 max-w-full" />
            <Skeleton className="h-5 w-32" />
            <Skeleton shape="text" lines={3} className="w-48 max-w-full" />
        </>
    );
}

export function PaneBodySkeleton({ pane }: { pane: PaneId | null }) {
    if (isClassicPane(pane)) {
        return <ClassicFrameSkeleton />;
    }
    return (
        <div className={`flex w-full flex-col gap-4 ${PANE_WIDTH}`}>
            {pane === 'about' ? <AboutBodySkeleton /> : pane === 'rulesets' ? <FilterListsBodySkeleton /> : <SettingsBodySkeleton />}
        </div>
    );
}

function ShellSkeleton({ pane }: { pane: PaneId | null }) {
    return (
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6" aria-busy="true" data-testid="dashboard-skeleton">
            <NavSkeleton />
            <div className="min-w-0 flex-1" aria-hidden="true">
                <PaneBodySkeleton pane={pane} />
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Load error                                                                */
/* ------------------------------------------------------------------------ */

function LoadErrorAlert({ error }: { error: unknown }) {
    const wide = useMediaQuery('(min-width: 640px)');
    const detail = errorText(error);
    return (
        <Alert
            color="danger"
            variant="soft"
            data-testid="dashboard-load-error"
            actionsPlacement={wide ? 'end' : 'bottom'}
            title={tNew('dashboardLoadError', 'The dashboard could not load its data.')}
            description={
                <div className="flex flex-col gap-1">
                    <span>{tNew('dashboardLoadErrorHint', 'Reload the page to try again.')}</span>
                    {detail !== '' && (
                        <details className="group text-xs" data-testid="dashboard-load-error-details">
                            {/* Same disclosure as About's troubleshooting: chevron, no native marker. */}
                            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring) [&::-webkit-details-marker]:hidden">
                                <AppIcon
                                    name="chevronDown"
                                    className="size-3.5 shrink-0 -rotate-90 group-open:rotate-0 rtl:rotate-90 rtl:group-open:rotate-0"
                                />
                                <span>{tNew('technicalDetails', 'Technical details')}</span>
                            </summary>
                            <code dir="ltr" className="mt-1 block break-words font-mono">
                                {detail}
                            </code>
                        </details>
                    )}
                </div>
            }
            actions={
                <Button color="secondary" variant="soft" size="sm" onClick={() => window.location.reload()}>
                    {tNew('reloadButton', 'Reload')}
                </Button>
            }
        />
    );
}

/* ------------------------------------------------------------------------ */
/* Shell                                                                     */
/* ------------------------------------------------------------------------ */

/** The tab trigger an event started on, if any. */
function tabFromEvent(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>('[role="tab"]') : null;
}

/** Pane id of a tab trigger (Radix id = `${base}-trigger-${value}`). */
function paneOfTab(tab: HTMLElement): PaneId | null {
    const match = /-trigger-([a-z]+)$/.exec(tab.id);
    return match !== null && isPaneId(match[1]) ? match[1] : null;
}

export function DashboardShell() {
    const shell = useDashboardShell();
    const { active, visible, framePane, frameCreated, visited, forcedSwitches } = shell;
    const frameMode = shell.status === 'ready' && isClassicPane(active);
    const rootRef = useRef<HTMLDivElement>(null);

    // P-2: upstream writes dashboard.activePane on EVERY click of a tab, even the
    // selected one; Radix reports no change for it. Remember, when the gesture
    // starts, whether the tab was already selected; the click then re-writes.
    const reselectArmed = useRef<HTMLElement | null>(null);
    const armReselect = (event: PointerEvent | KeyboardEvent) => {
        if ('key' in event && event.key !== 'Enter' && event.key !== ' ') { return; }
        const tab = tabFromEvent(event.target);
        reselectArmed.current = tab !== null && tab.getAttribute('aria-selected') === 'true' ? tab : null;
    };
    const onTabClick = (event: MouseEvent) => {
        const tab = tabFromEvent(event.target);
        const armed = reselectArmed.current;
        reselectArmed.current = null;
        if (tab === null || tab !== armed) { return; }
        const pane = paneOfTab(tab);
        if (pane !== null) { shell.reselect(pane); }
    };

    // D-2 removed the focused Develop tab (or hid the frame that had focus):
    // give focus to the Settings tab instead of letting it fall to <body>.
    const lastForced = useRef(0);
    useEffect(() => {
        if (forcedSwitches === lastForced.current) { return; }
        lastForced.current = forcedSwitches;
        const root = rootRef.current;
        if (root === null) { return; }
        const focused = document.activeElement;
        const classicPanel = root.querySelector('[data-pane-id="classic"]');
        const lost =
            focused === null ||
            focused === document.body ||
            !focused.isConnected ||
            (classicPanel !== null && classicPanel.contains(focused));
        if (!lost) { return; }
        root.querySelector<HTMLElement>('[role="tab"][id$="-trigger-settings"]')?.focus();
    }, [forcedSwitches]);

    // Keep the selected tab in view when the row of tabs scrolls sideways.
    const shownPane = shell.status === 'error' ? shell.errorPane : active;
    useEffect(() => {
        const root = rootRef.current;
        if (root === null || shownPane === null) { return; }
        const list = root.querySelector<HTMLElement>('[role="tablist"]');
        if (list === null || list.scrollWidth <= list.clientWidth) { return; }
        const tab = list.querySelector<HTMLElement>(`[role="tab"][id$="-trigger-${shownPane}"]`);
        tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [shownPane]);

    const tabsCommon = {
        orientation: 'responsive' as const,
        verticalFrom: 'lg' as const,
        pill: false,
        activationMode: 'manual' as const,
        labelledBy: DASHBOARD_TITLE_ID,
        listClassName: `${TABLIST_CLASSES} ${TABLIST_SCROLL_CUE}`,
    };

    let content;
    if (shell.status === 'error') {
        // Without the options data only About still works; the Settings tab explains the failure.
        const items: TabItem[] = [
            { id: 'settings', label: t(PANE_LABEL_KEYS.settings) },
            { id: 'about', label: t(PANE_LABEL_KEYS.about) },
        ];
        content = (
            <Tabs {...tabsCommon} items={items} value={shell.errorPane} onValueChange={shell.select}>
                <TabPanel value="settings" className={PANE_WIDTH} data-pane-id="settings">
                    <LoadErrorAlert error={shell.error} />
                </TabPanel>
                <TabPanel value="about" keepMounted className={PANE_WIDTH} data-pane-id="about">
                    {visited.has('about') ? (
                        <PaneErrorBoundary>
                            <REACT_PANE_COMPONENTS.about />
                        </PaneErrorBoundary>
                    ) : null}
                </TabPanel>
            </Tabs>
        );
    } else if (shell.status !== 'ready' || active === null || visible === null) {
        content = <ShellSkeleton pane={shell.startGuess} />;
    } else {
        const items: TabItem[] = PANES.map((pane) => ({
            id: pane.id,
            label: t(pane.labelKey),
            hidden: !visible[pane.id],
        }));
        const hostPane: ClassicPaneId = isClassicPane(active) ? active : framePane;
        content = (
            <Tabs
                {...tabsCommon}
                items={items}
                value={active}
                onValueChange={shell.select}
                className={frameMode ? 'min-h-0 flex-1' : undefined}
                panelsClassName={frameMode ? 'flex min-h-0 flex-col self-stretch' : undefined}
            >
                {REACT_PANE_IDS.map((id) => {
                    const Pane = REACT_PANE_COMPONENTS[id];
                    return (
                        <TabPanel key={id} value={id} keepMounted data-pane-id={id} className={PANE_WIDTH}>
                            {visited.has(id) ? (
                                <PaneErrorBoundary>
                                    <Pane />
                                </PaneErrorBoundary>
                            ) : null}
                        </TabPanel>
                    );
                })}
                <TabPanel
                    key="classic-host"
                    value={hostPane}
                    keepMounted
                    data-pane-id="classic"
                    className={frameMode ? 'min-h-0 flex-1' : undefined}
                >
                    {frameCreated ? (
                        <ClassicFrame pane={framePane} title={t(PANE_LABEL_KEYS[framePane])} />
                    ) : (
                        <div aria-busy="true">
                            <ClassicFrameSkeleton />
                        </div>
                    )}
                </TabPanel>
                <TabPanel key="classic-other" value={otherClassic(hostPane)} />
            </Tabs>
        );
    }

    return (
        <PageShell
            ref={rootRef}
            width="wide"
            header={<DashboardHeader />}
            className={frameMode ? `${STICKY_TOP_VAR} ${FRAME_MODE_ROOT}` : STICKY_TOP_VAR}
            mainClassName={frameMode ? 'min-h-0 flex-1' : undefined}
            data-active-pane={shownPane ?? ''}
            data-shell-status={shell.status}
            onPointerDownCapture={armReselect}
            onKeyDownCapture={armReselect}
            onClick={onTabClick}
        >
            {content}
            <StatusRegion />
        </PageShell>
    );
}

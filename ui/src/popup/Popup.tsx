/**
 * The toolbar popup (popup.html). Behaviour: docs/specs/popup.md, PARITY CHECKLIST §16,
 * with the changes the UI rules require (§13 of the spec; UI rules in docs/specs/README.md).
 *
 * Layout with a mouse (desktop browsers): fixed 340 x POPUP_HEIGHT_PX from the first paint
 * (UI rule §6.9; popup.html gives <body> the same size before any script runs). The header and
 * the footer ribbon have fixed heights; the middle area has the remaining height. Order in the
 * middle area: mode control, local tools, then the status message at the bottom (`mt-auto`), so
 * a message never moves the tools. If a long translation plus a message need more room, the
 * middle area scrolls inside itself, shows scroll shadows at the edges that hide content, and
 * scrolls a new message into view; the document never changes size.
 *
 * Layout on a touch screen (`touch:` variant: Safari on iPhone/iPad, Firefox for Android, which
 * show the popup as a sheet as wide as the screen): the popup takes the full width (at least
 * 340px when the screen has it) and at least the full height of the sheet, the footer stays at
 * the bottom, and the document scrolls when the content is taller. Targets are 44px, the footer
 * keeps clear of the home indicator, and the whole hostname is shown (no hover for `title`).
 */
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { EmptyMessage } from '@openai/apps-sdk-ui/components/EmptyMessage';
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { AppIcon, IconButton, type IconName } from '@/components/icons';
import { ModeSelector } from '@/components/ModeSelector';
import { Skeleton } from '@/components/Skeleton';
import { StatusRegion, useStatus } from '@/components/StatusRegion';
import {
    gotoURL,
    isBridgeError,
    isFilteringLevel,
    popupPanelData,
    setFilteringMode,
    setPendingFilteringMode,
    showMatchedRules,
    type FilteringLevel,
    type PopupPanelDataResponse,
} from '@/lib/bridge';
import { getBrowser, getURL, openOptionsPage, requestOrigins, type ExtTab } from '@/lib/ext';
import { getLocaleInfo, modeNameKey, t, tNew } from '@/lib/i18n';
import { useTouchScreen } from '@/lib/pointer';

import {
    BUSY_OVERLAY_DELAY_MS,
    LEVELS,
    NON_READY_VISIBILITY,
    RELOAD_DELAY_MS,
    TOOL_FILES,
    needsPendingMessage,
    needsPermission,
    panelDataRequest,
    permissionOrigins,
    readyVisibility,
    reloadPlan,
    reportPath,
    resolveTabTarget,
    shouldReload,
    type PopupVisibility,
    type ReloadPlan,
    type ToolName,
} from './model';
import { toUnicode } from './punycode';

/* ------------------------------------------------------------------------ */
/* Static class tables (complete strings, so Tailwind generates them)        */
/* ------------------------------------------------------------------------ */

const LEVEL_BADGE_CLASSES: Record<FilteringLevel, string> = {
    0: 'bg-level-0-soft text-level-0-on-soft',
    1: 'bg-level-1-soft text-level-1-on-soft',
    2: 'bg-level-2-soft text-level-2-on-soft',
    3: 'bg-level-3-soft text-level-3-on-soft',
};

const DESCRIPTION_KEYS: Partial<Record<FilteringLevel, string>> = {
    1: 'basicFilteringModeDescription',
    2: 'optimalFilteringModeDescription',
    3: 'completeFilteringModeDescription',
};

/* ------------------------------------------------------------------------ */
/* Strings without an upstream key (tNew; English only, listed in the report) */
/* ------------------------------------------------------------------------ */

const text = {
    loadFailed: () => tNew('popupLoadFailed', 'The settings for this tab could not be loaded.'),
    modeChangeFailed: () => tNew('popupModeChangeFailed', 'The filtering mode could not be changed.'),
    modeDiffers: (mode: string) =>
        tNew('popupModeDiffers', 'The filtering mode in force on this website is: {{mode}}.', { mode }),
    actionFailed: () => tNew('popupActionFailed', 'The action could not be completed.'),
    matchedRules: () => tNew('popupTipMatchedRules', 'Show matched rules'),
    modeManaged: () => tNew('popupModeManaged', 'Managed by your administrator'),
};

/**
 * 'en' when `key` has no translation in a non-English UI, i.e. tNew() fell back to its English
 * text: that text is then marked lang="en" dir="ltr" (spoken with the English voice, correct
 * word order in RTL pages). undefined when the text is in the page language.
 */
function fallbackLang(key: string): 'en' | undefined {
    if (getLocaleInfo().language === 'en') return undefined;
    let raw: unknown = '';
    try {
        raw = getBrowser().i18n.getMessage(key);
    } catch {
        raw = '';
    }
    return typeof raw === 'string' && raw.trim() !== '' ? undefined : 'en';
}

/** `str` in a span with lang/dir when it is an English fallback (see fallbackLang). */
function InLang({ k, children }: { k: string; children: string }) {
    const lang = fallbackLang(k);
    return lang === undefined ? (
        <>{children}</>
    ) : (
        <span lang={lang} dir="ltr">
            {children}
        </span>
    );
}

/* ------------------------------------------------------------------------ */
/* State                                                                     */
/* ------------------------------------------------------------------------ */

type PopupState =
    | { kind: 'loading' }
    /**
     * Not a website (§3.1 steps 2, 5) or a nullish/failed `popupPanelData` (step 7, plus the
     * §13 error: `failed`, shown under the "not a website" text, §16 line 6).
     */
    | { kind: 'no-website'; failed?: boolean }
    /** `tabs.query` rejected, or `popupPanelData` answered a malformed object (§16 lines 40, 42). */
    | { kind: 'error'; hostname: string | null }
    | { kind: 'ready'; tab: ExtTab; tabURL: URL; panel: PopupPanelDataResponse };

/** Technical details go to the console; the popup shows a short localisable sentence. */
function logFailure(what: string, err: unknown): void {
    console.warn(`[Blocker popup] ${what}`, err);
}

export interface PopupProps {
    dir: 'ltr' | 'rtl';
    /** Called once after the first commit (the mount guard stops watching window errors). */
    onMounted?: () => void;
}

/**
 * Fixed popup height with a mouse (see the file comment). popup.html and harness/popup.html
 * give <body> the same class (checked by tests/unit/popup/html.test.ts).
 */
export const POPUP_HEIGHT_PX = 456;
export const POPUP_HEIGHT_CLASS = 'h-[456px]';
/**
 * Touch screens: <body> classes of popup.html and harness/popup.html that undo the fixed size
 * (checked by tests/unit/popup/html.test.ts). `min(340px, 100vw)` keeps the desktop width where
 * the browser sizes the popup from its content and never forces a sideways scroll.
 */
export const POPUP_TOUCH_BODY_CLASSES = [
    'touch:h-auto',
    'touch:min-h-dvh',
    'touch:w-auto',
    'touch:min-w-[min(340px,100vw)]',
] as const;

/**
 * Scroll shadows for the middle area (no JS): two `local` covers in the surface colour move
 * with the content and hide two `scroll` shadows fixed at the edges, so a shadow shows only
 * at an edge where content is hidden. Tool rows and texts have no background of their own.
 * Shadow strength: the library's --shadow-alpha-400 (0.12) in light; 0.6 in dark, where a
 * 0.3 black shadow on #212121 was barely visible.
 */
/** Library Button at 44px on touch screens (the `size` prop stays the desktop size). */
const TOUCH_BUTTON = 'touch:[--button-size:var(--control-size-2xl)]';

const SCROLL_SHADOWS =
    '[--popup-scroll-cue-alpha:var(--shadow-alpha-400)] [[data-theme=dark]_&]:[--popup-scroll-cue-alpha:0.6] [background:linear-gradient(var(--color-surface)_30%,transparent)_top/100%_24px_no-repeat_local,linear-gradient(transparent,var(--color-surface)_70%)_bottom/100%_24px_no-repeat_local,linear-gradient(rgb(0_0_0/var(--popup-scroll-cue-alpha)),transparent)_top/100%_10px_no-repeat_scroll,linear-gradient(transparent,rgb(0_0_0/var(--popup-scroll-cue-alpha)))_bottom/100%_10px_no-repeat_scroll,var(--color-surface)]';

export function Popup({ dir, onMounted }: PopupProps) {
    const { announce, clear, current } = useStatus();

    const [state, setState] = useState<PopupState>({ kind: 'loading' });
    const [level, setLevelState] = useState<FilteringLevel>(1);
    const levelRef = useRef<FilteringLevel>(1);
    const [committing, setCommitting] = useState(false);
    const committingRef = useRef(false);
    const [overlay, setOverlay] = useState(false);
    const startedRef = useRef(false);

    const setLevel = useCallback((next: FilteringLevel) => {
        levelRef.current = next;
        setLevelState(next);
    }, []);

    useEffect(() => {
        onMounted?.();
    }, [onMounted]);

    /* ---------- initial load (§3.1); exactly once, also under StrictMode ---------- */
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        void (async () => {
            let tab: unknown;
            try {
                const tabs = await getBrowser().tabs.query({ active: true, currentWindow: true });
                [tab] = tabs;
            } catch (err) {
                setState({ kind: 'error', hostname: null });
                logFailure('loading the active tab failed', err);
                announce(text.loadFailed(), { tone: 'danger', lang: fallbackLang('popupLoadFailed') });
                return;
            }
            let target;
            try {
                target = resolveTabTarget(tab, getURL('/strictblock.'));
            } catch (err) {
                setState({ kind: 'error', hostname: null });
                logFailure('loading the active tab failed', err);
                announce(text.loadFailed(), { tone: 'danger', lang: fallbackLang('popupLoadFailed') });
                return;
            }
            if (target.kind === 'no-website') {
                setState({ kind: 'no-website' });
                return;
            }
            const { tabURL } = target;
            let panel: PopupPanelDataResponse;
            try {
                panel = await popupPanelData(panelDataRequest(tabURL));
            } catch (err) {
                // A nullish answer or a failed send is "not a website" upstream (js/popup.js:325,
                // js/ext.js:51-55); a malformed answer is an error state (§13). Both show the error.
                const asNoWebsite = isBridgeError(err) && (err.kind === 'no-response' || err.kind === 'transport');
                setState(asNoWebsite ? { kind: 'no-website', failed: true } : { kind: 'error', hostname: tabURL.hostname });
                logFailure('popupPanelData failed', err);
                announce(text.loadFailed(), { tone: 'danger', lang: fallbackLang('popupLoadFailed') });
                return;
            }
            setLevel(panel.level);
            setState({ kind: 'ready', tab: tab as ExtTab, tabURL, panel });
        })();
    }, [announce, setLevel]);

    /* ---------- busy overlay after 1 s of committing (§8.2) ---------- */
    // While the overlay covers the popup, the controls under it are `inert` (nothing hidden can
    // be focused, WCAG 2.4.11). Focus then falls to <body>; it is put back where it was when
    // the overlay goes away.
    const focusBeforeOverlayRef = useRef<HTMLElement | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!committing) {
            setOverlay(false);
            return;
        }
        const timer = window.setTimeout(() => {
            const active = document.activeElement;
            focusBeforeOverlayRef.current =
                active instanceof HTMLElement && rootRef.current?.contains(active) === true ? active : null;
            setOverlay(true);
        }, BUSY_OVERLAY_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [committing]);
    useEffect(() => {
        if (overlay) return;
        const saved = focusBeforeOverlayRef.current;
        focusBeforeOverlayRef.current = null;
        if (saved === null || !saved.isConnected) return;
        const active = document.activeElement;
        if (active === null || active === document.body) saved.focus({ preventScroll: true });
    }, [overlay]);

    /* ---------- a new visible message is scrolled into view (middle area, nearest edge) ---------- */
    const statusSlotRef = useRef<HTMLDivElement>(null);
    const currentId = current?.id;
    useEffect(() => {
        if (currentId === undefined) return;
        const slot = statusSlotRef.current;
        if (slot !== null && typeof slot.scrollIntoView === 'function') slot.scrollIntoView({ block: 'nearest' });
    }, [currentId]);

    const visibility: PopupVisibility = useMemo(
        () => (state.kind === 'ready' ? readyVisibility(state.panel, state.tab.id) : NON_READY_VISIBILITY),
        [state],
    );

    /* ---------- level change (§5.6). Synchronous up to permissions.request. ---------- */
    const runReload = useCallback(
        (tabId: unknown, plan: ReloadPlan) => {
            let pending: Promise<unknown>;
            try {
                const tabs = getBrowser().tabs;
                pending = plan.kind === 'reload' ? tabs.reload(tabId as number) : tabs.update(tabId as number, { url: plan.url });
            } catch (err) {
                pending = Promise.reject(err);
            }
            pending.catch((err: unknown) => {
                logFailure('reloading the tab failed', err);
                announce(text.actionFailed(), { tone: 'danger', lang: fallbackLang('popupActionFailed') });
            });
        },
        [announce],
    );

    const onSelectLevel = (next: number) => {
        if (state.kind !== 'ready') return;
        if (committingRef.current || visibility.modeReadOnly) return;
        if (!isFilteringLevel(next)) return;
        const { tab, tabURL, panel } = state;
        const hostname = tabURL.hostname;
        const before = levelRef.current;
        const after = next;

        committingRef.current = true;
        setCommitting(true);
        clear();
        setLevel(after);

        // Steps 2.1 and 2.2: nothing is awaited before permissions.request (UI rule §6.6).
        let permission: Promise<boolean> | null = null;
        if (needsPermission(after)) {
            if (needsPendingMessage(before, after)) {
                setPendingFilteringMode({
                    tabId: tab.id as number,
                    url: tabURL.href,
                    hostname,
                    beforeLevel: before,
                    afterLevel: after,
                }).catch((err: unknown) => console.warn('[Blocker popup] setPendingFilteringMode failed', err));
            }
            permission = requestOrigins(permissionOrigins(hostname));
        }

        void (async () => {
            try {
                if (permission !== null) {
                    let granted = false;
                    try {
                        granted = (await permission) === true;
                    } catch {
                        granted = false; // a rejection counts as "not granted" (js/popup.js:77-83)
                    }
                    if (!granted) {
                        setLevel(before);
                        return;
                    }
                }
                let actual: FilteringLevel;
                try {
                    actual = await setFilteringMode({ hostname, level: after });
                } catch (err) {
                    // §13: a failed setFilteringMode is never shown as a level and never reloads.
                    setLevel(before);
                    logFailure('setFilteringMode failed', err);
                    announce(text.modeChangeFailed(), { tone: 'danger', lang: fallbackLang('popupModeChangeFailed') });
                    return;
                }
                if (actual !== after) {
                    setLevel(actual);
                    announce(text.modeDiffers(t(modeNameKey(actual))), { tone: 'warning', lang: fallbackLang('popupModeDiffers') });
                }
                if (shouldReload(actual, before, panel.autoReload)) {
                    const plan = reloadPlan(tabURL.href, tab.url);
                    window.setTimeout(() => runReload(tab.id, plan), RELOAD_DELAY_MS);
                }
            } finally {
                committingRef.current = false;
                setCommitting(false);
            }
        })();
    };

    /* ---------- tools (§6) ---------- */
    const launchTool = (tool: ToolName) => {
        if (state.kind !== 'ready' || committingRef.current) return;
        let scripting;
        try {
            scripting = getBrowser().scripting;
        } catch {
            return;
        }
        if (scripting === undefined) return; // upstream guard: nothing at all, popup stays open
        let pending: Promise<unknown>;
        try {
            pending = scripting.executeScript({ files: [...TOOL_FILES[tool]], target: { tabId: state.tab.id as number } });
        } catch (err) {
            logFailure(`${tool} failed`, err);
            announce(text.actionFailed(), { tone: 'danger', lang: fallbackLang('popupActionFailed') });
            return;
        }
        Promise.resolve(pending).catch((err: unknown) => console.warn(`[Blocker popup] ${tool} failed`, err));
        window.close(); // right after the CALL, not after its result (js/popup.js:263, 278, 293)
    };

    const openReport = () => {
        if (state.kind !== 'ready' || committingRef.current) return;
        const { tab, tabURL, panel } = state;
        try {
            new URL(String(tab.url));
        } catch {
            return; // js/popup.js:233-236
        }
        let url: string;
        try {
            url = reportPath(getURL('/report.html'), tab.id, tabURL.href, panel.level);
        } catch (err) {
            logFailure('report failed', err);
            announce(text.actionFailed(), { tone: 'danger', lang: fallbackLang('popupActionFailed') });
            return;
        }
        gotoURL({ url }).catch((err: unknown) => {
            logFailure('gotoURL failed', err);
            announce(text.actionFailed(), { tone: 'danger', lang: fallbackLang('popupActionFailed') });
        });
    };

    const openDashboard = () => {
        if (committingRef.current) return;
        let pending: Promise<void>;
        try {
            pending = openOptionsPage();
        } catch (err) {
            pending = Promise.reject(err);
        }
        pending.catch((err: unknown) => {
            logFailure('openOptionsPage failed', err);
            announce(text.actionFailed(), { tone: 'danger', lang: fallbackLang('popupActionFailed') });
        });
    };

    const openMatchedRules = () => {
        if (state.kind !== 'ready' || committingRef.current) return;
        showMatchedRules({ tabId: state.tab.id as number }).catch((err: unknown) => {
            logFailure('showMatchedRules failed', err);
            announce(text.actionFailed(), { tone: 'danger', lang: fallbackLang('popupActionFailed') });
        });
    };

    /* ---------- render ---------- */
    const modeLabelId = useId();
    const toolsLabelId = useId();

    const names = useMemo(
        () => ({ 0: t('filteringMode0Name'), 1: t('filteringMode1Name'), 2: t('filteringMode2Name'), 3: t('filteringMode3Name') }),
        [],
    );
    const descriptions = useMemo(() => {
        const out: Record<number, string> = {};
        for (const [lvl, key] of Object.entries(DESCRIPTION_KEYS)) out[Number(lvl)] = t(key);
        return out;
    }, []);

    const hasFooter = state.kind === 'loading' || visibility.dashboard || visibility.matchedRules;
    // A load failure is shown inline (EmptyMessage) in the middle area; the live region then
    // only announces it (screen-reader only), so the sentence is not shown twice.
    const loadFailedInline =
        (state.kind === 'error' || (state.kind === 'no-website' && state.failed === true)) &&
        current !== null &&
        current.message === text.loadFailed();

    return (
        <div
            ref={rootRef}
            className={`relative flex ${POPUP_HEIGHT_CLASS} w-popup flex-col overflow-hidden bg-surface text-default touch:h-auto touch:min-h-dvh touch:w-full touch:overflow-visible`}
            data-testid="popup"
            data-state={state.kind}
            data-current-level={state.kind === 'ready' ? level : undefined}
        >
            <PopupHeader state={state} level={level} />

            {/* No aria-busy here: it would wrap the live regions (the radiogroup carries it). */}
            <main
                className={[
                    'flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 pb-2 touch:min-h-fit touch:overflow-visible',
                    SCROLL_SHADOWS,
                    committing ? 'pointer-events-none' : '',
                ].join(' ')}
                inert={overlay}
                data-testid="popup-main"
            >
                {/* slot 1: mode control / placeholders */}
                {state.kind === 'loading' ? (
                    <ModeSkeleton />
                ) : state.kind === 'ready' ? (
                    <section aria-labelledby={modeLabelId} className="flex shrink-0 flex-col gap-2 pb-4" data-testid="mode-section">
                        <h2 id={modeLabelId} className={`${HEADING_CLASS} flex items-center gap-1 lowercase`}>
                            {t('popupFilteringModeLabel')}
                            {/* Admin policy: the level is shown but cannot be changed. The text names
                                the radiogroup too ("filtering mode (Managed by …)"). The sr-only span is
                                block-level for name computation (a space precedes it), so the note is in
                                parentheses rather than after a comma, and keeps its own case
                               . */}
                            {visibility.modeReadOnly ? (
                                <>
                                    <AppIcon name="lock" className="size-3.5" />
                                    <span className="sr-only normal-case" data-testid="mode-managed-note">
                                        {'('}
                                        <InLang k="popupModeManaged">{text.modeManaged()}</InLang>
                                        {')'}
                                    </span>
                                </>
                            ) : null}
                        </h2>
                        <ModeSelector
                            value={level}
                            onChange={onSelectLevel}
                            levels={LEVELS}
                            names={names}
                            descriptions={descriptions}
                            busy={committing}
                            readOnly={visibility.modeReadOnly}
                            size="popup"
                            tooltips={false}
                            labelledBy={modeLabelId}
                            dir={dir}
                            className="lowercase"
                        />
                    </section>
                ) : state.kind === 'no-website' ? (
                    <div className="shrink-0" data-testid="no-website">
                        <EmptyMessage className="py-6">
                            <EmptyMessage.Icon>
                                <AppIcon name="website" />
                            </EmptyMessage.Icon>
                            <EmptyMessage.Title>{t('popupNoWebsite')}</EmptyMessage.Title>
                            {state.failed === true ? (
                                <EmptyMessage.Description>
                                    <span data-testid="load-failed">
                                        <InLang k="popupLoadFailed">{text.loadFailed()}</InLang>
                                    </span>
                                </EmptyMessage.Description>
                            ) : null}
                        </EmptyMessage>
                    </div>
                ) : (
                    <div className="shrink-0" data-testid="load-error">
                        <EmptyMessage className="py-6">
                            <EmptyMessage.Icon color="danger">
                                <AppIcon name="error" />
                            </EmptyMessage.Icon>
                            <EmptyMessage.Title>
                                <span data-testid="load-failed">
                                    <InLang k="popupLoadFailed">{text.loadFailed()}</InLang>
                                </span>
                            </EmptyMessage.Title>
                        </EmptyMessage>
                    </div>
                )}

                {/* slot 2: local tools */}
                {state.kind === 'loading' ? (
                    <ToolsSkeleton />
                ) : state.kind === 'ready' && visibility.localTools ? (
                    <section aria-labelledby={toolsLabelId} className="flex shrink-0 flex-col gap-1" data-testid="tools-section">
                        <h2 id={toolsLabelId} className={HEADING_CLASS}>
                            {t('popupLocalToolsLabel')}
                        </h2>
                        <ul className="flex flex-col">
                            {visibility.zapper ? (
                                <ToolItem id="gotoZapper" icon="zapper" label={t('zapperTipEnter')} onClick={() => launchTool('zapper')} />
                            ) : null}
                            {visibility.picker ? (
                                <ToolItem id="gotoPicker" icon="picker" label={t('pickerTipEnter')} onClick={() => launchTool('picker')} />
                            ) : null}
                            {visibility.unpicker ? (
                                <ToolItem id="gotoUnpicker" icon="unpicker" label={t('unpickerTipEnter')} onClick={() => launchTool('unpicker')} />
                            ) : null}
                            {visibility.report ? (
                                <ToolItem id="gotoReport" icon="report" label={t('popupTipReport')} onClick={openReport} />
                            ) : null}
                        </ul>
                    </section>
                ) : null}

                {/* slot 3: the live region stays mounted in every state; at the bottom of the middle
                    area, so a message never moves the tools. Compact Alert padding for 340 px. */}
                <div
                    ref={statusSlotRef}
                    className={[
                        'mt-auto shrink-0 scroll-my-2 [--alert-gap:--spacing(2)] [--alert-gutter:--spacing(3)]',
                        loadFailedInline ? '' : '[&:has([data-politeness]>*)]:pt-2',
                    ].join(' ')}
                    data-testid="status-slot"
                >
                    <StatusRegion visual={!loadFailedInline} />
                </div>
            </main>

            {hasFooter ? (
                <footer
                    className={[
                        'flex h-12 shrink-0 items-center justify-end gap-1 border-t border-subtle px-4',
                        // Touch: 44px buttons, clear of the home indicator (0 unless the page extends under it).
                        'touch:h-auto touch:min-h-14 touch:pt-1.5 touch:pb-[max(--spacing(1.5),env(safe-area-inset-bottom))]',
                        committing ? 'pointer-events-none' : '',
                    ].join(' ')}
                    inert={overlay}
                    data-testid="ribbon"
                >
                    {state.kind === 'loading' ? (
                        <Skeleton shape="circle" className="size-9 touch:size-11" />
                    ) : (
                        <>
                            {visibility.matchedRules ? (
                                <IconButton
                                    id="gotoMatchedRules"
                                    icon="matchedRules"
                                    label={text.matchedRules()}
                                    size="lg"
                                    className={TOUCH_BUTTON}
                                    onClick={openMatchedRules}
                                />
                            ) : null}
                            {visibility.dashboard ? (
                                <IconButton
                                    id="gotoDashboard"
                                    icon="dashboard"
                                    label={t('popupTipDashboard')}
                                    size="lg"
                                    className={TOUCH_BUTTON}
                                    onClick={openDashboard}
                                />
                            ) : null}
                        </>
                    )}
                </footer>
            ) : null}

            {overlay ? (
                // Covers the whole popup at 90 % (§8.2). The indicator is centred on the middle area,
                // on its own opaque chip so it stays legible over the content that shows through.
                <div className="absolute inset-0 z-50 flex flex-col" data-testid="busy-overlay">
                    <div className="absolute inset-0 bg-surface opacity-90" />
                    <div className={`relative flex flex-1 items-center justify-center pt-16 ${hasFooter ? 'pb-12' : ''}`}>
                        <div className="rounded-full bg-surface p-2.5 shadow-md" data-testid="busy-indicator">
                            <LoadingIndicator size={28} aria-hidden="true" />
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Parts                                                                     */
/* ------------------------------------------------------------------------ */

/** Section headings: smaller than the actions they label (12 px, secondary ink, 6.6:1). */
const HEADING_CLASS = 'text-xs leading-4 font-semibold text-secondary';

/** Above this many characters the hostname uses the smaller font (2 lines in the 64 px header). */
const LONG_HOSTNAME = 30;
/** Above this many characters the middle of the hostname is elided (full name in `title`). */
const MAX_HOSTNAME = 44;
/** Characters kept at the end when eliding: the registrable domain is what matters most. */
const HOSTNAME_TAIL = 28;

/**
 * Shortens a long hostname in the middle ("www.very-long-na…co.uk.example.net"), keeping its
 * end, which starts at a label boundary when one is in reach. Exported for the unit test.
 * Works on code points, so no surrogate pair is cut.
 */
export function middleEllipsis(name: string, max = MAX_HOSTNAME, tail = HOSTNAME_TAIL): string {
    const chars = Array.from(name);
    if (chars.length <= max) return name;
    let end = chars.slice(chars.length - tail);
    const dot = end.indexOf('.');
    if (dot >= 0 && dot < end.length - 1 && dot <= tail / 2) end = end.slice(dot + 1);
    const head = Math.max(1, max - 1 - end.length);
    return `${chars.slice(0, head).join('')}…${end.join('')}`;
}

/** The hostname with a line-break opportunity after each dot, so lines break between labels. */
function HostnameText({ name }: { name: string }) {
    const labels = name.split('.');
    return (
        <bdi dir="ltr">
            {labels.map((label, i) => (
                <Fragment key={i}>
                    {label}
                    {i < labels.length - 1 ? (
                        <>
                            .<wbr />
                        </>
                    ) : null}
                </Fragment>
            ))}
        </bdi>
    );
}

function PopupHeader({ state, level }: { state: PopupState; level: FilteringLevel }) {
    // Touch: no hover to read `title`, and the sheet is wider: show the whole name.
    const touch = useTouchScreen();
    let title: ReactNode;
    let fullTitle: string | undefined;
    let long = false;
    if (state.kind === 'loading') {
        title = <Skeleton shape="text" className="w-44" />;
    } else if (state.kind === 'ready' || (state.kind === 'error' && state.hostname !== null)) {
        const ascii = state.kind === 'ready' ? state.tabURL.hostname : (state.hostname ?? '');
        const shown = toUnicode(ascii);
        const display = touch ? shown : middleEllipsis(shown);
        fullTitle = shown;
        long = Array.from(shown).length > LONG_HOSTNAME;
        title = <HostnameText name={display} />;
    } else {
        title = t('extName');
    }
    return (
        <header
            className="flex h-16 shrink-0 items-center gap-3 border-b border-subtle px-4 touch:h-auto touch:min-h-16 touch:py-2"
            data-testid="popup-header"
        >
            <h1
                className={[
                    'line-clamp-2 min-w-0 flex-1 font-semibold [overflow-wrap:anywhere] text-default touch:line-clamp-none',
                    long ? 'text-sm leading-[18px]' : 'text-base leading-5',
                ].join(' ')}
                title={fullTitle}
                data-testid="hostname"
            >
                {title}
            </h1>
            {state.kind === 'loading' ? (
                <Skeleton shape="pill" className="h-6 w-16" />
            ) : state.kind === 'ready' ? (
                <Badge size="lg" pill className={`shrink-0 lowercase ${LEVEL_BADGE_CLASSES[level]}`} data-testid="mode-badge">
                    {t(modeNameKey(level))}
                </Badge>
            ) : null}
        </header>
    );
}

/**
 * One tool row: full content width (16..324, the same edges as the mode control), so the
 * hover/focus highlight lines up with it; the icon is indented inside the row.
 */
function ToolItem({ id, icon, label, onClick }: { id: string; icon: IconName; label: string; onClick: () => void }) {
    return (
        <li className="flex">
            <Button
                id={id}
                color="secondary"
                variant="ghost"
                size="md"
                pill={false}
                block
                className={TOOL_ROW_CLASS}
                onClick={onClick}
            >
                <AppIcon name={icon} className="size-4.5 text-secondary" />
                <span className="min-w-0 flex-1 leading-[18px]">{label}</span>
            </Button>
        </li>
    );
}

/** Tool row box (shared with its skeleton): 32 px for one line, 44 px for two; at least 44 px on touch screens. */
const TOOL_ROW_CLASS =
    'h-auto min-h-8 py-1.5 text-start whitespace-normal text-default [&>span:last-child]:justify-start touch:min-h-11';

function ModeSkeleton() {
    return (
        <div className="flex shrink-0 flex-col gap-2 pb-4" data-testid="mode-skeleton">
            <Skeleton className="my-0.5 h-3 w-24 rounded-xs" />
            {/* Same boxes as ModeSelector size="popup": 36 px control, 6 px gap, 20 px caption. */}
            <div className="flex flex-col gap-1.5">
                <Skeleton className="h-9 w-full touch:h-11" />
                <Skeleton shape="text" className="w-20" />
            </div>
        </div>
    );
}

/** Same boxes as the tool rows: heading, then 3 rows of icon + label at the rows' positions. */
function ToolsSkeleton() {
    return (
        <div className="flex shrink-0 flex-col gap-1" data-testid="tools-skeleton">
            <Skeleton className="my-0.5 h-3 w-28 rounded-xs" />
            <div className="flex flex-col">
                {[40, 44, 32].map((w) => (
                    <div key={w} className="flex h-8 items-center gap-2 px-2.5 touch:h-11" data-testid="tool-skeleton-row">
                        <Skeleton shape="circle" className="size-4.5" />
                        <Skeleton shape="text" className={TOOL_SKELETON_WIDTH[w]} />
                    </div>
                ))}
            </div>
        </div>
    );
}

const TOOL_SKELETON_WIDTH: Record<number, string> = { 40: 'w-40', 44: 'w-44', 32: 'w-32' };

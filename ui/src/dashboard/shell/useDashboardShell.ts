/**
 * State of the dashboard shell: which pane is shown, which tabs exist, when
 * the classic frame is created (dashboard-shell.md §2.2-§2.4, §5 E-2/E-3).
 *
 * - Options data come from the page-wide store of the Settings pane
 *   (`@/dashboard/panes/Settings/store`): one `getOptionsPageData` per
 *   document, BroadcastChannel merged there, and `develop` = the live Develop
 *   tab gate (toggle and `{ developerMode }` broadcast).
 * - `dashboard.activePane` is read once at start (R-3). The start pane is
 *   decided only when BOTH that read and the options data have resolved
 *   (R-5, D-1). No URL hash/query is read or written (R-6).
 * - A user selection sets the pane first and then writes storage without
 *   waiting (R-2), except the selection that first creates the classic frame:
 *   that write is awaited before the frame is created (R-15).
 * - Activating the tab that is already selected writes again, as upstream's
 *   click handler does on every click (js/dashboard.js:42-50; `reselect`).
 * - Developer mode turned off while Develop is shown: Settings, no write (D-2).
 *   `forcedSwitches` counts these switches so the shell can restore focus.
 * - Options failure (status 'error'): only Settings (showing the error) and
 *   About remain; switching between them is local and writes nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { loadOptionsData, useOptionsStore } from '@/dashboard/panes/Settings';
import { readActivePane, writeActivePane } from '@/lib/storage';

import { isClassicPane, isPaneId, resolveStartPane, visiblePanes, type ClassicPaneId, type PaneId } from './panes';

export type ShellStatus = 'loading' | 'error' | 'ready';

/** Panes reachable when the options data could not be loaded. */
export type ErrorPaneId = 'settings' | 'about';

export interface DashboardShellState {
    status: ShellStatus;
    error: unknown;
    /** Shown pane (null until the start pane is decided). */
    active: PaneId | null;
    /** Which tabs are visible (null until the options data arrived). */
    visible: Record<PaneId, boolean> | null;
    /** The classic pane the frame shows (the last one selected). */
    framePane: ClassicPaneId;
    /** True once the classic frame may exist (it is then never removed). */
    frameCreated: boolean;
    /** React panes mounted so far (kept mounted afterwards). */
    visited: ReadonlySet<PaneId>;
    /** Best guess of the start pane while loading (for the skeleton); null before the stored read. */
    startGuess: PaneId | null;
    /** Pane shown while status is 'error'. */
    errorPane: ErrorPaneId;
    /** Number of D-2 switches so far (Develop removed while shown). */
    forcedSwitches: number;
    select: (id: string) => void;
    /** The user activated the tab that is already selected (P-2). */
    reselect: (id: string) => void;
}

interface StoredRead {
    value: string | undefined;
}

function saveActivePane(id: PaneId): Promise<void> {
    return writeActivePane(id).catch((err: unknown) => {
        console.warn('[dashboard] could not save the active pane', err);
    });
}

export function useDashboardShell(): DashboardShellState {
    const options = useOptionsStore();
    const [stored, setStored] = useState<StoredRead | null>(null);
    const [active, setActive] = useState<PaneId | null>(null);
    const [framePane, setFramePane] = useState<ClassicPaneId>('filters');
    const [frameCreated, setFrameCreated] = useState(false);
    const [visited, setVisited] = useState<ReadonlySet<PaneId>>(() => new Set());
    const [errorPick, setErrorPick] = useState<ErrorPaneId | null>(null);
    const [forcedSwitches, setForcedSwitches] = useState(0);
    const started = useRef(false);
    const frameRequested = useRef(false);

    const ready = options.status === 'ready';
    const failed = options.status === 'error';
    const data = ready ? options.data : null;
    const develop = ready ? options.develop : false;
    const visible = useMemo(() => (data === null ? null : visiblePanes(data, develop)), [data, develop]);
    const visibleRef = useRef(visible);
    visibleRef.current = visible;
    const activeRef = useRef(active);
    activeRef.current = active;
    const failedRef = useRef(failed);
    failedRef.current = failed;

    // Start-up: the shared options request and the single stored-pane read.
    useEffect(() => {
        if (started.current) { return; }
        started.current = true;
        // Failure is carried by the store state (status 'error').
        loadOptionsData().catch(() => {});
        // Upstream localRead swallows errors (js/ext.js:59-67): a failed read means "absent".
        readActivePane()
            .catch(() => undefined)
            .then((value) => setStored({ value }));
    }, []);

    const markVisited = useCallback((id: PaneId) => {
        setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    }, []);

    // R-3/R-5/D-1: decide the start pane once both inputs are known.
    useEffect(() => {
        if (active !== null || data === null || stored === null) { return; }
        const start = resolveStartPane(stored.value, data, develop);
        setActive(start);
        markVisited(start);
        if (isClassicPane(start)) {
            // Stored value already names this pane: no write is needed (R-15).
            frameRequested.current = true;
            setFramePane(start);
            setFrameCreated(true);
        }
    }, [active, data, stored, develop, markVisited]);

    // D-2: Develop shown and developer mode turned off -> Settings, no storage write.
    useEffect(() => {
        if (active === 'develop' && visible !== null && !visible.develop) {
            setActive('settings');
            markVisited('settings');
            setForcedSwitches((n) => n + 1);
        }
    }, [active, visible, markVisited]);

    // Options failure: About stays reachable (it needs no options data).
    const errorPane: ErrorPaneId = errorPick ?? (stored?.value === 'about' ? 'about' : 'settings');
    useEffect(() => {
        if (failed && errorPane === 'about') { markVisited('about'); }
    }, [failed, errorPane, markVisited]);

    const select = useCallback(
        (id: string) => {
            if (failedRef.current) {
                // Nothing works without the options data: local switch only, no write.
                if (id === 'settings' || id === 'about') { setErrorPick(id); }
                return;
            }
            const allowed = visibleRef.current;
            if (!isPaneId(id) || allowed === null || !allowed[id]) { return; }
            // Pane first, then the write (R-2).
            setActive(id);
            markVisited(id);
            const write = saveActivePane(id);
            if (isClassicPane(id)) {
                setFramePane(id);
                if (!frameRequested.current) {
                    frameRequested.current = true;
                    // R-15: the frame reads dashboard.activePane at load; create it after the write.
                    void write.then(() => setFrameCreated(true));
                }
            }
        },
        [markVisited],
    );

    const reselect = useCallback((id: string) => {
        if (failedRef.current) { return; }
        const allowed = visibleRef.current;
        if (!isPaneId(id) || allowed === null || !allowed[id] || activeRef.current !== id) { return; }
        void saveActivePane(id);
    }, []);

    let startGuess: PaneId | null = null;
    if (stored !== null) {
        startGuess = isPaneId(stored.value) ? stored.value : 'settings';
    }

    const status: ShellStatus = failed ? 'error' : ready && active !== null ? 'ready' : 'loading';
    return {
        status,
        error: failed ? options.error : null,
        active,
        visible,
        framePane,
        frameCreated,
        visited,
        startGuess,
        errorPane,
        forcedSwitches,
        select,
        reselect,
    };
}

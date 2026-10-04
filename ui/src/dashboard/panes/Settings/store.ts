/**
 * The dashboard's options store — upstream `self.cachedRulesetData` plus its
 * boot sequence and live sync (settings.md §2.3, §5).
 *
 * ONE store per page (settings.md §2.3 "Ownership note", checklist 1 and 3):
 * - `loadOptionsData()` sends `{ what: 'getOptionsPageData' }` at most once per
 *   page, whoever calls it first (the Settings pane, the shell, the Filter-lists
 *   pane). Later calls return the same promise. A failed boot is NOT retried
 *   (that would be a second getOptionsPageData; a reload is the retry).
 * - Only after a successful answer is `BroadcastChannel('uBOL')` subscribed
 *   (once, never closed) and merged field by field (`mergeBroadcast`, §5.2).
 * - Other panes and the shell read the same data through `useOptionsStore()`
 *   or `getOptionsSnapshot()` + `subscribeOptions()`.
 *
 * `develop` is the Develop-tab gate (upstream `body[data-develop]`, §4.5): the
 * effective developer mode, re-derived from the store whenever the widgets are
 * re-rendered, and flipped immediately by the developer-mode toggle.
 *
 * `beforeRestore` hooks (settings.md §7.4, H17): a pane with a pending commit
 * (the Filter-lists pane's 997 ms `applyRulesets` debounce) registers a hook
 * that flushes or cancels it; restore/reset awaits every hook before step 1.
 */
import { useSyncExternalStore } from 'react';
import { getOptionsPageData, isBridgeError, subscribeBroadcast } from '@/lib/bridge';
import { effectiveDeveloperMode, mergeBroadcast, type OptionsData } from './model';
import { salvageOptionsData } from './salvage';

export type OptionsState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; error: unknown }
    | {
          status: 'ready';
          data: OptionsData;
          /** Develop-tab gate (upstream body[data-develop]). */
          develop: boolean;
          /** Incremented on every widget re-render trigger (broadcast or own write). */
          revision: number;
          /** Incremented when a broadcast asks the Filter-lists pane to re-render. */
          listsRevision: number;
      };

type Listener = () => void;

let state: OptionsState = { status: 'idle' };
let loadPromise: Promise<OptionsData> | null = null;
let unsubscribeChannel: (() => void) | null = null;
const listeners = new Set<Listener>();
const beforeRestoreHooks = new Set<() => unknown>();

function emit(next: OptionsState): void {
    state = next;
    for (const listener of Array.from(listeners)) {
        try {
            listener();
        } catch (err) {
            console.error('[settings store] listener failed', err);
        }
    }
}

export function getOptionsSnapshot(): OptionsState {
    return state;
}

export function subscribeOptions(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** React binding of the store. */
export function useOptionsStore(): OptionsState {
    return useSyncExternalStore(subscribeOptions, getOptionsSnapshot, getOptionsSnapshot);
}

function onBroadcast(message: unknown): void {
    if (state.status !== 'ready') return;
    const { store, widgets, lists } = mergeBroadcast(state.data, message);
    if (!widgets && !lists) return;
    emit({
        ...state,
        data: store,
        // A widget re-render re-derives the Develop gate from the store (settings.js:72-77, 317-319).
        develop: widgets ? effectiveDeveloperMode(store) : state.develop,
        revision: widgets ? state.revision + 1 : state.revision,
        listsRevision: lists ? state.listsRevision + 1 : state.listsRevision,
    });
}

/**
 * Boot (settings.md §2.3): one `getOptionsPageData` per page. Resolves the data,
 * rejects with the bridge error (state `error`, no channel opened).
 *
 * A `bad-response` whose only problems are display fields (a malformed
 * `disabledFeatures` or `defaultFilteringMode`) is used anyway, repaired by
 * `salvageOptionsData` (dashboard-shell P-3, checklist 6b):
 * the dashboard then works with those fields degraded instead of failing as a
 * whole. No second message is sent; the raw answer comes with the error.
 */
export function loadOptionsData(): Promise<OptionsData> {
    if (loadPromise !== null) return loadPromise;
    emit({ status: 'loading' });
    const ready = (data: OptionsData): OptionsData => {
        emit({ status: 'ready', data, develop: effectiveDeveloperMode(data), revision: 0, listsRevision: 0 });
        // Opened only after a successful answer, once per page (settings.js:350).
        if (unsubscribeChannel === null) {
            unsubscribeChannel = subscribeBroadcast(onBroadcast);
        }
        return data;
    };
    loadPromise = getOptionsPageData().then(ready, (error: unknown) => {
        if (isBridgeError(error) && error.kind === 'bad-response') {
            const salvaged = salvageOptionsData(error.response);
            if (salvaged !== null) {
                console.warn('[settings store] getOptionsPageData answer repaired:', salvaged.repaired.join(', '), error);
                return ready(salvaged.data);
            }
        }
        emit({ status: 'error', error });
        throw error;
    });
    // The store state carries the error; callers that do not await must not see an unhandled rejection.
    loadPromise.catch(() => {});
    return loadPromise;
}

/**
 * The page's own writes (mode change result, acknowledged toggle). Like a
 * broadcast, a change re-renders the widgets and re-derives the Develop gate.
 */
export function updateOptions(patch: Partial<OptionsData>): void {
    if (state.status !== 'ready') return;
    const data = { ...state.data, ...patch };
    emit({ ...state, data, develop: effectiveDeveloperMode(data), revision: state.revision + 1 });
}

/**
 * The Filter-lists pane's successful reads overwrite `enabledRulesets` and
 * `rulesetDetails` (filter-lists.js:132-133, settings.md §5.2). Only the data
 * changes: no widget re-render, no lists re-render, Develop gate untouched.
 */
export function replaceRulesetData(patch: Pick<Partial<OptionsData>, 'enabledRulesets' | 'rulesetDetails'>): void {
    if (state.status !== 'ready') return;
    emit({ ...state, data: { ...state.data, ...patch } });
}

/** Sets the Develop-tab gate directly (developer-mode toggle, settings.js:224-228). */
export function setDevelopGate(on: boolean): void {
    if (state.status !== 'ready' || state.develop === on) return;
    emit({ ...state, develop: on });
}

/** Re-derives the Develop gate from the store (after a failed developer-mode toggle). */
export function resetDevelopGate(): void {
    if (state.status !== 'ready') return;
    setDevelopGate(effectiveDeveloperMode(state.data));
}

/**
 * Registers a hook run before restore/reset step 1 (settings.md §7.4, H17).
 * Returns the unregister function.
 */
export function registerBeforeRestore(hook: () => unknown): () => void {
    beforeRestoreHooks.add(hook);
    return () => {
        beforeRestoreHooks.delete(hook);
    };
}

/** Runs every registered before-restore hook and waits for all of them. */
export async function runBeforeRestoreHooks(): Promise<void> {
    await Promise.all(Array.from(beforeRestoreHooks, (hook) => hook()));
}

/** Tests only: forget everything (closes the channel subscription). */
export function resetOptionsStoreForTests(): void {
    unsubscribeChannel?.();
    unsubscribeChannel = null;
    loadPromise = null;
    beforeRestoreHooks.clear();
    state = { status: 'idle' };
    for (const listener of Array.from(listeners)) listener();
}

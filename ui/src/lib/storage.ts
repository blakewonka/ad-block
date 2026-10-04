/**
 * Typed wrappers for the `browser.storage.local` keys the React pages read or
 * write DIRECTLY (docs/specs/messaging.md §12.1, §21.7; dashboard-shell.md R-2/R-3;
 * filter-lists.md §1.6/§7; settings.md §7.3 steps 8-11 and 20).
 *
 * The React pages may write only: `dashboard.activePane`, `hideUnusedFilterLists`,
 * `userDnrRules`, and (restore/reset only) `rulesets.imported`, the removal of
 * `rulesets.imported.compiled.*`, and `deferredJobs` (messaging.md §21.7).
 * Keys owned by the background (§12.2) have no writer here on purpose.
 *
 * Wire shape (parity with upstream js/ext.js:59-87, recorded by the harness):
 *   read   → `storage.local.get('<key>')` with the key STRING (not an array)
 *   write  → `storage.local.set({ '<key>': value })`
 *   remove → `storage.local.remove('<key>')` (or the array given)
 *   keys   → `storage.local.getKeys()` when it exists, else `storage.local.get(null)`
 *
 * Differences from upstream, on purpose (UI rule §6.5 spirit):
 * - Upstream `localRead` resolves `undefined` when the API throws or rejects.
 *   These wrappers REJECT instead, so the caller can surface the failure. A caller
 *   that wants upstream's behaviour writes `.catch(() => undefined)`.
 * - Absent values and values of the wrong type are normalised exactly as the
 *   upstream readers do (documented per function).
 * Nothing runs at import time; the API is resolved on every call.
 */

import { getBrowser } from './ext';
import type { ExtStorageArea } from './ext';
import type { ImportedListEntry } from './bridge';

/* ------------------------------------------------------------------------ */
/* Key names                                                                 */
/* ------------------------------------------------------------------------ */

export const STORAGE_KEYS = {
    activePane: 'dashboard.activePane',
    hideUnusedFilterLists: 'hideUnusedFilterLists',
    userDnrRules: 'userDnrRules',
    importedLists: 'rulesets.imported',
    deferredJobs: 'deferredJobs',
} as const;

/** Prefix of the compiled data of imported lists (`rulesets.imported.compiled.<id>`). */
export const IMPORTED_COMPILED_PREFIX = 'rulesets.imported.compiled.';

/** Default of `hideUnusedFilterLists` when the key is absent (js/filter-lists.js:32). */
export const DEFAULT_HIDE_UNUSED_FILTER_LISTS: readonly string[] = ['ads', 'regions', 'imported'];

/** Pane ids of the dashboard. `settings` is represented by the ABSENCE of the key. */
export type DashboardPane = 'settings' | 'rulesets' | 'filters' | 'develop' | 'about';

export interface DeferredJob {
    name: string;
    time: number;
}

/** Shape of the local storage keys the UI touches (messaging.md §20 `UiLocalStorage`). */
export interface UiLocalStorage {
    'dashboard.activePane'?: Exclude<DashboardPane, 'settings'>;
    hideUnusedFilterLists?: string[];
    userDnrRules?: string;
    'rulesets.imported'?: ImportedListEntry[];
    deferredJobs?: DeferredJob[];
}

/* ------------------------------------------------------------------------ */
/* Low-level helpers                                                         */
/* ------------------------------------------------------------------------ */

function local(): ExtStorageArea {
    const area = getBrowser().storage?.local;
    if (typeof area !== 'object' || area === null) {
        throw new Error('browser.storage.local is not available');
    }
    return area;
}

/**
 * `storage.local.get(key)` → the stored value, or `undefined` when absent
 * (upstream: `bin[key] ?? undefined`; a non-object `bin` also gives `undefined`).
 * Rejects when the API throws or rejects.
 */
export async function localRead(key: string): Promise<unknown> {
    const bin: unknown = await local().get(key);
    if (typeof bin !== 'object' || bin === null) { return undefined; }
    return (bin as Record<string, unknown>)[key] ?? undefined;
}

/** `storage.local.set({ [key]: value })`. */
export async function localWrite(key: string, value: unknown): Promise<void> {
    await local().set({ [key]: value });
}

/** `storage.local.remove(keys)`. */
export async function localRemove(keys: string | string[]): Promise<void> {
    await local().remove(keys);
}

/** Key listing: `storage.local.getKeys()` when it exists, else `Object.keys(await storage.local.get(null))` (js/ext.js:79-87). */
export async function localKeys(): Promise<string[]> {
    const area = local();
    if (typeof area.getKeys === 'function') {
        const keys: unknown = await area.getKeys();
        return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
    }
    const bin: unknown = await area.get(null);
    if (typeof bin !== 'object' || bin === null) { return []; }
    return Object.keys(bin);
}

/* ------------------------------------------------------------------------ */
/* dashboard.activePane (dashboard-shell.md R-2, R-3; messaging.md §12.1)    */
/* ------------------------------------------------------------------------ */

/**
 * Read once at startup. Resolves the stored string (upstream does not validate
 * it; the caller maps unknown ids to a pane), or `undefined` when absent or
 * not a string (= `settings`).
 */
export async function readActivePane(): Promise<string | undefined> {
    const v = await localRead(STORAGE_KEYS.activePane);
    return typeof v === 'string' ? v : undefined;
}

/**
 * Tab click: `settings` REMOVES the key, any other pane writes its id
 * (js/dashboard.js:42-50).
 */
export async function writeActivePane(pane: DashboardPane): Promise<void> {
    if (pane === 'settings') {
        await localRemove(STORAGE_KEYS.activePane);
        return;
    }
    await localWrite(STORAGE_KEYS.activePane, pane);
}

/* ------------------------------------------------------------------------ */
/* hideUnusedFilterLists (filter-lists.md §7)                                */
/* ------------------------------------------------------------------------ */

/**
 * Stored array, or `undefined` when absent or not an array (the caller then
 * uses DEFAULT_HIDE_UNUSED_FILTER_LISTS, js/filter-lists.js:32, 380-388).
 * The array may contain `'*'` ("all collapsed"; listed ids are the exceptions).
 */
export async function readHideUnusedFilterLists(): Promise<string[] | undefined> {
    const v = await localRead(STORAGE_KEYS.hideUnusedFilterLists);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined;
}

/** `storage.local.set({ hideUnusedFilterLists: list })` on every expand/collapse (js/filter-lists.js:354-377). */
export async function writeHideUnusedFilterLists(list: readonly string[]): Promise<void> {
    await localWrite(STORAGE_KEYS.hideUnusedFilterLists, Array.from(list));
}

/* ------------------------------------------------------------------------ */
/* userDnrRules (backup reads, restore writes/removes; messaging.md §7)      */
/* ------------------------------------------------------------------------ */

/** Backup step 8: the stored rule text, or `undefined` when absent or not a string. */
export async function readUserDnrRules(): Promise<string | undefined> {
    const v = await localRead(STORAGE_KEYS.userDnrRules);
    return typeof v === 'string' ? v : undefined;
}

/** Restore step 16 (non-empty): `storage.local.set({ userDnrRules: text })`. */
export async function writeUserDnrRules(text: string): Promise<void> {
    await localWrite(STORAGE_KEYS.userDnrRules, text);
}

/** Restore step 16 (empty) / reset: `storage.local.remove('userDnrRules')`. */
export async function removeUserDnrRules(): Promise<void> {
    await localRemove(STORAGE_KEYS.userDnrRules);
}

/* ------------------------------------------------------------------------ */
/* rulesets.imported + compiled data (restore/reset only, messaging.md §7.2)  */
/* ------------------------------------------------------------------------ */

/**
 * `storage.local.get('rulesets.imported')`, defaulting to `[]` like upstream
 * (`await localRead('rulesets.imported') || []`, js/imported-lists.js:78-81).
 * A truthy non-array value is returned as `[]` too (upstream would throw later).
 */
export async function readImportedLists(): Promise<ImportedListEntry[]> {
    const v = await localRead(STORAGE_KEYS.importedLists);
    return Array.isArray(v) ? (v as ImportedListEntry[]) : [];
}

/** `storage.local.set({ 'rulesets.imported': lists })` (js/imported-lists.js:121-125). */
export async function writeImportedLists(lists: readonly ImportedListEntry[]): Promise<void> {
    await localWrite(STORAGE_KEYS.importedLists, Array.from(lists));
}

/** Ids whose compiled data is stored (`rulesets.imported.compiled.<id>` keys), via `localKeys()` (js/imported-lists.js:42-51). */
export async function readCompiledImportedListIds(): Promise<string[]> {
    const keys = await localKeys();
    return keys
        .filter(k => k.startsWith(IMPORTED_COMPILED_PREFIX))
        .map(k => k.slice(IMPORTED_COMPILED_PREFIX.length));
}

/** `storage.local.remove([ 'rulesets.imported.compiled.<id>', … ])` for the given ids. No call when the list is empty. */
export async function removeCompiledImportedLists(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) { return; }
    await localRemove(ids.map(id => `${IMPORTED_COMPILED_PREFIX}${id}`));
}

/* ------------------------------------------------------------------------ */
/* deferredJobs (restore/reset only; js/alarms.js:31-63)                     */
/* ------------------------------------------------------------------------ */

/**
 * The RAW stored value of `deferredJobs` (`undefined` when absent). Raw on
 * purpose: upstream `registerJob` defaults it to `[]` while `removeJob` throws
 * when it is absent (messaging.md §7.2, §18 item 23); the caller decides which
 * behaviour to reproduce.
 */
export async function readDeferredJobs(): Promise<unknown> {
    return localRead(STORAGE_KEYS.deferredJobs);
}

/** `storage.local.set({ deferredJobs: jobs })`. */
export async function writeDeferredJobs(jobs: readonly DeferredJob[]): Promise<void> {
    await localWrite(STORAGE_KEYS.deferredJobs, Array.from(jobs));
}

/** `storage.local.remove('deferredJobs')` (removeJob, last job gone). */
export async function removeDeferredJobs(): Promise<void> {
    await localRemove(STORAGE_KEYS.deferredJobs);
}

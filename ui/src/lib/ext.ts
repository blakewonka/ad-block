/**
 * The ONLY door to the WebExtension API for the React pages
 * (UI rule §6.4).
 *
 * - `getBrowser()` resolves `globalThis.browser ?? globalThis.chrome` at CALL
 *   time. Nothing is read or cached at import time, so the harness can install
 *   its mock (src/dev/install-mock.ts) after this module was evaluated and unit
 *   tests can swap the fake between tests.
 * - When no usable API object exists, `getBrowser()` throws `ExtApiUnavailableError`
 *   with a message that says so (production pages always have one; the harness,
 *   the gallery and unit tests must install a mock first).
 * - The types below cover exactly the members the rebuilt surfaces use, as
 *   listed in docs/specs/messaging.md §13 (popup §4.6, settings §5.2,
 *   backup/restore §7, about §8, storage §12.1). No WebExtension types package
 *   is installed, so they are declared here.
 *
 * Callers never touch `browser.*` directly; they use `getBrowser()` or the
 * helpers exported here. Messages go through src/lib/bridge.ts, storage keys
 * through src/lib/storage.ts, text through src/lib/i18n.tsx.
 */

/* ------------------------------------------------------------------------ */
/* Minimal API types (only what the UI uses)                                 */
/* ------------------------------------------------------------------------ */

export interface ExtManifest {
    name: string;
    version: string;
    version_name?: string;
    /** Chromium/Safari expose `version_name`; upstream reads `versionName ?? version` (js/backup-restore.js:38-39). */
    versionName?: string;
    [key: string]: unknown;
}

export interface ExtPlatformInfo {
    os: string;
    arch?: string;
    [key: string]: unknown;
}

export interface ExtRuntime {
    /** Always called with ONE argument, the message object (messaging.md §1). */
    sendMessage(message: unknown): Promise<unknown>;
    getURL(path: string): string;
    getManifest(): ExtManifest;
    /** About/troubleshooting only (messaging.md §8.2). Safari support UNKNOWN (U18). */
    getPlatformInfo?(): Promise<ExtPlatformInfo>;
    /** Popup "dashboard" button (messaging.md §4.6). */
    openOptionsPage(): Promise<void>;
    id?: string;
}

export interface ExtI18n {
    /** Called with exactly ONE argument everywhere (i18n.md §1.1, §7 item 1). */
    getMessage(key: string): string;
    getUILanguage(): string;
}

export interface ExtStorageArea {
    get(keys: string | string[] | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    /** Optional: upstream falls back to `get(null)` when it is missing (js/ext.js:79-87). */
    getKeys?(): Promise<string[]>;
}

export interface ExtStorage {
    local: ExtStorageArea;
    /** Declared for completeness; no React page reads or writes session storage (messaging.md §12.1). */
    session?: ExtStorageArea;
}

export interface ExtPermissionsRequest {
    origins?: string[];
    permissions?: string[];
}

export interface ExtPermissions {
    /**
     * MUST be called synchronously inside the user-gesture handler, with no
     * `await` before it (UI rule §6.6, messaging.md §4.6 / §5.2).
     */
    request(request: ExtPermissionsRequest): Promise<boolean>;
}

export interface ExtTab {
    id?: number;
    url?: string;
    windowId?: number;
    active?: boolean;
    [key: string]: unknown;
}

export interface ExtTabs {
    query(query: { active?: boolean; currentWindow?: boolean; [key: string]: unknown }): Promise<ExtTab[]>;
    reload(tabId: number): Promise<void>;
    update(tabId: number, props: { url?: string; active?: boolean }): Promise<ExtTab | undefined>;
}

export interface ExtScripting {
    executeScript(details: { files: string[]; target: { tabId: number; frameIds?: number[]; allFrames?: boolean } }): Promise<unknown>;
}

export interface ExtAlarms {
    create(name: string, info: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): Promise<void> | void;
    clear(name: string): Promise<boolean>;
}

/** The subset of `browser` the React pages use. */
export interface ExtBrowser {
    runtime: ExtRuntime;
    i18n: ExtI18n;
    storage: ExtStorage;
    permissions: ExtPermissions;
    tabs: ExtTabs;
    /** Upstream guards with `if ( browser.scripting === undefined ) return;` (messaging.md §13.3). */
    scripting?: ExtScripting;
    /** Restore/reset only (messaging.md §7.2 step 9). */
    alarms: ExtAlarms;
}

/* ------------------------------------------------------------------------ */
/* Resolution                                                                */
/* ------------------------------------------------------------------------ */

export class ExtApiUnavailableError extends Error {
    constructor(message = 'Blocker UI: no WebExtension API found (neither globalThis.browser nor globalThis.chrome has a `runtime`). Production pages get it from the browser; the harness, gallery and unit tests must install a mock before the app code calls the API.') {
        super(message);
        this.name = 'ExtApiUnavailableError';
    }
}

function isApiObject(value: unknown): value is ExtBrowser {
    // `typeof … === 'object'` and a `runtime` object: this also rejects a DOM
    // element that happens to be reachable as `window.browser` through
    // named access (an element with id="browser"; cf. upstream i18n.js:24-28).
    if (typeof value !== 'object' || value === null) { return false; }
    const runtime = (value as { runtime?: unknown }).runtime;
    return typeof runtime === 'object' && runtime !== null;
}

function candidate(name: 'browser' | 'chrome'): unknown {
    try {
        return (globalThis as Record<string, unknown>)[name];
    } catch {
        return undefined;
    }
}

/** `true` when `getBrowser()` would succeed. Never throws. */
export function hasBrowserApi(): boolean {
    return isApiObject(candidate('browser')) || isApiObject(candidate('chrome'));
}

/**
 * `globalThis.browser ?? globalThis.chrome`, resolved on every call.
 * Throws `ExtApiUnavailableError` when neither is a usable API object.
 */
export function getBrowser(): ExtBrowser {
    const b = candidate('browser');
    if (isApiObject(b)) { return b; }
    const c = candidate('chrome');
    if (isApiObject(c)) { return c; }
    throw new ExtApiUnavailableError();
}

/* ------------------------------------------------------------------------ */
/* Thin, lazily resolved accessors                                           */
/* ------------------------------------------------------------------------ */

/**
 * `i18n` facade used by src/lib/i18n.tsx (spec i18n.md §5.2 imports `{ i18n } from './ext'`).
 * Each method resolves the API at call time and passes exactly one argument.
 */
export const i18n: ExtI18n = {
    getMessage(key: string): string {
        return getBrowser().i18n.getMessage(key);
    },
    getUILanguage(): string {
        return getBrowser().i18n.getUILanguage();
    },
};

/** `runtime.getURL(path)`. */
export function getURL(path: string): string {
    return getBrowser().runtime.getURL(path);
}

/** `runtime.getManifest()`. */
export function getManifest(): ExtManifest {
    return getBrowser().runtime.getManifest();
}

/** `runtime.openOptionsPage()` — the popup's dashboard button (messaging.md §4.6). */
export function openOptionsPage(): Promise<void> {
    return getBrowser().runtime.openOptionsPage();
}

/**
 * `runtime.getPlatformInfo()` (troubleshooting, messaging.md §8.2). Rejects when
 * the API lacks it (U18) instead of throwing synchronously, so it can sit in a
 * `Promise.all` next to bridge calls.
 */
export function getPlatformInfo(): Promise<ExtPlatformInfo> {
    try {
        const rt = getBrowser().runtime;
        if (typeof rt.getPlatformInfo !== 'function') {
            return Promise.reject(new Error('runtime.getPlatformInfo is not available'));
        }
        return rt.getPlatformInfo();
    } catch (err) {
        return Promise.reject(err);
    }
}

/**
 * `browser.permissions.request({ origins })`.
 *
 * Calls the API SYNCHRONOUSLY (before returning) so that it stays inside the
 * user gesture. Callers must invoke it directly from the event handler with
 * no `await` before it (UI rule §6.6). A synchronous throw of the API
 * is turned into a rejected promise; upstream's popup counts a rejection as
 * "not granted" (messaging.md §4.6 step 2c), its settings pane does not catch
 * (§5.2) — that decision stays with the caller.
 */
export function requestOrigins(origins: string[]): Promise<boolean> {
    try {
        return getBrowser().permissions.request({ origins });
    } catch (err) {
        return Promise.reject(err);
    }
}

/** `true` when `browser.scripting` exists (upstream guard, messaging.md §13.3). */
export function hasScripting(): boolean {
    try {
        return getBrowser().scripting !== undefined;
    } catch {
        return false;
    }
}

/** Browser family, as upstream `webextFlavor` (js/ext.js:30-34). */
export type WebextFlavor = 'safari' | 'firefox' | 'chromium';

/**
 * The browser family the extension runs in, from the scheme of
 * `runtime.getURL('')`, exactly as upstream `webextFlavor` (js/ext.js:30-34):
 * `safari-web-extension:` is Safari, `moz-extension:` is Firefox (desktop and
 * Android), anything else is Chromium (Chrome, Edge, Brave, Opera, ...).
 * 'chromium' when the API is unavailable.
 *
 * Use it only where upstream branches on the flavour (Settings: strict blocking
 * is not offered on Safari, dashboard.js:33 + settings.css:104). Everything else
 * follows the capabilities the background reports (`supportsCompiledFilters`,
 * `supportsUserScripts`, `isSideloaded`, ...), as upstream does.
 */
export function webextFlavor(): WebextFlavor {
    let url = '';
    try {
        url = getURL('');
    } catch {
        return 'chromium';
    }
    if (url.startsWith('safari-web-extension:')) return 'safari';
    return url.startsWith('moz-extension:') ? 'firefox' : 'chromium';
}

/** `true` when the extension runs in Safari (`webextFlavor() === 'safari'`). */
export function isSafari(): boolean {
    return webextFlavor() === 'safari';
}

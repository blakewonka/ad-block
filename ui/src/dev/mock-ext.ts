/**
 * Mock browser-extension API for the harness, the gallery and unit tests.
 * NEVER imported by a production entry (vite.shared.ts `noDevModules` fails
 * such a build; src/dev/mock-ext.test.ts greps the production sources).
 *
 * What it implements is exactly the list of docs/specs/messaging.md §13.6
 * ("the complete list of browser.* members the rebuilt surfaces touch"):
 * runtime.sendMessage / getURL / getManifest / getPlatformInfo / openOptionsPage,
 * tabs.query / reload / update, scripting.executeScript, permissions.request
 * (+ contains / getAll / remove), storage.local / session (get, set, remove,
 * clear, getKeys, onChanged), alarms.create / clear, i18n.getMessage, plus the
 * DOM global BroadcastChannel (patched by install-mock.ts).
 *
 * `runtime.sendMessage` is answered by MockBackground, an in-memory port of the
 * class-A handlers of js/background.js (messaging.md §2-§8): same response
 * shapes, same state changes as far as a page can observe them, and the same
 * BroadcastChannel('uBOL') echoes (§11). Requests and responses cross a JSON
 * "wire" like Chrome's messaging (undefined keys dropped, NaN -> null, Set -> {}).
 *
 * Every API call is appended to the shared `calls` array as
 * `{ api, args, t }` (args deep-copied at call time, t = performance.now()).
 * install-mock.ts exposes that array as `window.__blockerCalls` and the
 * control object as `window.__blockerMock`. docs/mock-harness.md
 * documents every switch and the record format.
 */
import { LOCALES, LONGEST_LOCALE, MANIFEST, RTL_LANGUAGES, RULESET_DETAILS, type LocaleMessages } from './fixtures';
import {
    type BackgroundInit,
    DEFAULT_TAB,
    defaultBackgroundInit,
    FACTORY_FILTERING_MODES,
    type ImportedListEntry,
    type ModeTable,
} from './fixtures/background-state';
import { type FailureMode, SCENARIO_NAMES, SCENARIOS, type ScenarioName } from './fixtures/scenarios';

/* ========================================================================== */
/* Public types                                                               */
/* ========================================================================== */

/** One recorded API call. */
export interface MockCall {
    /** Dotted API name, e.g. `runtime.sendMessage`, `permissions.request`, `window.close`. */
    api: string;
    /** Deep copy of the arguments, taken when the call was made. */
    args: unknown[];
    /** `performance.now()` at call time (ms since navigation start). */
    t: number;
}

export interface MockTab {
    id?: number;
    url?: string;
    [key: string]: unknown;
}

export type PermissionMode = 'grant' | 'deny' | 'reject' | 'hang';

/** Browser family the mock pretends to be (upstream `webextFlavor`, js/ext.js:30-34). */
export type MockPlatform = 'safari' | 'chromium' | 'firefox';
export const MOCK_PLATFORMS: readonly MockPlatform[] = ['safari', 'chromium', 'firefox'];

/** Fully resolved configuration (see parseMockOptions / resolveMockConfig). */
export interface MockConfig {
    scenarios: ScenarioName[];
    /**
     * Browser family: the scheme of runtime.getURL (which is what the UI and upstream
     * branch on) and the platform defaults of the background (see PLATFORM_DEFAULTS).
     */
    platform: MockPlatform;
    /** Locale folder whose messages.json answers i18n.getMessage. */
    lang: string;
    /** Value of `@@ui_locale` (and, with `_` -> `-`, of getUILanguage()). */
    uiLocale: string;
    dir: 'ltr' | 'rtl' | null;
    theme: 'light' | 'dark' | null;
    permission: PermissionMode;
    permissionDelay: number;
    /** Reject permissions.request when no user activation is active (Chrome's rule). */
    requireGesture: boolean;
    /** The active tab returned by tabs.query; null = no active tab. */
    tab: MockTab | null;
    /** false = `browser.scripting` is undefined. */
    scripting: boolean;
    /** false = `storage.local.getKeys` is missing (js/ext.js:81-83 falls back to get(null)). */
    storageGetKeys: boolean;
    /** Return value of window.confirm(). */
    confirm: boolean;
    /** false = the background posts no BroadcastChannel echo (messaging.md U13). */
    echo: boolean;
    /** Delay (ms) before every sendMessage is handled. */
    delay: number;
    /** Per-message delay (ms), overrides `delay`. */
    delays: Record<string, number>;
    /** Per-message failure; key `'*'` applies to every message. */
    failures: Record<string, FailureMode>;
    /** Verbatim JSON answers per message name (no state change, no echo). */
    responses: Record<string, unknown>;
    /** How a handler's `undefined` reaches the page (messaging.md U1). */
    nullishAs: 'undefined' | 'null';
    /** runtime.getManifest().name: 'localized' = "Blocker", 'raw' = "__MSG_extName__" (U10). */
    manifestName: 'localized' | 'raw';
    /** DNR updateEnabledRulesets fails: applyRulesets changes nothing, answers undefined, echoes the old list. */
    dnrError: boolean;
    /** Initial background state. */
    background: BackgroundInit;
    /** Seed for storage areas (UI-owned keys such as dashboard.activePane). */
    storage: { local: Record<string, unknown>; session: Record<string, unknown> };
}

/** User-facing options: every field optional; JSON-serialisable (query `?mock=`, `__BLOCKER_MOCK_CONFIG__`). */
export interface MockOptions {
    scenario?: string | string[];
    /** Browser family (default `safari`); applied before scenarios and the other switches. */
    platform?: MockPlatform;
    lang?: string;
    uiLocale?: string;
    dir?: 'ltr' | 'rtl';
    theme?: 'light' | 'dark';
    permission?: PermissionMode;
    permissionDelay?: number;
    requireGesture?: boolean;
    /** Replace the whole active tab (null = none). */
    tab?: MockTab | null;
    /** Set the active tab's URL; null = tab without a `url` property. */
    tabUrl?: string | null;
    tabId?: number;
    scripting?: boolean;
    storageGetKeys?: boolean;
    confirm?: boolean;
    echo?: boolean;
    delay?: number;
    delays?: Record<string, number>;
    failures?: Record<string, FailureMode>;
    responses?: Record<string, unknown>;
    nullishAs?: 'undefined' | 'null';
    manifestName?: 'localized' | 'raw';
    dnrError?: boolean;
    /** Level of the active tab's hostname (applied like setFilteringMode). */
    level?: number;
    /** Default level (applied like setDefaultFilteringMode). */
    defaultLevel?: number;
    /** Store N custom selectors for the active tab's hostname (popupPanelData.hasCustomFilters = N). */
    customFilterCount?: number;
    background?: Partial<BackgroundInit>;
    storage?: { local?: Record<string, unknown>; session?: Record<string, unknown> };
}

/* ========================================================================== */
/* Constants                                                                  */
/* ========================================================================== */

/** Host part of every extension URL the mock hands out. */
export const MOCK_EXTENSION_HOST = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
/** runtime.getURL('') — the `safari-web-extension:` scheme makes upstream's webextFlavor 'safari' (§14). */
export const MOCK_EXTENSION_ORIGIN = `safari-web-extension://${MOCK_EXTENSION_HOST}`;
/** runtime.getURL('') per platform: the scheme decides upstream's `webextFlavor` (js/ext.js:30-34). */
export const MOCK_EXTENSION_ORIGINS: Readonly<Record<MockPlatform, string>> = {
    safari: MOCK_EXTENSION_ORIGIN,
    chromium: 'chrome-extension://dlmnnmhkhemepjkkfkdcfbndleghblka',
    firefox: `moz-extension://${MOCK_EXTENSION_HOST}`,
};
/**
 * Background defaults that differ per platform (applied before scenarios and switches):
 * - `supportsCompiledFilters` is `supportsOffscreenDocument` (background.js:439): false in
 *   the Safari build (safari/ext-offscreen.js:25), true in the Chromium and Firefox builds
 *   (ext-offscreen.js:24; Firefox has no offscreen API but its build uses the generic file);
 * - `strictBlockMode` defaults to `webextFlavor !== 'safari'` (config.js:35);
 * - `supportsUserScripts` stays false: Chromium needs the user's "Allow user scripts"
 *   toggle and Firefox an optional permission (use `?userScripts=1` for the granted case).
 */
export const PLATFORM_DEFAULTS: Readonly<Record<MockPlatform, Partial<BackgroundInit>>> = {
    safari: {},
    chromium: { supportsCompiledFilters: true, strictBlockMode: true },
    firefox: { supportsCompiledFilters: true, strictBlockMode: true },
};
export const MOCK_EXTENSION_ID = 'org.example.blocker.Extension (ABCDE12345)';
/** Error text of a sendMessage with no receiver (Chrome's wording). */
export const NO_RECEIVER_ERROR = 'Could not establish connection. Receiving end does not exist.';
/** Error text when a handler throws and never answers (messaging.md §1.5). */
export const HANDLER_THREW_ERROR = 'The message port closed before a response was received.';

const MODE_NONE = 0;
const MODE_BASIC = 1;
const MODE_OPTIMAL = 2;
const MODE_COMPLETE = 3;

const RE_IMPORTED = /^[a-z-]+:\/\//;

/* ========================================================================== */
/* Small helpers                                                              */
/* ========================================================================== */

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** Deep copy for the call record; functions and other uncloneables become descriptive strings. */
export function snapshot(value: unknown): unknown {
    try {
        return structuredClone(value);
    } catch {
        return looseCopy(value, new WeakMap());
    }
}

function looseCopy(value: unknown, seen: WeakMap<object, unknown>): unknown {
    if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
    if (typeof value === 'symbol' || typeof value === 'bigint') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (typeof Node !== 'undefined' && value instanceof Node) return `[${value.nodeName}]`;
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        seen.set(value, out);
        for (const v of value) out.push(looseCopy(v, seen));
        return out;
    }
    if (value instanceof Set) return new Set([...value].map((v) => looseCopy(v, seen)));
    if (value instanceof Map) return new Map([...value].map(([k, v]) => [looseCopy(k, seen), looseCopy(v, seen)]));
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [k, v] of Object.entries(value)) out[k] = looseCopy(v, seen);
    return out;
}

/** JSON round trip, like Chrome's extension messaging. `undefined` stays `undefined`. */
function throughWire(value: unknown): unknown {
    if (value === undefined) return undefined;
    const text = JSON.stringify(value);
    return text === undefined ? undefined : JSON.parse(text);
}

const clone = <T>(value: T): T => structuredClone(value);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* ========================================================================== */
/* Mode table logic — a port of js/mode-manager.js:66-237 (messaging.md §3.2) */
/* ========================================================================== */

interface Modes {
    none: Set<string>;
    basic: Set<string>;
    optimal: Set<string>;
    complete: Set<string>;
}

const toBroaderHostname = (hn: string): string => {
    if (hn === '*') return '';
    const pos = hn.indexOf('.');
    return pos !== -1 ? hn.slice(pos + 1) : '*';
};

const isDescendantHostnameOfIter = (hna: string, setb: Set<string>): boolean => {
    if (setb.has('all-urls') || setb.has('*')) return true;
    let hn = hna;
    while (hn) {
        const pos = hn.indexOf('.');
        if (pos === -1) break;
        hn = hn.slice(pos + 1);
        if (setb.has(hn)) return true;
    }
    return false;
};

const pruneDescendantHostnamesFromSet = (hostname: string, hnSet: Set<string>): void => {
    for (const hn of hnSet) {
        if (hn.endsWith(hostname) === false) continue;
        if (hn === hostname) continue;
        if (hn.at(-hostname.length - 1) !== '.') continue;
        hnSet.delete(hn);
    }
};

const pruneHostnameFromSet = (hostname: string, hnSet: Set<string>): void => {
    let hn = hostname;
    for (;;) {
        hnSet.delete(hn);
        hn = toBroaderHostname(hn);
        if (hn === '*') break;
    }
};

export function serializeModes(details: Modes): ModeTable {
    return {
        none: Array.from(details.none),
        basic: Array.from(details.basic),
        optimal: Array.from(details.optimal),
        complete: Array.from(details.complete),
    };
}

/** js/mode-manager.js:96-103 — legacy keys accepted; throws when `details` is nullish. */
function unserializeModes(details: Record<string, unknown>): Modes {
    const d = details as Record<string, Iterable<string> | undefined>;
    return {
        none: new Set(d.none),
        basic: new Set(d.basic ?? d.network),
        optimal: new Set(d.optimal ?? d.extendedSpecific),
        complete: new Set(d.complete ?? d.extendedGeneric),
    };
}

/** js/mode-manager.js:107-119. */
function fixModes(details: Record<string, unknown>): Modes {
    const { none, basic, optimal, complete } = unserializeModes(details);
    for (const exclude of none) {
        basic.delete(exclude);
        pruneDescendantHostnamesFromSet(exclude, basic);
        optimal.delete(exclude);
        pruneDescendantHostnamesFromSet(exclude, optimal);
        complete.delete(exclude);
        pruneDescendantHostnamesFromSet(exclude, complete);
    }
    return { none, basic, optimal, complete };
}

/** js/mode-manager.js:123-149. */
export function lookupFilteringMode(modes: Modes, hostname: string): number {
    const { none, basic, optimal, complete } = modes;
    if (hostname === 'all-urls') {
        if (none.has('all-urls')) return MODE_NONE;
        if (basic.has('all-urls')) return MODE_BASIC;
        if (optimal.has('all-urls')) return MODE_OPTIMAL;
        if (complete.has('all-urls')) return MODE_COMPLETE;
        return MODE_BASIC;
    }
    if (none.has(hostname)) return MODE_NONE;
    if (none.has('all-urls') === false && isDescendantHostnameOfIter(hostname, none)) return MODE_NONE;
    if (basic.has(hostname)) return MODE_BASIC;
    if (basic.has('all-urls') === false && isDescendantHostnameOfIter(hostname, basic)) return MODE_BASIC;
    if (optimal.has(hostname)) return MODE_OPTIMAL;
    if (optimal.has('all-urls') === false && isDescendantHostnameOfIter(hostname, optimal)) return MODE_OPTIMAL;
    if (complete.has(hostname)) return MODE_COMPLETE;
    if (complete.has('all-urls') === false && isDescendantHostnameOfIter(hostname, complete)) return MODE_COMPLETE;
    return lookupFilteringMode(modes, 'all-urls');
}

function setForLevel(modes: Modes, level: unknown): Set<string> | undefined {
    switch (level) {
        case MODE_NONE:
            return modes.none;
        case MODE_BASIC:
            return modes.basic;
        case MODE_OPTIMAL:
            return modes.optimal;
        case MODE_COMPLETE:
            return modes.complete;
        default:
            return undefined;
    }
}

/**
 * js/mode-manager.js:153-237. `afterLevel` is whatever came over the wire: a
 * string or null matches no `case`, exactly as upstream (messaging.md §1.6 item 5).
 */
export function applyFilteringMode(modes: Modes, hostname: string, afterLevel: unknown): number {
    const defaultLevel = lookupFilteringMode(modes, 'all-urls');
    if (hostname === 'all-urls') {
        if (afterLevel === defaultLevel) return afterLevel;
        const target = setForLevel(modes, afterLevel);
        if (target !== undefined) {
            target.clear();
            target.add('all-urls');
        }
        setForLevel(modes, defaultLevel)?.delete('all-urls');
        return lookupFilteringMode(modes, 'all-urls');
    }
    const beforeLevel = lookupFilteringMode(modes, hostname);
    if (afterLevel === beforeLevel) return afterLevel;
    const before = setForLevel(modes, beforeLevel);
    if (before !== undefined) pruneHostnameFromSet(hostname, before);
    if (afterLevel !== defaultLevel) {
        const target = setForLevel(modes, afterLevel);
        if (target !== undefined && isDescendantHostnameOfIter(hostname, target) === false) {
            target.add(hostname);
            pruneDescendantHostnamesFromSet(hostname, target);
        }
    }
    return lookupFilteringMode(modes, hostname);
}

/** js/utils.js:114-129. */
export function hostnameFromMatch(origin: string): string {
    if (origin === '<all_urls>' || origin === '*://*/*') return 'all-urls';
    const match = /^[^:]+:\/\/(?:\*\.)?([^/]+)\/\*/.exec(origin);
    return match === null ? '' : (match[1] ?? '');
}

/** Rough Chrome-like validation of a host-permission match pattern. */
function isValidMatchPattern(pattern: unknown): boolean {
    if (typeof pattern !== 'string') return false;
    if (pattern === '<all_urls>') return true;
    const m = /^(\*|https?|wss?|ftp|file|urn):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (m === null) return false;
    const host = m[2] ?? '';
    if (host === '*' || host === '') return true;
    const bare = host.startsWith('*.') ? host.slice(2) : host;
    if (bare.includes('*')) return false;
    // `*.` in front of an IP literal is invalid (popup.md / messaging.md §4.6: `*://*.[::1]/*`).
    if (host.startsWith('*.') && (/^\[.*\]$/.test(bare) || /^\d+(?:\.\d+){3}$/.test(bare))) return false;
    return true;
}

/* ========================================================================== */
/* In-memory storage area                                                     */
/* ========================================================================== */

type ChangeListener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName?: string) => void;

export class MockEvent<F extends (...args: never[]) => unknown> {
    readonly listeners = new Set<F>();
    constructor(
        private readonly api: string,
        private readonly record: (api: string, args: unknown[]) => void,
    ) {}
    addListener = (fn: F): void => {
        this.record(`${this.api}.addListener`, [fn]);
        this.listeners.add(fn);
    };
    removeListener = (fn: F): void => {
        this.record(`${this.api}.removeListener`, [fn]);
        this.listeners.delete(fn);
    };
    hasListener = (fn: F): boolean => {
        this.record(`${this.api}.hasListener`, [fn]);
        return this.listeners.has(fn);
    };
    /** Not part of the WebExtension API: used by the mock to fire the event. */
    dispatch(...args: Parameters<F>): void {
        for (const fn of [...this.listeners]) {
            try {
                fn(...args);
            } catch (err) {
                console.error(`[mock-ext] ${this.api} listener threw`, err);
            }
        }
    }
}

export class MemoryArea {
    readonly data = new Map<string, unknown>();
    readonly onChanged: MockEvent<ChangeListener>;
    constructor(
        readonly name: 'local' | 'session' | 'sync',
        private readonly record: (api: string, args: unknown[]) => void,
        private readonly globalOnChanged: MockEvent<ChangeListener>,
        seed: Record<string, unknown> = {},
    ) {
        this.onChanged = new MockEvent<ChangeListener>(`storage.${name}.onChanged`, record);
        for (const [k, v] of Object.entries(seed)) this.data.set(k, clone(v));
    }

    /* ---- internal (not recorded): used by the mock background ---- */

    read(key: string): unknown {
        return this.data.has(key) ? clone(this.data.get(key)) : undefined;
    }
    write(items: Record<string, unknown>): void {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [k, v] of Object.entries(items)) {
            if (v === undefined) continue;
            const oldValue = this.data.get(k);
            this.data.set(k, clone(v));
            changes[k] = oldValue === undefined ? { newValue: clone(v) } : { oldValue: clone(oldValue), newValue: clone(v) };
        }
        this.emit(changes);
    }
    delete(keys: string | string[]): void {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (!this.data.has(k)) continue;
            changes[k] = { oldValue: clone(this.data.get(k)) };
            this.data.delete(k);
        }
        this.emit(changes);
    }
    dump(): Record<string, unknown> {
        return Object.fromEntries([...this.data].map(([k, v]) => [k, clone(v)]));
    }
    private emit(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void {
        if (Object.keys(changes).length === 0) return;
        // Storage events are asynchronous in browsers.
        setTimeout(() => {
            this.onChanged.dispatch(clone(changes));
            this.globalOnChanged.dispatch(clone(changes), this.name);
        }, 0);
    }

    /* ---- the WebExtension surface (recorded) ---- */

    get = (keys?: unknown): Promise<Record<string, unknown>> => {
        this.record(`storage.${this.name}.get`, keys === undefined ? [] : [keys]);
        const out: Record<string, unknown> = {};
        if (keys === undefined || keys === null) {
            for (const [k, v] of this.data) out[k] = clone(v);
        } else if (typeof keys === 'string') {
            if (this.data.has(keys)) out[keys] = clone(this.data.get(keys));
        } else if (Array.isArray(keys)) {
            for (const k of keys) if (typeof k === 'string' && this.data.has(k)) out[k] = clone(this.data.get(k));
        } else if (isRecord(keys)) {
            for (const [k, dflt] of Object.entries(keys)) out[k] = this.data.has(k) ? clone(this.data.get(k)) : dflt;
        } else {
            return Promise.reject(new TypeError(`storage.${this.name}.get: invalid keys`));
        }
        return Promise.resolve(out);
    };
    set = (items: unknown): Promise<void> => {
        this.record(`storage.${this.name}.set`, [items]);
        if (!isRecord(items)) return Promise.reject(new TypeError(`storage.${this.name}.set: items must be an object`));
        try {
            this.write(items);
        } catch (err) {
            return Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
        return Promise.resolve();
    };
    remove = (keys: unknown): Promise<void> => {
        this.record(`storage.${this.name}.remove`, [keys]);
        if (typeof keys === 'string') this.delete(keys);
        else if (Array.isArray(keys)) this.delete(keys.filter((k): k is string => typeof k === 'string'));
        return Promise.resolve();
    };
    clear = (): Promise<void> => {
        this.record(`storage.${this.name}.clear`, []);
        this.delete([...this.data.keys()]);
        return Promise.resolve();
    };
    getKeys = (): Promise<string[]> => {
        this.record(`storage.${this.name}.getKeys`, []);
        return Promise.resolve([...this.data.keys()]);
    };
}

/* ========================================================================== */
/* The mock background (class-A handlers of js/background.js)                 */
/* ========================================================================== */

type DetailsEntry = Record<string, unknown> & { id: string; enabled?: boolean };

interface ApplyResult {
    stockUpdated?: boolean;
    importedUpdated?: boolean;
    changed?: boolean;
    error?: string;
    enabledRulesets?: string[];
}

interface RulesetConfigState {
    version: string;
    enabledRulesets: string[] | undefined;
    autoReload: boolean;
    showBlockedCount: boolean;
    strictBlockMode: boolean;
    popupBlockMode: unknown;
    developerMode: boolean;
    hasBroadHostPermissions: boolean;
    /** Added by startSession (bg:753-756): toggles whenever `supportsUserScripts()` differs; `false` on Safari once settled. */
    userScripts: boolean;
}

export interface BackgroundDeps {
    local: MemoryArea;
    session: MemoryArea;
    /** Posts on BroadcastChannel('uBOL') (or drops it when echoes are off). */
    broadcast: (message: Record<string, unknown>) => void;
    config: MockConfig;
}

export class MockBackground {
    modes: Modes;
    rulesetConfig: RulesetConfigState;
    readonly origins: Set<string>;
    /** Stock ids enabled in "DNR", kept in ruleset-details order. */
    stockEnabled: string[];
    adminRulesets: string[];
    disabledFeatures: string[] | null | undefined;
    pendingPermissionRequest: Record<string, unknown> | undefined;
    readonly init: BackgroundInit;
    private readonly stockIds: string[];

    constructor(
        init: BackgroundInit,
        private readonly deps: BackgroundDeps,
    ) {
        this.init = clone(init);
        this.stockIds = RULESET_DETAILS.map((r) => r.id);
        this.modes = unserializeModes(init.filteringModes as unknown as Record<string, unknown>);
        this.origins = new Set(init.grantedOrigins);
        this.adminRulesets = [...init.adminRulesets];
        this.disabledFeatures = 'disabledFeatures' in init ? clone(init.disabledFeatures) : undefined;
        this.pendingPermissionRequest = undefined;
        const stock = new Set(init.enabledRulesets.filter((id) => !RE_IMPORTED.test(id) && this.stockIds.includes(id)));
        this.stockEnabled = this.stockIds.filter((id) => stock.has(id));
        // Imported lists live in local storage, as in js/imported-lists.js.
        if (init.importedLists.length !== 0) {
            const enabled = new Set(init.enabledRulesets);
            deps.local.write({
                'rulesets.imported': init.importedLists.map((l) => ({ ...l, enabled: l.enabled || enabled.has(l.id) })),
            });
        }
        for (const [hostname, selectors] of init.customFilters) {
            if (selectors.length !== 0) deps.local.write({ [`site.${hostname}`]: [...selectors].sort() });
        }
        if (typeof init.sandboxFilters === 'string' && init.sandboxFilters.trim() !== '') {
            deps.local.write({ sandboxFilters: init.sandboxFilters.trim() });
        }
        // The developer-mode admin token forces developer mode off (bg:807-814).
        const developerMode = init.developerMode && !(this.disabledFeatures ?? []).includes('develop');
        this.rulesetConfig = {
            version: MANIFEST.version,
            enabledRulesets: undefined,
            autoReload: init.autoReload,
            showBlockedCount: init.showBlockedCount,
            strictBlockMode: init.strictBlockMode,
            popupBlockMode: init.popupBlockMode,
            developerMode,
            hasBroadHostPermissions: this.hasOmnipotence(),
            userScripts: init.supportsUserScripts,
        };
        this.rulesetConfig.enabledRulesets = this.getEnabledRulesets();
    }

    /* ---- state readers ---- */

    hasOmnipotence(): boolean {
        return this.origins.has('<all_urls>') || this.origins.has('*://*/*');
    }

    importedLists(): ImportedListEntry[] {
        const lists = this.deps.local.read('rulesets.imported');
        return Array.isArray(lists) ? (lists as ImportedListEntry[]) : [];
    }

    /** js/ruleset-manager.js:548-557. */
    getEnabledRulesets(): string[] {
        return [...this.stockEnabled, ...this.importedLists().filter((l) => l.enabled === true).map((l) => l.id)];
    }

    /** js/ruleset-manager.js:78-89: stock entries in file order, then imported entries. */
    rulesetDetails(): DetailsEntry[] {
        return [...(clone(RULESET_DETAILS) as unknown as DetailsEntry[]), ...(this.importedLists() as unknown as DetailsEntry[])];
    }

    defaultFilteringMode(): number {
        return lookupFilteringMode(this.modes, 'all-urls');
    }

    /** js/filter-manager.js:69-95: number of selectors stored for the hostname and its parents. */
    hasCustomFilters(hostname: string): number {
        return this.customFiltersFromHostname(hostname).length;
    }

    customFiltersFromHostname(hostname: string): string[] {
        const out: string[] = [];
        let hn = hostname;
        while (hn !== '') {
            const selectors = this.deps.local.read(`site.${hn}`);
            if (Array.isArray(selectors)) out.push(...(selectors as string[]));
            const pos = hn.indexOf('.');
            if (pos === -1) break;
            hn = hn.slice(pos + 1);
        }
        return out.sort();
    }

    allCustomFilters(): Array<[string, string[]]> {
        const out: Array<[string, string[]]> = [];
        for (const [key, value] of this.deps.local.data) {
            if (!key.startsWith('site.')) continue;
            out.push([key.slice(5), clone(value) as string[]]);
        }
        return out;
    }

    /** A serialisable view of everything the background holds (for tests). */
    snapshot(): Record<string, unknown> {
        return {
            filteringModes: serializeModes(this.modes),
            defaultFilteringMode: this.defaultFilteringMode(),
            grantedOrigins: [...this.origins],
            hasOmnipotence: this.hasOmnipotence(),
            rulesetConfig: clone(this.rulesetConfig),
            enabledRulesets: this.getEnabledRulesets(),
            adminRulesets: [...this.adminRulesets],
            disabledFeatures: clone(this.disabledFeatures),
            pendingPermissionRequest: clone(this.pendingPermissionRequest),
            customFilters: this.allCustomFilters(),
            sandboxFilters: this.deps.local.read('sandboxFilters'),
            importedLists: this.importedLists(),
        };
    }

    /* ---- state writers ---- */

    /** js/mode-manager.js:304-322: write + broadcast `{ defaultFilteringMode, hasOmnipotence, filteringModeDetails }`. */
    private writeModes(): void {
        const data = serializeModes(this.modes);
        this.deps.local.write({ filteringModeDetails: data });
        this.deps.session.write({ filteringModeDetails: data });
        this.deps.broadcast({
            defaultFilteringMode: this.defaultFilteringMode(),
            hasOmnipotence: this.hasOmnipotence(),
            filteringModeDetails: unserializeModes(data as unknown as Record<string, unknown>),
        });
    }

    /** js/mode-manager.js:351-356 (always writes and broadcasts). */
    setFilteringMode(hostname: string, level: unknown): number {
        const after = applyFilteringMode(this.modes, hostname, level);
        this.writeModes();
        return after;
    }

    private saveRulesetConfig(): void {
        const data = clone(this.rulesetConfig);
        this.deps.local.write({ rulesetConfig: data });
        this.deps.session.write({ rulesetConfig: data });
    }

    /** js/ruleset-manager.js:605-703, with DNR simulated in memory. */
    enableRulesets(ids: unknown): ApplyResult {
        const afterIds = new Set<unknown>(ids as Iterable<unknown> | undefined);
        const beforeIds = new Set<unknown>(this.getEnabledRulesets());
        for (const token of this.adminRulesets) {
            const c0 = token.charAt(0);
            const id = token.slice(1);
            if (c0 === '+') afterIds.add(id);
            else if (c0 === '-') afterIds.delete(id);
        }
        const enableSet = new Set<unknown>();
        const disableSet = new Set<unknown>();
        for (const id of afterIds) if (!beforeIds.has(id)) enableSet.add(id);
        for (const id of beforeIds) if (!afterIds.has(id)) disableSet.add(id);

        const response: ApplyResult = {};
        const known = new Set(this.rulesetDetails().map((d) => d.id));
        for (const id of enableSet) {
            if (known.has(id as string)) continue;
            enableSet.delete(id);
            if (RE_IMPORTED.test(String(id))) response.importedUpdated = true;
            else response.stockUpdated = true;
        }
        for (const id of disableSet) if (!known.has(id as string)) disableSet.delete(id);
        if (enableSet.size === 0 && disableSet.size === 0) return response;

        const enableIds = [...enableSet].map(String);
        const disableIds = [...disableSet].map(String);

        // updateEnabledRulesets (js/ruleset-manager.js:584-601): stock ids only.
        const stockEnable = enableIds.filter((id) => !RE_IMPORTED.test(id));
        const stockDisable = disableIds.filter((id) => !RE_IMPORTED.test(id));
        let stockApplied = false;
        if (stockEnable.length !== 0 || stockDisable.length !== 0) {
            const next = new Set(this.stockEnabled);
            for (const id of stockDisable) next.delete(id);
            for (const id of stockEnable) next.add(id);
            const max = this.init.maxNumberOfEnabledRulesets;
            if (this.deps.config.dnrError) {
                response.error = 'Error: Mock DNR failure (dnrError switch).';
            } else if (typeof max === 'number' && next.size > max) {
                response.error = `Error: The number of enabled static rulesets exceeds the limit (${max}).`;
            } else {
                this.stockEnabled = this.stockIds.filter((id) => next.has(id));
                stockApplied = true;
            }
        }
        response.stockUpdated = stockApplied || response.stockUpdated;
        if (response.stockUpdated) response.changed = true;

        // updateEnabledImportedLists (js/imported-lists.js:85-109).
        const lists = this.importedLists();
        let importedModified = false;
        if (enableIds.some((id) => RE_IMPORTED.test(id)) || disableIds.some((id) => RE_IMPORTED.test(id))) {
            for (const list of lists) {
                if (enableIds.includes(list.id)) {
                    if (list.enabled === true) continue;
                    list.enabled = true;
                    importedModified = true;
                } else if (disableIds.includes(list.id)) {
                    if (list.enabled !== true) continue;
                    list.enabled = false;
                    importedModified = true;
                }
            }
            if (importedModified) this.deps.local.write({ 'rulesets.imported': lists });
        }
        response.importedUpdated = importedModified || response.importedUpdated;
        if (response.importedUpdated) response.changed = true;

        response.enabledRulesets = this.getEnabledRulesets();
        return response;
    }

    /** bg:239-260. */
    applyRulesets(ids: unknown): void {
        const result = this.enableRulesets(ids);
        if (result.stockUpdated || result.importedUpdated) {
            // HAZARD reproduced: an early return leaves result.enabledRulesets undefined (messaging.md §6.3).
            this.rulesetConfig.enabledRulesets = result.enabledRulesets;
            this.saveRulesetConfig();
        }
        this.deps.broadcast({ enabledRulesets: clone(this.rulesetConfig.enabledRulesets) });
    }

    /** js/imported-lists.js:225-232. */
    private removeImportedLists(urls: unknown): void {
        const ids = new Set<unknown>(Array.isArray(urls) ? urls : [urls]);
        const before = this.importedLists();
        const after = before.filter((l) => !ids.has(l.id));
        if (after.length !== before.length) this.deps.local.write({ 'rulesets.imported': after });
    }

    /** js/imported-lists.js:185-221. */
    private addImportedList(url: string): void {
        const lists = this.importedLists();
        if (lists.some((l) => l.id === url)) return;
        lists.push({
            id: url,
            name: url,
            group: 'imported',
            enabled: false,
            homeURL: '',
            expires: 7,
            time: { added: Date.now(), updated: 0 },
            filters: { total: 0, accepted: 0, rejected: 0 },
            rules: { total: 0, plain: 0, regex: 0 },
        });
        this.deps.local.write({ 'rulesets.imported': lists });
    }

    /* ---- permission events (bg:169-235) ---- */

    onPermissionsAdded(origins: string[]): void {
        const details = this.pendingPermissionRequest;
        this.pendingPermissionRequest = undefined;
        if (details !== undefined) {
            // onPermissionGrantedThruExtension (bg:169-183). The 437 ms tab reload it may
            // schedule is not reproduced (it is the background's call, not the page's).
            if (this.defaultFilteringMode() >= MODE_OPTIMAL) return;
            const hostname = details.hostname as string;
            if (!origins.map(hostnameFromMatch).includes(hostname)) return;
            if (lookupFilteringMode(this.modes, hostname) === details.afterLevel) return;
            this.setFilteringMode(hostname, details.afterLevel);
            return;
        }
        this.syncWithBrowserPermissions(origins);
    }

    /**
     * js/mode-manager.js:383-434 (simplified: same decisions, synchronous).
     * `added` = origins granted since the last sync (upstream compares with the persisted
     * `permissions.hostnames` list; the mock passes the newly granted origins instead).
     */
    syncWithBrowserPermissions(added: string[] = []): boolean {
        const allowed = new Set([...this.origins].map(hostnameFromMatch).filter((h) => h !== ''));
        const hasBroad = allowed.has('all-urls');
        const toggled = hasBroad !== this.rulesetConfig.hasBroadHostPermissions;
        const beforeMode = this.defaultFilteringMode();
        let modified = false;
        if (beforeMode > MODE_BASIC && !hasBroad) {
            this.setFilteringMode('all-urls', MODE_BASIC);
            modified = true;
        } else if (beforeMode === MODE_BASIC && hasBroad && toggled) {
            this.setFilteringMode('all-urls', MODE_OPTIMAL);
            modified = true;
        }
        if (toggled) {
            this.rulesetConfig.hasBroadHostPermissions = hasBroad;
            this.saveRulesetConfig();
        }
        const afterMode = this.defaultFilteringMode();
        if (afterMode > MODE_BASIC) return afterMode !== beforeMode;
        if (!hasBroad) {
            let changed = false;
            for (const hn of new Set([...this.modes.optimal, ...this.modes.complete])) {
                if (allowed.has(hn) || isDescendantHostnameOfIter(hn, allowed)) continue;
                applyFilteringMode(this.modes, hn, afterMode);
                changed = true;
            }
            // js/mode-manager.js:422-428: a newly allowed hostname with no mode yet becomes optimal.
            const { none, basic, optimal, complete } = this.modes;
            for (const hn of added.map(hostnameFromMatch)) {
                if (hn === '' || optimal.has(hn) || complete.has(hn) || basic.has(hn) || none.has(hn)) continue;
                applyFilteringMode(this.modes, hn, MODE_OPTIMAL);
                changed = true;
            }
            if (changed) {
                this.writeModes();
                modified = true;
            }
        }
        return modified;
    }

    /* ---- the dispatcher (bg:293-673; class A fully, class B minimally) ---- */

    handle(request: unknown): unknown {
        if (!isRecord(request)) throw new TypeError("Cannot read properties of undefined (reading 'includes')");
        const what = request.what;
        if (typeof what !== 'string') throw new TypeError('request.what.includes is not a function');
        if (what.includes(':')) return undefined;
        const cfg = this.rulesetConfig;
        switch (what) {
            /* ---------------- popup (§4) ---------------- */
            case 'popupPanelData': {
                const hostname = request.hostname as string;
                return {
                    hasOmnipotence: this.hasOmnipotence(),
                    level: lookupFilteringMode(this.modes, hostname),
                    autoReload: cfg.autoReload,
                    isSideloaded: this.init.isSideloaded,
                    developerMode: cfg.developerMode,
                    disabledFeatures: clone(this.disabledFeatures),
                    hasCustomFilters: this.hasCustomFilters(hostname),
                };
            }
            case 'setPendingFilteringMode':
                this.pendingPermissionRequest = request;
                return undefined;
            case 'setFilteringMode': {
                const hostname = request.hostname as string;
                const beforeLevel = lookupFilteringMode(this.modes, hostname);
                if (request.level === beforeLevel) return beforeLevel;
                return this.setFilteringMode(hostname, request.level);
            }
            case 'showMatchedRules':
                return undefined;
            case 'gotoURL': {
                const url = new URL(request.url as string, `${MOCK_EXTENSION_ORIGINS[this.deps.config.platform]}/`);
                return { id: 43, windowId: 1, active: true, url: url.href };
            }
            /* ---------------- settings (§5) ---------------- */
            case 'getOptionsPageData':
                return {
                    hasOmnipotence: this.hasOmnipotence(),
                    defaultFilteringMode: this.defaultFilteringMode(),
                    enabledRulesets: this.getEnabledRulesets(),
                    adminRulesets: [...this.adminRulesets],
                    maxNumberOfEnabledRulesets: this.init.maxNumberOfEnabledRulesets ?? undefined,
                    rulesetDetails: this.rulesetDetails(),
                    autoReload: cfg.autoReload,
                    showBlockedCount: cfg.showBlockedCount,
                    canShowBlockedCount: this.init.canShowBlockedCount,
                    strictBlockMode: cfg.strictBlockMode,
                    popupBlockMode: cfg.popupBlockMode,
                    firstRun: false,
                    isSideloaded: this.init.isSideloaded,
                    developerMode: cfg.developerMode,
                    disabledFeatures: clone(this.disabledFeatures),
                    supportsCompiledFilters: this.init.supportsCompiledFilters,
                    supportsUserScripts: this.init.supportsUserScripts,
                };
            case 'setDefaultFilteringMode':
                return this.setFilteringMode('all-urls', request.level);
            case 'setAutoReload':
                cfg.autoReload = Boolean(request.state); // `state && true || false` (bg:462)
                this.saveRulesetConfig();
                this.deps.broadcast({ autoReload: cfg.autoReload });
                return undefined;
            case 'setShowBlockedCount':
                cfg.showBlockedCount = Boolean(request.state); // (bg:468)
                this.saveRulesetConfig();
                this.deps.broadcast({ showBlockedCount: cfg.showBlockedCount });
                return undefined;
            case 'setStrictBlockMode':
                if (Boolean(request.state) !== Boolean(cfg.strictBlockMode)) {
                    cfg.strictBlockMode = Boolean(request.state);
                    this.saveRulesetConfig();
                    if (cfg.strictBlockMode === false) {
                        this.deps.local.delete('excludedStrictBlockHostnames');
                        this.deps.session.delete('excludedStrictBlockHostnames');
                    }
                }
                this.deps.broadcast({ strictBlockMode: cfg.strictBlockMode });
                return undefined;
            case 'setPopupBlockMode':
                // js/prevent-popup.js:66-67 compares Boolean(state) with the STORED value, which may be raw.
                if (Boolean(request.state) !== cfg.popupBlockMode) {
                    cfg.popupBlockMode = request.state; // the raw value (js/prevent-popup.js:70)
                    this.saveRulesetConfig();
                }
                this.deps.broadcast({ popupBlockMode: cfg.popupBlockMode });
                return undefined;
            case 'setDeveloperMode':
                cfg.developerMode = request.state === true;
                this.deps.broadcast({ developerMode: cfg.developerMode });
                this.saveRulesetConfig();
                return cfg.developerMode;
            /* ---------------- filter lists (§6) ---------------- */
            case 'getEnabledRulesets':
                return this.getEnabledRulesets();
            case 'getRulesetDetails':
                return this.rulesetDetails();
            case 'applyRulesets':
                this.applyRulesets(request.enabledRulesets);
                if (request.toRemove) this.removeImportedLists(request.toRemove);
                return undefined;
            case 'importFilterList': {
                const url = request.url as string;
                this.addImportedList(url);
                this.applyRulesets([...this.getEnabledRulesets(), url]);
                return undefined;
            }
            /* ---------------- backup / restore / reset (§7) ---------------- */
            case 'getDefaultConfig':
                return {
                    autoReload: true,
                    developerMode: false,
                    showBlockedCount: true,
                    strictBlockMode: false,
                    popupBlockMode: true,
                    rulesets: [...this.init.defaultRulesets],
                    filteringModes: clone(FACTORY_FILTERING_MODES),
                };
            case 'getCurrentConfig':
                return clone(cfg);
            case 'getFilteringModeDetails':
                return serializeModes(this.modes);
            case 'setFilteringModeDetails': {
                this.modes = fixModes(request.modes as Record<string, unknown>); // throws when `modes` is missing
                const data = serializeModes(this.modes);
                this.deps.local.write({ filteringModeDetails: data });
                this.deps.session.write({ filteringModeDetails: data });
                this.deps.broadcast({ defaultFilteringMode: this.defaultFilteringMode() });
                return serializeModes(this.modes);
            }
            case 'getAllCustomFilters':
                return this.allCustomFilters();
            case 'removeAllCustomFilters': {
                const hostname = request.hostname;
                const keys =
                    hostname === '*'
                        ? [...this.deps.local.data.keys()].filter((k) => k.startsWith('site.'))
                        : [`site.${String(hostname)}`];
                this.deps.local.delete(keys);
                return undefined;
            }
            case 'addManyCustomFilters': {
                // bg:588-597: destructures every entry, so a non-iterable `entries` or entry throws (no answer).
                // The accepted entries run concurrently (Promise.all): each one reads `site.<hostname>`
                // before any of them writes, so for a hostname listed twice the LAST entry's merge wins
                // and the earlier entry's new selectors are lost (js/filter-manager.js:247-260, 45-66).
                const before = new Map<string, unknown>();
                const accepted: Array<[string, string[]]> = [];
                for (const [hostname, selectors] of request.entries as Iterable<[unknown, unknown]>) {
                    if (typeof hostname !== 'string' || hostname === '') continue;
                    if (!Array.isArray(selectors) || selectors.length === 0) continue;
                    if (!before.has(hostname)) before.set(hostname, this.deps.local.read(`site.${hostname}`));
                    accepted.push([hostname, selectors as string[]]);
                }
                for (const [hostname, selectors] of accepted) this.addCustomFilters(hostname, selectors, { stored: before.get(hostname) });
                return undefined;
            }
            case 'getSandboxFilters':
                return this.deps.local.read('sandboxFilters');
            case 'setSandboxFilters': {
                const text = String(request.text ?? '').trim();
                if (text === '') this.deps.local.delete('sandboxFilters');
                else this.deps.local.write({ sandboxFilters: text });
                return undefined;
            }
            case 'updateUserDnrRules': {
                const removed = Number(this.deps.local.read('userDnrRuleCount') ?? 0);
                const text = cfg.developerMode ? this.deps.local.read('userDnrRules') : undefined;
                const added =
                    typeof text === 'string' && text.trim() !== ''
                        ? text.split(/^---\s*$/m).filter((block) => block.trim() !== '').length
                        : 0;
                if (added !== 0) this.deps.local.write({ userDnrRuleCount: added });
                else this.deps.local.delete('userDnrRuleCount');
                return { added, removed, errors: [] };
            }
            /* ---------------- about / troubleshooting (§8) ---------------- */
            case 'getDefaultFilteringMode':
                return this.defaultFilteringMode();
            case 'getEffectiveUserRules':
                return clone(this.init.effectiveUserRules);
            case 'getConsoleOutput':
                return [...this.init.consoleOutput];
            case 'getRegisteredContentScripts':
                return [...this.init.registeredContentScripts];
            case 'hasBroadHostPermissions':
                return this.hasOmnipotence();
            /* ---------------- class B (upstream-kept pages; §9) ---------------- */
            case 'getFilteringMode':
                return lookupFilteringMode(this.modes, request.hostname as string);
            case 'getImportedLists':
                return this.importedLists();
            case 'getEnabledRulesetsDetails': {
                const details = new Map(this.rulesetDetails().map((d) => [d.id, d]));
                return this.getEnabledRulesets()
                    .map((id) => details.get(id))
                    .filter((d) => d !== undefined);
            }
            case 'customFiltersFromHostname':
                return this.customFiltersFromHostname(request.hostname as string);
            case 'addCustomFilters':
                this.addCustomFilters(request.hostname as string, (request.selectors as string[]) ?? []);
                return undefined;
            case 'removeCustomFilters': {
                const selectors = new Set((request.selectors as string[]) ?? []);
                let hn = request.hostname as string;
                while (hn !== '') {
                    const stored = this.deps.local.read(`site.${hn}`);
                    if (Array.isArray(stored)) {
                        const kept = (stored as string[]).filter((s) => !selectors.has(s));
                        if (kept.length === 0) this.deps.local.delete(`site.${hn}`);
                        else if (kept.length !== stored.length) this.deps.local.write({ [`site.${hn}`]: kept });
                    }
                    const pos = hn.indexOf('.');
                    if (pos === -1) break;
                    hn = hn.slice(pos + 1);
                }
                return undefined;
            }
            case 'getRulesetRules':
                return this.rulesetDetails().some((d) => d.id === request.id) ? { rules: [] } : undefined;
            case 'getAllDynamicRules':
            case 'getAllSessionRules':
            case 'getMatchedRules':
                return [];
            case 'excludeFromStrictBlock':
                return {};
            /* ---------------- class C: content scripts / jobs (§10) ---------------- */
            case 'insertCSS':
            case 'removeCSS':
            case 'injectCSSProceduralAPI':
            case 'toggleToolbarIcon':
            case 'startCustomFilters':
            case 'terminateCustomFilters':
            case 'injectCustomFilters':
            case 'updateImportedLists':
            case 'pruneCSSCache':
            case 'keepAlive':
                console.warn(`[mock-ext] a page sent "${what}", a content-script/internal message the UI must never send`);
                return undefined;
            default:
                // Unknown `what`: falls through every switch and resolves undefined (bg:670-673).
                return undefined;
        }
    }

    /** js/filter-manager.js:247-260 (selectors are not type-checked there either). */
    private addCustomFilters(hostname: string, selectors: string[], snapshot?: { stored: unknown }): void {
        if (hostname === '') return;
        const key = `site.${hostname}`;
        const stored = snapshot !== undefined ? snapshot.stored : this.deps.local.read(key);
        const list = Array.isArray(stored) ? [...(stored as string[])] : [];
        const before = list.length;
        for (const s of selectors) {
            if (list.includes(s)) continue;
            list.push(s);
        }
        if (list.length !== before) this.deps.local.write({ [key]: list.sort() });
    }
}

/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

/** Accepts `de`, `pt-BR`, `pt_br`, `longest`; falls back to `en`. */
export function resolveLocale(lang: string | undefined): string {
    if (lang === undefined || lang === '') return 'en';
    if (lang === 'longest') return LONGEST_LOCALE;
    const wanted = lang.replace(/-/g, '_').toLowerCase();
    for (const folder of Object.keys(LOCALES)) if (folder.toLowerCase() === wanted) return folder;
    const primary = wanted.split('_')[0] ?? '';
    for (const folder of Object.keys(LOCALES)) if (folder.toLowerCase() === primary) return folder;
    console.warn(`[mock-ext] unknown locale "${lang}", using en`);
    return 'en';
}

function parseBool(value: string): boolean | undefined {
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off|none)$/i.test(value)) return false;
    return undefined;
}

function parseNumber(value: string): number | undefined {
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

function parseList(value: string): string[] {
    return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
}

const FAILURE_MODES: readonly string[] = ['reject', 'undefined', 'null', 'hang'];

/**
 * Query-string switches -> MockOptions. Unknown parameters are ignored.
 * The full table is in docs/mock-harness.md.
 */
export function parseMockOptions(search: string): MockOptions {
    const params = new URLSearchParams(search);
    const o: MockOptions = {};
    const bg: Partial<BackgroundInit> = {};
    const get = (name: string): string | undefined => params.get(name) ?? undefined;
    let v: string | undefined;

    if ((v = get('scenario')) !== undefined) o.scenario = parseList(v);
    if ((v = get('platform')) !== undefined) {
        if ((MOCK_PLATFORMS as readonly string[]).includes(v)) o.platform = v as MockPlatform;
        else console.warn(`[mock-ext] unknown platform "${v}" ignored`);
    }
    if ((v = get('lang')) !== undefined) o.lang = v;
    if ((v = get('ui_locale') ?? get('uiLocale')) !== undefined) o.uiLocale = v;
    if ((v = get('dir')) === 'rtl' || v === 'ltr') o.dir = v;
    if ((v = get('theme')) === 'dark' || v === 'light') o.theme = v;
    if ((v = get('perm') ?? get('permission')) !== undefined) {
        const map: Record<string, PermissionMode> = { grant: 'grant', allow: 'grant', deny: 'deny', reject: 'reject', throw: 'reject', hang: 'hang' };
        const mode = map[v.toLowerCase()];
        if (mode !== undefined) o.permission = mode;
    }
    if ((v = get('permDelay')) !== undefined) o.permissionDelay = parseNumber(v);
    if ((v = get('gesture')) !== undefined) o.requireGesture = v === 'strict' || parseBool(v) === true;
    if ((v = get('tab')) !== undefined && parseBool(v) === false) o.tab = null;
    if ((v = get('url')) !== undefined) o.tabUrl = v === 'none' ? null : v;
    if ((v = get('tabId')) !== undefined) o.tabId = parseNumber(v);
    if ((v = get('scripting')) !== undefined) o.scripting = parseBool(v);
    if ((v = get('getKeys')) !== undefined) o.storageGetKeys = parseBool(v);
    if ((v = get('confirm')) !== undefined) o.confirm = parseBool(v);
    if ((v = get('echo')) !== undefined) o.echo = parseBool(v);
    if ((v = get('delay')) !== undefined) o.delay = parseNumber(v);
    if ((v = get('fail')) !== undefined) {
        const failures: Record<string, FailureMode> = {};
        for (const item of parseList(v)) {
            const [name, mode = 'reject'] = item.split(':');
            if (name !== undefined && FAILURE_MODES.includes(mode)) failures[name === 'all' ? '*' : name] = mode as FailureMode;
        }
        o.failures = failures;
    }
    if ((v = get('nullAs')) === 'null' || v === 'undefined') o.nullishAs = v;
    if ((v = get('manifestName')) === 'raw' || v === 'localized') o.manifestName = v;
    if ((v = get('dnrError')) !== undefined) o.dnrError = parseBool(v);
    if ((v = get('level')) !== undefined) o.level = parseNumber(v);
    if ((v = get('default')) !== undefined) o.defaultLevel = parseNumber(v);
    if ((v = get('customFilters')) !== undefined) o.customFilterCount = parseNumber(v);
    if ((v = get('dev')) !== undefined) bg.developerMode = parseBool(v);
    if ((v = get('autoReload')) !== undefined) bg.autoReload = parseBool(v);
    if ((v = get('sideloaded')) !== undefined) bg.isSideloaded = parseBool(v);
    if ((v = get('compiled')) !== undefined) bg.supportsCompiledFilters = parseBool(v);
    if ((v = get('userScripts')) !== undefined) bg.supportsUserScripts = parseBool(v);
    if ((v = get('omni')) !== undefined) bg.grantedOrigins = parseBool(v) ? ['<all_urls>'] : [];
    if ((v = get('max')) !== undefined) bg.maxNumberOfEnabledRulesets = v === 'none' ? null : (parseNumber(v) ?? null);
    if ((v = get('disabled')) !== undefined) {
        if (v === 'null') bg.disabledFeatures = null;
        else if (v !== 'none') bg.disabledFeatures = parseList(v);
    }
    if ((v = get('admin')) !== undefined) bg.adminRulesets = parseList(v);
    if ((v = get('enabled')) !== undefined) bg.enabledRulesets = parseList(v);
    for (const key of Object.keys(bg) as Array<keyof BackgroundInit>) if (bg[key] === undefined) delete bg[key];
    if (Object.keys(bg).length !== 0) o.background = bg;

    if ((v = get('mock')) !== undefined) {
        try {
            const extra: unknown = JSON.parse(v);
            if (isRecord(extra)) return mergeOptions(o, extra as MockOptions);
        } catch (err) {
            console.warn('[mock-ext] ?mock= is not valid JSON', err);
        }
    }
    for (const key of Object.keys(o) as Array<keyof MockOptions>) if (o[key] === undefined) delete o[key];
    return o;
}

/** Later options win; `background`, `delays`, `failures`, `responses`, `storage` merge key by key. */
export function mergeOptions(...list: Array<MockOptions | undefined>): MockOptions {
    const out: MockOptions = {};
    for (const o of list) {
        if (o === undefined) continue;
        for (const [key, value] of Object.entries(o) as Array<[keyof MockOptions, unknown]>) {
            if (value === undefined) continue;
            if (key === 'background' || key === 'delays' || key === 'failures' || key === 'responses') {
                (out as Record<string, unknown>)[key] = { ...((out[key] as object | undefined) ?? {}), ...(value as object) };
            } else if (key === 'storage') {
                const s = value as NonNullable<MockOptions['storage']>;
                out.storage = {
                    local: { ...(out.storage?.local ?? {}), ...(s.local ?? {}) },
                    session: { ...(out.storage?.session ?? {}), ...(s.session ?? {}) },
                };
            } else {
                (out as Record<string, unknown>)[key] = value;
            }
        }
    }
    return out;
}

/** Defaults -> scenario presets (in order) -> options. */
export function resolveMockConfig(options: MockOptions = {}): MockConfig {
    const scenarioList = (Array.isArray(options.scenario) ? options.scenario : parseList(options.scenario ?? 'default')).filter(
        (name): name is ScenarioName => {
            const ok = (SCENARIO_NAMES as readonly string[]).includes(name);
            if (!ok) console.warn(`[mock-ext] unknown scenario "${name}" ignored`);
            return ok;
        },
    );
    const scenarios: ScenarioName[] = scenarioList.length === 0 ? ['default'] : scenarioList;

    const platform: MockPlatform =
        options.platform !== undefined && MOCK_PLATFORMS.includes(options.platform) ? options.platform : 'safari';
    const cfg: MockConfig = {
        scenarios,
        platform,
        lang: 'en',
        uiLocale: 'en',
        dir: null,
        theme: null,
        permission: 'grant',
        permissionDelay: 0,
        requireGesture: false,
        tab: { ...DEFAULT_TAB },
        scripting: true,
        storageGetKeys: true,
        confirm: true,
        echo: true,
        delay: 0,
        delays: {},
        failures: {},
        responses: {},
        nullishAs: 'undefined',
        manifestName: 'localized',
        dnrError: false,
        background: { ...defaultBackgroundInit(), ...clone(PLATFORM_DEFAULTS[platform]) },
        storage: {
            // Normally present: every content-script registration schedules this job (messaging.md §7.2, §21 line 31).
            local: { deferredJobs: [{ name: 'pruneCSSCache', time: Date.now() + 3_600_000 }] },
            session: {},
        },
    };

    for (const name of scenarios) {
        const patch = SCENARIOS[name];
        if (patch.background) Object.assign(cfg.background, clone(patch.background));
        if (patch.tabUrl !== undefined && cfg.tab) cfg.tab.url = patch.tabUrl;
        if (patch.delay !== undefined) cfg.delay = patch.delay;
        if (patch.permissionDelay !== undefined) cfg.permissionDelay = patch.permissionDelay;
        if (patch.failures) Object.assign(cfg.failures, patch.failures);
    }

    const o = options;
    if (o.lang !== undefined) cfg.lang = resolveLocale(o.lang);
    if (o.dir !== undefined) cfg.dir = o.dir;
    if (o.uiLocale !== undefined) cfg.uiLocale = o.uiLocale;
    else {
        const primary = cfg.lang.split('_')[0] ?? 'en';
        // `?dir=rtl` with a left-to-right language: report an RTL UI locale so the app's
        // real direction logic (i18n.md §2.2) turns RTL while the strings stay in `lang`.
        cfg.uiLocale = cfg.dir === 'rtl' && !RTL_LANGUAGES.includes(primary) ? 'ar' : cfg.lang;
    }
    if (o.theme !== undefined) cfg.theme = o.theme;
    if (o.permission !== undefined) cfg.permission = o.permission;
    if (o.permissionDelay !== undefined) cfg.permissionDelay = o.permissionDelay;
    if (o.requireGesture !== undefined) cfg.requireGesture = o.requireGesture;
    if (o.tab !== undefined) cfg.tab = o.tab === null ? null : { ...o.tab };
    if (o.tabUrl !== undefined && cfg.tab) {
        if (o.tabUrl === null) delete cfg.tab.url;
        else cfg.tab.url = o.tabUrl;
    }
    if (o.tabId !== undefined && cfg.tab) cfg.tab.id = o.tabId;
    if (o.scripting !== undefined) cfg.scripting = o.scripting;
    if (o.storageGetKeys !== undefined) cfg.storageGetKeys = o.storageGetKeys;
    if (o.confirm !== undefined) cfg.confirm = o.confirm;
    if (o.echo !== undefined) cfg.echo = o.echo;
    if (o.delay !== undefined) cfg.delay = o.delay;
    if (o.delays) Object.assign(cfg.delays, o.delays);
    if (o.failures) Object.assign(cfg.failures, o.failures);
    if (o.responses) Object.assign(cfg.responses, clone(o.responses));
    if (o.nullishAs !== undefined) cfg.nullishAs = o.nullishAs;
    if (o.manifestName !== undefined) cfg.manifestName = o.manifestName;
    if (o.dnrError !== undefined) cfg.dnrError = o.dnrError;
    if (o.background) Object.assign(cfg.background, clone(o.background));
    if (o.storage?.local) Object.assign(cfg.storage.local, clone(o.storage.local));
    if (o.storage?.session) Object.assign(cfg.storage.session, clone(o.storage.session));

    // Derived switches that edit the initial background state.
    const tabHostname = hostnameOfTab(cfg.tab);
    if (o.defaultLevel !== undefined || o.level !== undefined) {
        const modes = unserializeModes(cfg.background.filteringModes as unknown as Record<string, unknown>);
        if (o.defaultLevel !== undefined) applyFilteringMode(modes, 'all-urls', o.defaultLevel);
        if (o.level !== undefined && tabHostname !== '') applyFilteringMode(modes, tabHostname, o.level);
        cfg.background.filteringModes = serializeModes(modes);
    }
    if (o.customFilterCount !== undefined && tabHostname !== '') {
        const selectors = Array.from({ length: o.customFilterCount }, (_, i) => `.mock-ad-${i + 1}`);
        cfg.background.customFilters = [
            ...cfg.background.customFilters.filter(([hn]) => hn !== tabHostname),
            ...(selectors.length !== 0 ? [[tabHostname, selectors] as [string, string[]]] : []),
        ];
    }
    return cfg;
}

function hostnameOfTab(tab: MockTab | null): string {
    try {
        const url = new URL(String(tab?.url));
        return /^https?:$/.test(url.protocol) ? url.hostname : '';
    } catch {
        return '';
    }
}

/* ========================================================================== */
/* The browser object                                                         */
/* ========================================================================== */

export interface MockControl {
    /** Resolved configuration (treat as read-only; use the setters below). */
    readonly config: MockConfig;
    /** The recorder array (same object as window.__blockerCalls). */
    readonly calls: MockCall[];
    /** Every message the mock background posted on BroadcastChannel('uBOL'), in order. */
    readonly broadcasts: Array<{ message: unknown; t: number }>;
    readonly background: MockBackground;
    /** Serialisable snapshot of the background state and both storage areas. */
    state(): Record<string, unknown>;
    /** Post a message on BroadcastChannel('uBOL') as the background would (ignores `echo`). */
    broadcast(message: Record<string, unknown>): void;
    clearCalls(): void;
    setFailure(what: string, mode: FailureMode | null): void;
    setDelay(what: string, ms: number | null): void;
    setResponse(what: string, value: unknown): void;
    clearResponse(what: string): void;
    setPermission(mode: PermissionMode): void;
    setConfirm(value: boolean): void;
    setEcho(on: boolean): void;
    /** Was window.close()/self.close() called (install-mock.ts patches it)? */
    closed: boolean;
}

export interface MockExt {
    browser: Record<string, unknown>;
    control: MockControl;
    /** Records a call (used by install-mock.ts for window.close, confirm, BroadcastChannel). */
    record: (api: string, args: unknown[]) => void;
}

export interface CreateMockOptions {
    /** Array that receives the records (default: a new one). */
    calls?: MockCall[];
    /** Constructor used by the background to post echoes (default: globalThis.BroadcastChannel). */
    BroadcastChannel?: typeof BroadcastChannel;
}

/** Builds the browser API object and its control interface. Pure: touches no global. */
export function createMockExt(config: MockConfig, opts: CreateMockOptions = {}): MockExt {
    const calls = opts.calls ?? [];
    const record = (api: string, args: unknown[]): void => {
        calls.push({ api, args: snapshot(args) as unknown[], t: now() });
    };

    const broadcasts: Array<{ message: unknown; t: number }> = [];
    const BC = opts.BroadcastChannel ?? (typeof BroadcastChannel === 'function' ? BroadcastChannel : undefined);
    let channel: BroadcastChannel | undefined;
    const post = (message: Record<string, unknown>): void => {
        broadcasts.push({ message: snapshot(message), t: now() });
        if (BC === undefined) return;
        // Like js/utils.js:133-136: one channel, never closed.
        channel ??= new BC('uBOL');
        channel.postMessage(message);
    };

    const storageOnChanged = new MockEvent<ChangeListener>('storage.onChanged', record);
    const local = new MemoryArea('local', record, storageOnChanged, config.storage.local);
    const session = new MemoryArea('session', record, storageOnChanged, config.storage.session);
    const sync = new MemoryArea('sync', record, storageOnChanged);

    const background = new MockBackground(config.background, {
        local,
        session,
        config,
        broadcast: (message) => {
            if (config.echo) post(message);
        },
    });

    const messages: LocaleMessages = LOCALES[config.lang] ?? LOCALES.en ?? {};
    const uiLocalePrimary = (config.uiLocale.split(/[-_]/)[0] ?? '').toLowerCase();
    const rtl = RTL_LANGUAGES.includes(uiLocalePrimary);

    const getMessage = (key: string, substitutions?: unknown): string => {
        record('i18n.getMessage', substitutions === undefined ? [key] : [key, substitutions]);
        switch (key) {
            case '@@ui_locale':
                return config.uiLocale;
            case '@@extension_id':
                return MOCK_EXTENSION_HOST;
            case '@@bidi_dir':
                return rtl ? 'rtl' : 'ltr';
            case '@@bidi_reversed_dir':
                return rtl ? 'ltr' : 'rtl';
            case '@@bidi_start_edge':
                return rtl ? 'right' : 'left';
            case '@@bidi_end_edge':
                return rtl ? 'left' : 'right';
        }
        const entry = messages[key];
        if (entry === undefined) return '';
        let text = entry.message;
        const subs = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
        subs.forEach((s, i) => {
            text = text.split(`$${i + 1}`).join(String(s));
        });
        return text;
    };

    /* ---- runtime.sendMessage ---- */

    const dispatch = async (msg: unknown): Promise<unknown> => {
        let request: unknown;
        try {
            request = throughWire(msg);
        } catch (err) {
            throw new Error(`Error in invocation of runtime.sendMessage: ${String(err)}`);
        }
        const what = isRecord(request) && typeof request.what === 'string' ? request.what : undefined;
        const failure = (what !== undefined ? config.failures[what] : undefined) ?? config.failures['*'];
        const delay = (what !== undefined ? config.delays[what] : undefined) ?? config.delay;
        if (delay > 0) await sleep(delay);
        if (failure === 'hang') return never();
        if (failure === 'reject') throw new Error(NO_RECEIVER_ERROR);
        if (failure === 'undefined') return undefined;
        if (failure === 'null') return null;
        let result: unknown;
        if (what !== undefined && Object.prototype.hasOwnProperty.call(config.responses, what)) {
            result = clone(config.responses[what]);
        } else {
            try {
                result = background.handle(request);
            } catch (err) {
                // The real dispatcher never calls back (bg:859); Chrome then rejects the sender.
                console.warn(`[mock-ext] background handler for "${what ?? '?'}" threw:`, err);
                throw new Error(HANDLER_THREW_ERROR);
            }
        }
        const wired = throughWire(result);
        return wired === undefined && config.nullishAs === 'null' ? null : wired;
    };

    /* ---- permissions ---- */

    const permissionsOnAdded = new MockEvent<(p: { origins: string[]; permissions: string[] }) => void>('permissions.onAdded', record);
    const permissionsOnRemoved = new MockEvent<(p: { origins: string[]; permissions: string[] }) => void>('permissions.onRemoved', record);

    const grant = (origins: string[]): void => {
        const added = origins.filter((o) => !background.origins.has(o));
        for (const o of added) background.origins.add(o);
        if (added.length === 0) return;
        setTimeout(() => {
            background.onPermissionsAdded(added);
            permissionsOnAdded.dispatch({ origins: added, permissions: [] });
        }, 0);
    };

    const permissionsRequest = (perms: unknown): Promise<boolean> => {
        record('permissions.request', [perms]);
        const origins = isRecord(perms) && Array.isArray(perms.origins) ? (perms.origins as unknown[]) : [];
        const invalid = origins.find((o) => !isValidMatchPattern(o));
        if (invalid !== undefined) return Promise.reject(new Error(`Invalid value for origin pattern ${String(invalid)}: Invalid host wildcard.`));
        if (config.requireGesture && typeof navigator !== 'undefined' && navigator.userActivation?.isActive !== true) {
            return Promise.reject(new Error('This function must be called during a user gesture'));
        }
        const mode = config.permission;
        const answer = async (): Promise<boolean> => {
            if (config.permissionDelay > 0) await sleep(config.permissionDelay);
            if (mode === 'hang') return never();
            if (mode === 'reject') throw new Error('Mock: permissions.request failed (perm=reject).');
            if (mode === 'deny') return false;
            grant(origins as string[]);
            return true;
        };
        return answer();
    };

    const covered = (origin: string): boolean => background.hasOmnipotence() || background.origins.has(origin);

    /* ---- tabs ---- */

    const currentTab = (): MockTab | null => (config.tab === null ? null : clone(config.tab));

    /* ---- assemble ---- */

    const manifest = (): Record<string, unknown> => {
        const m = clone(MANIFEST) as Record<string, unknown>;
        if (config.manifestName === 'localized') {
            for (const key of ['name', 'short_name', 'description']) {
                const value = m[key];
                if (typeof value === 'string') {
                    m[key] = value.replace(/__MSG_(\w+)__/g, (_, k: string) => messages[k]?.message ?? (LOCALES.en?.[k]?.message ?? ''));
                }
            }
        }
        return m;
    };

    const runtime = {
        id: MOCK_EXTENSION_ID,
        lastError: undefined,
        getURL: (path: string): string => {
            record('runtime.getURL', [path]);
            return `${MOCK_EXTENSION_ORIGINS[config.platform]}/${String(path ?? '').replace(/^\/+/, '')}`;
        },
        getManifest: (): Record<string, unknown> => {
            record('runtime.getManifest', []);
            return manifest();
        },
        getPlatformInfo: (): Promise<{ os: string; arch: string; nacl_arch: string }> => {
            record('runtime.getPlatformInfo', []);
            return Promise.resolve({ os: config.background.platformOs, arch: 'arm64', nacl_arch: 'arm' });
        },
        openOptionsPage: (): Promise<void> => {
            record('runtime.openOptionsPage', []);
            return Promise.resolve();
        },
        sendMessage: (...args: unknown[]): Promise<unknown> => {
            record('runtime.sendMessage', args);
            const msg = args.length > 1 && typeof args[0] === 'string' ? args[1] : args[0];
            return dispatch(msg);
        },
        connect: (...args: unknown[]): unknown => {
            record('runtime.connect', args);
            const noop = { addListener() {}, removeListener() {}, hasListener: () => false };
            return { name: '', postMessage() {}, disconnect() {}, onMessage: noop, onDisconnect: noop };
        },
        sendNativeMessage: (...args: unknown[]): Promise<never> => {
            record('runtime.sendNativeMessage', args);
            return Promise.reject(new Error('Mock: no native messaging host.'));
        },
        reload: (): void => {
            record('runtime.reload', []);
        },
        onMessage: new MockEvent('runtime.onMessage', record),
        onInstalled: new MockEvent('runtime.onInstalled', record),
    };

    const tabs = {
        query: (queryInfo: unknown): Promise<MockTab[]> => {
            record('tabs.query', [queryInfo]);
            const tab = currentTab();
            const q = isRecord(queryInfo) ? queryInfo : {};
            const wantsActive = q.active === true || q.currentWindow === true || q.lastFocusedWindow === true;
            return Promise.resolve(tab !== null && wantsActive ? [tab] : []);
        },
        get: (tabId: number): Promise<MockTab> => {
            record('tabs.get', [tabId]);
            const tab = currentTab();
            return tab !== null && tab.id === tabId ? Promise.resolve(tab) : Promise.reject(new Error(`No tab with id: ${tabId}.`));
        },
        reload: (...args: unknown[]): Promise<void> => {
            record('tabs.reload', args);
            return Promise.resolve();
        },
        update: (...args: unknown[]): Promise<MockTab> => {
            record('tabs.update', args);
            const props = args.find(isRecord) ?? {};
            return Promise.resolve({ ...(currentTab() ?? {}), ...props });
        },
        create: (props: unknown): Promise<MockTab> => {
            record('tabs.create', [props]);
            return Promise.resolve({ id: 44, ...(isRecord(props) ? props : {}) });
        },
    };

    const scripting = {
        executeScript: (injection: unknown): Promise<Array<{ frameId: number; result: unknown }>> => {
            record('scripting.executeScript', [injection]);
            return Promise.resolve([{ frameId: 0, result: undefined }]);
        },
        insertCSS: (injection: unknown): Promise<void> => {
            record('scripting.insertCSS', [injection]);
            return Promise.resolve();
        },
        removeCSS: (injection: unknown): Promise<void> => {
            record('scripting.removeCSS', [injection]);
            return Promise.resolve();
        },
    };

    const permissions = {
        request: permissionsRequest,
        contains: (perms: unknown): Promise<boolean> => {
            record('permissions.contains', [perms]);
            const p = isRecord(perms) ? perms : {};
            const origins = Array.isArray(p.origins) ? (p.origins as string[]) : [];
            const apis = Array.isArray(p.permissions) ? (p.permissions as string[]) : [];
            const granted = new Set(MANIFEST.permissions ?? []);
            return Promise.resolve(origins.every(covered) && apis.every((a) => granted.has(a)));
        },
        getAll: (): Promise<{ origins: string[]; permissions: string[] }> => {
            record('permissions.getAll', []);
            return Promise.resolve({ origins: [...background.origins], permissions: [...(MANIFEST.permissions ?? [])] });
        },
        remove: (perms: unknown): Promise<boolean> => {
            record('permissions.remove', [perms]);
            const origins = isRecord(perms) && Array.isArray(perms.origins) ? (perms.origins as string[]) : [];
            const removed = origins.filter((o) => background.origins.delete(o));
            if (removed.length !== 0) {
                setTimeout(() => {
                    background.syncWithBrowserPermissions();
                    permissionsOnRemoved.dispatch({ origins: removed, permissions: [] });
                }, 0);
            }
            return Promise.resolve(removed.length !== 0);
        },
        onAdded: permissionsOnAdded,
        onRemoved: permissionsOnRemoved,
    };

    const localApi: Record<string, unknown> = {
        get: local.get,
        set: local.set,
        remove: local.remove,
        clear: local.clear,
        onChanged: local.onChanged,
    };
    if (config.storageGetKeys) localApi.getKeys = local.getKeys;

    const areaApi = (area: MemoryArea): Record<string, unknown> => ({
        get: area.get,
        set: area.set,
        remove: area.remove,
        clear: area.clear,
        getKeys: area.getKeys,
        onChanged: area.onChanged,
    });

    const storage = {
        local: localApi,
        session: areaApi(session),
        sync: areaApi(sync),
        onChanged: storageOnChanged,
        // `storage.managed` is deliberately absent (messaging.md U7: unknown on Safari).
    };

    const alarms = {
        create: (...args: unknown[]): Promise<void> => {
            record('alarms.create', args);
            return Promise.resolve();
        },
        clear: (name?: string): Promise<boolean> => {
            record('alarms.clear', name === undefined ? [] : [name]);
            return Promise.resolve(true);
        },
        get: (name?: string): Promise<undefined> => {
            record('alarms.get', name === undefined ? [] : [name]);
            return Promise.resolve(undefined);
        },
        getAll: (): Promise<never[]> => {
            record('alarms.getAll', []);
            return Promise.resolve([]);
        },
        onAlarm: new MockEvent('alarms.onAlarm', record),
    };

    const i18n = {
        getMessage,
        getUILanguage: (): string => {
            record('i18n.getUILanguage', []);
            return config.uiLocale.replace(/_/g, '-');
        },
        getAcceptLanguages: (): Promise<string[]> => {
            record('i18n.getAcceptLanguages', []);
            return Promise.resolve([config.uiLocale.replace(/_/g, '-')]);
        },
    };

    const action = {
        getBadgeText: (details: unknown): Promise<string> => {
            record('action.getBadgeText', [details]);
            return Promise.resolve('');
        },
    };

    const browser: Record<string, unknown> = { runtime, tabs, permissions, storage, alarms, i18n, action };
    if (config.scripting) browser.scripting = scripting;

    const control: MockControl = {
        config,
        calls,
        broadcasts,
        background,
        closed: false,
        state: () => ({
            background: background.snapshot(),
            storage: { local: local.dump(), session: session.dump() },
        }),
        broadcast: (message) => post(message),
        clearCalls: () => {
            calls.length = 0;
        },
        setFailure: (what, mode) => {
            if (mode === null) delete config.failures[what];
            else config.failures[what] = mode;
        },
        setDelay: (what, ms) => {
            if (what === '*') config.delay = ms ?? 0;
            else if (ms === null) delete config.delays[what];
            else config.delays[what] = ms;
        },
        setResponse: (what, value) => {
            config.responses[what] = clone(value);
        },
        clearResponse: (what) => {
            delete config.responses[what];
        },
        setPermission: (mode) => {
            config.permission = mode;
        },
        setConfirm: (value) => {
            config.confirm = value;
        },
        setEcho: (on) => {
            config.echo = on;
        },
    };

    return { browser, control, record };
}

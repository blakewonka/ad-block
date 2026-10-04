/**
 * Initial state of the mock background, and the exact responses it produces
 * for it. Harness and tests only.
 *
 * Sources (docs/specs/):
 *   - messaging.md §21 "Fixture F": active tab { id: 42, url: 'https://www.example.com/path?x=1' };
 *     popupPanelData level 1, autoReload true, isSideloaded true, developerMode false,
 *     hasCustomFilters 0; getOptionsPageData with defaultFilteringMode 2, enabledRulesets
 *     ['ublock-filters','easylist','easyprivacy'], adminRulesets [], the 51 PRISTINE
 *     rulesetDetails, the five toggles at their §3.5 defaults (strictBlockMode false on Safari),
 *     canShowBlockedCount true, supportsCompiledFilters false, supportsUserScripts false,
 *     disabledFeatures absent; getDefaultConfig as quoted there; permissions.request -> true.
 *   - settings.md §2.2 fixture: hasOmnipotence true ("all websites allowed"),
 *     maxNumberOfEnabledRulesets 50 (a placeholder: the Safari value is UNKNOWN, U4), firstRun false.
 *   - messaging.md §3.3 (mode table), §3.5 (rulesetConfig defaults), §4.1 (popupPanelData, 7 fields),
 *     §5.1 (getOptionsPageData, 17 fields), §7.1 (getDefaultConfig), §8.2 (troubleshooting reads),
 *     §17 items 2, 3, 8, 9 (Safari: no compiled filters, no user scripts, empty console, sideloaded).
 *
 * How fixture F's popup level 1 and default 2 coexist: the mode table holds
 * `www.example.com` in `basic` while `all-urls` is in `optimal`
 * (lookup order of messaging.md §3.2). popupPanelData's `hasOmnipotence` is
 * `true` here (F says false, settings.md §2.2 says true); the popup never reads
 * it (messaging.md §4.1), so one consistent state serves both pages.
 */
import { RULESET_DETAILS } from './index';

export type FilteringLevel = 0 | 1 | 2 | 3;

export interface ModeTable {
    none: string[];
    basic: string[];
    optimal: string[];
    complete: string[];
}

export interface ImportedListEntry {
    id: string;
    name: string;
    group: 'imported';
    enabled: boolean;
    homeURL: string;
    expires: number;
    time: { added: number; updated: number };
    filters: { total: number; accepted: number; rejected: number };
    rules: { total: number; plain: number; regex: number };
}

/** Everything the mock background starts from. JSON-serialisable on purpose (it can come from `?mock=`). */
export interface BackgroundInit {
    /** Host-permission match patterns currently granted (`<all_urls>` => hasOmnipotence). */
    grantedOrigins: string[];
    /** Serialised mode table (messaging.md §3.3). */
    filteringModes: ModeTable;
    /** Ids enabled now: stock ids (DNR) and imported-list URLs (§6.1). */
    enabledRulesets: string[];
    /** Stock ids enabled by default + env matches (getDefaultConfig.rulesets, §7.1). */
    defaultRulesets: string[];
    /** "+id" / "-id" admin tokens (§3.6). */
    adminRulesets: string[];
    /** Admin feature tokens; `null` reproduces the upstream INIT-THREW hazard (popup.md §8.4). Omit = absent. */
    disabledFeatures?: string[] | null;
    /** `null` = the browser exposes no value (U4): the limit never applies. */
    maxNumberOfEnabledRulesets: number | null;
    autoReload: boolean;
    showBlockedCount: boolean;
    canShowBlockedCount: boolean;
    strictBlockMode: boolean;
    popupBlockMode: boolean;
    developerMode: boolean;
    isSideloaded: boolean;
    supportsCompiledFilters: boolean;
    supportsUserScripts: boolean;
    /** Custom cosmetic filters, one pair per local key `site.<hostname>` (§7.1). */
    customFilters: Array<[string, string[]]>;
    /** Local `sandboxFilters` text; omit = key absent (getSandboxFilters answers undefined). */
    sandboxFilters?: string;
    /** Local `rulesets.imported` (§6.4); normally empty on Safari. */
    importedLists: ImportedListEntry[];
    /** getConsoleOutput (always [] on Safari, §17 item 8). */
    consoleOutput: string[];
    /** getRegisteredContentScripts. */
    registeredContentScripts: string[];
    /** getEffectiveUserRules. */
    effectiveUserRules: Array<Record<string, unknown>>;
    /** runtime.getPlatformInfo().os (U18: Safari's value is UNKNOWN). */
    platformOs: string;
}

/** Factory mode table (messaging.md §3.3, js/mode-manager.js:58-63). */
export const FACTORY_FILTERING_MODES: ModeTable = { none: [], basic: [], optimal: ['all-urls'], complete: [] };

/** Default-enabled stock ids of PRISTINE (`enabled: true` in ruleset-details.json, §3.4). */
export const DEFAULT_RULESET_IDS: readonly string[] = RULESET_DETAILS.filter((r) => r.enabled).map((r) => r.id);

/** The fake active tab of fixture F (messaging.md §21). */
export const DEFAULT_TAB = {
    id: 42,
    windowId: 1,
    index: 0,
    active: true,
    highlighted: true,
    pinned: false,
    incognito: false,
    status: 'complete',
    title: 'Example Domain',
    url: 'https://www.example.com/path?x=1',
} as const;

/** Background state of the `default` scenario = fixture F. */
export function defaultBackgroundInit(): BackgroundInit {
    return {
        grantedOrigins: ['<all_urls>'],
        filteringModes: { none: [], basic: ['www.example.com'], optimal: ['all-urls'], complete: [] },
        enabledRulesets: [...DEFAULT_RULESET_IDS],
        defaultRulesets: [...DEFAULT_RULESET_IDS],
        adminRulesets: [],
        maxNumberOfEnabledRulesets: 50,
        autoReload: true,
        showBlockedCount: true,
        canShowBlockedCount: true,
        strictBlockMode: false,
        popupBlockMode: true,
        developerMode: false,
        isSideloaded: true,
        supportsCompiledFilters: false,
        supportsUserScripts: false,
        customFilters: [],
        importedLists: [],
        consoleOutput: [],
        registeredContentScripts: [],
        effectiveUserRules: [],
        platformOs: 'mac',
    };
}

/**
 * Exact responses the mock gives in the `default` scenario before any change.
 * mock-ext.test.ts asserts the mock's computed answers deep-equal these.
 */
export const EXPECTED_DEFAULT_RESPONSES = {
    /** messaging.md §4.1 / §21 fixture F (hasOmnipotence: see the header note). */
    popupPanelData: {
        hasOmnipotence: true,
        level: 1,
        autoReload: true,
        isSideloaded: true,
        developerMode: false,
        hasCustomFilters: 0,
    },
    /** messaging.md §5.1, settings.md §2.2. `rulesetDetails` = the 51 PRISTINE entries (not repeated here). */
    getOptionsPageDataWithoutDetails: {
        hasOmnipotence: true,
        defaultFilteringMode: 2,
        enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
        adminRulesets: [],
        maxNumberOfEnabledRulesets: 50,
        autoReload: true,
        showBlockedCount: true,
        canShowBlockedCount: true,
        strictBlockMode: false,
        popupBlockMode: true,
        firstRun: false,
        isSideloaded: true,
        developerMode: false,
        supportsCompiledFilters: false,
        supportsUserScripts: false,
    },
    /** messaging.md §7.1, §21 fixture F. */
    getDefaultConfig: {
        autoReload: true,
        developerMode: false,
        showBlockedCount: true,
        strictBlockMode: false,
        popupBlockMode: true,
        rulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
        filteringModes: { none: [], basic: [], optimal: ['all-urls'], complete: [] },
    },
    /** messaging.md §3.5 (rulesetConfig) as returned by getCurrentConfig, §21 line 35. */
    getCurrentConfig: {
        version: '2026.1003.1243',
        enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
        autoReload: true,
        showBlockedCount: true,
        strictBlockMode: false,
        popupBlockMode: true,
        developerMode: false,
        hasBroadHostPermissions: true,
        /** Added by the background's startSession (bg:753-756); `false` on Safari once settled. */
        userScripts: false,
    },
    getFilteringModeDetails: { none: [], basic: ['www.example.com'], optimal: ['all-urls'], complete: [] },
    getDefaultFilteringMode: 2,
    hasBroadHostPermissions: true,
    getEffectiveUserRules: [],
    getConsoleOutput: [],
    getRegisteredContentScripts: [],
    getAllCustomFilters: [],
} as const;

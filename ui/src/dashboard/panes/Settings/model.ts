/**
 * Pure functions of the Settings pane (docs/specs/settings.md §13). No DOM, no
 * browser API, no React.
 *
 * The backup/restore helpers are ports of upstream js/backup-restore.js:36-215.
 * They deliberately keep upstream's JavaScript semantics on malformed input:
 * a backup file is untrusted JSON, and settings.md §7.3 (malformed-field table)
 * requires the SAME message prefix as upstream before a failure. So the
 * functions below perform the very same operations on the raw values (`for…of`,
 * `.slice`, `.startsWith`, `.join`, `.length`) and throw where upstream throws.
 * That is why some parameters are typed `any`: narrowing them would change
 * where (and whether) the sequence stops.
 */
import type {
    FilteringLevel,
    GetDefaultConfigResponse,
    GetOptionsPageDataResponse,
} from '@/lib/bridge';

/* ------------------------------------------------------------------------ */
/* Store / rendering                                                          */
/* ------------------------------------------------------------------------ */

/** The page store (`self.cachedRulesetData` upstream): the getOptionsPageData answer, updated by broadcasts. */
export type OptionsData = GetOptionsPageDataResponse;

/** Levels the Settings pane offers, in display order (settings.md §3.1). Level 0 is never offered. */
export const SETTINGS_LEVELS: readonly FilteringLevel[] = [1, 2, 3];

/** §13 #1: the selected option, or `null` (no option selected) for level 0 or anything unexpected. */
export function selectedLevel(defaultFilteringMode: unknown): 1 | 2 | 3 | null {
    return defaultFilteringMode === 1 || defaultFilteringMode === 2 || defaultFilteringMode === 3
        ? defaultFilteringMode
        : null;
}

export type Platform = 'safari' | 'other';

export interface ControlState {
    shown: boolean;
    enabled: boolean;
    checked: boolean;
}

export type ToggleKey = 'autoReload' | 'showBlockedCount' | 'strictBlockMode' | 'popupBlockMode' | 'developerMode';

/** Toggle order (settings.md §1 item 2, checklist 23). */
export const TOGGLE_ORDER: readonly ToggleKey[] = [
    'autoReload',
    'showBlockedCount',
    'strictBlockMode',
    'popupBlockMode',
    'developerMode',
];

function hasToken(disabledFeatures: unknown, token: string): boolean {
    return Array.isArray(disabledFeatures) && disabledFeatures.includes(token);
}

/** §13 #2: shown / enabled / checked per toggle (settings.md §4 table). Values are coerced like a DOM `checked` assignment. */
export function toggleStates(store: Partial<OptionsData>, platform: Platform): Record<ToggleKey, ControlState> {
    const canShowBlockedCount = Boolean(store.canShowBlockedCount);
    const hasOmnipotence = Boolean(store.hasOmnipotence);
    const developForbidden = hasToken(store.disabledFeatures, 'develop');
    return {
        autoReload: { shown: true, enabled: true, checked: Boolean(store.autoReload) },
        showBlockedCount: {
            shown: true,
            enabled: canShowBlockedCount,
            checked: canShowBlockedCount && Boolean(store.showBlockedCount),
        },
        strictBlockMode: {
            shown: platform !== 'safari',
            enabled: hasOmnipotence,
            checked: hasOmnipotence && Boolean(store.strictBlockMode),
        },
        popupBlockMode: { shown: true, enabled: true, checked: Boolean(store.popupBlockMode) },
        developerMode: {
            shown: !developForbidden,
            enabled: true,
            checked: effectiveDeveloperMode(store),
        },
    };
}

/** settings.md §4.5: `Boolean(developerMode) && disabledFeatures?.includes('develop') !== true`. */
export function effectiveDeveloperMode(store: Partial<Pick<OptionsData, 'developerMode' | 'disabledFeatures'>>): boolean {
    return Boolean(store.developerMode) && !hasToken(store.disabledFeatures, 'develop');
}

export interface AdminFlags {
    /** `dashboard`: Settings (and two other panes) unreachable; the shell forces About. */
    hidePane: boolean;
    /** `filteringMode`: the "Default filtering mode" block is hidden. */
    hideModeBlock: boolean;
    /** `develop`: the developer-mode row is hidden. */
    hideDeveloperRow: boolean;
}

/** §13 #3. Absent or empty `disabledFeatures` hides nothing. */
export function adminFlags(disabledFeatures: unknown): AdminFlags {
    return {
        hidePane: hasToken(disabledFeatures, 'dashboard'),
        hideModeBlock: hasToken(disabledFeatures, 'filteringMode'),
        hideDeveloperRow: hasToken(disabledFeatures, 'develop'),
    };
}

/** §13 #4: `body[data-supports]` tokens (settings.js:334-341). Expected empty on Safari. */
export function supportsTokens(data: Partial<Pick<OptionsData, 'supportsUserScripts' | 'supportsCompiledFilters'>>): string[] {
    const out: string[] = [];
    if (data.supportsUserScripts) out.push('user-scripts');
    if (data.supportsCompiledFilters) out.push('compiled-filters');
    return out;
}

/** §13 #6 (dashboard.js:83-86): `Array.from(x).sort().join('\n')`, `''` for a falsy value. */
export function hashFromIterable(iter: Iterable<unknown> | null | undefined | false | 0 | ''): string {
    if (!iter) return '';
    return Array.from(iter as Iterable<unknown>).sort().join('\n');
}

export interface MergeResult {
    store: OptionsData;
    /** Re-render §3.1 and §4 from the store. */
    widgets: boolean;
    /** Re-render the Filter-lists pane. */
    lists: boolean;
}

const WIDGET_FIELDS = [
    'hasOmnipotence',
    'defaultFilteringMode',
    'autoReload',
    'showBlockedCount',
    'strictBlockMode',
    'popupBlockMode',
    'developerMode',
] as const;

/**
 * §13 #5 (settings.js:249-323). Field by field: applied only when present
 * (`!== undefined`) and different (`!==`) from the stored value; `adminRulesets`
 * when its sorted content differs; `enabledRulesets` whenever present. Anything
 * else (filteringModeDetails, disabledFeatures, unknown keys) is ignored.
 * A non-object message changes nothing. The input store is never mutated.
 */
export function mergeBroadcast(store: OptionsData, message: unknown): MergeResult {
    if (typeof message !== 'object' || message === null) {
        return { store, widgets: false, lists: false };
    }
    const msg = message as Record<string, unknown>;
    let next: OptionsData | null = null;
    const set = (key: string, value: unknown) => {
        if (next === null) next = { ...store };
        (next as unknown as Record<string, unknown>)[key] = value;
    };
    let widgets = false;
    let lists = false;
    for (const key of WIDGET_FIELDS) {
        const value = msg[key];
        if (value === undefined) continue;
        if (value === (store as unknown as Record<string, unknown>)[key]) continue;
        set(key, value);
        widgets = true;
    }
    if (msg.adminRulesets !== undefined) {
        const before = hashFromIterable(store.adminRulesets as Iterable<unknown>);
        const after = hashFromIterable(msg.adminRulesets as Iterable<unknown>);
        if (after !== before) {
            set('adminRulesets', msg.adminRulesets);
            lists = true;
        }
    }
    if (msg.enabledRulesets !== undefined) {
        set('enabledRulesets', msg.enabledRulesets);
        lists = true;
    }
    return { store: next ?? store, widgets, lists };
}

/* ------------------------------------------------------------------------ */
/* Backup (backup-restore.js:36-88, settings.js:136-146)                      */
/* ------------------------------------------------------------------------ */

/** File name of the backup (settings.js:143; not renamed for "Blocker", settings.md H10). */
export const BACKUP_FILE_NAME = 'my-ubol-settings.json';

export interface BackupInputs {
    /** `manifest.versionName ?? manifest.version`. */
    version: string;
    /** Page store: toggles (raw) and `enabledRulesets`. */
    store: Pick<OptionsData, 'autoReload' | 'developerMode' | 'popupBlockMode' | 'showBlockedCount' | 'strictBlockMode' | 'enabledRulesets'>;
    defaultConfig: Pick<GetDefaultConfigResponse, 'autoReload' | 'developerMode' | 'popupBlockMode' | 'showBlockedCount' | 'strictBlockMode' | 'rulesets'>;
    /** Already trimmed sandbox text; `''` when none. */
    sandboxText: string;
    /** `getFilteringModeDetails` answer, passed through. */
    filteringModes: unknown;
    /** `getAllCustomFilters` answer. */
    customFilters: readonly unknown[];
    /** Stored `userDnrRules` (anything; only a non-empty string is used). */
    dnrRules: unknown;
}

/** §13 #7: the backup object, keys in upstream's insertion order (settings.md §6.2). */
export function buildBackup(input: BackupInputs): Record<string, unknown> {
    const { store, defaultConfig } = input;
    const out: Record<string, unknown> = {};
    out.version = input.version;
    if (store.autoReload !== defaultConfig.autoReload) out.autoReload = store.autoReload;
    if (store.developerMode !== defaultConfig.developerMode) out.developerMode = store.developerMode;
    if (store.popupBlockMode !== defaultConfig.popupBlockMode) out.popupBlockMode = store.popupBlockMode;
    if (store.showBlockedCount !== defaultConfig.showBlockedCount) out.showBlockedCount = store.showBlockedCount;
    if (store.strictBlockMode !== defaultConfig.strictBlockMode) out.strictBlockMode = store.strictBlockMode;
    const enabledRulesets = store.enabledRulesets;
    const customRulesets: string[] = [];
    for (const id of enabledRulesets) {
        if (defaultConfig.rulesets.includes(id)) continue;
        customRulesets.push(`+${id}`);
    }
    for (const id of defaultConfig.rulesets) {
        if (enabledRulesets.includes(id)) continue;
        customRulesets.push(`-${id}`);
    }
    if (customRulesets.length !== 0) out.rulesets = customRulesets;
    out.filteringModes = input.filteringModes;
    if (input.customFilters.length !== 0) out.customFilters = input.customFilters;
    if (input.sandboxText !== '') out.sandboxFilters = input.sandboxText.split('\n');
    if (typeof input.dnrRules === 'string' && input.dnrRules.length !== 0) {
        out.dnrRules = input.dnrRules.split(/\n+/);
    }
    return out;
}

/** §13 #8: `JSON.stringify(o, null, 2) + '\n'`. */
export function serializeBackup(data: unknown): string {
    return JSON.stringify(data, null, 2) + '\n';
}

/** `data:` URL of the download anchor (settings.js:142). */
export function backupDataURL(text: string): string {
    return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
}

/* ------------------------------------------------------------------------ */
/* Restore (settings.js:159-165, backup-restore.js:92-215)                    */
/* ------------------------------------------------------------------------ */

export const INVALID_FILE = Symbol('invalid restore file');

/**
 * Keys that make a parsed file a settings backup: the §6.2 keys except
 * `version` (a package.json has one too), plus the legacy `cosmeticFilters`
 * that §7.3 step 15 still reads.
 */
export const RESTORE_KEYS: readonly string[] = [
    'autoReload',
    'developerMode',
    'popupBlockMode',
    'showBlockedCount',
    'strictBlockMode',
    'rulesets',
    'filteringModes',
    'customFilters',
    'sandboxFilters',
    'dnrRules',
    'cosmeticFilters',
];

/**
 * §13 #9: parsed JSON when it is an object or array (`data instanceof Object`), else INVALID_FILE.
 *
 * DEVIATION (settings.md §7.2 HAZARD): upstream restores ANY
 * object, so the wrong .json file (`{}`, `[]`, a package.json) silently resets
 * every setting and deletes every custom filter. Here an object or array with
 * none of RESTORE_KEYS as an own key is INVALID_FILE too: nothing is sent and
 * the page says the file holds no settings. Every backup upstream or this UI
 * writes has `filteringModes` (§6.2), so real backups are unaffected; "Reset to
 * default settings…" remains the way to reset.
 */
export function parseRestoreFile(text: unknown): object | typeof INVALID_FILE {
    if (typeof text !== 'string') return INVALID_FILE;
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return INVALID_FILE;
    }
    if (!(data instanceof Object)) return INVALID_FILE;
    if (Array.isArray(data) || !RESTORE_KEYS.some((key) => Object.hasOwn(data, key))) return INVALID_FILE;
    return data;
}

/**
 * Ids of `enabled` that the running build cannot enable (a deviation
 * from §7.3 step 12 wire parity, messaging.md §6.3): not in `knownIds` (the
 * current `rulesetDetails`), not a default id, not an imported-list URL.
 * Sending only such an id as "new" makes upstream `applyRulesets` store
 * `rulesetConfig.enabledRulesets = undefined`, and the next background start
 * then disables EVERY ruleset (ruleset-manager.js:642-658, background.js:239-245,
 * 729-736). Returns [] when `knownIds` is empty (nothing to check against).
 */
export function unknownRulesets(enabled: readonly string[], defaultIds: readonly string[], knownIds: Iterable<string>): string[] {
    const known = new Set(knownIds);
    if (known.size === 0) return [];
    return enabled.filter((id) => !known.has(id) && !defaultIds.includes(id) && !RE_IMPORTED.test(id));
}

/**
 * §13 #10 (backup-restore.js:120-131). Starts from a COPY of the default ids;
 * throws exactly where upstream throws (non-iterable `rulesets`, non-string entry).
 */
export function resolveRulesets(defaultRulesets: readonly string[], targetRulesets: any): string[] {
    const enabled = Array.from(defaultRulesets);
    for (const entry of targetRulesets || []) {
        const id = entry.slice(1);
        if (entry.startsWith('+')) {
            if (enabled.includes(id)) continue;
            enabled.push(id);
        } else if (entry.startsWith('-')) {
            const i = enabled.indexOf(id);
            if (i === -1) continue;
            enabled.splice(i, 1);
        }
    }
    return enabled;
}

const RE_IMPORTED = /^[a-z-]+:\/\//;

/** §13 #11 (backup-restore.js:134-140). */
export function importedDelta(enabled: readonly string[], importedIds: readonly string[]): { toAdd: string[]; toRemove: string[] } {
    return {
        toAdd: enabled.filter((a) => RE_IMPORTED.test(a) && importedIds.includes(a) === false),
        toRemove: importedIds.filter((a) => enabled.includes(a) === false),
    };
}

/**
 * §13 #12 (backup-restore.js:158-179). `null` when `cosmeticFilters` is not an
 * array or yields nothing; throws on a non-string line, like upstream.
 */
export function legacyCosmeticEntries(cosmeticFilters: any): [string, string[]][] | null {
    if (!Array.isArray(cosmeticFilters)) return null;
    const hostnameMap = new Map<string, string[]>();
    for (const line of cosmeticFilters as any[]) {
        const i = line.indexOf('##');
        if (i === -1) continue;
        const hostname = line.slice(0, i);
        if (hostname === '') continue;
        const selector = line.slice(i + 2);
        if (selector === '') continue;
        const selectors = hostnameMap.get(hostname) || [];
        if (selectors.length === 0) hostnameMap.set(hostname, selectors);
        selectors.push(selector);
    }
    return hostnameMap.size !== 0 ? Array.from(hostnameMap) : null;
}

/**
 * §13 #13 (backup-restore.js:180-194): `+js` selectors become sandbox lines
 * `${hn}##${selector}`; hostnames left without a selector are dropped. Throws
 * where upstream throws (non-iterable list or selectors, non-string selector).
 */
export function splitCustomFilters(customFilters: any): { entries: [unknown, unknown[]][]; sandboxLines: string[] } {
    const entries: [unknown, unknown[]][] = [];
    const sandboxLines: string[] = [];
    for (const [hn, beforeSelectors] of customFilters ?? []) {
        const afterSelectors: unknown[] = [];
        for (const selector of beforeSelectors) {
            if (selector.startsWith('+js')) {
                sandboxLines.push(`${hn}##${selector}`);
            } else {
                afterSelectors.push(selector);
            }
        }
        if (afterSelectors.length) entries.push([hn, afterSelectors]);
    }
    return { entries, sandboxLines };
}

/**
 * §13 #14 (backup-restore.js:200-204). When `sandboxFilters` is truthy, `''`
 * and its `join('\n')` are appended, so the text may start with '\n'.
 * Throws for a truthy non-array (no `join`), like upstream.
 */
export function sandboxText(sandboxLines: readonly string[], sandboxFilters: any): string {
    const lines = Array.from(sandboxLines);
    if (sandboxFilters) lines.push('', sandboxFilters.join('\n'));
    return lines.join('\n');
}

/**
 * Step 20 (backup-restore.js:207-212): the `userDnrRules` text to store, or
 * `null` to remove the key. Throws for a value with a non-zero/undefined
 * `length` and no `join` (a string, a number, an object), like upstream.
 */
export function dnrRulesText(dnrRules: any): string | null {
    const dnr = dnrRules ?? [];
    if (dnr.length !== 0) return dnr.join('\n');
    return null;
}

/** `true` for an imported-list id (a URL, `/^[a-z-]+:\/\//`), as upstream tests it (backup-restore.js:134). */
export function isImportedListId(id: string): boolean {
    return RE_IMPORTED.test(id);
}

/* ------------------------------------------------------------------------ */
/* Presentation helpers                                                       */
/* ------------------------------------------------------------------------ */

/** Button label without a trailing ellipsis ("Reset to default settings…" → "Reset to default settings"). */
export function withoutEllipsis(label: string): string {
    return label.replace(/\s*(?:…|\.\.\.)\s*$/u, '');
}

/**
 * Default filtering level carried by a filtering-mode table: the bucket that
 * holds `'all-urls'` (none 0, basic 1, optimal 2, complete 3), or null when no
 * bucket holds it. Accepts arrays (message answers) and Sets (broadcasts).
 * Used to keep the page store current after restore step 13.
 */
export function defaultLevelFromDetails(details: unknown): 0 | 1 | 2 | 3 | null {
    if (details === null || typeof details !== 'object') return null;
    const table = details as Record<string, unknown>;
    const buckets = [
        ['none', 0],
        ['basic', 1],
        ['optimal', 2],
        ['complete', 3],
    ] as const;
    for (const [name, level] of buckets) {
        const bucket = table[name];
        if (Array.isArray(bucket) && bucket.includes('all-urls')) return level;
        if (bucket instanceof Set && bucket.has('all-urls')) return level;
    }
    return null;
}

/**
 * Typed wrappers for EVERY message the React pages send to the background
 * (UI rule §6.5). Source of truth: docs/specs/messaging.md (§2.1 table,
 * §20 TypeScript block, §21.1 checklist).
 *
 * Rules implemented here:
 * - One exported async function per class-A message; the function name is the
 *   `what` string. Each makes exactly ONE `runtime.sendMessage` call whose
 *   argument is `{ what, ...payload }` with exactly the payload keys of the
 *   spec. Optional keys (`toRemove`, `type`) are absent unless given; no key is
 *   ever `undefined` (§21.1 item 1). Extra properties passed at run time are
 *   not forwarded: every message is built field by field.
 * - `runtime.sendMessage` is called SYNCHRONOUSLY inside the function call (no
 *   `await` before it), so a call made from a user-gesture handler is issued
 *   inside that gesture (§21.2 line 9).
 * - Failures are surfaced, never swallowed (contrast js/ext.js:51-55): every
 *   function rejects with a `BridgeError` carrying the message name when
 *     * the request fails validation (`kind: 'bad-request'`; nothing is sent),
 *     * `runtime.sendMessage` throws or rejects (`'transport'`),
 *     * a message listed in NEVER_NULLISH_ON_SUCCESS answers `null`/`undefined`
 *       (`'no-response'`, §1.6 item 3),
 *     * the answer has the wrong shape (`'bad-response'`).
 *   "void" messages resolve `undefined` whatever the background answers.
 * - Levels must be integers 0..3, tab ids integers, states booleans, hostnames
 *   strings (§1.6 item 5, §21.1 item 5): anything else is rejected BEFORE
 *   sending, because a string or NaN level silently resets a site.
 * - No timeout: upstream has none and handlers can legitimately take seconds
 *   (§1.6 item 4, U2/U14). A handler that throws never answers, so the promise
 *   may never settle; the UI decides how to present a long wait.
 * - No caching: every call sends a fresh message and returns what the
 *   background answered.
 *
 * Also exported: MESSAGE_NAMES (contract gate), the name lists of §20, and the
 * BroadcastChannel('uBOL') subscription helpers of §11.
 */

import { getBrowser } from './ext';

/* ======================================================================== */
/* Shared data (messaging.md §3, §20)                                         */
/* ======================================================================== */

/** 0 none, 1 basic, 2 optimal, 3 complete. Must be a number on the wire. */
export type FilteringLevel = 0 | 1 | 2 | 3;

/** Serialised mode table. The literal 'all-urls' marks the default mode. */
export interface FilteringModeDetails {
    none: string[];
    basic: string[];
    optimal: string[];
    complete: string[];
}

/** Same table as delivered over BroadcastChannel (structured clone keeps Sets). */
export interface FilteringModeDetailsSets {
    none: Set<string>;
    basic: Set<string>;
    optimal: Set<string>;
    complete: Set<string>;
}

export interface RulesetFilterStats {
    total: number;
    accepted: number;
    rejected: number;
}

export interface RulesetRuleStats {
    total: number;
    plain: number;
    regex: number;
    removeparam?: number;
    redirect?: number;
    modifyHeaders?: number;
    strictblock?: number;
    urlskip?: number;
    discarded?: number;
    rejected?: number;
}

export type RulesetGroup =
    | 'default'
    | 'ads'
    | 'privacy'
    | 'malware'
    | 'annoyances'
    | 'regions'
    | 'imported';

export interface RulesetDetails {
    id: string;
    name: string;
    group?: RulesetGroup;
    /** "A|B" path of sub-group names. */
    parent?: string;
    /** Space separated language codes. */
    lang?: string;
    /** Space separated tags. */
    tags?: string;
    /** Stock list: enabled BY DEFAULT. Imported list: enabled NOW. */
    enabled: boolean;
    homeURL: string;
    filters: RulesetFilterStats;
    rules: RulesetRuleStats;
    css?: { generic?: number; specific?: number };
    popups?: number;
    /** Imported lists only: refresh period in days. */
    expires?: number;
    /** Imported lists only: epoch milliseconds. */
    time?: { added: number; updated: number };
}

export interface ImportedListEntry extends RulesetDetails {
    group: 'imported';
    expires: number;
    time: { added: number; updated: number };
}

/** "+<rulesetId>" or "-<rulesetId>". */
export type RulesetToken = string;

export interface DnrRule {
    id: number | string;
    priority?: number;
    action: Record<string, unknown>;
    condition: Record<string, unknown>;
}

export interface RulesetConfig {
    version: string;
    /** Absent after the applyRulesets hazard (messaging.md §6.3: bg:244 stores `undefined`). */
    enabledRulesets?: string[];
    autoReload: boolean;
    showBlockedCount: boolean;
    strictBlockMode: boolean;
    /** Stored raw by js/prevent-popup.js:70: non-boolean only if an upstream restore stored a non-boolean file value (this bridge never sends one). */
    popupBlockMode: boolean;
    developerMode: boolean;
    hasBroadHostPermissions: boolean;
    /** Added by startSession (bg:753-756); present on Safari after the first session. */
    userScripts?: boolean;
}

export type CustomFilterEntry = [hostname: string, selectors: string[]];

/* ======================================================================== */
/* Class A request / response types (messaging.md §20)                        */
/* ======================================================================== */

/* ---------- popup ---------- */

export interface PopupPanelDataRequest {
    what: 'popupPanelData';
    origin: string;
    hostname: string;
}
export interface PopupPanelDataResponse {
    hasOmnipotence: boolean;
    level: FilteringLevel;
    autoReload: boolean;
    isSideloaded: boolean;
    developerMode: boolean;
    /** The bridge turns `null` into an absent field (messaging.md §4.1). */
    disabledFeatures?: string[] | null;
    /** A count, not a boolean. */
    hasCustomFilters: number;
}

export interface SetPendingFilteringModeRequest {
    what: 'setPendingFilteringMode';
    tabId: number;
    url: string;
    hostname: string;
    beforeLevel: FilteringLevel;
    afterLevel: FilteringLevel;
}
export type SetPendingFilteringModeResponse = void;

export interface SetFilteringModeRequest {
    what: 'setFilteringMode';
    hostname: string;
    level: FilteringLevel;
}
/** Level actually in force afterwards; may differ from the request. */
export type SetFilteringModeResponse = FilteringLevel;

export interface ShowMatchedRulesRequest {
    what: 'showMatchedRules';
    tabId: number;
}
export type ShowMatchedRulesResponse = void;

export interface GotoURLRequest {
    what: 'gotoURL';
    /** Absolute URL, or path+query relative to the extension root. */
    url: string;
    type?: 'popup';
}
/** Tab / Window objects; never read. */
export type GotoURLResponse = unknown;

/* ---------- settings ---------- */

export interface GetOptionsPageDataRequest {
    what: 'getOptionsPageData';
}
export interface GetOptionsPageDataResponse {
    hasOmnipotence: boolean;
    defaultFilteringMode: FilteringLevel;
    enabledRulesets: string[];
    adminRulesets: RulesetToken[];
    maxNumberOfEnabledRulesets?: number | null;
    rulesetDetails: RulesetDetails[];
    autoReload: boolean;
    showBlockedCount: boolean;
    canShowBlockedCount: boolean;
    strictBlockMode: boolean;
    popupBlockMode: boolean;
    /** Always false. */
    firstRun: boolean;
    isSideloaded: boolean;
    developerMode: boolean;
    /** The bridge turns `null` into an absent field. */
    disabledFeatures?: string[] | null;
    supportsCompiledFilters: boolean;
    supportsUserScripts: boolean;
}

export interface SetDefaultFilteringModeRequest {
    what: 'setDefaultFilteringMode';
    level: FilteringLevel;
}
export type SetDefaultFilteringModeResponse = FilteringLevel;

export interface SetAutoReloadRequest {
    what: 'setAutoReload';
    state: boolean;
}
export type SetAutoReloadResponse = void;

export interface SetShowBlockedCountRequest {
    what: 'setShowBlockedCount';
    state: boolean;
}
export type SetShowBlockedCountResponse = void;

export interface SetStrictBlockModeRequest {
    what: 'setStrictBlockMode';
    state: boolean;
}
export type SetStrictBlockModeResponse = void;

export interface SetPopupBlockModeRequest {
    what: 'setPopupBlockMode';
    state: boolean;
}
export type SetPopupBlockModeResponse = void;

export interface SetDeveloperModeRequest {
    what: 'setDeveloperMode';
    state: boolean;
}
/** New value of developerMode. */
export type SetDeveloperModeResponse = boolean;

/* ---------- filter lists ---------- */

export interface GetEnabledRulesetsRequest {
    what: 'getEnabledRulesets';
}
export type GetEnabledRulesetsResponse = string[];

export interface GetRulesetDetailsRequest {
    what: 'getRulesetDetails';
}
export type GetRulesetDetailsResponse = RulesetDetails[];

export interface ApplyRulesetsRequest {
    what: 'applyRulesets';
    /** COMPLETE list of ids to be enabled; ids must exist in getRulesetDetails. */
    enabledRulesets: string[];
    /** Imported-list ids to delete after applying. */
    toRemove?: string[];
}
/** Always empty: the background never reports a DNR error here. */
export type ApplyRulesetsResponse = void;

export interface ImportFilterListRequest {
    what: 'importFilterList';
    url: string;
}
export type ImportFilterListResponse = void;

/* ---------- backup / restore / reset ---------- */

export interface GetDefaultConfigRequest {
    what: 'getDefaultConfig';
}
export interface GetDefaultConfigResponse {
    autoReload: boolean;
    developerMode: boolean;
    showBlockedCount: boolean;
    strictBlockMode: boolean;
    popupBlockMode: boolean;
    rulesets: string[];
    filteringModes: FilteringModeDetails;
}

export interface GetSandboxFiltersRequest {
    what: 'getSandboxFilters';
}
/** Nullish when nothing is stored (the bridge resolves `undefined` then). */
export type GetSandboxFiltersResponse = string | null | undefined;

export interface GetFilteringModeDetailsRequest {
    what: 'getFilteringModeDetails';
}
export type GetFilteringModeDetailsResponse = FilteringModeDetails;

export interface SetFilteringModeDetailsRequest {
    what: 'setFilteringModeDetails';
    /** COMPLETE replacement table. */
    modes: FilteringModeDetails;
}
/** Table in force afterwards (normalised, admin overrides applied). */
export type SetFilteringModeDetailsResponse = FilteringModeDetails;

export interface GetAllCustomFiltersRequest {
    what: 'getAllCustomFilters';
}
export type GetAllCustomFiltersResponse = CustomFilterEntry[];

export interface RemoveAllCustomFiltersRequest {
    what: 'removeAllCustomFilters';
    /** '*' = every site. */
    hostname: string;
}
export type RemoveAllCustomFiltersResponse = void;

export interface AddManyCustomFiltersRequest {
    what: 'addManyCustomFilters';
    entries: CustomFilterEntry[];
}
export type AddManyCustomFiltersResponse = void;

export interface SetSandboxFiltersRequest {
    what: 'setSandboxFilters';
    text: string;
}
export type SetSandboxFiltersResponse = void;

export interface UpdateUserDnrRulesRequest {
    what: 'updateUserDnrRules';
}
export interface UpdateUserDnrRulesResponse {
    added: number;
    removed: number;
    errors: string[];
}

/* ---------- about / troubleshooting ---------- */

export interface GetCurrentConfigRequest {
    what: 'getCurrentConfig';
}
export type GetCurrentConfigResponse = RulesetConfig;

export interface GetDefaultFilteringModeRequest {
    what: 'getDefaultFilteringMode';
}
export type GetDefaultFilteringModeResponse = FilteringLevel;

export interface GetEffectiveUserRulesRequest {
    what: 'getEffectiveUserRules';
}
export type GetEffectiveUserRulesResponse = DnrRule[];

export interface GetConsoleOutputRequest {
    what: 'getConsoleOutput';
}
export type GetConsoleOutputResponse = string[];

export interface GetRegisteredContentScriptsRequest {
    what: 'getRegisteredContentScripts';
}
export type GetRegisteredContentScriptsResponse = string[];

export interface HasBroadHostPermissionsRequest {
    what: 'hasBroadHostPermissions';
}
export type HasBroadHostPermissionsResponse = boolean;

/* ---------- map ---------- */

/** Messages the React bridge exposes (class A). */
export interface BridgeMessageMap {
    popupPanelData: { request: PopupPanelDataRequest; response: PopupPanelDataResponse };
    setPendingFilteringMode: { request: SetPendingFilteringModeRequest; response: SetPendingFilteringModeResponse };
    setFilteringMode: { request: SetFilteringModeRequest; response: SetFilteringModeResponse };
    showMatchedRules: { request: ShowMatchedRulesRequest; response: ShowMatchedRulesResponse };
    gotoURL: { request: GotoURLRequest; response: GotoURLResponse };
    getOptionsPageData: { request: GetOptionsPageDataRequest; response: GetOptionsPageDataResponse };
    setDefaultFilteringMode: { request: SetDefaultFilteringModeRequest; response: SetDefaultFilteringModeResponse };
    setAutoReload: { request: SetAutoReloadRequest; response: SetAutoReloadResponse };
    setShowBlockedCount: { request: SetShowBlockedCountRequest; response: SetShowBlockedCountResponse };
    setStrictBlockMode: { request: SetStrictBlockModeRequest; response: SetStrictBlockModeResponse };
    setPopupBlockMode: { request: SetPopupBlockModeRequest; response: SetPopupBlockModeResponse };
    setDeveloperMode: { request: SetDeveloperModeRequest; response: SetDeveloperModeResponse };
    getEnabledRulesets: { request: GetEnabledRulesetsRequest; response: GetEnabledRulesetsResponse };
    getRulesetDetails: { request: GetRulesetDetailsRequest; response: GetRulesetDetailsResponse };
    applyRulesets: { request: ApplyRulesetsRequest; response: ApplyRulesetsResponse };
    importFilterList: { request: ImportFilterListRequest; response: ImportFilterListResponse };
    getDefaultConfig: { request: GetDefaultConfigRequest; response: GetDefaultConfigResponse };
    getSandboxFilters: { request: GetSandboxFiltersRequest; response: GetSandboxFiltersResponse };
    getFilteringModeDetails: { request: GetFilteringModeDetailsRequest; response: GetFilteringModeDetailsResponse };
    setFilteringModeDetails: { request: SetFilteringModeDetailsRequest; response: SetFilteringModeDetailsResponse };
    getAllCustomFilters: { request: GetAllCustomFiltersRequest; response: GetAllCustomFiltersResponse };
    removeAllCustomFilters: { request: RemoveAllCustomFiltersRequest; response: RemoveAllCustomFiltersResponse };
    addManyCustomFilters: { request: AddManyCustomFiltersRequest; response: AddManyCustomFiltersResponse };
    setSandboxFilters: { request: SetSandboxFiltersRequest; response: SetSandboxFiltersResponse };
    updateUserDnrRules: { request: UpdateUserDnrRulesRequest; response: UpdateUserDnrRulesResponse };
    getCurrentConfig: { request: GetCurrentConfigRequest; response: GetCurrentConfigResponse };
    getDefaultFilteringMode: { request: GetDefaultFilteringModeRequest; response: GetDefaultFilteringModeResponse };
    getEffectiveUserRules: { request: GetEffectiveUserRulesRequest; response: GetEffectiveUserRulesResponse };
    getConsoleOutput: { request: GetConsoleOutputRequest; response: GetConsoleOutputResponse };
    getRegisteredContentScripts: { request: GetRegisteredContentScriptsRequest; response: GetRegisteredContentScriptsResponse };
    hasBroadHostPermissions: { request: HasBroadHostPermissionsRequest; response: HasBroadHostPermissionsResponse };
}

export type BridgeMessageName = keyof BridgeMessageMap;

/** Payload of a message: its request without `what`. */
export type BridgePayload<K extends BridgeMessageName> = Omit<BridgeMessageMap[K]['request'], 'what'>;

/* ======================================================================== */
/* Name lists (messaging.md §20)                                              */
/* ======================================================================== */

/** One bridge function per class-A message; the name is the `what` string. */
export const MESSAGE_NAMES = [
    // popup
    'popupPanelData',
    'setPendingFilteringMode',
    'setFilteringMode',
    'showMatchedRules',
    'gotoURL',
    // settings
    'getOptionsPageData',
    'setDefaultFilteringMode',
    'setAutoReload',
    'setShowBlockedCount',
    'setStrictBlockMode',
    'setPopupBlockMode',
    'setDeveloperMode',
    // filter lists
    'getEnabledRulesets',
    'getRulesetDetails',
    'applyRulesets',
    'importFilterList',
    // backup / restore / reset
    'getDefaultConfig',
    'getSandboxFilters',
    'getFilteringModeDetails',
    'setFilteringModeDetails',
    'getAllCustomFilters',
    'removeAllCustomFilters',
    'addManyCustomFilters',
    'setSandboxFilters',
    'updateUserDnrRules',
    // about / troubleshooting
    'getCurrentConfig',
    'getDefaultFilteringMode',
    'getEffectiveUserRules',
    'getConsoleOutput',
    'getRegisteredContentScripts',
    'hasBroadHostPermissions',
] as const satisfies readonly BridgeMessageName[];

/** Same list under the name the spec uses (messaging.md §20). */
export const BRIDGE_FUNCTION_NAMES = MESSAGE_NAMES;

/**
 * Class-A messages whose success response is never nullish: a nullish
 * response means the call failed and is surfaced as an error.
 */
export const NEVER_NULLISH_ON_SUCCESS = [
    'popupPanelData',
    'setFilteringMode',
    'getOptionsPageData',
    'setDefaultFilteringMode',
    'setDeveloperMode',
    'getEnabledRulesets',
    'getRulesetDetails',
    'getDefaultConfig',
    'getFilteringModeDetails',
    'setFilteringModeDetails',
    'getAllCustomFilters',
    'updateUserDnrRules',
    'getCurrentConfig',
    'getDefaultFilteringMode',
    'getEffectiveUserRules',
    'getConsoleOutput',
    'getRegisteredContentScripts',
    'hasBroadHostPermissions',
] as const satisfies readonly BridgeMessageName[];

/** Class-B names: sent only by surfaces kept as upstream code (§9). The React pages never send them. */
export const CLASSIC_MESSAGE_NAMES = [
    'addCustomFilters',
    'removeCustomFilters',
    'customFiltersFromHostname',
    'getEnabledRulesetsDetails',
    'getRulesetRules',
    'getAllDynamicRules',
    'getAllSessionRules',
    'getMatchedRules',
    'excludeFromStrictBlock',
    'getFilteringMode',
    'getImportedLists',
] as const;

/** Class-C names: content scripts / internal jobs (§10). The UI must NEVER send them. */
export const FORBIDDEN_MESSAGE_NAMES = [
    'insertCSS',
    'removeCSS',
    'injectCSSProceduralAPI',
    'toggleToolbarIcon',
    'startCustomFilters',
    'terminateCustomFilters',
    'injectCustomFilters',
    'updateImportedLists',
    'pruneCSSCache',
    'keepAlive',
] as const;

/* ======================================================================== */
/* Errors                                                                    */
/* ======================================================================== */

export type BridgeErrorKind =
    /** The request failed validation; nothing was sent. */
    | 'bad-request'
    /** `runtime.sendMessage` threw or rejected (no receiver, context gone, no API). */
    | 'transport'
    /** A NEVER_NULLISH_ON_SUCCESS message answered null/undefined (untrusted sender, unknown `what`, handler failure). */
    | 'no-response'
    /** The answer does not have the documented shape. */
    | 'bad-response';

export class BridgeError extends Error {
    /** The `what` of the failed message. */
    readonly messageName: BridgeMessageName;
    readonly kind: BridgeErrorKind;
    /** What the background answered, for `no-response` / `bad-response`. */
    readonly response?: unknown;

    constructor(messageName: BridgeMessageName, kind: BridgeErrorKind, detail: string, options?: { cause?: unknown; response?: unknown }) {
        super(`${messageName}: ${detail}`, options?.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'BridgeError';
        this.messageName = messageName;
        this.kind = kind;
        if (options !== undefined && 'response' in options) { this.response = options.response; }
    }
}

export function isBridgeError(err: unknown): err is BridgeError {
    return err instanceof BridgeError;
}

/* ======================================================================== */
/* Validation helpers                                                        */
/* ======================================================================== */

const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Integer 0..3 (a real number: '2', NaN, 2.5, undefined are not levels). */
export function isFilteringLevel(v: unknown): v is FilteringLevel {
    return v === 0 || v === 1 || v === 2 || v === 3;
}

const isTabId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');

type Check = [ok: boolean, what: string];

function requireRequest(name: BridgeMessageName, checks: Check[]): void {
    for (const [ok, what] of checks) {
        if (!ok) { throw new BridgeError(name, 'bad-request', `invalid request: ${what}`); }
    }
}

/* ======================================================================== */
/* Transport                                                                 */
/* ======================================================================== */

/**
 * Sends `message` (already validated, `what` first) and returns the raw answer.
 * `runtime.sendMessage` is invoked synchronously, before the first `await`.
 */
function send(name: BridgeMessageName, message: { what: BridgeMessageName } & Record<string, unknown>): Promise<unknown> {
    let pending: Promise<unknown>;
    try {
        pending = Promise.resolve(getBrowser().runtime.sendMessage(message));
    } catch (err) {
        return Promise.reject(new BridgeError(name, 'transport', `runtime.sendMessage threw: ${describe(err)}`, { cause: err }));
    }
    return pending.then(
        (response) => {
            if ((NEVER_NULLISH_ON_SUCCESS as readonly string[]).includes(name) && (response === undefined || response === null)) {
                throw new BridgeError(name, 'no-response', 'the background sent no answer (unknown message, untrusted sender or failing handler)', { response });
            }
            return response;
        },
        (err: unknown) => {
            throw new BridgeError(name, 'transport', `runtime.sendMessage rejected: ${describe(err)}`, { cause: err });
        },
    );
}

function describe(err: unknown): string {
    if (err instanceof Error) { return err.message; }
    try { return String(err); } catch { return 'unknown error'; }
}

function badResponse(name: BridgeMessageName, what: string, response: unknown): BridgeError {
    return new BridgeError(name, 'bad-response', `unexpected answer: ${what}`, { response });
}

/** Builds `{ what, ...fields }` leaving out every field whose value is `undefined`. */
function message<K extends BridgeMessageName>(what: K, fields: Record<string, unknown> = {}): { what: K } & Record<string, unknown> {
    const out: { what: K } & Record<string, unknown> = { what };
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) { out[k] = v; }
    }
    return out;
}

/** Runs `build` (validation + message construction) and sends; validation errors become rejections. */
function call(name: BridgeMessageName, build: () => { what: BridgeMessageName } & Record<string, unknown>): Promise<unknown> {
    let msg: { what: BridgeMessageName } & Record<string, unknown>;
    try {
        msg = build();
    } catch (err) {
        return Promise.reject(err instanceof BridgeError ? err : new BridgeError(name, 'bad-request', describe(err), { cause: err }));
    }
    return send(name, msg);
}

/** Normalises `disabledFeatures`: null/undefined → absent; array of strings kept; anything else rejected. */
function normaliseDisabledFeatures<T extends { disabledFeatures?: string[] | null }>(name: BridgeMessageName, response: T): T {
    const df = response.disabledFeatures;
    if (df === null || df === undefined) {
        const copy = { ...response };
        delete copy.disabledFeatures;
        return copy;
    }
    if (!isStringArray(df)) { throw badResponse(name, 'disabledFeatures is not an array of strings', response); }
    return response;
}

/* ======================================================================== */
/* Class A — popup (messaging.md §4)                                          */
/* ======================================================================== */

/** `{ what: 'popupPanelData', origin, hostname }` (§4.1). */
export async function popupPanelData(payload: BridgePayload<'popupPanelData'>): Promise<PopupPanelDataResponse> {
    const name = 'popupPanelData';
    const r = await call(name, () => {
        requireRequest(name, [
            [typeof payload?.origin === 'string', 'origin must be a string'],
            [typeof payload?.hostname === 'string', 'hostname must be a string'],
        ]);
        return message(name, { origin: payload.origin, hostname: payload.hostname });
    });
    if (!isObject(r)) { throw badResponse(name, 'not an object', r); }
    if (!isFilteringLevel(r.level)) { throw badResponse(name, 'level is not an integer 0..3', r); }
    if (typeof r.hasCustomFilters !== 'number' || Number.isNaN(r.hasCustomFilters)) { throw badResponse(name, 'hasCustomFilters is not a number', r); }
    for (const key of ['autoReload', 'isSideloaded', 'developerMode'] as const) {
        if (typeof r[key] !== 'boolean') { throw badResponse(name, `${key} is not a boolean`, r); }
    }
    return normaliseDisabledFeatures(name, r as unknown as PopupPanelDataResponse);
}

/**
 * `{ what: 'setPendingFilteringMode', tabId, url, hostname, beforeLevel, afterLevel }` (§4.2).
 * Upstream does not await it; the message is sent synchronously when this is called.
 */
export async function setPendingFilteringMode(payload: BridgePayload<'setPendingFilteringMode'>): Promise<void> {
    const name = 'setPendingFilteringMode';
    await call(name, () => {
        requireRequest(name, [
            [isTabId(payload?.tabId), 'tabId must be an integer'],
            [typeof payload?.url === 'string', 'url must be a string'],
            [typeof payload?.hostname === 'string', 'hostname must be a string'],
            [isFilteringLevel(payload?.beforeLevel), 'beforeLevel must be an integer 0..3'],
            [isFilteringLevel(payload?.afterLevel), 'afterLevel must be an integer 0..3'],
        ]);
        return message(name, {
            tabId: payload.tabId,
            url: payload.url,
            hostname: payload.hostname,
            beforeLevel: payload.beforeLevel,
            afterLevel: payload.afterLevel,
        });
    });
}

/** `{ what: 'setFilteringMode', hostname, level }` → level actually in force (§4.3). */
export async function setFilteringMode(payload: BridgePayload<'setFilteringMode'>): Promise<FilteringLevel> {
    const name = 'setFilteringMode';
    const r = await call(name, () => {
        requireRequest(name, [
            [typeof payload?.hostname === 'string', 'hostname must be a string'],
            [isFilteringLevel(payload?.level), 'level must be an integer 0..3'],
        ]);
        return message(name, { hostname: payload.hostname, level: payload.level });
    });
    if (!isFilteringLevel(r)) { throw badResponse(name, 'not an integer 0..3', r); }
    return r;
}

/** `{ what: 'showMatchedRules', tabId }` (§4.4). */
export async function showMatchedRules(payload: BridgePayload<'showMatchedRules'>): Promise<void> {
    const name = 'showMatchedRules';
    await call(name, () => {
        requireRequest(name, [[isTabId(payload?.tabId), 'tabId must be an integer']]);
        return message(name, { tabId: payload.tabId });
    });
}

/** `{ what: 'gotoURL', url, type? }` (§4.5). `type` is sent only when given. */
export async function gotoURL(payload: BridgePayload<'gotoURL'>): Promise<GotoURLResponse> {
    const name = 'gotoURL';
    const r = await call(name, () => {
        requireRequest(name, [
            [typeof payload?.url === 'string', 'url must be a string'],
            [payload?.type === undefined || payload.type === 'popup', "type must be absent or 'popup'"],
        ]);
        return message(name, { url: payload.url, type: payload.type });
    });
    // null and undefined are the same thing (messaging.md §1.4); nobody reads the value.
    return r ?? undefined;
}

/* ======================================================================== */
/* Class A — settings (messaging.md §5)                                       */
/* ======================================================================== */

/** `{ what: 'getOptionsPageData' }` (§5.1). */
export async function getOptionsPageData(): Promise<GetOptionsPageDataResponse> {
    const name = 'getOptionsPageData';
    const r = await call(name, () => message(name));
    if (!isObject(r)) { throw badResponse(name, 'not an object', r); }
    if (!isFilteringLevel(r.defaultFilteringMode)) { throw badResponse(name, 'defaultFilteringMode is not an integer 0..3', r); }
    if (!isStringArray(r.enabledRulesets)) { throw badResponse(name, 'enabledRulesets is not an array of strings', r); }
    if (!isStringArray(r.adminRulesets)) { throw badResponse(name, 'adminRulesets is not an array of strings', r); }
    if (!Array.isArray(r.rulesetDetails)) { throw badResponse(name, 'rulesetDetails is not an array', r); }
    return normaliseDisabledFeatures(name, r as unknown as GetOptionsPageDataResponse);
}

/** `{ what: 'setDefaultFilteringMode', level }` → default level now in force (§5.2). */
export async function setDefaultFilteringMode(payload: BridgePayload<'setDefaultFilteringMode'>): Promise<FilteringLevel> {
    const name = 'setDefaultFilteringMode';
    const r = await call(name, () => {
        requireRequest(name, [[isFilteringLevel(payload?.level), 'level must be an integer 0..3']]);
        return message(name, { level: payload.level });
    });
    if (!isFilteringLevel(r)) { throw badResponse(name, 'not an integer 0..3', r); }
    return r;
}

/**
 * The five toggles. `state` must be a real boolean (messaging.md §21.1 item 5).
 * DEVIATION from upstream (reported, messaging.md §7.2 notes): upstream restore sends
 * a backup file's toggle value raw (a string, a number…) and the background coerces it
 * differently per message (bg:462, 468, 265; js/prevent-popup.js:70 stores it raw).
 * The bridge rejects a non-boolean `state` (`bad-request`, nothing sent).
 */
function booleanSetter(name: 'setAutoReload' | 'setShowBlockedCount' | 'setStrictBlockMode' | 'setPopupBlockMode' | 'setDeveloperMode', payload: { state: boolean } | undefined): Promise<unknown> {
    return call(name, () => {
        requireRequest(name, [[typeof payload?.state === 'boolean', 'state must be a boolean']]);
        return message(name, { state: payload!.state });
    });
}

/** `{ what: 'setAutoReload', state }` (§5.3). */
export async function setAutoReload(payload: BridgePayload<'setAutoReload'>): Promise<void> {
    await booleanSetter('setAutoReload', payload);
}

/** `{ what: 'setShowBlockedCount', state }` (§5.3). */
export async function setShowBlockedCount(payload: BridgePayload<'setShowBlockedCount'>): Promise<void> {
    await booleanSetter('setShowBlockedCount', payload);
}

/** `{ what: 'setStrictBlockMode', state }` (§5.3). */
export async function setStrictBlockMode(payload: BridgePayload<'setStrictBlockMode'>): Promise<void> {
    await booleanSetter('setStrictBlockMode', payload);
}

/** `{ what: 'setPopupBlockMode', state }` (§5.3). */
export async function setPopupBlockMode(payload: BridgePayload<'setPopupBlockMode'>): Promise<void> {
    await booleanSetter('setPopupBlockMode', payload);
}

/** `{ what: 'setDeveloperMode', state }` → new developerMode (§5.3). */
export async function setDeveloperMode(payload: BridgePayload<'setDeveloperMode'>): Promise<boolean> {
    const name = 'setDeveloperMode';
    const r = await booleanSetter(name, payload);
    if (typeof r !== 'boolean') { throw badResponse(name, 'not a boolean', r); }
    return r;
}

/* ======================================================================== */
/* Class A — filter lists (messaging.md §6)                                   */
/* ======================================================================== */

/** `{ what: 'getEnabledRulesets' }` (§6.1). */
export async function getEnabledRulesets(): Promise<string[]> {
    const name = 'getEnabledRulesets';
    const r = await call(name, () => message(name));
    if (!isStringArray(r)) { throw badResponse(name, 'not an array of strings', r); }
    return r;
}

/** `{ what: 'getRulesetDetails' }` (§6.2). */
export async function getRulesetDetails(): Promise<RulesetDetails[]> {
    const name = 'getRulesetDetails';
    const r = await call(name, () => message(name));
    if (!Array.isArray(r)) { throw badResponse(name, 'not an array', r); }
    return r as RulesetDetails[];
}

/**
 * `{ what: 'applyRulesets', enabledRulesets, toRemove? }` (§6.3).
 *
 * HAZARDS the CALLER must respect (the bridge cannot know the current details):
 * `enabledRulesets` is the COMPLETE list (`[]` disables everything) and every id
 * must be in the current `getRulesetDetails` answer. `toRemove` is sent only when
 * given.
 */
export async function applyRulesets(payload: BridgePayload<'applyRulesets'>): Promise<void> {
    const name = 'applyRulesets';
    await call(name, () => {
        requireRequest(name, [
            [isStringArray(payload?.enabledRulesets), 'enabledRulesets must be an array of strings'],
            [payload?.toRemove === undefined || isStringArray(payload.toRemove), 'toRemove must be absent or an array of strings'],
        ]);
        return message(name, { enabledRulesets: payload.enabledRulesets, toRemove: payload.toRemove });
    });
}

/** `{ what: 'importFilterList', url }` (§6.4). Never offer while `supportsCompiledFilters` is false. */
export async function importFilterList(payload: BridgePayload<'importFilterList'>): Promise<void> {
    const name = 'importFilterList';
    await call(name, () => {
        requireRequest(name, [[typeof payload?.url === 'string', 'url must be a string']]);
        return message(name, { url: payload.url });
    });
}

/* ======================================================================== */
/* Class A — backup / restore / reset (messaging.md §7)                       */
/* ======================================================================== */

/** `{ what: 'getDefaultConfig' }` (§7.1). */
export async function getDefaultConfig(): Promise<GetDefaultConfigResponse> {
    const name = 'getDefaultConfig';
    const r = await call(name, () => message(name));
    if (!isObject(r)) { throw badResponse(name, 'not an object', r); }
    if (!isStringArray(r.rulesets)) { throw badResponse(name, 'rulesets is not an array of strings', r); }
    if (!isObject(r.filteringModes)) { throw badResponse(name, 'filteringModes is not an object', r); }
    return r as unknown as GetDefaultConfigResponse;
}

/** `{ what: 'getSandboxFilters' }` (§7.1). Resolves `undefined` when nothing is stored (NOT an error). */
export async function getSandboxFilters(): Promise<string | undefined> {
    const name = 'getSandboxFilters';
    const r = await call(name, () => message(name));
    if (r === undefined || r === null) { return undefined; }
    if (typeof r !== 'string') { throw badResponse(name, 'not a string', r); }
    return r;
}

/** `{ what: 'getFilteringModeDetails' }` (§7.1). Nullish = failure (no backup without it). */
export async function getFilteringModeDetails(): Promise<FilteringModeDetails> {
    const name = 'getFilteringModeDetails';
    const r = await call(name, () => message(name));
    if (!isObject(r)) { throw badResponse(name, 'not an object', r); }
    return r as unknown as FilteringModeDetails;
}

/**
 * `{ what: 'setFilteringModeDetails', modes }` (§7.2 step 11).
 * `modes` must be an object (not an array, not nullish): a missing table makes the
 * handler throw and never answer. Its content is passed through unchanged, as
 * upstream restore does (legacy keys included).
 * DEVIATION from upstream (reported, messaging.md §7.2 notes): upstream restore also
 * sends a string or array `filteringModes` from a backup file, which the background
 * turns into four empty sets (default becomes basic, every per-site mode lost,
 * js/mode-manager.js:96-103, 125-131). The bridge rejects it (`bad-request`) instead.
 */
export async function setFilteringModeDetails(payload: BridgePayload<'setFilteringModeDetails'>): Promise<FilteringModeDetails> {
    const name = 'setFilteringModeDetails';
    const r = await call(name, () => {
        requireRequest(name, [[isObject(payload?.modes), 'modes must be an object']]);
        return message(name, { modes: payload.modes });
    });
    if (!isObject(r)) { throw badResponse(name, 'not an object', r); }
    return r as unknown as FilteringModeDetails;
}

/** `{ what: 'getAllCustomFilters' }` (§7.1). */
export async function getAllCustomFilters(): Promise<CustomFilterEntry[]> {
    const name = 'getAllCustomFilters';
    const r = await call(name, () => message(name));
    if (!Array.isArray(r)) { throw badResponse(name, 'not an array', r); }
    return r as CustomFilterEntry[];
}

/** `{ what: 'removeAllCustomFilters', hostname }` — `'*'` = every site (§7.2 step 12). */
export async function removeAllCustomFilters(payload: BridgePayload<'removeAllCustomFilters'>): Promise<void> {
    const name = 'removeAllCustomFilters';
    await call(name, () => {
        requireRequest(name, [[typeof payload?.hostname === 'string', 'hostname must be a string']]);
        return message(name, { hostname: payload.hostname });
    });
}

/**
 * `{ what: 'addManyCustomFilters', entries }` (§7.2 steps 13-14). Entries are passed through
 * unchanged. The background skips an entry whose hostname is not a non-empty string or whose
 * selector list is not a non-empty array (bg:591-594), but it destructures every entry
 * (`for (const [hostname, selectors] of request.entries)`, bg:590): an entry that is not
 * iterable (null, a number, an object) makes the handler throw and never answer. So every
 * entry must be an array; anything else is rejected before sending.
 */
export async function addManyCustomFilters(payload: BridgePayload<'addManyCustomFilters'>): Promise<void> {
    const name = 'addManyCustomFilters';
    await call(name, () => {
        requireRequest(name, [
            [Array.isArray(payload?.entries), 'entries must be an array'],
            [Array.isArray(payload?.entries) && payload.entries.every(e => Array.isArray(e)), 'every entry must be a [hostname, selectors] array'],
        ]);
        return message(name, { entries: payload.entries });
    });
}

/** `{ what: 'setSandboxFilters', text }` (§7.2 step 15). Sent exactly as given (the background trims). */
export async function setSandboxFilters(payload: BridgePayload<'setSandboxFilters'>): Promise<void> {
    const name = 'setSandboxFilters';
    await call(name, () => {
        requireRequest(name, [[typeof payload?.text === 'string', 'text must be a string']]);
        return message(name, { text: payload.text });
    });
}

/** `{ what: 'updateUserDnrRules' }` (§7.2 step 17). */
export async function updateUserDnrRules(): Promise<UpdateUserDnrRulesResponse> {
    const name = 'updateUserDnrRules';
    const r = await call(name, () => message(name));
    if (!isObject(r)) { throw badResponse(name, 'not an object', r); }
    return r as unknown as UpdateUserDnrRulesResponse;
}

/* ======================================================================== */
/* Class A — about / troubleshooting (messaging.md §8.2)                      */
/* ======================================================================== */

/** `{ what: 'getCurrentConfig' }`. */
export async function getCurrentConfig(): Promise<RulesetConfig> {
    const name = 'getCurrentConfig';
    const r = await call(name, () => message(name));
    if (!isObject(r)) { throw badResponse(name, 'not an object', r); }
    return r as unknown as RulesetConfig;
}

/** `{ what: 'getDefaultFilteringMode' }`. */
export async function getDefaultFilteringMode(): Promise<FilteringLevel> {
    const name = 'getDefaultFilteringMode';
    const r = await call(name, () => message(name));
    if (!isFilteringLevel(r)) { throw badResponse(name, 'not an integer 0..3', r); }
    return r;
}

/** `{ what: 'getEffectiveUserRules' }`. */
export async function getEffectiveUserRules(): Promise<DnrRule[]> {
    const name = 'getEffectiveUserRules';
    const r = await call(name, () => message(name));
    if (!Array.isArray(r)) { throw badResponse(name, 'not an array', r); }
    return r as DnrRule[];
}

/** `{ what: 'getConsoleOutput' }`. */
export async function getConsoleOutput(): Promise<string[]> {
    const name = 'getConsoleOutput';
    const r = await call(name, () => message(name));
    if (!isStringArray(r)) { throw badResponse(name, 'not an array of strings', r); }
    return r;
}

/** `{ what: 'getRegisteredContentScripts' }`. */
export async function getRegisteredContentScripts(): Promise<string[]> {
    const name = 'getRegisteredContentScripts';
    const r = await call(name, () => message(name));
    if (!isStringArray(r)) { throw badResponse(name, 'not an array of strings', r); }
    return r;
}

/** `{ what: 'hasBroadHostPermissions' }`. */
export async function hasBroadHostPermissions(): Promise<boolean> {
    const name = 'hasBroadHostPermissions';
    const r = await call(name, () => message(name));
    if (typeof r !== 'boolean') { throw badResponse(name, 'not a boolean', r); }
    return r;
}

/* ======================================================================== */
/* Bridge object (the spec's suggested call shape, for contract gates)        */
/* ======================================================================== */

type NoPayload<K extends BridgeMessageName> = keyof BridgePayload<K> extends never ? true : false;

/** Payload without `what`, promise of the (normalised) response. Functions without payload take no argument. */
export type Bridge = {
    [K in BridgeMessageName]: NoPayload<K> extends true
        ? () => Promise<unknown>
        : (payload: BridgePayload<K>) => Promise<unknown>;
};

export const bridge = {
    popupPanelData,
    setPendingFilteringMode,
    setFilteringMode,
    showMatchedRules,
    gotoURL,
    getOptionsPageData,
    setDefaultFilteringMode,
    setAutoReload,
    setShowBlockedCount,
    setStrictBlockMode,
    setPopupBlockMode,
    setDeveloperMode,
    getEnabledRulesets,
    getRulesetDetails,
    applyRulesets,
    importFilterList,
    getDefaultConfig,
    getSandboxFilters,
    getFilteringModeDetails,
    setFilteringModeDetails,
    getAllCustomFilters,
    removeAllCustomFilters,
    addManyCustomFilters,
    setSandboxFilters,
    updateUserDnrRules,
    getCurrentConfig,
    getDefaultFilteringMode,
    getEffectiveUserRules,
    getConsoleOutput,
    getRegisteredContentScripts,
    hasBroadHostPermissions,
} as const satisfies Bridge;

/* ======================================================================== */
/* BroadcastChannel('uBOL') (messaging.md §11)                                */
/* ======================================================================== */

export const BROADCAST_CHANNEL_NAME = 'uBOL';

/** Any subset of keys may be present in one message; test each with `!== undefined`. */
export interface BroadcastMessage {
    hasOmnipotence?: boolean;
    defaultFilteringMode?: FilteringLevel;
    /** Arrives with Sets (structured clone); see `modeDetailsToArrays`. */
    filteringModeDetails?: FilteringModeDetailsSets;
    autoReload?: boolean;
    showBlockedCount?: boolean;
    strictBlockMode?: boolean;
    popupBlockMode?: boolean;
    developerMode?: boolean;
    adminRulesets?: RulesetToken[];
    enabledRulesets?: string[];
}

export type BroadcastListener = (message: BroadcastMessage) => void;

let channel: BroadcastChannel | null = null;
const listeners = new Set<BroadcastListener>();

function onChannelMessage(ev: MessageEvent): void {
    const data: unknown = ev.data;
    // Upstream ignores non-object data (js/settings.js:251).
    if (typeof data !== 'object' || data === null) { return; }
    for (const listener of Array.from(listeners)) {
        try {
            listener(data as BroadcastMessage);
        } catch (err) {
            console.error('[bridge] BroadcastChannel listener failed', err);
        }
    }
}

/** `true` when this page can open a BroadcastChannel. */
export function isBroadcastSupported(): boolean {
    return typeof globalThis.BroadcastChannel === 'function';
}

/**
 * Listens on `BroadcastChannel('uBOL')`. The channel is opened lazily on the
 * first subscription (so a page that never subscribes never opens one,
 * §21.3 line 17) and closed when the last subscriber leaves. Non-object data is
 * ignored. Returns the unsubscribe function (idempotent).
 *
 * Delivery from Safari's non-persistent background page is UNKNOWN (U13);
 * the UI must still work when no message ever arrives.
 */
export function subscribeBroadcast(listener: BroadcastListener): () => void {
    if (!isBroadcastSupported()) {
        console.warn('[bridge] BroadcastChannel is not available; live updates are off');
        return () => {};
    }
    listeners.add(listener);
    if (channel === null) {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channel.addEventListener('message', onChannelMessage);
    }
    let active = true;
    return () => {
        if (!active) { return; }
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0 && channel !== null) {
            channel.removeEventListener('message', onChannelMessage);
            channel.close();
            channel = null;
        }
    };
}

/**
 * Converts a mode table that may hold Sets (broadcast) or arrays (messages) into
 * the array form. Missing buckets become `[]`.
 */
export function modeDetailsToArrays(details: Partial<Record<keyof FilteringModeDetails, Iterable<string> | null | undefined>>): FilteringModeDetails {
    const conv = (v: Iterable<string> | null | undefined): string[] => (v === null || v === undefined ? [] : Array.from(v));
    return {
        none: conv(details.none),
        basic: conv(details.basic),
        optimal: conv(details.optimal),
        complete: conv(details.complete),
    };
}

/**
 * Restore / reset sequence (settings.md §7.3, §8) and backup (§6), through
 * src/lib/bridge.ts, src/lib/storage.ts and src/lib/ext.ts only — upstream
 * js/backup-restore.js is NOT imported (§7.5).
 *
 * `restoreFromObject(target)` sends exactly upstream's messages, in upstream's
 * order, each awaited before the next (§7.3 steps 1-21). Differences, all on
 * the failure path (UI rule §6.5, reported):
 * - The bridge rejects instead of resolving `undefined`. A failed step stops
 *   the sequence and the promise rejects with a `RestoreError` that says
 *   which step failed and whether something had already been written
 *   (`applied`), so the page can report a PARTIAL restore.
 * - Exception, kept for parity (§13 "getDefaultConfig fails"): when step 1
 *   fails, the toggles PRESENT in the file are still sent, up to the first
 *   missing one, exactly as upstream (`a ?? b.x` does not read `b.x` when `a`
 *   is present); the sequence then stops with the step-1 error as the cause.
 * - The bridge refuses a non-boolean toggle `state` and a `modes` that is not a
 *   plain object (`BridgeError` kind `bad-request`, nothing sent). Upstream
 *   sends such file values raw. This is the accepted bridge deviation
 *   (settings.md §7.3 note): the restore stops there and is reported partial.
 * - Malformed fields (§7.3 table) throw at the same step as upstream, because
 *   the pure helpers in ./model keep upstream's JavaScript operations.
 * - A step that does not settle within `stepTimeoutMs` (default 120 s) stops
 *   the sequence with a `timeout` failure, so the busy state is always left
 *   (upstream stays busy forever, H6). The late answer, if any, is ignored.
 * - A failed `rulesets.imported` read is treated as "no imported list" and the
 *   sequence continues, exactly as upstream's `localRead` (ext.js:59-66 swallows
 *   the error, `|| []`). Same traffic as upstream.
 * - `onApplied` (optional, H7 deviation that changes no message)
 *   receives the store fields a successful write has set: each toggle (the
 *   developer-mode answer), `enabledRulesets` after `applyRulesets`, and the
 *   default level found in the `setFilteringModeDetails` answer. The page
 *   applies them to its store so a later backup is right even without echoes (U1).
 * - `knownRulesetIds` (optional, deviation from §7.3 step 12 wire
 *   parity, messaging.md §6.3): ruleset ids of the file that this build does
 *   not ship are left out of `applyRulesets` and returned in `skippedRulesets`.
 *   Sent as they are, they can make the background store `enabledRulesets =
 *   undefined`, and its next start disables every ruleset (model.ts
 *   `unknownRulesets`). No message is added or removed; only that payload
 *   changes, and only for such a file.
 */
import {
    addManyCustomFilters,
    applyRulesets,
    getAllCustomFilters,
    getDefaultConfig,
    getFilteringModeDetails,
    getSandboxFilters,
    removeAllCustomFilters,
    setAutoReload,
    setDeveloperMode,
    setFilteringModeDetails,
    setPopupBlockMode,
    setSandboxFilters,
    setShowBlockedCount,
    setStrictBlockMode,
    updateUserDnrRules,
    BridgeError,
    type GetDefaultConfigResponse,
} from '@/lib/bridge';
import { getManifest } from '@/lib/ext';
import { readImportedLists, readUserDnrRules, removeUserDnrRules, writeUserDnrRules } from '@/lib/storage';
import { addImportedLists, removeImportedLists } from './importedLists';
import {
    buildBackup,
    defaultLevelFromDetails,
    dnrRulesText,
    importedDelta,
    legacyCosmeticEntries,
    resolveRulesets,
    sandboxText,
    serializeBackup,
    splitCustomFilters,
    unknownRulesets,
    type OptionsData,
} from './model';

export const DEFAULT_STEP_TIMEOUT_MS = 120_000;

/** Names of the steps, as reported in a RestoreError (message names, or the page-side action). */
export type RestoreStep =
    | 'getDefaultConfig'
    | 'setAutoReload'
    | 'setShowBlockedCount'
    | 'setDeveloperMode'
    | 'setStrictBlockMode'
    | 'setPopupBlockMode'
    | 'rulesets'
    | 'readImportedLists'
    | 'removeImportedLists'
    | 'addImportedLists'
    | 'applyRulesets'
    | 'setFilteringModeDetails'
    | 'removeAllCustomFilters'
    | 'cosmeticFilters'
    | 'customFilters'
    | 'sandboxFilters'
    | 'setSandboxFilters'
    | 'dnrRules'
    | 'writeUserDnrRules'
    | 'updateUserDnrRules';

export class RestoreError extends Error {
    readonly step: RestoreStep;
    /** True when at least one write (message or storage write) was issued before the failure. */
    readonly applied: boolean;
    readonly reason: 'failed' | 'timeout';
    constructor(step: RestoreStep, applied: boolean, cause: unknown, reason: 'failed' | 'timeout' = 'failed') {
        super(`restore stopped at ${step}: ${describe(cause)}`, { cause });
        this.name = 'RestoreError';
        this.step = step;
        this.applied = applied;
        this.reason = reason;
    }
}

function describe(err: unknown): string {
    if (err instanceof Error) return err.message;
    try {
        return String(err);
    } catch {
        return 'unknown error';
    }
}

class StepTimeout extends Error {
    constructor(ms: number) {
        super(`no answer within ${ms} ms`);
        this.name = 'StepTimeout';
    }
}

export interface RestoreOptions {
    /** Per-step watchdog. Default DEFAULT_STEP_TIMEOUT_MS. */
    stepTimeoutMs?: number;
    /** Called after a successful write with the store fields it set (see header). */
    onApplied?: (patch: Partial<OptionsData>) => void;
    /** Ids of the current `rulesetDetails` (stock + imported). Omitted or empty: no check (upstream traffic). */
    knownRulesetIds?: Iterable<string>;
}

export interface RestoreResult {
    /** Ids from the file that were not sent because this build does not have them (file order). */
    skippedRulesets: string[];
}

/**
 * §7.3 `restoreFromObject(target)`. `target` is any JSON object or array (the
 * caller validated `data instanceof Object`); `{}` is a reset (§8).
 */
// The file content is untrusted JSON; see model.ts for why `any` is used.
export async function restoreFromObject(target: any, options: RestoreOptions = {}): Promise<RestoreResult> {
    const timeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    let applied = false;
    const report = (patch: Partial<OptionsData>): void => {
        try {
            options.onApplied?.(patch);
        } catch (err) {
            console.error('[settings restore] onApplied failed', err);
        }
    };

    /**
     * Runs one step. `run` is called synchronously (so a bridge/storage call is
     * issued right away). `write` steps mark `applied` once the call may have had
     * an effect: on success, on a timeout, or on a failure other than "refused
     * before sending" (bridge `bad-request`) / "not delivered" (bridge `transport`).
     */
    async function step<T>(name: RestoreStep, write: boolean, run: () => T | Promise<T>): Promise<T> {
        const wrap = (err: unknown): RestoreError => (err instanceof RestoreError ? err : new RestoreError(name, applied, err));
        let pending: Promise<T>;
        try {
            pending = Promise.resolve(run());
        } catch (err) {
            throw wrap(err);
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const watchdog = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new StepTimeout(timeoutMs)), timeoutMs);
        });
        try {
            const value = await Promise.race([pending, watchdog]);
            if (write) applied = true;
            return value;
        } catch (err) {
            if (err instanceof StepTimeout) {
                if (write) applied = true;
                throw new RestoreError(name, applied, err, 'timeout');
            }
            if (write && !notDelivered(err)) applied = true;
            throw wrap(err);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    // 1. getDefaultConfig — a failure does not stop the sequence yet (see header).
    let defaultConfig: GetDefaultConfigResponse | undefined;
    let defaultConfigError: unknown;
    try {
        defaultConfig = await step('getDefaultConfig', false, () => getDefaultConfig());
    } catch (err) {
        defaultConfigError = err instanceof RestoreError ? err.cause : err;
        if (err instanceof RestoreError && err.reason === 'timeout') throw err;
    }
    /** `target[key] ?? defaultConfig[key]`, failing like upstream when the default is needed but missing. */
    const pick = (stepName: RestoreStep, key: keyof GetDefaultConfigResponse): unknown => {
        const value = target[key];
        if (value !== undefined && value !== null) return value;
        if (defaultConfig === undefined) throw new RestoreError(stepName, applied, defaultConfigError);
        return defaultConfig[key];
    };
    const requireDefaults = (stepName: RestoreStep): GetDefaultConfigResponse => {
        if (defaultConfig === undefined) throw new RestoreError(stepName, applied, defaultConfigError);
        return defaultConfig;
    };

    // 2-6. Toggles, in upstream order. The bridge rejects a non-boolean state (deviation, see header).
    let state: boolean;
    await step('setAutoReload', true, () => setAutoReload({ state: (state = pick('setAutoReload', 'autoReload') as boolean) }));
    report({ autoReload: state! });
    await step('setShowBlockedCount', true, () => setShowBlockedCount({ state: (state = pick('setShowBlockedCount', 'showBlockedCount') as boolean) }));
    report({ showBlockedCount: state! });
    const developerMode = await step('setDeveloperMode', true, () => setDeveloperMode({ state: pick('setDeveloperMode', 'developerMode') as boolean }));
    report({ developerMode });
    await step('setStrictBlockMode', true, () => setStrictBlockMode({ state: (state = pick('setStrictBlockMode', 'strictBlockMode') as boolean) }));
    report({ strictBlockMode: state! });
    await step('setPopupBlockMode', true, () => setPopupBlockMode({ state: (state = pick('setPopupBlockMode', 'popupBlockMode') as boolean) }));
    report({ popupBlockMode: state! });

    // 7. Enabled rulesets: defaults + file deltas (throws on malformed `rulesets`, like upstream).
    const defaults = requireDefaults('rulesets');
    const resolved = await step('rulesets', false, () => resolveRulesets(defaults.rulesets, target.rulesets));
    // 7b. (deviation, see header) leave out ids this build cannot enable.
    const skippedRulesets = unknownRulesets(resolved, defaults.rulesets, options.knownRulesetIds ?? []);
    const enabled = skippedRulesets.length === 0 ? resolved : resolved.filter((id) => !skippedRulesets.includes(id));

    // 8-11. Imported lists, page side.
    // Upstream's localRead swallows a failed read (ext.js:59-66): continue with no imported list.
    const imported = await step('readImportedLists', false, () =>
        readImportedLists().catch((err: unknown) => {
            console.warn('[settings restore] rulesets.imported could not be read; continuing as upstream', err);
            return [] as Awaited<ReturnType<typeof readImportedLists>>;
        }),
    );
    const { toAdd, toRemove } = importedDelta(
        enabled,
        imported.map((a) => a.id),
    );
    if (toRemove.length) {
        await step('removeImportedLists', true, () => removeImportedLists(toRemove));
    }
    if (toAdd.length) {
        await step('addImportedLists', true, () => addImportedLists(toAdd));
    }

    // 12. applyRulesets (no `toRemove` key).
    const enabledRulesets = Array.from(enabled);
    await step('applyRulesets', true, () => applyRulesets({ enabledRulesets }));
    report({ enabledRulesets: [...enabledRulesets] });

    // 13. Filtering modes (the bridge rejects a non-object table: deviation, see header).
    const modesInForce = await step('setFilteringModeDetails', true, () =>
        setFilteringModeDetails({ modes: (target.filteringModes ?? defaults.filteringModes) as GetDefaultConfigResponse['filteringModes'] }),
    );
    const defaultLevel = defaultLevelFromDetails(modesInForce);
    if (defaultLevel !== null) report({ defaultFilteringMode: defaultLevel });

    // 14. Remove every custom filter.
    await step('removeAllCustomFilters', true, () => removeAllCustomFilters({ hostname: '*' }));

    // 15. Legacy `cosmeticFilters`.
    const legacy = await step('cosmeticFilters', false, () => legacyCosmeticEntries(target.cosmeticFilters));
    if (legacy !== null) {
        await step('cosmeticFilters', true, () => addManyCustomFilters({ entries: legacy }));
    }

    // 16-17. `customFilters`, `+js` selectors split off to the sandbox.
    const split = await step('customFilters', false, () => splitCustomFilters(target.customFilters));
    if (split.entries.length) {
        await step('customFilters', true, () =>
            addManyCustomFilters({ entries: split.entries as unknown as [string, string[]][] }),
        );
    }

    // 18-19. Sandbox text, always sent.
    const text = await step('sandboxFilters', false, () => sandboxText(split.sandboxLines, target.sandboxFilters));
    await step('setSandboxFilters', true, () => setSandboxFilters({ text }));

    // 20. User DNR rules (page storage).
    const dnr = await step('dnrRules', false, () => dnrRulesText(target.dnrRules));
    if (dnr !== null) {
        await step('writeUserDnrRules', true, () => writeUserDnrRules(dnr));
    } else {
        await step('writeUserDnrRules', true, () => removeUserDnrRules());
    }

    // 21. Rebuild the user DNR rules.
    await step('updateUserDnrRules', true, () => updateUserDnrRules());
    return { skippedRulesets };
}

/** A bridge failure that guarantees the message had no effect: refused before sending, or not delivered. */
function notDelivered(err: unknown): boolean {
    return err instanceof BridgeError && (err.kind === 'bad-request' || err.kind === 'transport');
}

/* ------------------------------------------------------------------------ */
/* Backup (§6)                                                               */
/* ------------------------------------------------------------------------ */

/**
 * §6.1: `getDefaultConfig` + `getSandboxFilters` (sent together), then
 * `getFilteringModeDetails`, `getAllCustomFilters`, then a `storage.local` read
 * of `userDnrRules`. Toggles and `enabledRulesets` come from the page store.
 * Any failed read rejects (no file); an absent sandbox text is not a failure.
 */
export async function createBackupText(store: OptionsData): Promise<string> {
    const manifest = getManifest();
    const version = manifest.versionName ?? manifest.version;
    const [defaultConfig, sandbox] = await Promise.all([getDefaultConfig(), getSandboxFilters()]);
    const filteringModes = await getFilteringModeDetails();
    const customFilters = await getAllCustomFilters();
    const dnrRules = await readUserDnrRules();
    const data = buildBackup({
        version,
        store,
        defaultConfig,
        sandboxText: sandbox?.trim() ?? '',
        filteringModes,
        customFilters,
        dnrRules,
    });
    return serializeBackup(data);
}

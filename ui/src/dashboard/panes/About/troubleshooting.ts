/**
 * Troubleshooting text of the About pane: a line-for-line transcription of
 * upstream `js/troubleshooting.js` (dashboard-shell.md §4.4, messaging.md §8.2).
 *
 * The pure part (`renderData`, `vendorString`, `buildTroubleshootingConfig`)
 * has no DOM and no browser API, so it is unit-tested against the byte-exact
 * examples of the specs. `fetchTroubleshootingInfo()` issues the ten calls in
 * upstream order, all started before any is awaited (one Promise.all).
 *
 * Differences from upstream, on purpose:
 * - the `getEnabledRulesets` answer is COPIED before the +/- prefixing and the
 *   sort (upstream mutates it in place; spec R-12 / P-17);
 * - only the dashboard use (no `details`) is supported: there is no
 *   `filtering.site`, no `badge`, and the whole `console` list is printed.
 *   `report.html` (the only caller with `details`) stays upstream code.
 */
import { getDefaultConfig, getConsoleOutput, getCurrentConfig, getDefaultFilteringMode, getEffectiveUserRules, getEnabledRulesets, getRegisteredContentScripts, getRulesetDetails, hasBroadHostPermissions, type DnrRule, type GetDefaultConfigResponse, type RulesetConfig, type RulesetDetails } from '@/lib/bridge';
import { getManifest, getPlatformInfo, getURL, type ExtPlatformInfo } from '@/lib/ext';

/** js/troubleshooting.js:26-48, verbatim semantics. */
export function renderData(data: unknown, depth = 0): string {
    const indent = ' '.repeat(depth);
    if (Array.isArray(data)) {
        const out: string[] = [];
        for (const value of data) {
            out.push(renderData(value, depth));
        }
        return out.join('\n');
    }
    if (typeof data !== 'object' || data === null) {
        return `${indent}${String(data)}`;
    }
    const out: string[] = [];
    for (const [name, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null) {
            out.push(`${indent}${name}:`);
            out.push(renderData(value, depth + 1));
            continue;
        }
        out.push(`${indent}${name}: ${String(value)}`);
    }
    return out.join('\n');
}

/** js/troubleshooting.js:77-102: browser name + version + (os). */
export function vendorString(extURL: string, userAgent: string, os: unknown): string {
    let agent: string;
    let version: string;
    if (extURL.startsWith('moz-extension:')) {
        agent = 'Firefox';
        const match = /\bFirefox\/(\d+\.\d+)\b/.exec(userAgent);
        version = (match && match[1]) || '?';
    } else if (extURL.startsWith('safari-web-extension:')) {
        agent = 'Safari';
        const match = /\bVersion\/(\d+\.\d+)\b/.exec(userAgent);
        version = (match && match[1]) || '?';
    } else if (/\bEdg\/\b/.test(userAgent)) {
        agent = 'Edge';
        const match = /\bEdg\/(\d+)\b/.exec(userAgent);
        version = (match && match[1]) || '?';
    } else {
        agent = 'Chrome';
        const match = /\bChrome\/(\d+)\b/.exec(userAgent);
        version = (match && match[1]) || '?';
    }
    if (/\bMobile\b/.test(userAgent)) {
        agent += ' Mobile';
    }
    agent += ` ${version} (${String(os)})`;
    return agent;
}

const MODE_NAMES = ['no filtering', 'basic', 'optimal', 'complete'] as const;

export interface TroubleshootingInputs {
    manifest: { name?: unknown; version?: unknown };
    platformInfo: Pick<ExtPlatformInfo, 'os'>;
    defaultConfig: Pick<GetDefaultConfigResponse, 'strictBlockMode' | 'popupBlockMode' | 'rulesets'>;
    currentConfig: Pick<RulesetConfig, 'strictBlockMode' | 'popupBlockMode'>;
    enabledRulesets: readonly string[];
    rulesetDetails: readonly Pick<RulesetDetails, 'id' | 'rules'>[];
    defaultMode: number;
    userRules: readonly unknown[];
    consoleOutput: readonly string[];
    registeredScripts: readonly string[];
    hasOmnipotence: boolean;
    /** `runtime.getURL('')`. */
    extURL: string;
    /** `navigator.userAgent`. */
    userAgent: string;
}

/**
 * js/troubleshooting.js:103-155 without `details`. Key order is part of the
 * output (Object.entries order), so keys are added exactly as upstream does.
 * Throws, like upstream, when an enabled id has no entry in the details.
 */
export function buildTroubleshootingConfig(input: TroubleshootingInputs): Record<string, unknown> {
    const details = new Map(input.rulesetDetails.map((d) => [d.id, d]));
    const filtering: Record<string, string> = {};
    filtering.default = `${MODE_NAMES[input.defaultMode as 0 | 1 | 2 | 3]}`;
    const config: Record<string, unknown> = {
        name: input.manifest.name,
        version: input.manifest.version,
        browser: vendorString(input.extURL, input.userAgent, input.platformInfo.os),
        filtering,
        permission: input.hasOmnipotence ? 'all' : 'ask',
    };
    if (input.currentConfig.strictBlockMode !== input.defaultConfig.strictBlockMode) {
        config.strictblock = input.currentConfig.strictBlockMode;
    }
    if (input.currentConfig.popupBlockMode !== input.defaultConfig.popupBlockMode) {
        config.popupblock = input.currentConfig.popupBlockMode;
    }
    if (input.userRules.length !== 0) {
        config['user rules'] = input.userRules.length;
    }
    // Copy: upstream mutates the response array in place (troubleshooting.js:138-147).
    const enabled = [...input.enabledRulesets];
    config.rules = enabled.reduce((a, b) => {
        const entry = details.get(b);
        if (entry === undefined) {
            throw new TypeError(`troubleshooting: no ruleset details for "${b}"`);
        }
        return a + entry.rules.total;
    }, 0);
    const defaultRulesets = input.defaultConfig.rulesets;
    for (let i = 0; i < enabled.length; i++) {
        const id = enabled[i] as string;
        if (defaultRulesets.includes(id)) { continue; }
        enabled[i] = `+${id}`;
    }
    for (const id of defaultRulesets) {
        if (enabled.includes(id)) { continue; }
        enabled.push(`-${id}`);
    }
    config.rulesets = enabled.sort();
    if (input.registeredScripts.length !== 0) {
        config.scripting = [...input.registeredScripts];
    }
    if (input.consoleOutput.length !== 0) {
        config.console = [...input.consoleOutput];
    }
    return config;
}

/**
 * Sends the ten calls of dashboard-shell.md §4.4 in upstream order, all
 * issued synchronously before any of them is awaited, then renders the text.
 * Rejects (BridgeError or TypeError) on any failure; the caller shows an Alert.
 */
export function fetchTroubleshootingInfo(): Promise<string> {
    const manifest = getManifest();
    const all = Promise.all([
        getPlatformInfo(),
        getDefaultConfig(),
        getCurrentConfig(),
        getEnabledRulesets(),
        getRulesetDetails(),
        getDefaultFilteringMode(),
        getEffectiveUserRules(),
        getConsoleOutput(),
        getRegisteredContentScripts(),
        hasBroadHostPermissions(),
    ] as const);
    return all.then(
        ([platformInfo, defaultConfig, currentConfig, enabledRulesets, rulesetDetails, defaultMode, userRules, consoleOutput, registeredScripts, hasOmnipotence]) =>
            renderData(
                buildTroubleshootingConfig({
                    manifest,
                    platformInfo,
                    defaultConfig,
                    currentConfig,
                    enabledRulesets,
                    rulesetDetails,
                    defaultMode,
                    userRules: userRules as readonly DnrRule[],
                    consoleOutput,
                    registeredScripts,
                    hasOmnipotence,
                    extURL: getURL(''),
                    userAgent: globalThis.navigator?.userAgent ?? '',
                }),
            ),
    );
}

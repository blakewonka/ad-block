/**
 * Fixtures for the mock browser API (src/dev/mock-ext.ts). Harness and tests only.
 *
 * Real data, copied byte for byte from PRISTINE
 * (build/pristine/safari: the upstream Safari build renamed to "Blocker", made by scripts/build.sh):
 *   ruleset-details.json   = PRISTINE/rulesets/ruleset-details.json   (51 entries; messaging.md §3.4)
 *   manifest.json          = PRISTINE/manifest.json                   (messaging.md §14)
 *   locales/<folder>.json  = PRISTINE/_locales/<folder>/messages.json (all 71 locales; i18n.md §0)
 * Do not edit these files; re-copy them when the upstream commit changes
 * (manifest.json differs from PRISTINE only in its build-time "version").
 *
 * Derived data (initial background state, scenario presets, exact response
 * shapes) lives in background-state.ts and scenarios.ts, each citing the spec
 * section it follows.
 */
import manifestJson from './manifest.json';
import rulesetDetailsJson from './ruleset-details.json';

export interface LocaleMessage {
    message: string;
    description?: string;
}
export type LocaleMessages = Record<string, LocaleMessage>;

/** Every locale shipped in PRISTINE, keyed by folder name (`en`, `pt_BR`, `zh_TW`, ...). */
export const LOCALES: Readonly<Record<string, LocaleMessages>> = (() => {
    const modules = import.meta.glob<LocaleMessages>('./locales/*.json', { eager: true, import: 'default' });
    const out: Record<string, LocaleMessages> = {};
    for (const [path, messages] of Object.entries(modules)) {
        const folder = /\/([A-Za-z_]+)\.json$/.exec(path)?.[1];
        if (folder !== undefined) out[folder] = messages;
    }
    return out;
})();

/**
 * Locale with the longest strings overall: `el` (Greek). Measured over all
 * 116 keys of the 71 PRISTINE locales, trimmed, in grapheme clusters
 * (Intl.Segmenter): el 5614, fr 5446, so 5356, bg 5339, es 5304, ca 5275;
 * `el` also has the most keys longer than 2x English (10). i18n.md §3 gives
 * the per-key maxima; this is the single "worst overall" locale.
 * `?lang=longest` selects it.
 */
export const LONGEST_LOCALE = 'el';

/** Locales upstream renders right-to-left (i18n.md §2.2, PRISTINE/js/i18n.js:39-44). */
export const RTL_LANGUAGES: readonly string[] = ['ar', 'he', 'fa', 'ps', 'ur'];

export interface StockRulesetDetails {
    id: string;
    name: string;
    group?: string;
    parent?: string;
    lang?: string;
    tags?: string;
    enabled: boolean;
    homeURL: string;
    filters: { total: number; accepted: number; rejected: number };
    rules: { total: number; plain: number; regex: number; [k: string]: number };
    css?: { generic?: number; specific?: number };
    popups?: number;
}

/** The 51 stock ruleset entries in file order (messaging.md §3.4, §6.2). */
export const RULESET_DETAILS = rulesetDetailsJson as unknown as readonly StockRulesetDetails[];

export interface MockManifest {
    name: string;
    short_name?: string;
    version: string;
    version_name?: string;
    permissions?: string[];
    [key: string]: unknown;
}

/** PRISTINE/manifest.json (name `__MSG_extName__`, version `2026.1003.1243`). */
export const MANIFEST = manifestJson as unknown as MockManifest;

/**
 * Graceful degradation of a malformed `getOptionsPageData` answer
 * (dashboard-shell P-3, settings.md checklist 6b).
 *
 * The bridge validates the boot answer strictly and rejects it with a
 * `bad-response` BridgeError (which carries the raw answer). Upstream instead
 * stores whatever arrived and renders what it can (settings.js:330-349). This
 * module decides, field by field, whether the raw answer can still be used
 * safely. It is pure: no DOM, no browser API, no message.
 *
 * Repaired (display-only fields; a wrong value here can never produce a
 * harmful write):
 * - `disabledFeatures` that is not an array (a string, a number, an object…).
 *   Upstream's `renderAdminRules` throws on it (`forbid.join`), skips
 *   `renderWidgets`, and the Develop tab stays hidden (`body[data-develop]`
 *   never set). Here: the admin policy is unreadable, so the safe reading is
 *   applied: the Develop tab and the developer-mode row are off
 *   (`['develop']`), and no other token is invented. An empty string has
 *   `length === 0` upstream and hides nothing, so it is treated as absent.
 *   An array keeps its string entries (upstream `includes`/`join` work on it).
 * - `defaultFilteringMode` that is not an integer 0..3. `'1'`/`'2'`/`'3'`
 *   select that card upstream (the radio selector interpolates the value), so
 *   they become the number. Anything else selects no card (as level 0 does):
 *   the pane still renders every other control (checklist 6b).
 *
 * NOT repaired (the answer is still rejected; the shell shows its error Alert
 * and About stays reachable):
 * - a non-object answer;
 * - `enabledRulesets`, `adminRulesets`, `rulesetDetails` that are malformed.
 *   Guessing them is unsafe: an empty `enabledRulesets` would make the next
 *   backup list every default list as `-<id>` (a restore would then turn
 *   blocking off), and an empty `adminRulesets` would unlock admin-locked
 *   lists. These are writes, so a loud failure is the right outcome.
 */
import type { OptionsData } from './model';

export interface SalvageResult {
    data: OptionsData;
    /** Names of the fields that were repaired (for the console warning and tests). */
    repaired: string[];
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isLevel(v: unknown): v is 0 | 1 | 2 | 3 {
    return v === 0 || v === 1 || v === 2 || v === 3;
}

/**
 * Returns a usable store from a raw boot answer the bridge rejected, or `null`
 * when it cannot be used safely (see the module comment).
 */
export function salvageOptionsData(raw: unknown): SalvageResult | null {
    if (!isObject(raw)) return null;
    if (!isStringArray(raw.enabledRulesets)) return null;
    if (!isStringArray(raw.adminRulesets)) return null;
    if (!Array.isArray(raw.rulesetDetails)) return null;

    const out: Record<string, unknown> = { ...raw };
    const repaired: string[] = [];

    const level = raw.defaultFilteringMode;
    if (!isLevel(level)) {
        repaired.push('defaultFilteringMode');
        out.defaultFilteringMode = level === '1' || level === '2' || level === '3' ? Number(level) : 0;
    }

    const df = raw.disabledFeatures;
    if (df === null || df === undefined) {
        delete out.disabledFeatures; // the bridge's own rule: null means absent (messaging.md §1.4)
    } else if (Array.isArray(df)) {
        if (!isStringArray(df)) {
            repaired.push('disabledFeatures');
            out.disabledFeatures = df.filter((x): x is string => typeof x === 'string');
        }
    } else if (df === '') {
        repaired.push('disabledFeatures');
        delete out.disabledFeatures;
    } else {
        // Unreadable admin policy: Develop off, nothing else hidden.
        repaired.push('disabledFeatures');
        out.disabledFeatures = ['develop'];
    }

    // Nothing to repair means the bridge rejected it for a reason this module
    // does not know about: do not second-guess it.
    if (repaired.length === 0) return null;
    return { data: out as unknown as OptionsData, repaired };
}

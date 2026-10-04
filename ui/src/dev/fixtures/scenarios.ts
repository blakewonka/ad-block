/**
 * Scenario presets for the mock browser API (`?scenario=a,b`, applied in order
 * on top of the `default` state). Harness and tests only.
 *
 * Sources (docs/specs/):
 *   default        messaging.md §21 fixture F (see background-state.ts).
 *   admin-locked   messaging.md §3.6 (admin tokens), popup.md §8.4, settings.md §2.4 and
 *                  filter-lists.md §11 (what each token does). `+`/`-` tokens are applied to the
 *                  enabled list exactly as js/ruleset-manager.js:617-625 does (messaging.md §6.3).
 *   max-rulesets   filter-lists.md §10 / messaging.md §6.3: "at the limit" iff the number of checked
 *                  stock leaves === maxNumberOfEnabledRulesets (the Safari value is UNKNOWN, U4; 5 is a
 *                  test value). Exceeding the limit is answered like a DNR rejection: state unchanged,
 *                  response undefined, echo with the old list (messaging.md §6.3, filter-lists.md §9.5).
 *   no-website     messaging.md §4.1 pre-conditions / popup.md §16 line 5: the active tab is
 *                  `about:blank`, so the popup must send no message at all.
 *   error-on-apply UI rule §6.5 + messaging.md §1.5 row 1: every state-changing message is
 *                  rejected at transport level (as when no receiver exists); reads still answer.
 *   slow           messaging.md §1.6 item 4 / U14: handlers that re-register content scripts can take
 *                  seconds. Every message is answered after 1500 ms, permission prompts after 600 ms.
 */
import type { BackgroundInit } from './background-state';

export const SCENARIO_NAMES = ['default', 'admin-locked', 'max-rulesets', 'no-website', 'error-on-apply', 'slow'] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** Failure injected for one message name (or `'*'` = every message). */
export type FailureMode = 'reject' | 'undefined' | 'null' | 'hang';

/** Messages that change background state (used by `error-on-apply`). Actions and the
 * fire-and-forget `setPendingFilteringMode` are excluded on purpose. */
export const STATE_CHANGING_MESSAGES: readonly string[] = [
    'setFilteringMode',
    'setDefaultFilteringMode',
    'setAutoReload',
    'setShowBlockedCount',
    'setStrictBlockMode',
    'setPopupBlockMode',
    'setDeveloperMode',
    'applyRulesets',
    'importFilterList',
    'setFilteringModeDetails',
    'removeAllCustomFilters',
    'addManyCustomFilters',
    'setSandboxFilters',
    'updateUserDnrRules',
];

/** The part of the mock configuration a scenario may set (see MockConfig in mock-ext.ts). */
export interface ScenarioPatch {
    background?: Partial<BackgroundInit>;
    tabUrl?: string;
    delay?: number;
    permissionDelay?: number;
    failures?: Record<string, FailureMode>;
}

export const SCENARIOS: Readonly<Record<ScenarioName, ScenarioPatch>> = {
    default: {},
    'admin-locked': {
        background: {
            // filteringMode: popup level control inert, Settings default-mode block hidden.
            // develop: developer-mode row hidden, effective developer mode false.
            // picker: picker + unpicker rows and the Custom filters tab hidden.
            disabledFeatures: ['filteringMode', 'develop', 'picker'],
            // +annoyances-cookies forced on, -easyprivacy forced off.
            adminRulesets: ['+annoyances-cookies', '-easyprivacy'],
            enabledRulesets: ['ublock-filters', 'easylist', 'annoyances-cookies'],
            // So that "developer mode forced off by the admin token" is observable.
            developerMode: false,
        },
    },
    'max-rulesets': {
        background: {
            maxNumberOfEnabledRulesets: 5,
            enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'annoyances-cookies', 'deu-0'],
        },
    },
    'no-website': {
        tabUrl: 'about:blank',
    },
    'error-on-apply': {
        failures: Object.fromEntries(STATE_CHANGING_MESSAGES.map((what) => [what, 'reject' as const])),
    },
    slow: {
        delay: 1500,
        permissionDelay: 600,
    },
};

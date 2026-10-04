/**
 * Pane ids, labels and the pure visibility / start-pane rules of the dashboard
 * shell (dashboard-shell.md §2). No DOM, no browser API: unit-tested.
 */

/** Pane ids in nav order (dashboard-shell.md §2.1, R-1). `rulesets` = Filter lists. */
export const PANE_IDS = ['settings', 'rulesets', 'filters', 'develop', 'about'] as const;
export type PaneId = (typeof PANE_IDS)[number];

/** Tab label keys (R-1; no new strings). */
export const PANE_LABEL_KEYS: Readonly<Record<PaneId, string>> = {
    settings: 'settingsPageName',
    rulesets: 'aboutFilterLists',
    filters: 'customFiltersPageName',
    develop: 'developPageName',
    about: 'aboutPageName',
};

/** Panes rendered by the embedded upstream page (dashboard-shell.md §5). */
export const CLASSIC_PANES = ['filters', 'develop'] as const;
export type ClassicPaneId = (typeof CLASSIC_PANES)[number];

export function isPaneId(value: unknown): value is PaneId {
    return typeof value === 'string' && (PANE_IDS as readonly string[]).includes(value);
}

export function isClassicPane(value: unknown): value is ClassicPaneId {
    return value === 'filters' || value === 'develop';
}

/** The part of `getOptionsPageData` the shell reads. */
export interface ShellOptions {
    developerMode?: unknown;
    disabledFeatures?: unknown;
}

function featureList(disabledFeatures: unknown): readonly unknown[] {
    // Upstream: `disabledFeatures?.includes(...)`. Only arrays are honoured here;
    // the bridge already turns `null` into an absent field.
    return Array.isArray(disabledFeatures) ? disabledFeatures : [];
}

export function isFeatureDisabled(options: ShellOptions, token: string): boolean {
    return featureList(options.disabledFeatures).includes(token);
}

/**
 * Effective developer mode (settings.js:72-76):
 * `Boolean(developerMode) && disabledFeatures?.includes('develop') !== true`.
 */
export function effectiveDeveloperMode(options: ShellOptions): boolean {
    return Boolean(options.developerMode) && !isFeatureDisabled(options, 'develop');
}

/**
 * Which tabs are shown (dashboard-shell.md §2.3).
 * `developerModeOn` is the live effective state (it changes on a toggle or a
 * broadcast); `disabledFeatures` is fixed for the document's life.
 */
export function visiblePanes(options: ShellOptions, developerModeOn: boolean): Record<PaneId, boolean> {
    const dashboardOff = isFeatureDisabled(options, 'dashboard');
    const pickerOff = isFeatureDisabled(options, 'picker');
    return {
        settings: !dashboardOff,
        rulesets: !dashboardOff,
        filters: !dashboardOff && !pickerOff,
        develop: developerModeOn,
        about: true,
    };
}

/**
 * Start pane, decided only once BOTH the stored-pane read and the options data
 * have resolved (R-3, R-5, D-1):
 * - `dashboard` disabled: About (forced; no storage write);
 * - a stored string naming a visible pane: that pane;
 * - anything else (absent, not a string, unknown id, hidden pane): Settings.
 */
export function resolveStartPane(stored: unknown, options: ShellOptions, developerModeOn: boolean): PaneId {
    if (isFeatureDisabled(options, 'dashboard')) {
        return 'about';
    }
    const visible = visiblePanes(options, developerModeOn);
    if (isPaneId(stored) && visible[stored]) {
        return stored;
    }
    return 'settings';
}

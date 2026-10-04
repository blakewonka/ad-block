/**
 * Pure helpers of the toolbar popup (no DOM, no browser API).
 * Behaviour source: docs/specs/popup.md (section numbers below) and messaging.md §4.
 */
import type { FilteringLevel, PopupPanelDataResponse } from '@/lib/bridge';

export const LEVELS: readonly FilteringLevel[] = [0, 1, 2, 3];

/** Delay between the `setFilteringMode` answer and the tab reload (js/popup.js:103-109, §5.6 step 7). */
export const RELOAD_DELAY_MS = 437;

/** Delay before the busy overlay becomes visible during a commit (css/popup.css:70-74, §8.2). */
export const BUSY_OVERLAY_DELAY_MS = 1000;

/** The upstream popup kept by the stage step (UI rule §5, §6.9). */
export const CLASSIC_POPUP_URL = 'popup-classic.html';

/** `executeScript` file lists, in their significant order (§6, js/popup.js:259-292). */
export const TOOL_FILES = {
    zapper: ['/js/scripting/tool-overlay.js', '/js/scripting/zapper.js'],
    picker: ['/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/picker.js'],
    unpicker: ['/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/unpicker.js'],
} as const satisfies Record<string, readonly string[]>;

export type ToolName = keyof typeof TOOL_FILES;

/* ------------------------------------------------------------------------ */
/* Tab → target URL (§3.1 steps 2-5)                                          */
/* ------------------------------------------------------------------------ */

export interface WebsiteTarget {
    kind: 'website';
    /** The page the popup acts on (the unwrapped URL on a strict-block page). */
    tabURL: URL;
}

export interface NoWebsiteTarget {
    kind: 'no-website';
}

export type TabTarget = WebsiteTarget | NoWebsiteTarget;

/**
 * Decides whether the active tab is a website, as upstream `init()` does (js/popup.js:303-318):
 * `tab` must be an object; its `url` must parse; a strict-block page is unwrapped
 * (`#<blocked URL>`); the result needs a non-empty hostname and an http(s) protocol.
 *
 * `strictBlockPrefix` is `runtime.getURL('/strictblock.')`.
 */
export function resolveTabTarget(tab: unknown, strictBlockPrefix: string): TabTarget {
    if (typeof tab !== 'object' || tab === null) return { kind: 'no-website' };
    let url: URL | undefined;
    try {
        url = new URL(String((tab as { url?: unknown }).url));
        if (url.href.startsWith(strictBlockPrefix)) {
            url = new URL(url.hash.slice(1));
        }
    } catch {
        // Upstream swallows the exception (js/popup.js:314-315): either `url` is still
        // undefined (bad tab URL) or it is the strict-block page itself (bad hash).
    }
    if (url === undefined || url.hostname === '' || !/^https?:/.test(url.protocol)) {
        return { kind: 'no-website' };
    }
    return { kind: 'website', tabURL: url };
}

/** Payload of `popupPanelData` (§3.2). */
export function panelDataRequest(tabURL: URL): { origin: string; hostname: string } {
    return { origin: tabURL.origin, hostname: tabURL.hostname };
}

/* ------------------------------------------------------------------------ */
/* Level commit rules (§5.6)                                                  */
/* ------------------------------------------------------------------------ */

/** `permissions.request` is made for EVERY commit whose target is 2 or 3 (js/popup.js:66). */
export function needsPermission(after: FilteringLevel): boolean {
    return after > 1;
}

/** `setPendingFilteringMode` only when crossing from {0,1} to {2,3} (js/popup.js:66-67). */
export function needsPendingMessage(before: FilteringLevel, after: FilteringLevel): boolean {
    return after > 1 && before <= 1;
}

/** The origin pattern requested for `hostname` (js/popup.js:80), e.g. `*://*.www.example.com/*`. */
export function permissionOrigins(hostname: string): string[] {
    return [`*://*.${hostname}/*`];
}

/** Reload after a commit when the level in force changed and auto-reload is on (js/popup.js:101). */
export function shouldReload(actual: FilteringLevel, before: FilteringLevel, autoReload: boolean): boolean {
    return actual !== before && autoReload;
}

export type ReloadPlan = { kind: 'reload' } | { kind: 'update'; url: string };

/**
 * `tabs.reload` when the tab's own `url` string equals the parsed URL, otherwise
 * `tabs.update(id, { url: tabURL.href })` (strict-block page, or a tab URL that is not
 * in normalised form) (js/popup.js:102-108).
 */
export function reloadPlan(tabURLHref: string, tabUrl: unknown): ReloadPlan {
    return tabURLHref === tabUrl ? { kind: 'reload' } : { kind: 'update', url: tabURLHref };
}

/* ------------------------------------------------------------------------ */
/* Report (§6 call D)                                                         */
/* ------------------------------------------------------------------------ */

/**
 * `gotoURL` value for the report page: path + query of `reportPageURL`
 * (`runtime.getURL('/report.html')`) with `tabid`, `url`, `mode` set in that order
 * (js/popup.js:237-243). `mode` is the level at popup OPEN (upstream quirk, §14 item 4).
 */
export function reportPath(reportPageURL: string, tabId: unknown, tabURLHref: string, levelAtOpen: number): string {
    const url = new URL(reportPageURL);
    url.searchParams.set('tabid', String(tabId));
    url.searchParams.set('url', tabURLHref);
    url.searchParams.set('mode', String(levelAtOpen));
    return `${url.pathname}${url.search}`;
}

/* ------------------------------------------------------------------------ */
/* What is shown (§6, §7, §8.4, §8.5)                                         */
/* ------------------------------------------------------------------------ */

export interface PopupVisibility {
    /** Level control shown but not operable (admin token `filteringMode`). */
    modeReadOnly: boolean;
    zapper: boolean;
    picker: boolean;
    unpicker: boolean;
    report: boolean;
    /** The "On this website" section (removed when zapper, picker and report are all forbidden). */
    localTools: boolean;
    /** The ribbon's dashboard button (removed with the whole ribbon by `dashboard`). */
    dashboard: boolean;
    matchedRules: boolean;
}

/**
 * Upstream joins the list with ' ' into `body[data-forbid]` and matches each token with the
 * CSS `~=` selector (js/popup.js:36-38; css/popup.css:97-109). So every entry is split on CSS
 * whitespace (space, tab, LF, CR, FF) and matched case-sensitively: `' filteringMode'`,
 * `'filteringMode '` and `'zapper picker'` all forbid.
 */
export function forbiddenTokens(disabledFeatures: readonly string[] | null | undefined): Set<string> {
    const out = new Set<string>();
    if (!Array.isArray(disabledFeatures)) return out;
    for (const entry of disabledFeatures) {
        for (const token of String(entry).split(/[\t\n\f\r ]+/)) {
            if (token !== '') out.add(token);
        }
    }
    return out;
}

/** Visibility in the READY state. */
export function readyVisibility(panel: PopupPanelDataResponse, tabId: unknown): PopupVisibility {
    const forbid = forbiddenTokens(panel.disabledFeatures);
    const ribbon = !forbid.has('dashboard');
    return {
        modeReadOnly: forbid.has('filteringMode'),
        zapper: !forbid.has('zapper'),
        picker: !forbid.has('picker'),
        unpicker: !forbid.has('picker') && Boolean(panel.hasCustomFilters),
        report: !forbid.has('report'),
        localTools: !(forbid.has('zapper') && forbid.has('picker') && forbid.has('report')),
        dashboard: ribbon,
        matchedRules:
            ribbon &&
            panel.isSideloaded === true &&
            Boolean(panel.developerMode) &&
            typeof tabId === 'number' &&
            !Number.isNaN(tabId),
    };
}

/**
 * Visibility outside READY (loading, no website, error): only the dashboard button.
 * Admin tokens are not known there, so the dashboard stays (upstream quirk, §8.3, §14 item 9).
 */
export const NON_READY_VISIBILITY: PopupVisibility = Object.freeze({
    modeReadOnly: true,
    zapper: false,
    picker: false,
    unpicker: false,
    report: false,
    localTools: false,
    dashboard: true,
    matchedRules: false,
});

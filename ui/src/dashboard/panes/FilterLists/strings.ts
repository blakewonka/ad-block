/**
 * Strings of the Filter lists pane that upstream does not have (filter-lists.md
 * §1.8 last line: no upstream string for an error, the limit, or no results).
 * English-only through `tNew` (UI rule §6.7, docs/specs/README.md). The wording
 * names no browser: the same pane runs in Safari, Chromium browsers and Firefox.
 */
import { tNew } from '@/lib/i18n';

export const S = {
    loadFailed: () => tNew('filterListsLoadFailed', 'The filter lists could not be loaded.'),
    reloadHint: () => tNew('filterListsReloadHint', 'Reload the page to try again.'),
    retry: () => tNew('filterListsRetry', 'Try again'),
    refreshFailed: () =>
        tNew('filterListsRefreshFailed', 'The filter lists could not be refreshed. What you see may be out of date.'),
    saving: () => tNew('filterListsSaving', 'Saving…'),
    saveSlow: () =>
        tNew('filterListsSaveSlow', 'Your changes have not been saved yet. Blocker is still waiting for the browser.'),
    saveFailed: () => tNew('filterListsSaveFailed', 'Your changes could not be saved.'),
    saveFailedHint: () =>
        tNew('filterListsSaveFailedHint', 'The lists below show what is enabled now. Try your change again.'),
    notApplied: (lists: string) => tNew('filterListsNotApplied', 'The browser did not enable: {{lists}}', { lists }),
    notAppliedHint: () =>
        tNew(
            'filterListsNotAppliedHint',
            'The browser limits how many filter lists and rules can be enabled at the same time. Turn off another list, then try again.',
        ),
    limitReached: (max: string) =>
        tNew(
            'filterListsLimitReached',
            'The maximum number of enabled filter lists ({{max}}) is reached. Turn a list off before you turn another one on.',
            { max },
        ),
    managed: () => tNew('filterListsManaged', 'Managed by your administrator'),
    hideUnused: () => tNew('filterListsHideUnused', 'Hide unused lists'),
    hiddenCount: (count: string) => tNew('filterListsHiddenCount', '{{count}} hidden', { count }),
    notAppliedTitle: () => tNew('filterListsNotAppliedTitle', 'Not every filter list could be enabled'),
    limitTitle: () => tNew('filterListsLimitTitle', 'Filter list limit reached'),
    clearSearch: () => tNew('filterListsClearSearch', 'Clear search'),
    noResults: () => tNew('filterListsNoResults', 'No filter lists match your search.'),
    homeLink: (name: string) => tNew('filterListsHomeLink', 'Website of {{name}}', { name }),
    count: (checked: number, total: number) =>
        tNew('filterListsCount', '{{checked}} of {{total}} enabled', { checked, total }),
    prefSaveFailed: () => tNew('filterListsPrefSaveFailed', 'This display preference could not be saved.'),
    dismiss: () => tNew('filterListsDismiss', 'Dismiss'),
    /* Imported lists (only where the background supports them, §12). */
    removeList: (name: string) => tNew('filterListsRemoveImported', 'Remove {{name}}', { name }),
    undoRemoveList: (name: string) => tNew('filterListsUndoRemoveImported', 'Keep {{name}}', { name }),
    removalPending: () =>
        tNew('filterListsRemovalPending', 'Will be removed when you close this page.'),
    importFailed: () => tNew('filterListsImportFailed', 'The filter list could not be added.'),
    importInvalid: () => tNew('filterListsImportInvalid', 'Enter the full address of a filter list, for example https://example.com/list.txt'),
    importAdded: () => tNew('filterListsImportAdded', 'Filter list added.'),
} as const;

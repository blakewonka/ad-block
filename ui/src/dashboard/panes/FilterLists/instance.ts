/**
 * The page's single Filter lists controller, wired to the bridge, storage and
 * the page-wide options store.
 *
 * One per page: the pane is mounted once and kept mounted by the shell, and the
 * hide-unused preference is read once per page load (§7.2). Created lazily at
 * the first show of the pane (§2.1), never at import.
 */
import { applyRulesets, getEnabledRulesets, getRulesetDetails, importFilterList, type RulesetDetails } from '@/lib/bridge';
import type { ListDetails } from '@/lib/model/filterLists';
import { readHideUnusedFilterLists, writeHideUnusedFilterLists } from '@/lib/storage';

import { getOptionsSnapshot, registerBeforeRestore, subscribeOptions } from '../Settings';
import { replaceRulesetData } from '../Settings/store';
import { FilterListsController, type OptionsStatus } from './controller';

let instance: FilterListsController | null = null;

function optionsStatus(): OptionsStatus {
    const s = getOptionsSnapshot();
    if (s.status === 'ready') {
        return {
            status: 'ready',
            listsRevision: s.listsRevision,
            options: {
                adminRulesets: s.data.adminRulesets,
                maxNumberOfEnabledRulesets: s.data.maxNumberOfEnabledRulesets,
                supportsCompiledFilters: s.data.supportsCompiledFilters,
            },
        };
    }
    if (s.status === 'error') return { status: 'error', error: s.error };
    return { status: 'loading' };
}

export function getFilterListsController(): FilterListsController {
    if (instance !== null) return instance;
    const controller = new FilterListsController({
        getEnabledRulesets: () => getEnabledRulesets(),
        // Runtime JSON records; the model types them loosely (ListDetails).
        getRulesetDetails: () => getRulesetDetails() as Promise<unknown> as Promise<ListDetails[]>,
        applyRulesets: (payload) => applyRulesets(payload),
        importFilterList: (url) => importFilterList({ url }),
        readHideUnused: () => readHideUnusedFilterLists(),
        writeHideUnused: (list) => writeHideUnusedFilterLists(list),
        getOptions: optionsStatus,
        subscribeOptions,
        publishRulesetData: (enabledRulesets, rulesetDetails) =>
            replaceRulesetData({ enabledRulesets, rulesetDetails: rulesetDetails as unknown as RulesetDetails[] }),
    });
    // settings.md §7.4 / H17: restore and reset wait for a pending commit to be sent.
    registerBeforeRestore(() => controller.flush());
    // D1 (§14): flush a pending change when the page goes away.
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', () => controller.pageHide());
    }
    instance = controller;
    return controller;
}

/** Tests only. */
export function resetFilterListsControllerForTests(): void {
    instance?.dispose();
    instance = null;
}

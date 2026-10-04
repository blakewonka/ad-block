/**
 * Pane registry of the React dashboard (dashboard-shell.md §2.1).
 *
 * PANE CONTRACT: every React pane is a component with no required props that
 * loads its own data (the Settings and Filter-lists panes share one
 * `getOptionsPageData` through `@/dashboard/panes/Settings/store`). The two
 * classic panes have no component here: they are shown by the single shared
 * `ClassicFrame` (`@/dashboard/panes/Classic`), which the shell owns.
 */
import type { ComponentType } from 'react';

import type { PaneId } from '@/dashboard/shell/panes';

import { AboutPane } from './About';
import { FilterListsPane } from './FilterLists';
import { SettingsPane } from './Settings';

export type ReactPaneId = Exclude<PaneId, 'filters' | 'develop'>;

export interface PaneEntry {
    id: PaneId;
    /** i18n key of the tab label (R-1). */
    labelKey: string;
    /** `react`: a component below; `classic`: rendered inside the classic frame. */
    kind: 'react' | 'classic';
    Component?: ComponentType;
}

export const PANES: readonly PaneEntry[] = [
    { id: 'settings', labelKey: 'settingsPageName', kind: 'react', Component: SettingsPane },
    { id: 'rulesets', labelKey: 'aboutFilterLists', kind: 'react', Component: FilterListsPane },
    { id: 'filters', labelKey: 'customFiltersPageName', kind: 'classic' },
    { id: 'develop', labelKey: 'developPageName', kind: 'classic' },
    { id: 'about', labelKey: 'aboutPageName', kind: 'react', Component: AboutPane },
];

export const REACT_PANE_COMPONENTS: Readonly<Record<ReactPaneId, ComponentType>> = {
    settings: SettingsPane,
    rulesets: FilterListsPane,
    about: AboutPane,
};

export { AboutPane } from './About';
export { ClassicFrame } from './Classic';

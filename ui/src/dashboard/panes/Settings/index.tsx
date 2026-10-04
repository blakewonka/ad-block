/**
 * Settings pane public API.
 *
 * The shell and the other panes share the page-wide options store
 * (one getOptionsPageData and one BroadcastChannel per page, settings.md §2.3):
 * call `loadOptionsData()` at start-up and read `useOptionsStore()`; its `develop`
 * field is the Develop-tab gate. A pane with a pending commit registers
 * `registerBeforeRestore()` (settings.md §7.4, H17).
 */
export { SettingsPane } from './SettingsPane';
export {
    getOptionsSnapshot,
    loadOptionsData,
    registerBeforeRestore,
    subscribeOptions,
    useOptionsStore,
    type OptionsState,
} from './store';
export { adminFlags, effectiveDeveloperMode, supportsTokens, type OptionsData } from './model';

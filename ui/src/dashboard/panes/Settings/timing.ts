/**
 * Watchdogs of the Settings pane.
 *
 * The bridge has no timeout, and upstream's background never answers when its
 * handler throws (settings.md U9), and a permission prompt may never settle
 * (U2). A mode change or a toggle that has had no answer after `watchdogMs`
 * is given up: the control shows the stored value again and the failure is
 * announced, so nothing stays "pending" forever. A late answer still updates
 * the store (it is the background's truth) but is not announced.
 *
 * Mutable only so unit tests can shorten it.
 */
export const settingsTiming = {
    watchdogMs: 120_000,
};

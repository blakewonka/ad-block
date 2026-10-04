/**
 * Filter lists pane controller: state, reads, the debounced commit and the
 * hide-unused preference (docs/specs/filter-lists.md §2, §4, §7, §9, §13, §14).
 *
 *
 * All list logic (tree, tri-state, totals, search, payload) lives in the pure,
 * tested model `@/lib/model/filterLists`; this file only sequences it in time.
 * No React here: the pane subscribes with `useSyncExternalStore`.
 *
 * Sequencing rules (spec references in brackets):
 * - Reads: `getEnabledRulesets` and `getRulesetDetails` are sent together, in
 *   that order, without waiting (§1.2). Only the most recently requested pair
 *   is applied (§13, checklist 41). A failed read keeps the last good tree and
 *   baseline and is shown (D4, Q12).
 * - Commit: every checkbox change (re)starts a 997 ms timer (§9.1). When it
 *   fires while a commit is unsettled (or while a re-read after a failed commit
 *   is still owed, D4) it re-arms instead (§9.4, Q14). The payload is the
 *   complete list built by `planCommit` (§9.2); `toggled` is emptied at commit
 *   start whatever the plan says (FL:440).
 * - After a commit settles: a rejected send is shown and the state is re-read
 *   before any further commit (D4); a resolved one re-reads itself when no
 *   `{ enabledRulesets }` broadcast caused a re-read since the commit started
 *   (D8, Q16).
 * - The only failure signal Safari leaves is a mismatch between what was sent
 *   and the next read (§9.5); it is reported as `notApplied`. Only the FIRST
 *   read requested after a resolved commit is compared (the echo read or the
 *   D8 read), and only when no newer read superseded it; a rejected commit is
 *   never compared. Later changes of the enabled set (another tab, a Settings
 *   reset) are not failures (F1).
 * - Until a read that reflects a resolved commit has been applied, the next
 *   commit compares against what that commit sent, not the stale baseline
 *   (F3; the Q16 class that D8 closes).
 * - Page hide: a pending change is flushed once (D1); nothing is sent when
 *   nothing is pending (D7).
 * - Restore/reset (settings.md §7.4, H17): `flush()` sends a pending change
 *   immediately and waits for every unsettled commit, so the restore's own
 *   `applyRulesets` always lands last. The wait is bounded by SLOW_COMMIT_MS
 *   (a hung send must not block the restore, F4). The last commit is then marked
 *   superseded and never verified (§9.5): any later read may already reflect the
 *   restore (F1 remnant). A pending change that cannot
 *   be sent then (a commit still unsettled, or a re-read owed after a failed
 *   one) is dropped from `toggled`, so the next read shows the real state: the
 *   restore's own list supersedes it either way (F2).
 */
import type { ApplyRulesetsPayload, ListDetails, ListTree, RemovalFlags, Selection } from '@/lib/model/filterLists';
import {
    adminLockedIds,
    flagRemoval,
    isValidImportUrl,
    pruneRemovalFlags,
    unflagRemoval,
    afterCommitAction,
    applyServerRead,
    buildListTree,
    COMMIT_DEBOUNCE_MS,
    commitMismatch,
    commitTimerAction,
    emptySelection,
    hideUnusedInit,
    pageHideFlush,
    planCommit,
    startCommit,
    toggleHideUnused as modelToggleHideUnused,
    toggleLeaf as modelToggleLeaf,
    toggleNode as modelToggleNode,
} from '@/lib/model/filterLists';

/** The options data this pane needs (from the page-wide store, settings.md §2.3). */
export interface ListsOptions {
    adminRulesets?: readonly unknown[];
    maxNumberOfEnabledRulesets?: number | null;
    supportsCompiledFilters?: boolean;
}

export type OptionsStatus =
    | { status: 'loading' }
    | { status: 'error'; error: unknown }
    | { status: 'ready'; options: ListsOptions; listsRevision: number };

export interface ControllerDeps {
    getEnabledRulesets(): Promise<string[]>;
    getRulesetDetails(): Promise<ListDetails[]>;
    applyRulesets(payload: ApplyRulesetsPayload): Promise<unknown>;
    /** `{ what: 'importFilterList', url }` (§1.5, §12.2). Only offered with compiled-filter support. */
    importFilterList?(url: string): Promise<unknown>;
    readHideUnused(): Promise<unknown>;
    writeHideUnused(list: string[]): Promise<void>;
    /** Options store access (the store triggers the reads on broadcasts through `listsRevision`). */
    getOptions(): OptionsStatus;
    subscribeOptions(listener: () => void): () => void;
    /** Keep the page store's `enabledRulesets` / `rulesetDetails` current (spec §1.1, checklist 36). */
    publishRulesetData?(enabledRulesets: string[], rulesetDetails: ListDetails[]): void;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (id: unknown) => void;
}

export type ReadTrigger = 'initial' | 'broadcast' | 'after-commit' | 'after-error' | 'retry';

export interface ListsState {
    /** Set once `start()` ran (= the pane has been shown, §2.1). */
    started: boolean;
    /** Hide-unused preference: read once per controller (§7.2). */
    hideUnusedLoaded: boolean;
    hideUnused: ReadonlySet<string>;
    /** Last good read (null until the first successful pair). */
    data: { tree: ListTree; serverEnabled: ReadonlySet<string> } | null;
    selection: Selection;
    read: {
        /** A read pair is in flight. */
        pending: boolean;
        /** Error of the most recent read pair, cleared by the next success. */
        error: unknown;
    };
    search: string;
    commit: {
        /** The 997 ms timer is armed (an unsent change exists). */
        timerPending: boolean;
        /** An `applyRulesets` is unsettled (upstream body.committing, §9.4). */
        committing: boolean;
        /** The unsettled commit is taking longer than SLOW_COMMIT_MS (Q14). */
        slow: boolean;
        /** Rejection of the last commit (D4); cleared by the next successful one. */
        error: unknown;
        /** D4: a failed commit requires a successful re-read before the next commit. */
        needsReread: boolean;
        /** Ids that were sent but are not enabled after the following read (§9.5). */
        notApplied: string[];
    };
    /** Failure of the last hide-unused storage write (upstream ignores it, §1.6). */
    prefError: unknown;
    /**
     * Imported lists flagged for removal (§12.3), with their checked state before the
     * flag. They are deleted by the page-hide commit (`toRemove`, §14).
     */
    removing: RemovalFlags;
    /** "Add filter list…" (§12.2). */
    importing: {
        pending: boolean;
        /** Rejection of the last import (upstream ignores it); cleared by the next attempt. */
        error: unknown;
        /** Increases with every successful import (the view closes and clears the form). */
        done: number;
    };
}

/** After this long an unsettled commit is reported as "not completed yet" (Q14; UI choice). */
export const SLOW_COMMIT_MS = 8000;
/**
 * D8 grace: after a resolved commit, wait this long for the background's
 * `{ enabledRulesets }` echo before re-reading ourselves (arrival order of the
 * response and the echo is UNKNOWN 17.7, so either order must work).
 */
export const ECHO_GRACE_MS = 250;

type Listener = () => void;

interface CommitRecord {
    sent: string[];
    status: 'inflight' | 'resolved' | 'rejected';
    /** A broadcast-driven read was requested after this commit started (D8). */
    rereadSeen: boolean;
    /** §9.5: the read that will verify this commit has been requested (only one ever does). */
    verifyClaimed: boolean;
    /** `readSeq` when the commit started: reads with a higher seq were requested after it. */
    startSeq: number;
    /** A read requested after the commit started was applied after it resolved (F3). */
    readApplied: boolean;
    /**
     * A restore/reset's own `applyRulesets` follows this commit (`flush()`), so no
     * later read can tell a refusal from the restore: never verify it (§9.5, F1 remnant).
     */
    superseded: boolean;
}

export class FilterListsController {
    private state: ListsState;
    private readonly listeners = new Set<Listener>();
    private readonly deps: ControllerDeps;
    private readonly setTimer: (fn: () => void, ms: number) => unknown;
    private readonly clearTimer: (id: unknown) => void;

    private readSeq = 0;
    private timer: unknown = null;
    private slowTimer: unknown = null;
    private commitPromise: Promise<void> | null = null;
    private record: CommitRecord | null = null;
    private lastListsRevision: number | null = null;
    private unsubscribeOptions: (() => void) | null = null;
    private hideUnusedPromise: Promise<void> | null = null;

    constructor(deps: ControllerDeps) {
        this.deps = deps;
        this.setTimer = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
        this.clearTimer = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
        this.state = {
            started: false,
            hideUnusedLoaded: false,
            hideUnused: hideUnusedInit(undefined),
            data: null,
            selection: emptySelection(),
            read: { pending: false, error: null },
            search: '',
            commit: {
                timerPending: false,
                committing: false,
                slow: false,
                error: null,
                needsReread: false,
                notApplied: [],
            },
            prefError: null,
            removing: new Map(),
            importing: { pending: false, error: null, done: 0 },
        };
    }

    /* -------------------------------------------------------------- store */

    getState = (): ListsState => this.state;

    subscribe = (listener: Listener): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private set(patch: Partial<ListsState>): void {
        this.state = { ...this.state, ...patch };
        for (const listener of Array.from(this.listeners)) {
            try {
                listener();
            } catch (err) {
                console.error('[filter lists] listener failed', err);
            }
        }
    }

    private setCommit(patch: Partial<ListsState['commit']>): void {
        this.set({ commit: { ...this.state.commit, ...patch } });
    }

    private options(): ListsOptions {
        const o = this.deps.getOptions();
        return o.status === 'ready' ? o.options : {};
    }

    /* ---------------------------------------------------------- lifecycle */

    /**
     * First show of the pane (§2.1): read the hide-unused preference once and send
     * the first read pair. Idempotent.
     */
    start(): void {
        if (this.state.started) return;
        this.set({ started: true });
        this.hideUnusedPromise = this.deps.readHideUnused().then(
            (stored) => {
                // §7.2: a stored array replaces the default; anything else keeps it.
                this.set({ hideUnusedLoaded: true, hideUnused: hideUnusedInit(stored) });
            },
            (err: unknown) => {
                console.warn('[filter lists] hideUnusedFilterLists could not be read', err);
                this.set({ hideUnusedLoaded: true });
            },
        );
        const o = this.deps.getOptions();
        this.lastListsRevision = o.status === 'ready' ? o.listsRevision : null;
        this.unsubscribeOptions = this.deps.subscribeOptions(this.onOptions);
        this.reread('initial');
    }

    /** Stops listening and clears the timers (tests; the pane itself stays mounted). */
    dispose(): void {
        this.unsubscribeOptions?.();
        this.unsubscribeOptions = null;
        if (this.timer !== null) this.clearTimer(this.timer);
        if (this.slowTimer !== null) this.clearTimer(this.slowTimer);
        this.timer = null;
        this.slowTimer = null;
    }

    /** For tests: resolves when the preference read finished. */
    whenHideUnusedLoaded(): Promise<void> {
        return this.hideUnusedPromise ?? Promise.resolve();
    }

    private onOptions = (): void => {
        const o = this.deps.getOptions();
        if (o.status !== 'ready') return;
        if (this.lastListsRevision === null) {
            // Options arrived after the first show: nothing was broadcast to this page yet.
            this.lastListsRevision = o.listsRevision;
            this.emitNoop();
            return;
        }
        if (o.listsRevision !== this.lastListsRevision) {
            this.lastListsRevision = o.listsRevision;
            // §13: an `{ enabledRulesets }` or changed `{ adminRulesets }` broadcast re-reads.
            this.reread('broadcast');
        } else {
            this.emitNoop();
        }
    };

    /** Re-emit so the view re-derives from new options (admin tokens, limit). */
    private emitNoop(): void {
        this.set({});
    }

    /* -------------------------------------------------------------- reads */

    /** Sends one read pair; only the most recently requested pair is applied (§13). */
    reread(trigger: ReadTrigger): void {
        const seq = ++this.readSeq;
        let verify: CommitRecord | null = null;
        const record = this.record;
        if (record !== null) {
            if (trigger === 'broadcast') record.rereadSeen = true;
            // §9.5 (F1): only the first read after the commit (echo or D8 read) verifies it.
            const eligible = trigger === 'after-commit' || trigger === 'broadcast';
            if (eligible && record.status !== 'rejected' && !record.verifyClaimed && !record.superseded) {
                record.verifyClaimed = true;
                verify = record;
            }
        }
        this.set({ read: { ...this.state.read, pending: true } });
        // Both sends are issued synchronously, enabled first (§1.2, checklist 2).
        let enabledP: Promise<string[]>;
        let detailsP: Promise<ListDetails[]>;
        try {
            enabledP = this.deps.getEnabledRulesets();
        } catch (err) {
            enabledP = Promise.reject(err);
        }
        try {
            detailsP = this.deps.getRulesetDetails();
        } catch (err) {
            detailsP = Promise.reject(err);
        }
        Promise.all([enabledP, detailsP]).then(
            ([enabled, details]) => {
                if (seq !== this.readSeq) return;
                this.applyRead(enabled, details, seq, verify);
            },
            (error: unknown) => {
                console.warn('[filter lists] read failed', error);
                if (seq !== this.readSeq) return;
                // D4 / Q12: keep the last good tree and baseline; show the failure.
                this.set({ read: { pending: false, error } });
            },
        );
    }

    private applyRead(enabled: string[], details: ListDetails[], seq: number, verify: CommitRecord | null): void {
        const tree = buildListTree(details);
        const { selection, serverEnabled } = applyServerRead(this.state.selection, tree, enabled);
        let notApplied = this.state.commit.notApplied;
        const record = this.record;
        if (verify !== null && verify === record && !record.superseded) {
            if (record.status === 'resolved') {
                const admin = adminLockedIds(tree, this.options().adminRulesets);
                const known = record.sent.filter((id) => tree.leafById.has(id));
                notApplied = commitMismatch(known, serverEnabled, admin).notEnabled;
            } else if (record.status === 'inflight') {
                // Answered before the commit settled: it may not reflect it. Let a later read verify.
                record.verifyClaimed = false;
                record.rereadSeen = false;
            }
        }
        if (record !== null && record.status === 'resolved' && seq > record.startSeq) record.readApplied = true;
        this.state = {
            ...this.state,
            data: { tree, serverEnabled },
            selection,
            removing: pruneRemovalFlags(this.state.removing, tree),
            read: { pending: false, error: null },
            commit: { ...this.state.commit, needsReread: false, notApplied },
        };
        this.set({});
        try {
            this.deps.publishRulesetData?.(enabled.slice(), details);
        } catch (err) {
            console.warn('[filter lists] could not update the page store', err);
        }
    }

    /* ------------------------------------------------------- user changes */

    toggleLeaf(id: string, value?: boolean): void {
        if (this.state.data === null) return;
        if (!this.state.data.tree.leafById.has(id)) return;
        // A list flagged for removal has a disabled checkbox (FL:507).
        if (this.state.removing.has(id)) return;
        this.set({ selection: modelToggleLeaf(this.state.selection, id, value) });
        this.scheduleCommit();
    }

    /** Composite node checkbox: none -> all, partial -> all, all -> none (§6). Admin leaves untouched (Q3 fix). */
    toggleNode(nodeId: string): void {
        const data = this.state.data;
        if (data === null) return;
        const node = data.tree.nodeById.get(nodeId);
        if (node === undefined || node.kind !== 'node') return;
        const skip = adminLockedIds(data.tree, this.options().adminRulesets);
        this.set({ selection: modelToggleNode(this.state.selection, node, { skip }) });
        this.scheduleCommit();
    }

    /** Trash icon of an imported list (§12.3, FL:501-511): uncheck it now, delete it on page hide. */
    removeImported(id: string): void {
        const data = this.state.data;
        if (data === null) return;
        const next = flagRemoval(this.state.selection, this.state.removing, data.tree.leafById.get(id));
        if (next.removing === this.state.removing) return;
        this.set(next);
        this.scheduleCommit();
    }

    /** Undo icon (§12.3, FL:513-523): restore the checked state the list had. */
    undoRemoveImported(id: string): void {
        if (this.state.data === null) return;
        const next = unflagRemoval(this.state.selection, this.state.removing, id);
        if (next.removing === this.state.removing) return;
        this.set(next);
        this.scheduleCommit();
    }

    /**
     * "Add filter list…" (§12.2, FL:490-499). An address that fails upstream's test
     * sends nothing and resolves false. Otherwise sends `{ what: 'importFilterList', url }`
     * once; the background enables the list and broadcasts `{ enabledRulesets }`, which
     * re-reads the lists (§13). Resolves true when the message was answered.
     */
    async importList(url: string): Promise<boolean> {
        const send = this.deps.importFilterList;
        if (send === undefined || this.state.importing.pending) return false;
        if (!isValidImportUrl(url)) return false;
        this.set({ importing: { ...this.state.importing, pending: true, error: null } });
        try {
            await send(url);
        } catch (error) {
            console.warn('[filter lists] importFilterList failed', error);
            this.set({ importing: { ...this.state.importing, pending: false, error } });
            return false;
        }
        this.set({ importing: { pending: false, error: null, done: this.state.importing.done + 1 } });
        return true;
    }

    dismissImportError(): void {
        if (this.state.importing.error !== null) this.set({ importing: { ...this.state.importing, error: null } });
    }

    setSearch(pattern: string): void {
        if (pattern === this.state.search) return;
        this.set({ search: pattern });
    }

    /** One hide-unused toggle (§7.2): flips membership and writes the whole array. */
    toggleHideUnused(nodeId: string): void {
        const { set, stored } = modelToggleHideUnused(this.state.hideUnused, nodeId);
        this.set({ hideUnused: set });
        this.writePref(stored);
    }

    /**
     * Header switch: puts every given node in (or out of) the hide-unused state
     * with ONE write of the whole array (same key and format as §7.2).
     */
    setHideUnusedFor(nodeIds: readonly string[], on: boolean): void {
        let set = this.state.hideUnused;
        let stored: string[] | null = null;
        for (const id of nodeIds) {
            if (set.has(id) === on) continue;
            const next = modelToggleHideUnused(set, id);
            set = next.set;
            stored = next.stored;
        }
        if (stored === null) return;
        this.set({ hideUnused: set });
        this.writePref(stored);
    }

    private writePref(stored: string[]): void {
        this.deps.writeHideUnused(stored).then(
            () => {
                if (this.state.prefError !== null) this.set({ prefError: null });
            },
            (error: unknown) => {
                this.set({ prefError: error });
            },
        );
    }

    dismissCommitError(): void {
        this.setCommit({ error: null });
    }

    dismissNotApplied(): void {
        this.setCommit({ notApplied: [] });
    }

    dismissPrefError(): void {
        this.set({ prefError: null });
    }

    /* ------------------------------------------------------------- commit */

    /** §9.1: cancel a pending timer and start a new one of 997 ms. */
    private scheduleCommit(): void {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = this.setTimer(this.onTimer, COMMIT_DEBOUNCE_MS);
        if (!this.state.commit.timerPending) this.setCommit({ timerPending: true });
    }

    private onTimer = (): void => {
        this.timer = null;
        const blocked = this.state.commit.committing || this.state.commit.needsReread || this.state.data === null;
        if (commitTimerAction(blocked) === 'rearm') {
            // §9.4: a due commit is postponed by another 997 ms, never sent in parallel.
            this.timer = this.setTimer(this.onTimer, COMMIT_DEBOUNCE_MS);
            return;
        }
        this.setCommit({ timerPending: false });
        void this.commit();
    };

    /** §9.2. Resolves when the commit (if any) has settled. */
    private commit(): Promise<void> {
        const data = this.state.data;
        if (data === null) return Promise.resolve();
        const plan = planCommit({
            tree: data.tree,
            checked: this.state.selection.checked,
            adminRulesets: this.options().adminRulesets,
            serverEnabled: this.baseline() ?? data.serverEnabled,
            // Q5 fix (spec §16: both are safe): no redundant re-send because of admin-enabled ids.
            ignoreAdminInBaseline: true,
        });
        // FL:440: `toggled` is emptied at commit start, whatever the plan says.
        this.set({ selection: startCommit(this.state.selection) });
        if (plan.payload === null) return Promise.resolve();
        const record: CommitRecord = {
            sent: plan.enabledRulesets,
            status: 'inflight',
            rereadSeen: false,
            verifyClaimed: false,
            startSeq: this.readSeq,
            readApplied: false,
            superseded: false,
        };
        this.record = record;
        this.setCommit({ committing: true, slow: false, notApplied: [] });
        this.slowTimer = this.setTimer(() => {
            this.slowTimer = null;
            if (this.state.commit.committing) this.setCommit({ slow: true });
        }, SLOW_COMMIT_MS);
        let sendP: Promise<unknown>;
        try {
            sendP = this.deps.applyRulesets(plan.payload);
        } catch (err) {
            sendP = Promise.reject(err);
        }
        const p = sendP.then(
            () => {
                record.status = 'resolved';
                this.endCommit();
                this.setCommit({ error: null });
                // D8: re-read unless the echo already caused a re-read.
                this.setTimer(() => {
                    if (this.record !== record) return;
                    if (afterCommitAction(record.rereadSeen) === 'reread') this.reread('after-commit');
                }, ECHO_GRACE_MS);
            },
            (error: unknown) => {
                record.status = 'rejected';
                // The UI shows a plain-language notice; the technical reason goes to the console.
                console.warn('[filter lists] applyRulesets failed', error);
                this.endCommit();
                // D4: show it, re-read before any further commit.
                this.setCommit({ error, needsReread: true });
                this.reread('after-error');
            },
        );
        this.commitPromise = p;
        void p.finally(() => {
            if (this.commitPromise === p) this.commitPromise = null;
        });
        return p;
    }

    /**
     * F3: the list the background has after the last resolved commit, until a read
     * reflecting it has been applied; null when the last read is current.
     */
    private baseline(): string[] | null {
        const r = this.record;
        return r !== null && r.status === 'resolved' && !r.readApplied ? r.sent : null;
    }

    private endCommit(): void {
        if (this.slowTimer !== null) this.clearTimer(this.slowTimer);
        this.slowTimer = null;
        this.setCommit({ committing: false, slow: false });
    }

    /**
     * Restore/reset hook (settings.md §7.4, H17): send a pending change now and wait
     * until no commit is unsettled, so the restore's `applyRulesets` lands last.
     */
    async flush(): Promise<void> {
        let pending = false;
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
            pending = true;
        }
        // F4: never wait longer than SLOW_COMMIT_MS in total for a send to settle.
        let timedOut = false;
        let timeoutId: unknown = null;
        const timeout = new Promise<void>((resolve) => {
            timeoutId = this.setTimer(() => {
                timedOut = true;
                resolve();
            }, SLOW_COMMIT_MS);
        });
        try {
            while (this.commitPromise !== null && !timedOut) await Promise.race([this.commitPromise, timeout]);
            if (!pending) return;
            this.setCommit({ timerPending: false });
            if (!timedOut && this.commitPromise === null && !this.state.commit.needsReread) {
                await Promise.race([this.commit(), timeout]);
            } else {
                // F2/F4: the change cannot be sent now; the restore's list supersedes it.
                // Drop it from `toggled` so the next read shows the real state.
                this.set({ selection: startCommit(this.state.selection) });
            }
        } finally {
            if (timeoutId !== null) this.clearTimer(timeoutId);
            // F1 remnant: the restore's `applyRulesets` is sent right after this, so the
            // first read after our last commit (echo or D8, possibly already requested)
            // reflects the restore, not Safari's answer to our list. Not a §9.5 failure.
            if (this.record !== null) this.record.superseded = true;
        }
    }

    /**
     * D1 (§14): on page hide, send a pending change once with the payload the
     * debounced commit would send now; nothing when nothing is pending (D7).
     * Imported lists flagged for removal are deleted here, as by upstream's unload
     * commit (`toRemove`, FL:442-457, 466-471), even when no change is pending.
     */
    pageHide(): void {
        const data = this.state.data;
        if (data === null) return;
        const toRemove = [...this.state.removing.keys()];
        const pending = this.timer !== null && !this.state.commit.needsReread;
        if (!pending && toRemove.length === 0) return;
        const admin = this.options().adminRulesets;
        const adminIds = adminLockedIds(data.tree, admin);
        const payload = pageHideFlush({
            tree: data.tree,
            checked: this.state.selection.checked,
            adminRulesets: admin,
            serverEnabled: [...data.serverEnabled].filter((id) => !adminIds.has(id)),
            timerPending: pending,
            inFlight: this.state.commit.committing && this.record !== null ? this.record.sent : this.baseline(),
            toRemove,
        });
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
        this.setCommit({ timerPending: false });
        if (payload === null) return;
        // Sent once: a page restored from the back/forward cache must not delete twice.
        if (payload.toRemove !== undefined) this.set({ removing: new Map() });
        try {
            this.deps.applyRulesets(payload).catch((err: unknown) => {
                console.warn('[filter lists] page-hide flush failed', err);
            });
        } catch (err) {
            console.warn('[filter lists] page-hide flush failed', err);
        }
    }
}

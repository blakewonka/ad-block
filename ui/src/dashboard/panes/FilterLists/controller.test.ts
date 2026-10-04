/**
 * FilterListsController: timing and sequencing (filter-lists.md §2, §7, §9, §13, §14,
 * D1, D4, D7, D8, Q5, Q14, imported lists §12). Real ruleset-details.json, fake timers, fake bridge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RULESET_DETAILS from '../../../dev/fixtures/ruleset-details.json';
import type { ApplyRulesetsPayload, ListDetails } from '@/lib/model/filterLists';
import { ECHO_GRACE_MS, FilterListsController, SLOW_COMMIT_MS, type ListsOptions, type OptionsStatus } from './controller';

const DETAILS = RULESET_DETAILS as unknown as ListDetails[];
const DEFAULTS = ['ublock-filters', 'easylist', 'easyprivacy'];
const RU_NODE = '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** A fake background: records every call in order, answers from `enabled`. */
function setup(
    opts: {
        options?: ListsOptions;
        stored?: unknown;
        enabled?: string[];
        manualApply?: boolean;
        details?: ListDetails[];
        importResult?: 'ok' | 'fail';
    } = {},
) {
    let details = opts.details ?? DETAILS;
    const log: unknown[] = [];
    let enabled = [...(opts.enabled ?? DEFAULTS)];
    const applies: Deferred<void>[] = [];
    let readMode: 'ok' | 'fail' | 'manual' = 'ok';
    const manualReads: { enabled: Deferred<string[]>; details: Deferred<ListDetails[]> }[] = [];
    let options: OptionsStatus = { status: 'ready', listsRevision: 0, options: opts.options ?? { maxNumberOfEnabledRulesets: 50 } };
    const optionListeners = new Set<() => void>();
    const writes: string[][] = [];
    const published: string[][] = [];
    let pendingEnabled: Deferred<string[]> | null = null;
    const controller = new FilterListsController({
        getEnabledRulesets: () => {
            log.push({ what: 'getEnabledRulesets' });
            if (readMode === 'fail') return Promise.reject(new Error('read failed'));
            if (readMode === 'manual') {
                pendingEnabled = deferred<string[]>();
                return pendingEnabled.promise;
            }
            return Promise.resolve([...enabled]);
        },
        getRulesetDetails: () => {
            log.push({ what: 'getRulesetDetails' });
            if (readMode === 'fail') return Promise.reject(new Error('read failed'));
            if (readMode === 'manual') {
                const d = deferred<ListDetails[]>();
                manualReads.push({ enabled: pendingEnabled!, details: d });
                return d.promise;
            }
            return Promise.resolve(details);
        },
        applyRulesets: (payload: ApplyRulesetsPayload) => {
            log.push({ what: 'applyRulesets', ...payload });
            if (opts.manualApply) {
                const d = deferred<void>();
                applies.push(d);
                return d.promise.then(() => {
                    enabled = [...payload.enabledRulesets];
                });
            }
            enabled = [...payload.enabledRulesets];
            if (payload.toRemove) details = details.filter((d) => !payload.toRemove!.includes(d.id));
            return Promise.resolve();
        },
        importFilterList: (url: string) => {
            log.push({ what: 'importFilterList', url });
            if (opts.importResult === 'fail') return Promise.reject(new Error('import failed'));
            return Promise.resolve(undefined);
        },
        readHideUnused: () => Promise.resolve(opts.stored),
        writeHideUnused: (list) => {
            writes.push(list);
            return Promise.resolve();
        },
        getOptions: () => options,
        subscribeOptions: (fn) => {
            optionListeners.add(fn);
            return () => optionListeners.delete(fn);
        },
        publishRulesetData: (e) => published.push(e),
    });
    const whats = () => log.map((m) => (m as { what: string }).what);
    const applied = () => log.filter((m) => (m as { what: string }).what === 'applyRulesets');
    const broadcast = () => {
        if (options.status !== 'ready') return;
        options = { ...options, listsRevision: options.listsRevision + 1 };
        for (const fn of optionListeners) fn();
    };
    return {
        controller,
        log,
        whats,
        applied,
        applies,
        writes,
        published,
        manualReads,
        broadcast,
        setReadMode: (m: typeof readMode) => (readMode = m),
        setEnabled: (e: string[]) => (enabled = e),
        setOptions: (o: OptionsStatus) => {
            options = o;
            for (const fn of optionListeners) fn();
        },
    };
}

const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

async function started(o: Parameters<typeof setup>[0] = {}) {
    const env = setup(o);
    env.controller.start();
    await flush();
    await env.controller.whenHideUnusedLoaded();
    await flush();
    env.log.length = 0;
    return env;
}

describe('first show (§2, checklist 1, 2, 26, 36)', () => {
    it('sends getEnabledRulesets then getRulesetDetails synchronously, nothing else', () => {
        const env = setup();
        expect(env.whats()).toEqual([]);
        env.controller.start();
        expect(env.whats()).toEqual(['getEnabledRulesets', 'getRulesetDetails']);
        env.controller.start();
        expect(env.whats()).toEqual(['getEnabledRulesets', 'getRulesetDetails']);
    });

    it('builds the tree and baseline and publishes the read to the page store', async () => {
        const env = await started();
        const s = env.controller.getState();
        expect(s.data?.tree.leaves).toHaveLength(51);
        expect([...s.data!.serverEnabled].sort()).toEqual([...DEFAULTS].sort());
        expect([...s.selection.checked].sort()).toEqual([...DEFAULTS].sort());
        expect(env.published).toEqual([DEFAULTS]);
        expect(env.applied()).toEqual([]);
    });

    it('hide-unused: default set, stored array replaces it, non-array ignored; no write without a toggle', async () => {
        expect([...(await started()).controller.getState().hideUnused]).toEqual(['ads', 'regions', 'imported']);
        expect([...(await started({ stored: ['misc'] })).controller.getState().hideUnused]).toEqual(['misc']);
        const env = await started({ stored: 'nope' });
        expect([...env.controller.getState().hideUnused]).toEqual(['ads', 'regions', 'imported']);
        expect(env.writes).toEqual([]);
    });

    it('a broadcast before the first show triggers nothing; after it, one read pair', async () => {
        const env = setup();
        env.broadcast();
        expect(env.whats()).toEqual([]);
        env.controller.start();
        await flush();
        env.log.length = 0;
        env.broadcast();
        expect(env.whats()).toEqual(['getEnabledRulesets', 'getRulesetDetails']);
    });
});

describe('debounced commit (§9.1, §9.2, checklist 17-21)', () => {
    it('sends nothing at the change, then the complete list 997 ms after it', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        expect(env.controller.getState().commit.timerPending).toBe(true);
        await vi.advanceTimersByTimeAsync(996);
        expect(env.applied()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] },
        ]);
    });

    it('tick then untick within the window sends nothing and empties toggled', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(2000);
        expect(env.applied()).toEqual([]);
        expect(env.controller.getState().selection.toggled.size).toBe(0);
    });

    it('three changes 400 ms apart give one message 997 ms after the last', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(400);
        env.controller.toggleLeaf('fra-0');
        await vi.advanceTimersByTimeAsync(400);
        env.controller.toggleLeaf('easylist');
        await vi.advanceTimersByTimeAsync(996);
        expect(env.applied()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easyprivacy', 'ublock-filters', 'deu-0', 'fra-0'] },
        ]);
    });

    it('node toggle: none -> all, partial -> all, all -> none; payload follows', async () => {
        const env = await started();
        env.controller.toggleLeaf('rus-0');
        env.controller.toggleNode(RU_NODE);
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied().at(-1)).toEqual({
            what: 'applyRulesets',
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'rus-0', 'rus-1'],
        });
        env.controller.toggleNode(RU_NODE);
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied().at(-1)).toEqual({
            what: 'applyRulesets',
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters'],
        });
    });

    it('a due commit re-arms while one is in flight; the second carries the complete list (§9.4)', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toHaveLength(1);
        expect(env.controller.getState().commit.committing).toBe(true);
        env.controller.toggleLeaf('fra-0');
        await vi.advanceTimersByTimeAsync(997 * 3);
        expect(env.applied()).toHaveLength(1);
        env.applies[0]!.resolve();
        await flush();
        expect(env.controller.getState().commit.committing).toBe(false);
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] },
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0', 'fra-0'] },
        ]);
    });

    it('Q14: a commit that never settles is reported as slow; nothing more is sent', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        expect(env.controller.getState().commit.slow).toBe(false);
        env.controller.toggleLeaf('fra-0');
        await vi.advanceTimersByTimeAsync(SLOW_COMMIT_MS);
        expect(env.controller.getState().commit.slow).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(env.applied()).toHaveLength(1);
    });
});

describe('after the commit (D4, D8, §9.5)', () => {
    it('D8: re-reads after the response when no echo-driven read happened', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        expect(env.whats()).toEqual(['applyRulesets']);
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS);
        expect(env.whats()).toEqual(['applyRulesets', 'getEnabledRulesets', 'getRulesetDetails']);
    });

    it('D8: no extra read when the echo re-read happened', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.broadcast();
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS * 4);
        expect(env.whats()).toEqual(['applyRulesets', 'getEnabledRulesets', 'getRulesetDetails']);
    });

    it('checklist 43: without the echo, unticking after a commit is still sent', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997 + ECHO_GRACE_MS);
        await flush();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] },
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters'] },
        ]);
    });

    it('D4: a rejected send is shown, the state is re-read, and no commit is built before that read succeeds', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.setReadMode('fail');
        env.applies[0]!.reject(new Error('Could not establish connection.'));
        await flush();
        let s = env.controller.getState();
        expect(s.commit.committing).toBe(false);
        expect(String(s.commit.error)).toMatch(/Could not establish/);
        expect(s.commit.needsReread).toBe(true);
        expect(s.read.error).not.toBeNull();
        expect(s.data?.tree.leaves).toHaveLength(51); // last good state kept
        env.controller.toggleLeaf('fra-0');
        await vi.advanceTimersByTimeAsync(997 * 3);
        expect(env.applied()).toHaveLength(1);
        env.setReadMode('ok');
        env.controller.reread('retry');
        await flush();
        s = env.controller.getState();
        expect(s.commit.needsReread).toBe(false);
        // deu-0 reverted to the server state (toggled was emptied at commit start); fra-0 is kept.
        expect(s.selection.checked.has('deu-0')).toBe(false);
        expect(s.selection.checked.has('fra-0')).toBe(true);
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied().at(-1)).toEqual({
            what: 'applyRulesets',
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'fra-0'],
        });
    });

    it('§9.5: ids not enabled after the following read are reported', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.applies[0]!.resolve();
        await flush();
        env.setEnabled([...DEFAULTS]); // the browser refused the change
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS);
        await flush();
        const s = env.controller.getState();
        expect(s.commit.notApplied).toEqual(['deu-0']);
        expect(s.selection.checked.has('deu-0')).toBe(false); // silent revert of upstream, now explained
    });
});

describe('reads (§13, D4, checklist 25, 41)', () => {
    it('only the most recently requested read pair is applied', async () => {
        const env = await started();
        env.setReadMode('manual');
        env.broadcast();
        env.broadcast();
        const [older, newer] = env.manualReads;
        newer!.enabled.resolve([...DEFAULTS, 'fra-0']);
        newer!.details.resolve(DETAILS);
        await flush();
        older!.enabled.resolve([...DEFAULTS, 'ita-0']);
        older!.details.resolve(DETAILS);
        await flush();
        const checked = env.controller.getState().selection.checked;
        expect(checked.has('fra-0')).toBe(true);
        expect(checked.has('ita-0')).toBe(false);
    });

    it('a pending edit survives another page\'s change (§13 item 4)', async () => {
        const env = await started({ enabled: [...DEFAULTS, 'ita-0'] });
        env.controller.toggleLeaf('deu-0');
        env.setEnabled([...DEFAULTS, 'fra-0']);
        env.broadcast();
        await flush();
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0', 'fra-0'] },
        ]);
    });

    it('a failed first read leaves no data; a later success makes the pane operable (Q15)', async () => {
        const env = setup();
        env.setReadMode('fail');
        env.controller.start();
        await flush();
        expect(env.controller.getState().data).toBeNull();
        expect(env.controller.getState().read.error).not.toBeNull();
        env.controller.toggleLeaf('deu-0');
        expect(env.controller.getState().commit.timerPending).toBe(false);
        env.setReadMode('ok');
        env.controller.reread('retry');
        await flush();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toHaveLength(1);
    });
});

describe('admin (§11, Q3, Q5)', () => {
    const options: ListsOptions = { adminRulesets: ['+annoyances-cookies', '-easyprivacy'], maxNumberOfEnabledRulesets: 50 };

    it('admin-locked leaves are never sent; tick then untick sends nothing (Q5 fix)', async () => {
        const env = await started({ options, enabled: ['ublock-filters', 'easylist', 'annoyances-cookies'] });
        env.controller.toggleLeaf('deu-0');
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(2000);
        expect(env.applied()).toEqual([]);
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toEqual([{ what: 'applyRulesets', enabledRulesets: ['easylist', 'ublock-filters', 'deu-0'] }]);
    });

    it('Q3 fix: a node toggle leaves admin-locked leaves alone', async () => {
        const env = await started({ options: { adminRulesets: ['+rus-1'] }, enabled: [...DEFAULTS, 'rus-1'] });
        env.controller.toggleNode(RU_NODE); // partial -> all
        expect(env.controller.getState().selection.toggled.has('rus-1')).toBe(false);
        env.controller.toggleNode(RU_NODE); // all -> none, rus-1 stays checked
        const s = env.controller.getState();
        expect(s.selection.checked.has('rus-1')).toBe(true);
        expect(s.selection.checked.has('rus-0')).toBe(false);
    });
});

describe('hide unused (§7.2)', () => {
    it('a toggle writes the whole array', async () => {
        const env = await started();
        env.controller.toggleHideUnused('regions');
        expect(env.writes).toEqual([['ads', 'imported']]);
        env.controller.toggleHideUnused(RU_NODE);
        expect(env.writes.at(-1)).toEqual(['ads', 'imported', RU_NODE]);
        expect(env.applied()).toEqual([]);
    });

    it('the header switch makes one write; nothing when nothing changes', async () => {
        const env = await started();
        env.controller.setHideUnusedFor(['ads', 'privacy', 'annoyances', 'misc', 'regions'], true);
        expect(env.writes).toEqual([['ads', 'regions', 'imported', 'privacy', 'annoyances', 'misc']]);
        env.controller.setHideUnusedFor(['ads', 'privacy'], true);
        expect(env.writes).toHaveLength(1);
        env.controller.setHideUnusedFor(['ads', 'privacy', 'annoyances', 'misc', 'regions'], false);
        expect(env.writes.at(-1)).toEqual(['imported']);
    });

    it('a failed write is reported', async () => {
        const env = await started();
        (env.controller as unknown as { deps: { writeHideUnused: () => Promise<void> } }).deps.writeHideUnused = () =>
            Promise.reject(new Error('quota'));
        env.controller.toggleHideUnused('regions');
        await flush();
        expect(env.controller.getState().prefError).not.toBeNull();
    });
});

describe('page hide (D1, D7) and restore (settings.md §7.4)', () => {
    it('pending change: flushed once with the debounced payload; then the timer is gone', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        env.controller.pageHide();
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] },
        ]);
        await vi.advanceTimersByTimeAsync(5000);
        expect(env.applied()).toHaveLength(1);
    });

    it('nothing pending, or a change back to the baseline: nothing sent', async () => {
        const env = await started();
        env.controller.pageHide();
        env.controller.toggleLeaf('deu-0');
        env.controller.toggleLeaf('deu-0');
        env.controller.pageHide();
        expect(env.applied()).toEqual([]);
    });

    it('during an unsettled commit: compares against the in-flight list (D1, D7)', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.controller.pageHide(); // nothing pending
        expect(env.applied()).toHaveLength(1);
        env.controller.toggleLeaf('fra-0');
        env.controller.pageHide();
        expect(env.applied()).toHaveLength(2);
        expect(env.applied()[1]).toEqual({
            what: 'applyRulesets',
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0', 'fra-0'],
        });
    });

    it('during an unsettled commit: a pending list equal to the in-flight one is not re-sent (D7)', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.controller.toggleLeaf('fra-0');
        env.controller.toggleLeaf('fra-0'); // pending list == in-flight list, != stale baseline
        env.controller.pageHide();
        expect(env.applied()).toHaveLength(1);
    });

    it('flush(): sends a pending change at once and resolves after it settled', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        let done = false;
        const p = env.controller.flush().then(() => (done = true));
        await flush();
        expect(env.applied()).toHaveLength(1);
        expect(done).toBe(false);
        env.applies[0]!.resolve();
        await p;
        expect(done).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(env.applied()).toHaveLength(1);
    });

    it('flush(): waits for an in-flight commit, then sends a change made meanwhile', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.controller.toggleLeaf('fra-0');
        const p = env.controller.flush();
        await flush();
        expect(env.applied()).toHaveLength(1);
        env.applies[0]!.resolve();
        await flush();
        expect(env.applied()).toHaveLength(2);
        env.applies[1]!.resolve();
        await p;
    });
});

describe('review findings F1-F5', () => {
    it('F1: §9.5 compares only the first read after a commit; a later change elsewhere is no failure', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997 + ECHO_GRACE_MS);
        await flush();
        expect(env.controller.getState().commit.notApplied).toEqual([]);
        // A Settings reset / another tab disables it later: the echo re-reads, no warning.
        env.setEnabled([...DEFAULTS]);
        env.broadcast();
        await flush();
        const s = env.controller.getState();
        expect(s.selection.checked.has('deu-0')).toBe(false);
        expect(s.commit.notApplied).toEqual([]);
    });

    it('F1: the echo read verifies too (refusal reported once), later broadcasts do not re-report', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.applies[0]!.resolve();
        await flush();
        env.setEnabled([...DEFAULTS]); // refused
        env.broadcast(); // the echo
        await flush();
        expect(env.controller.getState().commit.notApplied).toEqual(['deu-0']);
        env.controller.dismissNotApplied();
        env.broadcast();
        await flush();
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS * 4);
        expect(env.controller.getState().commit.notApplied).toEqual([]);
        expect(env.whats().filter((w) => w === 'getEnabledRulesets')).toHaveLength(2); // echo + later broadcast, no D8
    });

    it('F1: a rejected commit is never compared with a later read', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.applies[0]!.reject(new Error('Could not establish connection.'));
        await flush();
        env.broadcast();
        await flush();
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS * 4);
        expect(env.controller.getState().commit.notApplied).toEqual([]);
    });

    it('F1: a verifying read superseded by a newer one (reset right after the commit) verifies nothing', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.applies[0]!.resolve();
        await flush();
        env.setReadMode('manual');
        env.broadcast(); // our echo: claims the verification
        env.broadcast(); // the reset's echo: supersedes it
        const [older, newer] = env.manualReads;
        newer!.enabled.resolve([...DEFAULTS]);
        newer!.details.resolve(DETAILS);
        await flush();
        older!.enabled.resolve([...DEFAULTS, 'deu-0']);
        older!.details.resolve(DETAILS);
        await flush();
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS * 4);
        const s = env.controller.getState();
        expect(s.commit.notApplied).toEqual([]);
        expect(s.selection.checked.has('deu-0')).toBe(false);
    });

    it('F1 remnant: a change flushed by a reset within the debounce is not verified against the reset', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0'); // pending: the 997 ms timer is armed
        await env.controller.flush(); // Settings reset: the pending change is sent first
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] },
        ]);
        env.setEnabled([...DEFAULTS]); // the reset's own applyRulesets lands last
        env.broadcast(); // our echo, delivered after the reset was sent: the first read after the commit
        await flush();
        env.broadcast(); // the reset's echo
        await flush();
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS * 4);
        const s = env.controller.getState();
        expect(s.commit.notApplied).toEqual([]);
        expect(s.selection.checked.has('deu-0')).toBe(false);
        expect(env.applied()).toHaveLength(1); // nothing re-sent
    });

    it('F1 remnant: a verifying read already in flight when a reset flushes is answered with the reset state, no warning', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.applies[0]!.resolve();
        await flush();
        env.setReadMode('manual');
        env.broadcast(); // our echo: claims the verification, answer delayed
        await env.controller.flush(); // reset confirmed now (nothing pending, nothing in flight)
        const [read] = env.manualReads;
        read!.enabled.resolve([...DEFAULTS]); // answered after the reset's applyRulesets
        read!.details.resolve(DETAILS);
        await flush();
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS * 4);
        expect(env.controller.getState().commit.notApplied).toEqual([]);
    });

    it('F1 remnant: after a flush, a new commit is verified again (true positive kept)', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        await env.controller.flush();
        env.setEnabled([...DEFAULTS]);
        env.broadcast();
        await flush();
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS * 4);
        env.log.length = 0;
        // Next user change is refused by Safari: still reported.
        env.controller.toggleLeaf('fra-0');
        await vi.advanceTimersByTimeAsync(997);
        env.setEnabled([...DEFAULTS]);
        await vi.advanceTimersByTimeAsync(ECHO_GRACE_MS);
        await flush();
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'fra-0'] },
        ]);
        expect(env.controller.getState().commit.notApplied).toEqual(['fra-0']);
    });

    it('F2: flush() while a re-read is owed drops the pending change instead of keeping a stale box', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.setReadMode('fail');
        env.applies[0]!.reject(new Error('Could not establish connection.'));
        await flush();
        env.controller.toggleLeaf('fra-0');
        await env.controller.flush();
        let s = env.controller.getState();
        expect(s.commit.timerPending).toBe(false);
        expect(s.selection.toggled.size).toBe(0);
        // The restore's echo re-reads: the box shows the real state; nothing else is ever sent.
        env.setReadMode('ok');
        env.broadcast();
        await flush();
        await vi.advanceTimersByTimeAsync(10_000);
        s = env.controller.getState();
        expect(s.selection.checked.has('fra-0')).toBe(false);
        expect(env.applied()).toHaveLength(1);
    });

    it('F3: a change made after the response but before the follow-up read compares with what was sent', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997);
        env.setReadMode('manual'); // the follow-up read is slow
        env.applies[0]!.resolve();
        await flush();
        env.controller.toggleLeaf('deu-0'); // untick before any read reflected the commit
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toEqual([
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] },
            { what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters'] },
        ]);
    });

    it('F3: once a read reflecting the commit is applied, the baseline is the read again', async () => {
        const env = await started();
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997 + ECHO_GRACE_MS);
        await flush();
        env.setEnabled([...DEFAULTS]); // changed elsewhere, read applied below
        env.broadcast();
        await flush();
        env.controller.toggleLeaf('fra-0');
        env.controller.toggleLeaf('fra-0');
        await vi.advanceTimersByTimeAsync(2000);
        expect(env.applied()).toHaveLength(1); // nothing re-sent against the old commit list
    });

    it('F4: flush() waits at most SLOW_COMMIT_MS for a hung send, then lets the restore proceed', async () => {
        const env = await started({ manualApply: true });
        env.controller.toggleLeaf('deu-0');
        await vi.advanceTimersByTimeAsync(997); // never settles
        env.controller.toggleLeaf('fra-0');
        let done = false;
        void env.controller.flush().then(() => (done = true));
        await vi.advanceTimersByTimeAsync(SLOW_COMMIT_MS - 10);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(20);
        expect(done).toBe(true);
        expect(env.applied()).toHaveLength(1); // never two sends in parallel
        expect(env.controller.getState().selection.toggled.size).toBe(0);
        expect(env.controller.getState().commit.timerPending).toBe(false);
    });

    it('F5: a node whose admin leaf is forced off can return to none', async () => {
        const env = await started({ options: { adminRulesets: ['-rus-0'] }, enabled: [...DEFAULTS, 'rus-1'] });
        env.controller.toggleNode(RU_NODE);
        expect(env.controller.getState().selection.checked.has('rus-1')).toBe(false);
        env.controller.toggleNode(RU_NODE);
        expect(env.controller.getState().selection.checked.has('rus-1')).toBe(true);
        expect(env.controller.getState().selection.checked.has('rus-0')).toBe(false);
    });
});

describe('imported lists (§12.2, §12.3, §14 toRemove)', () => {
    const IMPORTED: ListDetails = {
        id: 'https://example.org/list.txt',
        name: 'My list',
        group: 'imported',
        enabled: true,
        homeURL: '',
        filters: { accepted: 9 },
        rules: { plain: 9, regex: 0 },
    };
    const withImported = (extra: Parameters<typeof setup>[0] = {}) =>
        started({
            details: [...DETAILS, IMPORTED],
            enabled: [...DEFAULTS, IMPORTED.id],
            options: { maxNumberOfEnabledRulesets: 50, supportsCompiledFilters: true },
            ...extra,
        });

    it('trash unchecks the list and the debounced commit only disables it (FL:501-511, 442-457)', async () => {
        const env = await withImported();
        env.controller.removeImported(IMPORTED.id);
        const s = env.controller.getState();
        expect(s.removing.get(IMPORTED.id)).toBe(true);
        expect(s.selection.checked.has(IMPORTED.id)).toBe(false);
        // A flagged list's checkbox is disabled.
        env.controller.toggleLeaf(IMPORTED.id, true);
        expect(env.controller.getState().selection.checked.has(IMPORTED.id)).toBe(false);
        await vi.advanceTimersByTimeAsync(997);
        expect(env.applied()).toEqual([{ what: 'applyRulesets', enabledRulesets: expect.not.arrayContaining([IMPORTED.id]) }]);
        expect(env.applied()[0]).not.toHaveProperty('toRemove');
    });

    it('page hide deletes flagged lists with toRemove, even with nothing pending, and only once', async () => {
        const env = await withImported();
        env.controller.removeImported(IMPORTED.id);
        await vi.advanceTimersByTimeAsync(997 + ECHO_GRACE_MS);
        await flush();
        env.log.length = 0;
        env.controller.pageHide();
        expect(env.applied()).toHaveLength(1);
        const msg = env.applied()[0] as { enabledRulesets: string[]; toRemove: string[] };
        expect(msg.toRemove).toEqual([IMPORTED.id]);
        expect([...msg.enabledRulesets].sort()).toEqual([...DEFAULTS].sort());
        env.controller.pageHide();
        expect(env.applied()).toHaveLength(1);
    });

    it('page hide with a pending change and a flag sends one final commit with both', async () => {
        const env = await withImported();
        env.controller.removeImported(IMPORTED.id);
        env.controller.toggleLeaf('easylist', false);
        env.controller.pageHide();
        const msgs = env.applied() as { enabledRulesets: string[]; toRemove?: string[] }[];
        expect(msgs).toHaveLength(1);
        expect(msgs[0].toRemove).toEqual([IMPORTED.id]);
        expect(msgs[0].enabledRulesets).not.toContain('easylist');
        expect(msgs[0].enabledRulesets).not.toContain(IMPORTED.id);
        await vi.advanceTimersByTimeAsync(2000);
        expect(env.applied()).toHaveLength(1);
    });

    it('undo restores the remembered state and nothing is deleted (FL:513-523)', async () => {
        const env = await withImported();
        env.controller.removeImported(IMPORTED.id);
        env.controller.undoRemoveImported(IMPORTED.id);
        const s = env.controller.getState();
        expect(s.removing.size).toBe(0);
        expect(s.selection.checked.has(IMPORTED.id)).toBe(true);
        await vi.advanceTimersByTimeAsync(997);
        // Back to the server state: nothing to send.
        expect(env.applied()).toEqual([]);
        env.controller.pageHide();
        expect(env.applied()).toEqual([]);
    });

    it('stock lists cannot be flagged', async () => {
        const env = await withImported();
        env.controller.removeImported('easylist');
        expect(env.controller.getState().removing.size).toBe(0);
        expect(env.controller.getState().commit.timerPending).toBe(false);
    });

    it('importList sends exactly { url } for a valid address and nothing for an invalid one (FL:490-499)', async () => {
        const env = await withImported();
        expect(await env.controller.importList('not a url')).toBe(false);
        expect(await env.controller.importList('https://example.com')).toBe(false); // no path: fails FL:493
        expect(env.log).toEqual([]);
        expect(await env.controller.importList('https://example.com/list.txt')).toBe(true);
        expect(env.log).toEqual([{ what: 'importFilterList', url: 'https://example.com/list.txt' }]);
        expect(env.controller.getState().importing).toEqual({ pending: false, error: null, done: 1 });
    });

    it('a failed import is kept as an error and can be dismissed', async () => {
        const env = await withImported({ importResult: 'fail' });
        expect(await env.controller.importList('https://example.com/list.txt')).toBe(false);
        expect(env.controller.getState().importing.error).toBeInstanceOf(Error);
        expect(env.controller.getState().importing.done).toBe(0);
        env.controller.dismissImportError();
        expect(env.controller.getState().importing.error).toBeNull();
    });
});

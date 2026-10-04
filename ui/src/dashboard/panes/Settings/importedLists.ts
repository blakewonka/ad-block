/**
 * Page-side imported-list bookkeeping used by restore/reset (settings.md §7.3
 * steps 10-11). Port of upstream js/imported-lists.js:42-67, 113-126, 185-232
 * and js/alarms.js:31-63, going through src/lib/storage.ts and src/lib/ext.ts.
 *
 *
 * Call order is upstream's (settings.md §7.3 "Page-side calls"):
 *   get('rulesets.imported') → key listing → [remove(compiled keys)] →
 *   set({ 'rulesets.imported' }) → get('deferredJobs') → [alarms.create|clear] →
 *   [set|remove deferredJobs]
 * The compiled-key removal, the list write and the job update are started
 * together (upstream's Promise.all); none waits for another.
 *
 * HAZARD kept on purpose (settings.md H9): `removeJob` reads `deferredJobs`
 * without a default and throws when the key is absent, after the list write
 * was issued. The restore caller surfaces that as a failure.
 */
import { getBrowser } from '@/lib/ext';
import type { ImportedListEntry } from '@/lib/bridge';
import {
    localRemove,
    readCompiledImportedListIds,
    readDeferredJobs,
    readImportedLists,
    removeCompiledImportedLists,
    writeDeferredJobs,
    writeImportedLists,
    type DeferredJob,
} from '@/lib/storage';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UPDATE_JOB = 'updateImportedLists';

/** alarms.js:31-39 (the alarm promise is returned so the caller can surface a failure). */
function setupJobsAlarm(jobs: DeferredJob[] | undefined): Promise<unknown> {
    try {
        const alarms = getBrowser().alarms;
        if (Boolean(jobs?.length) === false) {
            return Promise.resolve(alarms.clear('deferredJobs'));
        }
        // No less than 5 minutes in the future.
        const when = Math.max(jobs![0].time, Date.now() + 5 * 60 * 1000);
        return Promise.resolve(alarms.create('deferredJobs', { when }));
    } catch (err) {
        return Promise.reject(err);
    }
}

/** alarms.js:41-52. */
async function registerJob(name: string, time: number): Promise<void> {
    // Upstream: `await localRead('deferredJobs') || []` — a truthy non-array throws below, as upstream.
    const jobs = ((await readDeferredJobs()) || []) as DeferredJob[];
    const job = jobs.find((a) => a.name === name);
    if (job) {
        job.time = time;
    } else {
        jobs.push({ name, time });
    }
    jobs.sort((a, b) => a.time - b.time);
    const alarm = setupJobsAlarm(jobs);
    await Promise.all([alarm, writeDeferredJobs(jobs)]);
}

/** alarms.js:54-63. Throws (TypeError) when `deferredJobs` is absent: upstream HAZARD H9. */
async function removeJob(name: string): Promise<void> {
    const before = (await readDeferredJobs()) as DeferredJob[];
    const after = before.filter((a) => a.name !== name);
    if (after.length === before.length) return;
    const alarm = setupJobsAlarm(after);
    if (after.length) {
        await Promise.all([alarm, writeDeferredJobs(after)]);
        return;
    }
    await Promise.all([alarm, localRemove('deferredJobs')]);
}

/** imported-lists.js:55-67. */
function scheduleImportedListsUpdate(lists: ImportedListEntry[]): Promise<void> {
    let earlierTime = 0;
    for (const list of lists) {
        if (list.enabled !== true) continue;
        const updateTime = list.time.updated + list.expires * MS_PER_DAY;
        if (earlierTime !== 0 && earlierTime < updateTime) continue;
        earlierTime = updateTime;
    }
    if (earlierTime) return registerJob(UPDATE_JOB, earlierTime);
    return removeJob(UPDATE_JOB);
}

/** imported-lists.js:113-126. */
async function saveImportedLists(lists: ImportedListEntry[]): Promise<void> {
    const compiledLists = await readCompiledImportedListIds();
    const enabledListIds = lists.filter((a) => a.enabled).map((a) => a.id);
    const toRemove = compiledLists.filter((id) => !enabledListIds.includes(id));
    await Promise.all([
        toRemove.length ? removeCompiledImportedLists(toRemove) : false,
        writeImportedLists(lists),
        scheduleImportedListsUpdate(lists),
    ]);
}

/** imported-lists.js:185-221 (URLs only: restore passes ids). */
export async function addImportedLists(urls: readonly string[]): Promise<void> {
    const lists = await readImportedLists();
    const beforeCount = lists.length;
    for (const url of urls) {
        if (lists.some((a) => a.id === url)) continue;
        lists.push({
            id: url,
            name: url,
            group: 'imported',
            enabled: false,
            homeURL: '',
            expires: 7,
            time: { added: Date.now(), updated: 0 },
            filters: { total: 0, accepted: 0, rejected: 0 },
            rules: { total: 0, plain: 0, regex: 0 },
        });
    }
    if (lists.length !== beforeCount) {
        await saveImportedLists(lists);
    }
}

/** imported-lists.js:225-232. */
export async function removeImportedLists(ids: readonly string[]): Promise<void> {
    const setOfIds = new Set(ids);
    const beforeLists = await readImportedLists();
    const afterLists = beforeLists.filter((a) => setOfIds.has(a.id) === false);
    if (afterLists.length === beforeLists.length) return;
    await saveImportedLists(afterLists);
}

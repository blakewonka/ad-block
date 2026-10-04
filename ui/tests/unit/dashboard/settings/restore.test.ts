/**
 * Restore / reset / backup traffic against the project's mock background
 * (settings.md §6, §7.3, §8, §13 vectors).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOptionsPageData } from '@/lib/bridge';
import { createBackupText, RestoreError, restoreFromObject } from '@/dashboard/panes/Settings/restore';
import type { MockOptions } from '@/dev/mock-ext';

import { installMock, type InstalledMock } from './mock';

type Call = { api: string; args: unknown[] };
const M = (what: string, extra: Record<string, unknown> = {}): Call => ({ api: 'runtime.sendMessage', args: [{ what, ...extra }] });
const S = (op: string, ...args: unknown[]): Call => ({ api: `storage.local.${op}`, args });

const DEFAULT_RULESETS = ['ublock-filters', 'easylist', 'easyprivacy'];
const DEFAULT_MODES = { none: [], basic: [], optimal: ['all-urls'], complete: [] };

const TOGGLES_DEFAULT: Call[] = [
    M('getDefaultConfig'),
    M('setAutoReload', { state: true }),
    M('setShowBlockedCount', { state: true }),
    M('setDeveloperMode', { state: false }),
    M('setStrictBlockMode', { state: false }),
    M('setPopupBlockMode', { state: true }),
];
const AFTER_APPLY: Call[] = [
    M('applyRulesets', { enabledRulesets: DEFAULT_RULESETS }),
    M('setFilteringModeDetails', { modes: DEFAULT_MODES }),
    M('removeAllCustomFilters', { hostname: '*' }),
];
/** settings.md §8: reset on Safari with no imported lists. */
const RESET_TRAFFIC: Call[] = [
    ...TOGGLES_DEFAULT,
    S('get', 'rulesets.imported'),
    ...AFTER_APPLY,
    M('setSandboxFilters', { text: '' }),
    S('remove', 'userDnrRules'),
    M('updateUserDnrRules'),
];

let mock: InstalledMock | null = null;
function setup(options: MockOptions = {}): InstalledMock {
    mock = installMock(options);
    return mock;
}
afterEach(() => {
    mock?.uninstall();
    mock = null;
    vi.restoreAllMocks();
});

async function failure(promise: Promise<unknown>): Promise<RestoreError> {
    try {
        await promise;
    } catch (err) {
        expect(err).toBeInstanceOf(RestoreError);
        return err as RestoreError;
    }
    throw new Error('expected the restore to fail');
}

describe('restoreFromObject — exact traffic', () => {
    it('§13 planRestore vector (every field)', async () => {
        const m = setup();
        await restoreFromObject({
            version: '2026.1003.1243',
            autoReload: false,
            developerMode: true,
            popupBlockMode: false,
            showBlockedCount: false,
            strictBlockMode: true,
            rulesets: ['+annoyances-cookies', '-easyprivacy', '+easylist', '-not-there', 'xbad'],
            filteringModes: { none: ['example.com'], basic: [], optimal: [], complete: ['all-urls'] },
            customFilters: [
                ['example.org', ['.ad-banner', '+js(set, a, 1)']],
                ['only-js.example', ['+js(nowoif)']],
            ],
            cosmeticFilters: ['legacy.example##.x', 'legacy.example##.y', 'nohash', '##.nohost', 'nosel.example##'],
            sandboxFilters: ['example.net##+js(set, foo, 1)', 'example.net##.z'],
            dnrRules: ['action:', '  type: block'],
        });
        expect(m.traffic()).toEqual([
            M('getDefaultConfig'),
            M('setAutoReload', { state: false }),
            M('setShowBlockedCount', { state: false }),
            M('setDeveloperMode', { state: true }),
            M('setStrictBlockMode', { state: true }),
            M('setPopupBlockMode', { state: false }),
            S('get', 'rulesets.imported'),
            M('applyRulesets', { enabledRulesets: ['ublock-filters', 'easylist', 'annoyances-cookies'] }),
            M('setFilteringModeDetails', { modes: { none: ['example.com'], basic: [], optimal: [], complete: ['all-urls'] } }),
            M('removeAllCustomFilters', { hostname: '*' }),
            M('addManyCustomFilters', { entries: [['legacy.example', ['.x', '.y']]] }),
            M('addManyCustomFilters', { entries: [['example.org', ['.ad-banner']]] }),
            M('setSandboxFilters', {
                text: 'example.org##+js(set, a, 1)\nonly-js.example##+js(nowoif)\n\nexample.net##+js(set, foo, 1)\nexample.net##.z',
            }),
            S('set', { userDnrRules: 'action:\n  type: block' }),
            M('updateUserDnrRules'),
        ]);
    });

    it('{} and [] produce exactly the reset traffic (§8)', async () => {
        for (const target of [{}, []]) {
            const m = setup();
            await restoreFromObject(target);
            expect(m.traffic()).toEqual(RESET_TRAFFIC);
            m.uninstall();
        }
    });

    it('nullish fields fall back to the defaults', async () => {
        const m = setup();
        await restoreFromObject({ filteringModes: null, autoReload: null, dnrRules: null, version: 'ignored' });
        expect(m.traffic()).toEqual(RESET_TRAFFIC);
    });

    it('sandbox edge cases keep the leading newline', async () => {
        for (const [sandboxFilters, text] of [
            [['a##.b'], '\na##.b'],
            [[], '\n'],
        ] as const) {
            const m = setup();
            await restoreFromObject({ sandboxFilters });
            const expected = RESET_TRAFFIC.map((c) =>
                (c.args[0] as { what?: string })?.what === 'setSandboxFilters' ? M('setSandboxFilters', { text }) : c,
            );
            expect(m.traffic()).toEqual(expected);
            m.uninstall();
        }
    });

    it('imported list added, deferredJobs present: page-side calls in upstream order', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const m = setup();
        await restoreFromObject({ rulesets: ['+https://example.com/list.txt'] });
        expect(m.traffic()).toEqual([
            ...TOGGLES_DEFAULT,
            S('get', 'rulesets.imported'),
            S('get', 'rulesets.imported'),
            S('getKeys'),
            S('set', {
                'rulesets.imported': [
                    {
                        id: 'https://example.com/list.txt',
                        name: 'https://example.com/list.txt',
                        group: 'imported',
                        enabled: false,
                        homeURL: '',
                        expires: 7,
                        time: { added: 1_000_000, updated: 0 },
                        filters: { total: 0, accepted: 0, rejected: 0 },
                        rules: { total: 0, plain: 0, regex: 0 },
                    },
                ],
            }),
            S('get', 'deferredJobs'),
            M('applyRulesets', { enabledRulesets: [...DEFAULT_RULESETS, 'https://example.com/list.txt'] }),
            M('setFilteringModeDetails', { modes: DEFAULT_MODES }),
            M('removeAllCustomFilters', { hostname: '*' }),
            M('setSandboxFilters', { text: '' }),
            S('remove', 'userDnrRules'),
            M('updateUserDnrRules'),
        ]);
    });

    it('imported list added, deferredJobs ABSENT: stops after the job read and is reported (H9)', async () => {
        const m = setup();
        await (m.browser.storage as { local: { remove(k: string): Promise<void> } }).local.remove('deferredJobs');
        m.calls.length = 0;
        const err = await failure(restoreFromObject({ rulesets: ['+https://example.com/list.txt'] }));
        expect(err.step).toBe('addImportedLists');
        expect(err.applied).toBe(true);
        const traffic = m.traffic();
        expect(traffic.slice(-2)).toEqual([expect.objectContaining({ api: 'storage.local.set' }), S('get', 'deferredJobs')]);
        expect(m.messages().map((x) => (x as { what: string }).what)).not.toContain('applyRulesets');
    });

    it('reset with one enabled imported list removes it and reschedules the jobs', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(5_000);
        const id = 'https://a.example/l.txt';
        const m = setup({
            storage: {
                local: {
                    'rulesets.imported': [
                        {
                            id,
                            name: id,
                            group: 'imported',
                            enabled: true,
                            homeURL: '',
                            expires: 7,
                            time: { added: 1, updated: 2 },
                            filters: { total: 0, accepted: 0, rejected: 0 },
                            rules: { total: 0, plain: 0, regex: 0 },
                        },
                    ],
                    [`rulesets.imported.compiled.${id}`]: 'compiled',
                    deferredJobs: [
                        { name: 'updateImportedLists', time: 5 },
                        { name: 'pruneCSSCache', time: 9 },
                    ],
                },
            },
        });
        await restoreFromObject({});
        expect(m.traffic()).toEqual([
            ...TOGGLES_DEFAULT,
            S('get', 'rulesets.imported'),
            S('get', 'rulesets.imported'),
            S('getKeys'),
            S('remove', [`rulesets.imported.compiled.${id}`]),
            S('set', { 'rulesets.imported': [] }),
            S('get', 'deferredJobs'),
            { api: 'alarms.create', args: ['deferredJobs', { when: 5_000 + 300_000 }] },
            S('set', { deferredJobs: [{ name: 'pruneCSSCache', time: 9 }] }),
            ...AFTER_APPLY,
            M('setSandboxFilters', { text: '' }),
            S('remove', 'userDnrRules'),
            M('updateUserDnrRules'),
        ]);
    });

    it('getKeys missing: the key listing falls back to get(null)', async () => {
        const m = setup({ storageGetKeys: false });
        await restoreFromObject({ rulesets: ['+https://example.com/list.txt'] });
        expect(m.traffic().map((c) => c.api)).toContain('storage.local.get');
        expect(m.traffic()).toContainEqual(S('get', null));
    });
});

describe('restoreFromObject — failures (same prefix as upstream, then a RestoreError)', () => {
    const prefixUpTo = (what: string): Call[] => {
        const i = RESET_TRAFFIC.findIndex((c) => (c.args[0] as { what?: string })?.what === what);
        return RESET_TRAFFIC.slice(0, i + 1);
    };

    it.each([[{ rulesets: 5 }], [{ rulesets: [1] }], [{ rulesets: {} }]])('%j → messages 1-6, then failure', async (file) => {
        const m = setup();
        const err = await failure(restoreFromObject(file));
        expect(err.step).toBe('rulesets');
        expect(err.applied).toBe(true);
        expect(m.traffic()).toEqual(TOGGLES_DEFAULT);
    });

    it.each([[{ cosmeticFilters: [1] }], [{ customFilters: 5 }], [{ customFilters: {} }], [{ customFilters: [['a', 5]] }], [{ customFilters: [['a', [1]]] }], [{ sandboxFilters: 'x' }]])(
        '%j → up to removeAllCustomFilters, then failure',
        async (file) => {
            const m = setup();
            const err = await failure(restoreFromObject(file));
            expect(err.applied).toBe(true);
            expect(m.traffic()).toEqual(prefixUpTo('removeAllCustomFilters'));
        },
    );

    it.each([[{ dnrRules: 'x' }], [{ dnrRules: 5 }], [{ dnrRules: {} }]])('%j → up to setSandboxFilters, then failure', async (file) => {
        const m = setup();
        const err = await failure(restoreFromObject(file));
        expect(err.step).toBe('dnrRules');
        expect(m.traffic()).toEqual(prefixUpTo('setSandboxFilters'));
    });

    it('getDefaultConfig fails: toggles present in the file are still sent up to the first missing one', async () => {
        const m = setup({ failures: { getDefaultConfig: 'reject' } });
        const err = await failure(restoreFromObject({ autoReload: false }));
        expect(err.step).toBe('setShowBlockedCount');
        expect(err.applied).toBe(true);
        expect(m.traffic()).toEqual([M('getDefaultConfig'), M('setAutoReload', { state: false })]);
    });

    it('getDefaultConfig fails with all five toggles: five messages, then failure at the rulesets step', async () => {
        const m = setup({ failures: { getDefaultConfig: 'undefined' } });
        const err = await failure(
            restoreFromObject({ autoReload: false, showBlockedCount: false, developerMode: true, strictBlockMode: true, popupBlockMode: false }),
        );
        expect(err.step).toBe('rulesets');
        expect(m.traffic()).toEqual([
            M('getDefaultConfig'),
            M('setAutoReload', { state: false }),
            M('setShowBlockedCount', { state: false }),
            M('setDeveloperMode', { state: true }),
            M('setStrictBlockMode', { state: true }),
            M('setPopupBlockMode', { state: false }),
        ]);
    });

    it('getDefaultConfig fails on an empty file: nothing is written', async () => {
        const m = setup({ failures: { getDefaultConfig: 'reject' } });
        const err = await failure(restoreFromObject({}));
        expect(err.applied).toBe(false);
        expect(m.traffic()).toEqual([M('getDefaultConfig')]);
    });

    it('bridge deviation: a non-boolean toggle is refused before sending (nothing applied)', async () => {
        const m = setup();
        const err = await failure(restoreFromObject({ autoReload: 'yes' }));
        expect(err.step).toBe('setAutoReload');
        expect(err.applied).toBe(false);
        expect(m.traffic()).toEqual([M('getDefaultConfig')]);
    });

    it('bridge deviation: a non-object filteringModes stops before setFilteringModeDetails (partial)', async () => {
        const m = setup();
        const err = await failure(restoreFromObject({ filteringModes: 'x' }));
        expect(err.step).toBe('setFilteringModeDetails');
        expect(err.applied).toBe(true);
        expect(m.traffic()).toEqual(prefixUpTo('applyRulesets'));
    });

    it('a write rejected at transport level stops the sequence (error-on-apply)', async () => {
        const m = setup({ scenario: 'error-on-apply' });
        const err = await failure(restoreFromObject({}));
        expect(err.step).toBe('setAutoReload');
        expect(err.applied).toBe(false);
        expect(m.traffic()).toEqual([M('getDefaultConfig'), M('setAutoReload', { state: true })]);
    });

    it('a step that never answers ends with a timeout failure', async () => {
        const m = setup({ failures: { applyRulesets: 'hang' } });
        const err = await failure(restoreFromObject({}, { stepTimeoutMs: 30 }));
        expect(err.step).toBe('applyRulesets');
        expect(err.reason).toBe('timeout');
        expect(err.applied).toBe(true);
        expect(m.traffic()).toEqual(prefixUpTo('applyRulesets'));
    });
});

describe('createBackupText (§6.1)', () => {
    it('sends the four reads in order, then reads userDnrRules; no write', async () => {
        const m = setup();
        const store = await getOptionsPageData();
        m.calls.length = 0;
        const text = await createBackupText(store);
        expect(m.traffic()).toEqual([
            M('getDefaultConfig'),
            M('getSandboxFilters'),
            M('getFilteringModeDetails'),
            M('getAllCustomFilters'),
            S('get', 'userDnrRules'),
        ]);
        const data = JSON.parse(text) as Record<string, unknown>;
        expect(Object.keys(data)).toEqual(['version', 'filteringModes']);
        expect(data.version).toBe('2026.1003.1243');
        expect(text.endsWith('}\n')).toBe(true);
    });

    it('uses the page store, not a fresh read', async () => {
        setup();
        const store = await getOptionsPageData();
        const text = await createBackupText({ ...store, autoReload: false, enabledRulesets: ['easylist', 'deu-0'] });
        const data = JSON.parse(text) as Record<string, unknown>;
        expect(data.autoReload).toBe(false);
        expect(data.rulesets).toEqual(['+deu-0', '-ublock-filters', '-easyprivacy']);
    });

    it.each(['getDefaultConfig', 'getSandboxFilters', 'getFilteringModeDetails', 'getAllCustomFilters'])('a failed %s produces no file', async (what) => {
        setup();
        const store = await getOptionsPageData();
        mock!.control.setFailure(what, 'reject');
        await expect(createBackupText(store)).rejects.toThrow();
    });

    it('an absent sandbox text is not a failure; a stored one is trimmed and split', async () => {
        setup();
        const store = await getOptionsPageData();
        mock!.control.setResponse('getSandboxFilters', '  a##+js(x)\nb##.y\n');
        const data = JSON.parse(await createBackupText(store)) as Record<string, unknown>;
        expect(data.sandboxFilters).toEqual(['a##+js(x)', 'b##.y']);
    });
});

describe('review fixes: restore parity and store updates', () => {
    it('a failed rulesets.imported read is treated as no imported list and the restore continues (upstream localRead)', async () => {
        const m = setup();
        const storage = (m.browser.storage as { local: { get: (k: unknown) => Promise<unknown> } }).local;
        const original = storage.get.bind(storage);
        storage.get = (k: unknown) => (k === 'rulesets.imported' ? Promise.reject(new Error('read failed')) : original(k));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await restoreFromObject({});
        const sent = m.messages().map((x) => (x as { what: string }).what);
        expect(sent).toEqual([
            'getDefaultConfig',
            'setAutoReload',
            'setShowBlockedCount',
            'setDeveloperMode',
            'setStrictBlockMode',
            'setPopupBlockMode',
            'applyRulesets',
            'setFilteringModeDetails',
            'removeAllCustomFilters',
            'setSandboxFilters',
            'updateUserDnrRules',
        ]);
    });

    it('onApplied receives each successful write, in order; the traffic is unchanged', async () => {
        const m = setup();
        const patches: unknown[] = [];
        await restoreFromObject(
            { autoReload: false, developerMode: true, rulesets: ['-easyprivacy'], filteringModes: { none: [], basic: [], optimal: [], complete: ['all-urls'] } },
            { onApplied: (p) => patches.push(p) },
        );
        expect(patches).toEqual([
            { autoReload: false },
            { showBlockedCount: true },
            { developerMode: true },
            { strictBlockMode: false },
            { popupBlockMode: true },
            { enabledRulesets: ['ublock-filters', 'easylist'] },
            { defaultFilteringMode: 3 },
        ]);
        expect(m.messages()[1]).toEqual({ what: 'setAutoReload', state: false });
    });

    it('onApplied is not called for a write that failed', async () => {
        setup({ scenario: 'error-on-apply' });
        const patches: unknown[] = [];
        await expect(restoreFromObject({}, { onApplied: (p) => patches.push(p) })).rejects.toBeInstanceOf(RestoreError);
        expect(patches).toEqual([]);
    });
});

describe('ruleset ids this build does not ship (blocking-safety review)', () => {
    // Sent alone as "new", such an id makes upstream applyRulesets store
    // enabledRulesets = undefined, and the next background start disables every ruleset.
    const KNOWN = [...DEFAULT_RULESETS, 'annoyances-cookies', 'fra-0'];

    it('an unknown id is left out of applyRulesets and returned; nothing else changes', async () => {
        const m = setup();
        const result = await restoreFromObject(
            { rulesets: ['+old-removed-list', '+', '+fra-0', '-easyprivacy'] },
            { knownRulesetIds: KNOWN },
        );
        expect(result).toEqual({ skippedRulesets: ['old-removed-list', ''] });
        const applied = m.messages().filter((msg) => (msg as { what: string }).what === 'applyRulesets');
        expect(applied).toEqual([{ what: 'applyRulesets', enabledRulesets: ['ublock-filters', 'easylist', 'fra-0'] }]);
        expect(m.messages().map((msg) => (msg as { what: string }).what)).toEqual(RESET_TRAFFIC.filter((c) => c.api === 'runtime.sendMessage').map((c) => (c.args[0] as { what: string }).what));
    });

    it('the reviewer file {"rulesets":["+old-removed-list"]} sends exactly the defaults (reset payload)', async () => {
        const m = setup();
        const result = await restoreFromObject({ rulesets: ['+old-removed-list'] }, { knownRulesetIds: KNOWN });
        expect(result.skippedRulesets).toEqual(['old-removed-list']);
        expect(m.traffic()).toEqual(RESET_TRAFFIC);
    });

    it('imported-list URLs and default ids are never dropped', async () => {
        const m = setup();
        const result = await restoreFromObject({ rulesets: ['+https://example.com/list.txt'] }, { knownRulesetIds: ['fra-0'] });
        expect(result.skippedRulesets).toEqual([]);
        expect(m.messages()).toContainEqual({ what: 'applyRulesets', enabledRulesets: [...DEFAULT_RULESETS, 'https://example.com/list.txt'] });
    });

    it('without knownRulesetIds (or with none) the payload is upstream\'s', async () => {
        for (const options of [{}, { knownRulesetIds: [] }]) {
            const m = setup();
            const result = await restoreFromObject({ rulesets: ['+old-removed-list'] }, options);
            expect(result.skippedRulesets).toEqual([]);
            expect(m.messages()).toContainEqual({ what: 'applyRulesets', enabledRulesets: [...DEFAULT_RULESETS, 'old-removed-list'] });
            m.uninstall();
        }
    });
});

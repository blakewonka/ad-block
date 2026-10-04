/**
 * src/lib/storage.ts: exact storage.local calls (messaging.md §12.1, §21.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as S from '@/lib/storage';
import { createFakeBrowser, installFakeBrowser } from './fake-browser';
import type { FakeBrowser } from './fake-browser';

let fake: FakeBrowser;

beforeEach(() => {
    fake = installFakeBrowser(createFakeBrowser());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('dashboard.activePane', () => {
    it('reads with get(<key string>) and returns a stored string', async () => {
        fake.store.set('dashboard.activePane', 'rulesets');
        await expect(S.readActivePane()).resolves.toBe('rulesets');
        expect(fake.storage.local.get).toHaveBeenCalledWith('dashboard.activePane');
    });

    it('absent or non-string → undefined (= settings)', async () => {
        await expect(S.readActivePane()).resolves.toBeUndefined();
        fake.store.set('dashboard.activePane', 3);
        await expect(S.readActivePane()).resolves.toBeUndefined();
    });

    it('settings removes the key; other panes write their id (js/dashboard.js:42-50)', async () => {
        await S.writeActivePane('about');
        expect(fake.storage.local.set).toHaveBeenCalledWith({ 'dashboard.activePane': 'about' });
        await S.writeActivePane('settings');
        expect(fake.storage.local.remove).toHaveBeenCalledWith('dashboard.activePane');
        expect(fake.storage.local.set).toHaveBeenCalledTimes(1);
        expect(fake.store.has('dashboard.activePane')).toBe(false);
    });
});

describe('hideUnusedFilterLists', () => {
    it('reads an array, ignores other types, writes a copy', async () => {
        await expect(S.readHideUnusedFilterLists()).resolves.toBeUndefined();
        fake.store.set('hideUnusedFilterLists', '*');
        await expect(S.readHideUnusedFilterLists()).resolves.toBeUndefined();
        fake.store.set('hideUnusedFilterLists', ['*', 'ads']);
        await expect(S.readHideUnusedFilterLists()).resolves.toEqual(['*', 'ads']);
        expect(fake.storage.local.get).toHaveBeenLastCalledWith('hideUnusedFilterLists');
        await S.writeHideUnusedFilterLists(['regions']);
        expect(fake.storage.local.set).toHaveBeenCalledWith({ hideUnusedFilterLists: ['regions'] });
        expect(S.DEFAULT_HIDE_UNUSED_FILTER_LISTS).toEqual(['ads', 'regions', 'imported']);
    });
});

describe('userDnrRules', () => {
    it('read / write / remove', async () => {
        await expect(S.readUserDnrRules()).resolves.toBeUndefined();
        await S.writeUserDnrRules('action:\n  type: block');
        expect(fake.storage.local.set).toHaveBeenCalledWith({ userDnrRules: 'action:\n  type: block' });
        await expect(S.readUserDnrRules()).resolves.toBe('action:\n  type: block');
        expect(fake.storage.local.get).toHaveBeenLastCalledWith('userDnrRules');
        await S.removeUserDnrRules();
        expect(fake.storage.local.remove).toHaveBeenCalledWith('userDnrRules');
    });
});

describe('imported lists, compiled keys, deferred jobs (restore/reset)', () => {
    it('readImportedLists defaults to [] like upstream', async () => {
        await expect(S.readImportedLists()).resolves.toEqual([]);
        expect(fake.storage.local.get).toHaveBeenCalledWith('rulesets.imported');
        fake.store.set('rulesets.imported', 'garbage');
        await expect(S.readImportedLists()).resolves.toEqual([]);
    });

    it('writeImportedLists writes the array under rulesets.imported', async () => {
        const entry = {
            id: 'https://example.org/list.txt', name: 'https://example.org/list.txt', group: 'imported' as const, enabled: false,
            homeURL: '', expires: 7, time: { added: 1, updated: 0 }, filters: { total: 0, accepted: 0, rejected: 0 },
            rules: { total: 0, plain: 0, regex: 0 },
        };
        await S.writeImportedLists([entry]);
        expect(fake.storage.local.set).toHaveBeenCalledWith({ 'rulesets.imported': [entry] });
    });

    it('localKeys uses getKeys() when present, else get(null)', async () => {
        fake.store.set('rulesets.imported.compiled.https://a/x.txt', 'data');
        fake.store.set('other', 1);
        await expect(S.readCompiledImportedListIds()).resolves.toEqual(['https://a/x.txt']);
        expect(fake.storage.local.getKeys).toHaveBeenCalledTimes(1);
        expect(fake.storage.local.get).not.toHaveBeenCalled();

        delete fake.storage.local.getKeys;
        await expect(S.localKeys()).resolves.toEqual(['rulesets.imported.compiled.https://a/x.txt', 'other']);
        expect(fake.storage.local.get).toHaveBeenCalledWith(null);
    });

    it('removeCompiledImportedLists removes the prefixed keys in one call, and nothing for []', async () => {
        await S.removeCompiledImportedLists([]);
        expect(fake.storage.local.remove).not.toHaveBeenCalled();
        await S.removeCompiledImportedLists(['https://a/x.txt', 'https://b/y.txt']);
        expect(fake.storage.local.remove).toHaveBeenCalledWith([
            'rulesets.imported.compiled.https://a/x.txt',
            'rulesets.imported.compiled.https://b/y.txt',
        ]);
    });

    it('deferredJobs: raw read (undefined when absent), write, remove', async () => {
        await expect(S.readDeferredJobs()).resolves.toBeUndefined();
        await S.writeDeferredJobs([{ name: 'pruneCSSCache', time: 5 }]);
        expect(fake.storage.local.set).toHaveBeenCalledWith({ deferredJobs: [{ name: 'pruneCSSCache', time: 5 }] });
        await expect(S.readDeferredJobs()).resolves.toEqual([{ name: 'pruneCSSCache', time: 5 }]);
        await S.removeDeferredJobs();
        expect(fake.storage.local.remove).toHaveBeenCalledWith('deferredJobs');
    });
});

describe('failures', () => {
    it('API rejections are surfaced, not turned into undefined', async () => {
        fake.storage.local.get.mockRejectedValue(new Error('quota'));
        await expect(S.readActivePane()).rejects.toThrow('quota');
        fake.storage.local.set.mockRejectedValue(new Error('nope'));
        await expect(S.writeHideUnusedFilterLists([])).rejects.toThrow('nope');
    });

    it('rejects when no API is present', async () => {
        vi.stubGlobal('browser', undefined);
        await expect(S.readUserDnrRules()).rejects.toThrow(/no WebExtension API/);
    });

    it('only the keys of messaging.md §21.7 have writers', () => {
        expect(Object.values(S.STORAGE_KEYS).sort()).toEqual(
            ['dashboard.activePane', 'deferredJobs', 'hideUnusedFilterLists', 'rulesets.imported', 'userDnrRules'],
        );
    });
});

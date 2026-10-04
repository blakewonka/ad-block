/**
 * settings.md §13 vectors for the pure functions of the Settings pane.
 */
import { describe, expect, it } from 'vitest';

import {
    adminFlags,
    backupDataURL,
    buildBackup,
    defaultLevelFromDetails,
    dnrRulesText,
    hashFromIterable,
    importedDelta,
    INVALID_FILE,
    legacyCosmeticEntries,
    mergeBroadcast,
    parseRestoreFile,
    RESTORE_KEYS,
    unknownRulesets,
    resolveRulesets,
    sandboxText,
    selectedLevel,
    serializeBackup,
    splitCustomFilters,
    supportsTokens,
    toggleStates,
    withoutEllipsis,
    type OptionsData,
} from '@/dashboard/panes/Settings/model';

/** settings.md §2.2 fixture (Safari, fresh install, all websites allowed). */
function fixture(): OptionsData {
    return {
        hasOmnipotence: true,
        defaultFilteringMode: 2,
        enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
        adminRulesets: [],
        maxNumberOfEnabledRulesets: 50,
        rulesetDetails: [],
        autoReload: true,
        showBlockedCount: true,
        canShowBlockedCount: true,
        strictBlockMode: false,
        popupBlockMode: true,
        firstRun: false,
        isSideloaded: true,
        developerMode: false,
        supportsCompiledFilters: false,
        supportsUserScripts: false,
    };
}

describe('selectedLevel', () => {
    it('0 → none; 1..3 → themselves; junk → none', () => {
        expect(selectedLevel(0)).toBeNull();
        expect(selectedLevel(1)).toBe(1);
        expect(selectedLevel(2)).toBe(2);
        expect(selectedLevel(3)).toBe(3);
        expect(selectedLevel('2')).toBeNull();
        expect(selectedLevel(undefined)).toBeNull();
    });
});

describe('toggleStates', () => {
    it('Safari, fixture: strict hidden, the others shown/enabled with fixture values', () => {
        const s = toggleStates(fixture(), 'safari');
        expect(s.autoReload).toEqual({ shown: true, enabled: true, checked: true });
        expect(s.showBlockedCount).toEqual({ shown: true, enabled: true, checked: true });
        expect(s.strictBlockMode.shown).toBe(false);
        expect(s.popupBlockMode).toEqual({ shown: true, enabled: true, checked: true });
        expect(s.developerMode).toEqual({ shown: true, enabled: true, checked: false });
    });
    it('canShowBlockedCount false → off and disabled', () => {
        const s = toggleStates({ ...fixture(), canShowBlockedCount: false, showBlockedCount: true }, 'safari');
        expect(s.showBlockedCount).toEqual({ shown: true, enabled: false, checked: false });
    });
    it('non-Safari strict: disabled/off without omnipotence, enabled/on with it', () => {
        const off = toggleStates({ ...fixture(), hasOmnipotence: false, strictBlockMode: true }, 'other');
        expect(off.strictBlockMode).toEqual({ shown: true, enabled: false, checked: false });
        const on = toggleStates({ ...fixture(), hasOmnipotence: true, strictBlockMode: true }, 'other');
        expect(on.strictBlockMode).toEqual({ shown: true, enabled: true, checked: true });
    });
    it('developerMode true + develop forbidden → row hidden, effective off', () => {
        const s = toggleStates({ ...fixture(), developerMode: true, disabledFeatures: ['develop'] }, 'safari');
        expect(s.developerMode).toEqual({ shown: false, enabled: true, checked: false });
    });
});

describe('adminFlags / supportsTokens', () => {
    it('adminFlags vectors', () => {
        const none = { hidePane: false, hideModeBlock: false, hideDeveloperRow: false };
        expect(adminFlags(undefined)).toEqual(none);
        expect(adminFlags([])).toEqual(none);
        expect(adminFlags(['filteringMode'])).toEqual({ ...none, hideModeBlock: true });
        expect(adminFlags(['develop'])).toEqual({ ...none, hideDeveloperRow: true });
        expect(adminFlags(['dashboard'])).toEqual({ ...none, hidePane: true });
        expect(adminFlags('develop')).toEqual(none);
    });
    it('supportsTokens', () => {
        expect(supportsTokens({ supportsUserScripts: false, supportsCompiledFilters: false })).toEqual([]);
        expect(supportsTokens({ supportsUserScripts: true, supportsCompiledFilters: true })).toEqual(['user-scripts', 'compiled-filters']);
    });
});

describe('mergeBroadcast (§13 sequence)', () => {
    it('applies the vector sequence field by field', () => {
        let store = fixture();
        const step = (msg: unknown) => {
            const r = mergeBroadcast(store, msg);
            store = r.store;
            return { widgets: r.widgets, lists: r.lists };
        };
        const before = store;
        expect(step('hello')).toEqual({ widgets: false, lists: false });
        expect(step(null)).toEqual({ widgets: false, lists: false });
        expect(store).toBe(before);
        expect(step({ autoReload: false })).toEqual({ widgets: true, lists: false });
        expect(store.autoReload).toBe(false);
        expect(before.autoReload).toBe(true); // input never mutated
        expect(step({ showBlockedCount: false, popupBlockMode: false, developerMode: true })).toEqual({ widgets: true, lists: false });
        expect([store.showBlockedCount, store.popupBlockMode, store.developerMode]).toEqual([false, false, true]);
        expect(step({ defaultFilteringMode: 3, hasOmnipotence: false, filteringModeDetails: { none: new Set() } })).toEqual({ widgets: true, lists: false });
        expect(store.defaultFilteringMode).toBe(3);
        expect(store.hasOmnipotence).toBe(false);
        expect('filteringModeDetails' in store).toBe(false);
        expect(step({ defaultFilteringMode: 0 })).toEqual({ widgets: true, lists: false });
        expect(selectedLevel(store.defaultFilteringMode)).toBeNull();
        expect(step({ enabledRulesets: ['easylist'] })).toEqual({ widgets: false, lists: true });
        expect(store.enabledRulesets).toEqual(['easylist']);
        expect(step({ adminRulesets: ['+easylist'] })).toEqual({ widgets: false, lists: true });
        expect(store.adminRulesets).toEqual(['+easylist']);
        const kept = store;
        expect(step({ filteringModeDetails: {}, foo: 1 })).toEqual({ widgets: false, lists: false });
        expect(step({ disabledFeatures: ['develop'] })).toEqual({ widgets: false, lists: false });
        expect(store).toBe(kept);
    });
    it('equal values set no flag, except enabledRulesets', () => {
        const store = fixture();
        expect(mergeBroadcast(store, { autoReload: true, defaultFilteringMode: 2 })).toMatchObject({ widgets: false, lists: false });
        expect(mergeBroadcast(store, { adminRulesets: [] })).toMatchObject({ lists: false });
        expect(mergeBroadcast({ ...store, adminRulesets: ['-a', '+b'] }, { adminRulesets: ['+b', '-a'] })).toMatchObject({ lists: false });
        expect(mergeBroadcast(store, { enabledRulesets: store.enabledRulesets })).toMatchObject({ lists: true });
    });
    it('hashFromIterable', () => {
        expect(hashFromIterable(undefined)).toBe('');
        expect(hashFromIterable(['b', 'a'])).toBe('a\nb');
        expect(hashFromIterable(new Set(['z', 'y']))).toBe('y\nz');
    });
});

const DEFAULT_CONFIG = {
    autoReload: true,
    developerMode: false,
    showBlockedCount: true,
    strictBlockMode: false,
    popupBlockMode: true,
    rulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
};

describe('buildBackup + serializeBackup (§6.2, byte for byte)', () => {
    it('reproduces the "every optional key" file', () => {
        const data = buildBackup({
            version: '2026.1003.1243',
            store: {
                autoReload: false,
                developerMode: true,
                popupBlockMode: false,
                showBlockedCount: false,
                strictBlockMode: true,
                enabledRulesets: ['ublock-filters', 'easylist', 'annoyances-cookies', 'deu-0'],
            },
            defaultConfig: DEFAULT_CONFIG,
            sandboxText: '  example.net##+js(set, foo, 1)\nexample.net##.x\n'.trim(),
            filteringModes: { none: ['example.com'], basic: [], optimal: [], complete: ['all-urls'] },
            customFilters: [['example.org', ['.ad-banner', '{"selector":"div","tasks":[["has-text","x"]]}']]],
            dnrRules: 'action:\n  type: block\n\n\ncondition:\n  urlFilter: x',
        });
        const expected = `{
  "version": "2026.1003.1243",
  "autoReload": false,
  "developerMode": true,
  "popupBlockMode": false,
  "showBlockedCount": false,
  "strictBlockMode": true,
  "rulesets": [
    "+annoyances-cookies",
    "+deu-0",
    "-easyprivacy"
  ],
  "filteringModes": {
    "none": [
      "example.com"
    ],
    "basic": [],
    "optimal": [],
    "complete": [
      "all-urls"
    ]
  },
  "customFilters": [
    [
      "example.org",
      [
        ".ad-banner",
        "{\\"selector\\":\\"div\\",\\"tasks\\":[[\\"has-text\\",\\"x\\"]]}"
      ]
    ]
  ],
  "sandboxFilters": [
    "example.net##+js(set, foo, 1)",
    "example.net##.x"
  ],
  "dnrRules": [
    "action:",
    "  type: block",
    "condition:",
    "  urlFilter: x"
  ]
}
`;
        expect(serializeBackup(data)).toBe(expected);
    });
    it('reproduces the minimal file', () => {
        const data = buildBackup({
            version: '2026.1003.1243',
            store: { ...DEFAULT_CONFIG, enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'] },
            defaultConfig: DEFAULT_CONFIG,
            sandboxText: '',
            filteringModes: { none: [], basic: [], optimal: ['all-urls'], complete: [] },
            customFilters: [],
            dnrRules: undefined,
        });
        expect(serializeBackup(data)).toBe(
            '{\n  "version": "2026.1003.1243",\n  "filteringModes": {\n    "none": [],\n    "basic": [],\n    "optimal": [\n      "all-urls"\n    ],\n    "complete": []\n  }\n}\n',
        );
    });
    it('uses the raw developerMode from the store and skips an empty dnr string', () => {
        const data = buildBackup({
            version: '1',
            store: { ...DEFAULT_CONFIG, developerMode: true, enabledRulesets: DEFAULT_CONFIG.rulesets },
            defaultConfig: DEFAULT_CONFIG,
            sandboxText: '',
            filteringModes: {},
            customFilters: [],
            dnrRules: '',
        });
        expect(Object.keys(data)).toEqual(['version', 'developerMode', 'filteringModes']);
    });
    it('data URL', () => {
        expect(backupDataURL('{"a":1}\n')).toBe('data:text/plain;charset=utf-8,%7B%22a%22%3A1%7D%0A');
    });
});

describe('restore helpers', () => {
    it('parseRestoreFile', () => {
        for (const bad of ['this is not json', '', '42', '"abc"', 'null', 'true']) {
            expect(parseRestoreFile(bad)).toBe(INVALID_FILE);
        }
        expect(parseRestoreFile(42)).toBe(INVALID_FILE);
        // An object or array with no settings key is not a backup (it would reset everything).
        for (const notBackup of ['{}', '[]', '[1,2]', '{"hello":1}', '{"version":"1.0.0"}', '{"name":"some-other-app","version":"1.0.0","dependencies":{}}', '{"__proto__":{"autoReload":false}}']) {
            expect(parseRestoreFile(notBackup), notBackup).toBe(INVALID_FILE);
        }
        expect(parseRestoreFile('{"rulesets":[]}')).toEqual({ rulesets: [] });
        expect(parseRestoreFile('{"version":"2025.1.1","filteringModes":{}}')).toEqual({ version: '2025.1.1', filteringModes: {} });
        expect(parseRestoreFile('{"cosmeticFilters":["a##.b"]}')).toEqual({ cosmeticFilters: ['a##.b'] });
        expect(parseRestoreFile('{"autoReload":null}')).toEqual({ autoReload: null });
        for (const key of RESTORE_KEYS) expect(parseRestoreFile(JSON.stringify({ [key]: 5 })), key).not.toBe(INVALID_FILE);
        expect(RESTORE_KEYS).not.toContain('version');
    });
    it('unknownRulesets: ids neither known, default nor imported URLs', () => {
        const defaults = ['ublock-filters', 'easylist', 'easyprivacy'];
        const known = ['ublock-filters', 'easylist', 'easyprivacy', 'fra-0', 'https://example.com/imported.txt'];
        expect(unknownRulesets([...defaults, 'fra-0', 'old-removed-list', '', 'https://example.com/new.txt'], defaults, known)).toEqual([
            'old-removed-list',
            '',
        ]);
        expect(unknownRulesets([...defaults, 'fra-0'], defaults, known)).toEqual([]);
        // A default id is never dropped, even if the known list lacks it.
        expect(unknownRulesets(defaults, defaults, ['easylist'])).toEqual([]);
        // Nothing to check against: no id is dropped.
        expect(unknownRulesets([...defaults, 'old-removed-list'], defaults, [])).toEqual([]);
    });
    it('resolveRulesets', () => {
        const defaults = ['ublock-filters', 'easylist', 'easyprivacy'];
        expect(resolveRulesets(defaults, ['+annoyances-cookies', '-easyprivacy', '+easylist', '-not-there', 'xbad'])).toEqual([
            'ublock-filters',
            'easylist',
            'annoyances-cookies',
        ]);
        expect(defaults).toEqual(['ublock-filters', 'easylist', 'easyprivacy']);
        expect(resolveRulesets(defaults, undefined)).toEqual(defaults);
        expect(resolveRulesets(defaults, 0)).toEqual(defaults);
        expect(resolveRulesets(defaults, ['+'])).toEqual([...defaults, '']);
        expect(resolveRulesets(defaults, '+-')).toEqual(defaults); // a string is iterated character by character
        expect(() => resolveRulesets(defaults, 5)).toThrow(TypeError);
        expect(() => resolveRulesets(defaults, [1])).toThrow(TypeError);
        expect(() => resolveRulesets(defaults, {})).toThrow(TypeError);
    });
    it('importedDelta', () => {
        expect(importedDelta(['easylist', 'https://a.example/l.txt', 'https://b.example/l.txt'], ['https://b.example/l.txt', 'https://c.example/x'])).toEqual({
            toAdd: ['https://a.example/l.txt'],
            toRemove: ['https://c.example/x'],
        });
    });
    it('legacyCosmeticEntries', () => {
        expect(legacyCosmeticEntries(['legacy.example##.x', 'legacy.example##.y', 'nohash', '##.nohost', 'nosel.example##'])).toEqual([
            ['legacy.example', ['.x', '.y']],
        ]);
        expect(legacyCosmeticEntries(undefined)).toBeNull();
        expect(legacyCosmeticEntries('a##b')).toBeNull();
        expect(legacyCosmeticEntries(['nohash'])).toBeNull();
        expect(() => legacyCosmeticEntries([1])).toThrow(TypeError);
    });
    it('splitCustomFilters', () => {
        expect(
            splitCustomFilters([
                ['example.org', ['.ad-banner', '+js(set, a, 1)']],
                ['only-js.example', ['+js(nowoif)']],
            ]),
        ).toEqual({
            entries: [['example.org', ['.ad-banner']]],
            sandboxLines: ['example.org##+js(set, a, 1)', 'only-js.example##+js(nowoif)'],
        });
        expect(splitCustomFilters(undefined)).toEqual({ entries: [], sandboxLines: [] });
        expect(splitCustomFilters(null)).toEqual({ entries: [], sandboxLines: [] });
        expect(() => splitCustomFilters(5)).toThrow(TypeError);
        expect(() => splitCustomFilters({})).toThrow(TypeError);
        expect(() => splitCustomFilters([['a', 5]])).toThrow(TypeError);
        expect(() => splitCustomFilters([['a', [1]]])).toThrow(TypeError);
    });
    it('sandboxText edge cases', () => {
        expect(sandboxText([], undefined)).toBe('');
        expect(sandboxText([], ['a##.b'])).toBe('\na##.b');
        expect(sandboxText([], [])).toBe('\n');
        expect(sandboxText(['x##+js(a)'], ['y##.z'])).toBe('x##+js(a)\n\ny##.z');
        expect(() => sandboxText([], 'x')).toThrow(TypeError);
    });
    it('dnrRulesText', () => {
        expect(dnrRulesText(undefined)).toBeNull();
        expect(dnrRulesText(null)).toBeNull();
        expect(dnrRulesText([])).toBeNull();
        expect(dnrRulesText('')).toBeNull();
        expect(dnrRulesText(['action:', '  type: block'])).toBe('action:\n  type: block');
        for (const bad of ['x', 5, {}, 0]) {
            expect(() => dnrRulesText(bad)).toThrow(TypeError);
        }
    });
    it('withoutEllipsis', () => {
        expect(withoutEllipsis('Reset to default settings…')).toBe('Reset to default settings');
        expect(withoutEllipsis('Back up...')).toBe('Back up');
        expect(withoutEllipsis('Plain')).toBe('Plain');
    });
});

describe('defaultLevelFromDetails', () => {
    it('finds the bucket holding all-urls, in arrays and Sets', () => {
        expect(defaultLevelFromDetails({ none: [], basic: [], optimal: ['all-urls'], complete: [] })).toBe(2);
        expect(defaultLevelFromDetails({ none: ['all-urls'], basic: [], optimal: [], complete: [] })).toBe(0);
        expect(defaultLevelFromDetails({ none: new Set(), basic: new Set(['a.com', 'all-urls']), optimal: new Set(), complete: new Set() })).toBe(1);
        expect(defaultLevelFromDetails({ none: [], basic: [], optimal: [], complete: ['all-urls'] })).toBe(3);
    });
    it('returns null when no bucket holds it or the input is not a table', () => {
        expect(defaultLevelFromDetails({ none: [], basic: [], optimal: ['x.com'], complete: [] })).toBeNull();
        expect(defaultLevelFromDetails(null)).toBeNull();
        expect(defaultLevelFromDetails('optimal')).toBeNull();
    });
});

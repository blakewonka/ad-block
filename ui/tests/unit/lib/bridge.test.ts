/**
 * src/lib/bridge.ts against docs/specs/messaging.md (§2.1, §20, §21.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as B from '@/lib/bridge';
import {
    BRIDGE_FUNCTION_NAMES,
    BridgeError,
    CLASSIC_MESSAGE_NAMES,
    FORBIDDEN_MESSAGE_NAMES,
    MESSAGE_NAMES,
    NEVER_NULLISH_ON_SUCCESS,
    bridge,
    isFilteringLevel,
    modeDetailsToArrays,
    subscribeBroadcast,
} from '@/lib/bridge';
import type { BridgeMessageName } from '@/lib/bridge';
import { createFakeBrowser, installFakeBrowser } from './fake-browser';
import type { FakeBrowser } from './fake-browser';

/* ------------------------------------------------------------------------ */
/* Fixtures: a valid success answer per message (messaging.md §2.1)          */
/* ------------------------------------------------------------------------ */

const modes = { none: [], basic: [], optimal: ['all-urls'], complete: [] };

const SUCCESS: Record<BridgeMessageName, unknown> = {
    popupPanelData: { hasOmnipotence: false, level: 1, autoReload: true, isSideloaded: true, developerMode: false, hasCustomFilters: 0 },
    setPendingFilteringMode: undefined,
    setFilteringMode: 2,
    showMatchedRules: undefined,
    gotoURL: [{}, {}],
    getOptionsPageData: {
        hasOmnipotence: true, defaultFilteringMode: 2, enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
        adminRulesets: [], maxNumberOfEnabledRulesets: 50, rulesetDetails: [], autoReload: true, showBlockedCount: true,
        canShowBlockedCount: true, strictBlockMode: false, popupBlockMode: true, firstRun: false, isSideloaded: true,
        developerMode: false, supportsCompiledFilters: false, supportsUserScripts: false,
    },
    setDefaultFilteringMode: 3,
    setAutoReload: undefined,
    setShowBlockedCount: undefined,
    setStrictBlockMode: undefined,
    setPopupBlockMode: undefined,
    setDeveloperMode: true,
    getEnabledRulesets: ['easylist'],
    getRulesetDetails: [{ id: 'easylist', name: 'EasyList', enabled: true, homeURL: '', filters: { total: 1, accepted: 1, rejected: 0 }, rules: { total: 1, plain: 1, regex: 0 } }],
    applyRulesets: undefined,
    importFilterList: undefined,
    getDefaultConfig: { autoReload: true, developerMode: false, showBlockedCount: true, strictBlockMode: false, popupBlockMode: true, rulesets: ['ublock-filters', 'easylist', 'easyprivacy'], filteringModes: modes },
    getSandboxFilters: 'example.com##+js(x)',
    getFilteringModeDetails: modes,
    setFilteringModeDetails: modes,
    getAllCustomFilters: [['example.com', ['.ad']]],
    removeAllCustomFilters: undefined,
    addManyCustomFilters: undefined,
    setSandboxFilters: undefined,
    updateUserDnrRules: { added: 0, removed: 0, errors: [] },
    getCurrentConfig: { version: '1', enabledRulesets: [], autoReload: true, showBlockedCount: true, strictBlockMode: false, popupBlockMode: true, developerMode: false, hasBroadHostPermissions: true },
    getDefaultFilteringMode: 2,
    getEffectiveUserRules: [],
    getConsoleOutput: [],
    getRegisteredContentScripts: ['css-generic'],
    hasBroadHostPermissions: true,
};

/** Each case: call → exact message expected on the wire (messaging.md §2.1, §4-§8, §21). */
interface Case {
    name: BridgeMessageName;
    call: () => Promise<unknown>;
    expected: Record<string, unknown>;
}

const CASES: Case[] = [
    { name: 'popupPanelData', call: () => B.popupPanelData({ origin: 'https://www.example.com', hostname: 'www.example.com' }),
        expected: { what: 'popupPanelData', origin: 'https://www.example.com', hostname: 'www.example.com' } },
    { name: 'setPendingFilteringMode',
        call: () => B.setPendingFilteringMode({ tabId: 42, url: 'https://www.example.com/path?x=1', hostname: 'www.example.com', beforeLevel: 1, afterLevel: 2 }),
        expected: { what: 'setPendingFilteringMode', tabId: 42, url: 'https://www.example.com/path?x=1', hostname: 'www.example.com', beforeLevel: 1, afterLevel: 2 } },
    { name: 'setFilteringMode', call: () => B.setFilteringMode({ hostname: 'www.example.com', level: 2 }),
        expected: { what: 'setFilteringMode', hostname: 'www.example.com', level: 2 } },
    { name: 'showMatchedRules', call: () => B.showMatchedRules({ tabId: 42 }), expected: { what: 'showMatchedRules', tabId: 42 } },
    { name: 'gotoURL', call: () => B.gotoURL({ url: '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1' }),
        expected: { what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1' } },
    { name: 'getOptionsPageData', call: () => B.getOptionsPageData(), expected: { what: 'getOptionsPageData' } },
    { name: 'setDefaultFilteringMode', call: () => B.setDefaultFilteringMode({ level: 3 }), expected: { what: 'setDefaultFilteringMode', level: 3 } },
    { name: 'setAutoReload', call: () => B.setAutoReload({ state: false }), expected: { what: 'setAutoReload', state: false } },
    { name: 'setShowBlockedCount', call: () => B.setShowBlockedCount({ state: true }), expected: { what: 'setShowBlockedCount', state: true } },
    { name: 'setStrictBlockMode', call: () => B.setStrictBlockMode({ state: false }), expected: { what: 'setStrictBlockMode', state: false } },
    { name: 'setPopupBlockMode', call: () => B.setPopupBlockMode({ state: true }), expected: { what: 'setPopupBlockMode', state: true } },
    { name: 'setDeveloperMode', call: () => B.setDeveloperMode({ state: true }), expected: { what: 'setDeveloperMode', state: true } },
    { name: 'getEnabledRulesets', call: () => B.getEnabledRulesets(), expected: { what: 'getEnabledRulesets' } },
    { name: 'getRulesetDetails', call: () => B.getRulesetDetails(), expected: { what: 'getRulesetDetails' } },
    { name: 'applyRulesets', call: () => B.applyRulesets({ enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'deu-0'] }),
        expected: { what: 'applyRulesets', enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'deu-0'] } },
    { name: 'importFilterList', call: () => B.importFilterList({ url: 'https://example.org/list.txt' }),
        expected: { what: 'importFilterList', url: 'https://example.org/list.txt' } },
    { name: 'getDefaultConfig', call: () => B.getDefaultConfig(), expected: { what: 'getDefaultConfig' } },
    { name: 'getSandboxFilters', call: () => B.getSandboxFilters(), expected: { what: 'getSandboxFilters' } },
    { name: 'getFilteringModeDetails', call: () => B.getFilteringModeDetails(), expected: { what: 'getFilteringModeDetails' } },
    { name: 'setFilteringModeDetails', call: () => B.setFilteringModeDetails({ modes }), expected: { what: 'setFilteringModeDetails', modes } },
    { name: 'getAllCustomFilters', call: () => B.getAllCustomFilters(), expected: { what: 'getAllCustomFilters' } },
    { name: 'removeAllCustomFilters', call: () => B.removeAllCustomFilters({ hostname: '*' }), expected: { what: 'removeAllCustomFilters', hostname: '*' } },
    { name: 'addManyCustomFilters', call: () => B.addManyCustomFilters({ entries: [['example.com', ['.ad', '.banner']]] }),
        expected: { what: 'addManyCustomFilters', entries: [['example.com', ['.ad', '.banner']]] } },
    { name: 'setSandboxFilters', call: () => B.setSandboxFilters({ text: '\na##.b' }), expected: { what: 'setSandboxFilters', text: '\na##.b' } },
    { name: 'updateUserDnrRules', call: () => B.updateUserDnrRules(), expected: { what: 'updateUserDnrRules' } },
    { name: 'getCurrentConfig', call: () => B.getCurrentConfig(), expected: { what: 'getCurrentConfig' } },
    { name: 'getDefaultFilteringMode', call: () => B.getDefaultFilteringMode(), expected: { what: 'getDefaultFilteringMode' } },
    { name: 'getEffectiveUserRules', call: () => B.getEffectiveUserRules(), expected: { what: 'getEffectiveUserRules' } },
    { name: 'getConsoleOutput', call: () => B.getConsoleOutput(), expected: { what: 'getConsoleOutput' } },
    { name: 'getRegisteredContentScripts', call: () => B.getRegisteredContentScripts(), expected: { what: 'getRegisteredContentScripts' } },
    { name: 'hasBroadHostPermissions', call: () => B.hasBroadHostPermissions(), expected: { what: 'hasBroadHostPermissions' } },
];

let fake: FakeBrowser;

beforeEach(() => {
    fake = installFakeBrowser(createFakeBrowser({ reply: (msg) => SUCCESS[(msg as { what: BridgeMessageName }).what] }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------ */

describe('name lists', () => {
    it('MESSAGE_NAMES is exactly the 31 class-A names of messaging.md §20', () => {
        expect([...MESSAGE_NAMES]).toEqual([
            'popupPanelData', 'setPendingFilteringMode', 'setFilteringMode', 'showMatchedRules', 'gotoURL',
            'getOptionsPageData', 'setDefaultFilteringMode', 'setAutoReload', 'setShowBlockedCount',
            'setStrictBlockMode', 'setPopupBlockMode', 'setDeveloperMode',
            'getEnabledRulesets', 'getRulesetDetails', 'applyRulesets', 'importFilterList',
            'getDefaultConfig', 'getSandboxFilters', 'getFilteringModeDetails', 'setFilteringModeDetails',
            'getAllCustomFilters', 'removeAllCustomFilters', 'addManyCustomFilters', 'setSandboxFilters', 'updateUserDnrRules',
            'getCurrentConfig', 'getDefaultFilteringMode', 'getEffectiveUserRules', 'getConsoleOutput',
            'getRegisteredContentScripts', 'hasBroadHostPermissions',
        ]);
        expect(BRIDGE_FUNCTION_NAMES).toBe(MESSAGE_NAMES);
        expect(new Set(MESSAGE_NAMES).size).toBe(31);
    });

    it('every name has an exported function and a bridge entry, and nothing else is exported as a message function', () => {
        for (const name of MESSAGE_NAMES) {
            expect(typeof (B as Record<string, unknown>)[name]).toBe('function');
            expect(bridge[name]).toBe((B as Record<string, unknown>)[name]);
        }
        expect(Object.keys(bridge).sort()).toEqual([...MESSAGE_NAMES].sort());
        expect(CASES.map(c => c.name)).toEqual([...MESSAGE_NAMES]);
    });

    it('no class-A name contains ":" or is a class-B / class-C name', () => {
        for (const name of MESSAGE_NAMES) {
            expect(name).not.toContain(':');
            expect(FORBIDDEN_MESSAGE_NAMES as readonly string[]).not.toContain(name);
            expect(CLASSIC_MESSAGE_NAMES as readonly string[]).not.toContain(name);
        }
        for (const name of FORBIDDEN_MESSAGE_NAMES) {
            expect((B as Record<string, unknown>)[name]).toBeUndefined();
        }
        for (const name of CLASSIC_MESSAGE_NAMES) {
            expect((B as Record<string, unknown>)[name]).toBeUndefined();
        }
    });

    it('NEVER_NULLISH_ON_SUCCESS is a subset of MESSAGE_NAMES with the 18 names of §20', () => {
        expect(NEVER_NULLISH_ON_SUCCESS).toHaveLength(18);
        for (const name of NEVER_NULLISH_ON_SUCCESS) { expect(MESSAGE_NAMES as readonly string[]).toContain(name); }
    });
});

describe('every bridge function sends exactly the spec payload', () => {
    it.each(CASES)('$name', async ({ call, expected }) => {
        const p = call();
        // Sent synchronously, inside the caller's turn (user-gesture rule, §21.2 line 9).
        expect(fake.runtime.sendMessage).toHaveBeenCalledTimes(1);
        await p;
        expect(fake.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const sent = fake.runtime.sendMessage.mock.calls[0];
        expect(sent).toHaveLength(1);
        // toStrictEqual: same keys, no extra key, no key with value undefined.
        expect(sent[0]).toStrictEqual(expected);
        expect(Object.keys(sent[0] as object)[0]).toBe('what');
        for (const v of Object.values(sent[0] as object)) { expect(v).not.toBeUndefined(); }
    });

    it('resolves the answer for value messages and undefined for void messages', async () => {
        await expect(B.setFilteringMode({ hostname: 'a.com', level: 2 })).resolves.toBe(2);
        await expect(B.setDeveloperMode({ state: true })).resolves.toBe(true);
        await expect(B.getEnabledRulesets()).resolves.toEqual(['easylist']);
        await expect(B.getSandboxFilters()).resolves.toBe('example.com##+js(x)');
        await expect(B.updateUserDnrRules()).resolves.toEqual({ added: 0, removed: 0, errors: [] });
        await expect(B.hasBroadHostPermissions()).resolves.toBe(true);
        fake.runtime.sendMessage.mockResolvedValue('something');
        await expect(B.setAutoReload({ state: true })).resolves.toBeUndefined();
        await expect(B.applyRulesets({ enabledRulesets: [] })).resolves.toBeUndefined();
    });

    it('optional keys are absent unless given (applyRulesets.toRemove, gotoURL.type)', async () => {
        await B.applyRulesets({ enabledRulesets: ['a'], toRemove: undefined });
        await B.applyRulesets({ enabledRulesets: ['a'], toRemove: ['https://x.org/l.txt'] });
        await B.gotoURL({ url: '/a.html', type: undefined });
        await B.gotoURL({ url: '/a.html', type: 'popup' });
        const sent = fake.runtime.sendMessage.mock.calls.map(c => c[0]);
        expect(sent[0]).toStrictEqual({ what: 'applyRulesets', enabledRulesets: ['a'] });
        expect('toRemove' in (sent[0] as object)).toBe(false);
        expect(sent[1]).toStrictEqual({ what: 'applyRulesets', enabledRulesets: ['a'], toRemove: ['https://x.org/l.txt'] });
        expect(sent[2]).toStrictEqual({ what: 'gotoURL', url: '/a.html' });
        expect(sent[3]).toStrictEqual({ what: 'gotoURL', url: '/a.html', type: 'popup' });
    });

    it('extra properties passed at run time are not forwarded', async () => {
        const payload = { hostname: 'a.com', level: 1, what: 'insertCSS', extra: 1 } as unknown as Parameters<typeof B.setFilteringMode>[0];
        await B.setFilteringMode(payload);
        await (B.getOptionsPageData as (p?: unknown) => Promise<unknown>)({ what: 'keepAlive', x: 1 });
        expect(fake.runtime.sendMessage.mock.calls[0][0]).toStrictEqual({ what: 'setFilteringMode', hostname: 'a.com', level: 1 });
        expect(fake.runtime.sendMessage.mock.calls[1][0]).toStrictEqual({ what: 'getOptionsPageData' });
    });

    it('each message object is a fresh object', async () => {
        await B.getEnabledRulesets();
        await B.getEnabledRulesets();
        const [a, b] = fake.runtime.sendMessage.mock.calls.map(c => c[0]);
        expect(a).not.toBe(b);
    });

    it('reproduces the reset sequence of messaging.md §21.5 line 29 when driven step by step', async () => {
        const D = await B.getDefaultConfig();
        await B.setAutoReload({ state: D.autoReload });
        await B.setShowBlockedCount({ state: D.showBlockedCount });
        await B.setDeveloperMode({ state: D.developerMode });
        await B.setStrictBlockMode({ state: D.strictBlockMode });
        await B.setPopupBlockMode({ state: D.popupBlockMode });
        await B.applyRulesets({ enabledRulesets: Array.from(D.rulesets) });
        await B.setFilteringModeDetails({ modes: D.filteringModes });
        await B.removeAllCustomFilters({ hostname: '*' });
        await B.setSandboxFilters({ text: '' });
        fake.runtime.sendMessage.mockResolvedValueOnce({ added: 0, removed: 0, errors: [] });
        await B.updateUserDnrRules();
        expect(fake.runtime.sendMessage.mock.calls.map(c => c[0])).toStrictEqual([
            { what: 'getDefaultConfig' },
            { what: 'setAutoReload', state: true },
            { what: 'setShowBlockedCount', state: true },
            { what: 'setDeveloperMode', state: false },
            { what: 'setStrictBlockMode', state: false },
            { what: 'setPopupBlockMode', state: true },
            { what: 'applyRulesets', enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'] },
            { what: 'setFilteringModeDetails', modes: { none: [], basic: [], optimal: ['all-urls'], complete: [] } },
            { what: 'removeAllCustomFilters', hostname: '*' },
            { what: 'setSandboxFilters', text: '' },
            { what: 'updateUserDnrRules' },
        ]);
    });
});

describe('failures are surfaced, not swallowed (§1.6, §21.1 items 3-4)', () => {
    const nullable = new Set<string>(NEVER_NULLISH_ON_SUCCESS);

    it.each(CASES)('$name rejects with BridgeError(transport) when sendMessage rejects', async ({ name, call }) => {
        const reason = new Error('Could not establish connection. Receiving end does not exist.');
        fake.runtime.sendMessage.mockRejectedValue(reason);
        const err = await call().then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(BridgeError);
        expect((err as BridgeError).messageName).toBe(name);
        expect((err as BridgeError).kind).toBe('transport');
        expect((err as BridgeError).cause).toBe(reason);
        expect((err as BridgeError).message).toContain(name);
    });

    it.each(CASES)('$name rejects (not throws synchronously) when sendMessage throws', async ({ name, call }) => {
        fake.runtime.sendMessage.mockImplementation(() => { throw new Error('boom'); });
        let p: Promise<unknown> | undefined;
        expect(() => { p = call(); }).not.toThrow();
        await expect(p).rejects.toMatchObject({ name: 'BridgeError', messageName: name, kind: 'transport' });
    });

    it.each(CASES)('$name: null and undefined answers follow NEVER_NULLISH_ON_SUCCESS', async ({ name, call }) => {
        for (const answer of [undefined, null]) {
            fake.runtime.sendMessage.mockResolvedValueOnce(answer);
            if (nullable.has(name)) {
                await expect(call()).rejects.toMatchObject({ name: 'BridgeError', messageName: name, kind: 'no-response' });
            } else {
                await expect(call()).resolves.toBeUndefined();
            }
        }
    });

    it('rejects with BridgeError(transport) when no browser API exists', async () => {
        vi.unstubAllGlobals();
        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('chrome', undefined);
        await expect(B.getOptionsPageData()).rejects.toMatchObject({ name: 'BridgeError', messageName: 'getOptionsPageData', kind: 'transport' });
    });

    it('rejects malformed answers with BridgeError(bad-response)', async () => {
        const bad: Array<[() => Promise<unknown>, unknown]> = [
            [() => B.setFilteringMode({ hostname: 'a.com', level: 2 }), '2'],
            [() => B.setFilteringMode({ hostname: 'a.com', level: 2 }), 4],
            [() => B.setFilteringMode({ hostname: 'a.com', level: 2 }), Number.NaN],
            [() => B.setDefaultFilteringMode({ level: 2 }), 2.5],
            [() => B.getDefaultFilteringMode(), 'optimal'],
            [() => B.setDeveloperMode({ state: true }), 'true'],
            [() => B.hasBroadHostPermissions(), 1],
            [() => B.getEnabledRulesets(), 'easylist'],
            [() => B.getEnabledRulesets(), [1, 2]],
            [() => B.getRulesetDetails(), {}],
            [() => B.getAllCustomFilters(), {}],
            [() => B.getSandboxFilters(), 42],
            [() => B.getFilteringModeDetails(), []],
            [() => B.getDefaultConfig(), { rulesets: 'x', filteringModes: modes }],
            [() => B.getDefaultConfig(), { rulesets: [] }],
            [() => B.popupPanelData({ origin: 'o', hostname: 'h' }), { ...(SUCCESS.popupPanelData as object), level: '1' }],
            [() => B.popupPanelData({ origin: 'o', hostname: 'h' }), { ...(SUCCESS.popupPanelData as object), hasCustomFilters: undefined }],
            [() => B.popupPanelData({ origin: 'o', hostname: 'h' }), { ...(SUCCESS.popupPanelData as object), developerMode: undefined }],
            [() => B.popupPanelData({ origin: 'o', hostname: 'h' }), { ...(SUCCESS.popupPanelData as object), disabledFeatures: 'zapper' }],
            [() => B.getOptionsPageData(), { ...(SUCCESS.getOptionsPageData as object), enabledRulesets: undefined }],
            [() => B.getOptionsPageData(), { ...(SUCCESS.getOptionsPageData as object), defaultFilteringMode: '2' }],
        ];
        for (const [call, answer] of bad) {
            fake.runtime.sendMessage.mockResolvedValueOnce(answer);
            await expect(call()).rejects.toMatchObject({ name: 'BridgeError', kind: 'bad-response' });
        }
    });

    it('treats disabledFeatures: null like an absent field (messaging.md §4.1)', async () => {
        fake.runtime.sendMessage.mockResolvedValueOnce({ ...(SUCCESS.popupPanelData as object), disabledFeatures: null });
        const r = await B.popupPanelData({ origin: 'o', hostname: 'h' });
        expect('disabledFeatures' in r).toBe(false);
        fake.runtime.sendMessage.mockResolvedValueOnce({ ...(SUCCESS.getOptionsPageData as object), disabledFeatures: null });
        const o = await B.getOptionsPageData();
        expect('disabledFeatures' in o).toBe(false);
        fake.runtime.sendMessage.mockResolvedValueOnce({ ...(SUCCESS.popupPanelData as object), disabledFeatures: ['zapper'] });
        expect((await B.popupPanelData({ origin: 'o', hostname: 'h' })).disabledFeatures).toEqual(['zapper']);
    });

    it('getSandboxFilters: a nullish answer is "nothing stored", not an error', async () => {
        fake.runtime.sendMessage.mockResolvedValueOnce(null);
        await expect(B.getSandboxFilters()).resolves.toBeUndefined();
    });
});

describe('request validation: nothing is sent for a bad payload (§1.6 item 5, §21.1 item 5)', () => {
    const badLevels: unknown[] = ['2', Number.NaN, undefined, null, 2.5, -1, 4, true];

    it.each(badLevels)('level %s is rejected before sending', async (level) => {
        const calls: Array<() => Promise<unknown>> = [
            () => B.setFilteringMode({ hostname: 'a.com', level } as never),
            () => B.setDefaultFilteringMode({ level } as never),
            () => B.setPendingFilteringMode({ tabId: 1, url: 'https://a.com/', hostname: 'a.com', beforeLevel: 1, afterLevel: level } as never),
            () => B.setPendingFilteringMode({ tabId: 1, url: 'https://a.com/', hostname: 'a.com', beforeLevel: level, afterLevel: 2 } as never),
        ];
        for (const call of calls) {
            await expect(call()).rejects.toMatchObject({ name: 'BridgeError', kind: 'bad-request' });
        }
        expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects non-integer tab ids, non-boolean states, non-string hostnames and missing lists', async () => {
        const calls: Array<() => Promise<unknown>> = [
            () => B.showMatchedRules({ tabId: '42' } as never),
            () => B.showMatchedRules({ tabId: Number.NaN }),
            () => B.setPendingFilteringMode({ tabId: undefined, url: 'u', hostname: 'h', beforeLevel: 1, afterLevel: 2 } as never),
            () => B.setAutoReload({ state: 'true' } as never),
            () => B.setShowBlockedCount({ state: 1 } as never),
            () => B.setStrictBlockMode({} as never),
            () => B.setPopupBlockMode({ state: null } as never),
            () => B.setDeveloperMode({ state: undefined } as never),
            () => B.setFilteringMode({ hostname: undefined, level: 1 } as never),
            () => B.popupPanelData({ origin: 'o' } as never),
            () => B.applyRulesets({} as never),
            () => B.applyRulesets({ enabledRulesets: undefined } as never),
            () => B.applyRulesets({ enabledRulesets: 'easylist' } as never),
            () => B.applyRulesets({ enabledRulesets: [1] } as never),
            () => B.applyRulesets({ enabledRulesets: [], toRemove: 'x' } as never),
            () => B.gotoURL({ url: '/x', type: 'normal' } as never),
            () => B.setFilteringModeDetails({ modes: undefined } as never),
            () => B.setFilteringModeDetails({ modes: [] } as never),
            () => B.addManyCustomFilters({ entries: undefined } as never),
            // A non-iterable entry makes bg:590 throw (no answer): rejected before sending.
            () => B.addManyCustomFilters({ entries: [['example.com', ['.ad']], null] } as never),
            () => B.addManyCustomFilters({ entries: [5] } as never),
            () => B.setSandboxFilters({ text: undefined } as never),
            () => B.removeAllCustomFilters({} as never),
            () => B.importFilterList({} as never),
            () => (B.setFilteringMode as (p?: unknown) => Promise<unknown>)(),
        ];
        for (const call of calls) {
            await expect(call()).rejects.toMatchObject({ name: 'BridgeError', kind: 'bad-request' });
        }
        expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('isFilteringLevel accepts exactly 0, 1, 2, 3', () => {
        expect([0, 1, 2, 3].every(isFilteringLevel)).toBe(true);
        for (const v of ['0', 1.5, -0.5, 4, Number.NaN, null, undefined, {}]) { expect(isFilteringLevel(v)).toBe(false); }
    });
});

/* ------------------------------------------------------------------------ */
/* BroadcastChannel('uBOL')                                                  */
/* ------------------------------------------------------------------------ */

class FakeChannel {
    static instances: FakeChannel[] = [];
    readonly name: string;
    closed = false;
    private handlers = new Set<(ev: MessageEvent) => void>();
    constructor(name: string) {
        this.name = name;
        FakeChannel.instances.push(this);
    }
    addEventListener(type: string, fn: (ev: MessageEvent) => void): void { if (type === 'message') { this.handlers.add(fn); } }
    removeEventListener(type: string, fn: (ev: MessageEvent) => void): void { if (type === 'message') { this.handlers.delete(fn); } }
    close(): void { this.closed = true; }
    postMessage(): void { throw new Error('the UI never posts'); }
    emit(data: unknown): void { for (const fn of this.handlers) { fn({ data } as MessageEvent); } }
}

describe('subscribeBroadcast (§11)', () => {
    beforeEach(() => {
        FakeChannel.instances = [];
        vi.stubGlobal('BroadcastChannel', FakeChannel);
    });

    it('opens BroadcastChannel("uBOL") lazily, shares it, and closes it with the last subscriber', () => {
        expect(FakeChannel.instances).toHaveLength(0);
        const a = vi.fn();
        const b = vi.fn();
        const offA = subscribeBroadcast(a);
        const offB = subscribeBroadcast(b);
        expect(FakeChannel.instances).toHaveLength(1);
        const ch = FakeChannel.instances[0];
        expect(ch.name).toBe('uBOL');

        ch.emit({ enabledRulesets: ['easylist'] });
        expect(a).toHaveBeenCalledWith({ enabledRulesets: ['easylist'] });
        expect(b).toHaveBeenCalledTimes(1);

        offA();
        offA(); // idempotent
        ch.emit({ developerMode: true });
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(2);
        expect(ch.closed).toBe(false);

        offB();
        expect(ch.closed).toBe(true);

        const offC = subscribeBroadcast(vi.fn());
        expect(FakeChannel.instances).toHaveLength(2);
        offC();
    });

    it('ignores non-object data and isolates a throwing listener', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const bad = vi.fn(() => { throw new Error('listener bug'); });
        const good = vi.fn();
        const off1 = subscribeBroadcast(bad);
        const off2 = subscribeBroadcast(good);
        const ch = FakeChannel.instances[0];
        ch.emit('text');
        ch.emit(null);
        ch.emit(42);
        expect(bad).not.toHaveBeenCalled();
        expect(good).not.toHaveBeenCalled();
        ch.emit({ autoReload: false });
        expect(good).toHaveBeenCalledWith({ autoReload: false });
        expect(errSpy).toHaveBeenCalled();
        off1();
        off2();
    });

    it('returns a no-op unsubscribe when BroadcastChannel is missing', () => {
        vi.stubGlobal('BroadcastChannel', undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const off = subscribeBroadcast(vi.fn());
        expect(typeof off).toBe('function');
        off();
        expect(warn).toHaveBeenCalled();
    });

    it('never sends a runtime message', () => {
        const off = subscribeBroadcast(vi.fn());
        FakeChannel.instances[0].emit({ enabledRulesets: [] });
        off();
        expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
    });
});

describe('modeDetailsToArrays', () => {
    it('converts Sets (broadcast form) and arrays to the array form', () => {
        expect(modeDetailsToArrays({ none: new Set(['a.com']), basic: new Set(), optimal: new Set(['all-urls']), complete: new Set() }))
            .toEqual({ none: ['a.com'], basic: [], optimal: ['all-urls'], complete: [] });
        expect(modeDetailsToArrays({ optimal: ['all-urls'] })).toEqual({ none: [], basic: [], optimal: ['all-urls'], complete: [] });
    });
});

/**
 * Unit tests of the mock browser API (src/dev/mock-ext.ts): response shapes
 * equal the spec fixtures, state changes follow the background handlers,
 * switches parse, calls are recorded — and no production source imports it.
 */
import { describe, expect, it } from 'vitest';

import { LOCALES, LONGEST_LOCALE, MANIFEST, RULESET_DETAILS } from './fixtures';
import { EXPECTED_DEFAULT_RESPONSES } from './fixtures/background-state';
import { createMockExt, type MockCall, type MockOptions, parseMockOptions, resolveMockConfig } from './mock-ext';


class FakeChannel {
    static posted: unknown[] = [];
    constructor(readonly name: string) {}
    postMessage(message: unknown): void {
        FakeChannel.posted.push(structuredClone(message));
    }
    close(): void {}
}

function setup(options: MockOptions = {}) {
    FakeChannel.posted = [];
    const calls: MockCall[] = [];
    const mock = createMockExt(resolveMockConfig(options), {
        calls,
        BroadcastChannel: FakeChannel as unknown as typeof BroadcastChannel,
    });
    const browser = mock.browser as {
        runtime: { sendMessage: (m: unknown) => Promise<unknown>; getURL: (p: string) => string; getManifest: () => { name: string; version: string } };
        tabs: { query: (q: unknown) => Promise<Array<{ id?: number; url?: string }>> };
        permissions: { request: (p: unknown) => Promise<boolean> };
        storage: { local: { get: (k: unknown) => Promise<Record<string, unknown>>; getKeys?: unknown } };
        i18n: { getMessage: (k: string) => string };
        scripting?: unknown;
    };
    const send = (m: unknown) => browser.runtime.sendMessage(m);
    return { ...mock, browser, calls, send, posted: FakeChannel.posted };
}

const POPUP_REQUEST = { what: 'popupPanelData', origin: 'https://www.example.com', hostname: 'www.example.com' };
const flush = () => new Promise((r) => setTimeout(r, 5));

// Byte-identity of the copied fixtures with PRISTINE is checked by tests/e2e/harness.smoke.mjs
// (it needs node:fs, which the unit-test tsconfig does not type).
describe('fixtures are real PRISTINE data', () => {
    it('has 51 stock rulesets, 3 enabled by default, and the PRISTINE manifest', () => {
        expect(RULESET_DETAILS).toHaveLength(51);
        expect(RULESET_DETAILS.filter((r) => r.enabled).map((r) => r.id)).toEqual(['ublock-filters', 'easylist', 'easyprivacy']);
        expect(MANIFEST.name).toBe('__MSG_extName__');
        expect(MANIFEST.version).toBe('2026.1003.1243');
        expect(LONGEST_LOCALE).toBe('el');
    });
});

describe('default scenario answers fixture F (messaging.md §21)', () => {
    it('answers every read with the documented shape', async () => {
        const { send } = setup();
        expect(await send(POPUP_REQUEST)).toEqual(EXPECTED_DEFAULT_RESPONSES.popupPanelData);
        const options = (await send({ what: 'getOptionsPageData' })) as Record<string, unknown>;
        const { rulesetDetails, ...rest } = options;
        expect(rest).toEqual(EXPECTED_DEFAULT_RESPONSES.getOptionsPageDataWithoutDetails);
        expect(Object.keys(options)).toHaveLength(16); // 17 fields; disabledFeatures (undefined) is dropped by the JSON wire
        expect(rulesetDetails).toEqual(RULESET_DETAILS);
        expect(await send({ what: 'getDefaultConfig' })).toEqual(EXPECTED_DEFAULT_RESPONSES.getDefaultConfig);
        expect(await send({ what: 'getCurrentConfig' })).toEqual(EXPECTED_DEFAULT_RESPONSES.getCurrentConfig);
        expect(await send({ what: 'getFilteringModeDetails' })).toEqual(EXPECTED_DEFAULT_RESPONSES.getFilteringModeDetails);
        expect(await send({ what: 'getEnabledRulesets' })).toEqual(['ublock-filters', 'easylist', 'easyprivacy']);
        expect(await send({ what: 'getRulesetDetails' })).toEqual(RULESET_DETAILS);
        for (const what of [
            'getDefaultFilteringMode',
            'hasBroadHostPermissions',
            'getEffectiveUserRules',
            'getConsoleOutput',
            'getRegisteredContentScripts',
            'getAllCustomFilters',
        ] as const) {
            expect(await send({ what })).toEqual(EXPECTED_DEFAULT_RESPONSES[what]);
        }
        expect(await send({ what: 'getSandboxFilters' })).toBeUndefined();
        expect(await send({ what: 'updateUserDnrRules' })).toEqual({ added: 0, removed: 0, errors: [] });
    });

    it('gives the fixture-F tab and the PRISTINE manifest', async () => {
        const { browser } = setup();
        expect(await browser.tabs.query({ active: true, currentWindow: true })).toEqual([
            expect.objectContaining({ id: 42, url: 'https://www.example.com/path?x=1' }),
        ]);
        expect(browser.runtime.getManifest()).toMatchObject({ name: 'Blocker', version: '2026.1003.1243' });
        expect(setup({ manifestName: 'raw' }).browser.runtime.getManifest().name).toBe('__MSG_extName__');
        expect(browser.runtime.getURL('/report.html')).toMatch(/^safari-web-extension:\/\/[0-9a-f-]+\/report\.html$/);
    });
});

describe('state changes mirror the background', () => {
    it('setFilteringMode changes the next popupPanelData level and broadcasts the mode table', async () => {
        const { send, posted } = setup();
        expect(await send({ what: 'setFilteringMode', hostname: 'www.example.com', level: 3 })).toBe(3);
        expect(((await send(POPUP_REQUEST)) as { level: number }).level).toBe(3);
        expect(posted).toHaveLength(1);
        const echo = posted[0] as { defaultFilteringMode: number; hasOmnipotence: boolean; filteringModeDetails: { complete: Set<string> } };
        expect(echo.defaultFilteringMode).toBe(2);
        expect(echo.hasOmnipotence).toBe(true);
        expect(echo.filteringModeDetails.complete).toEqual(new Set(['www.example.com']));
        // Same level again: answered without a write (bg:519).
        expect(await send({ what: 'setFilteringMode', hostname: 'www.example.com', level: 3 })).toBe(3);
        expect(posted).toHaveLength(1);
    });

    it('a level equal to the default removes the site entry; a string level drops the site to the default (§1.6 item 5)', async () => {
        const { send } = setup();
        expect(await send({ what: 'setFilteringMode', hostname: 'www.example.com', level: 2 })).toBe(2);
        expect(await send({ what: 'getFilteringModeDetails' })).toEqual({ none: [], basic: [], optimal: ['all-urls'], complete: [] });
        const s2 = setup();
        expect(await s2.send({ what: 'setFilteringMode', hostname: 'www.example.com', level: '0' })).toBe(2);
    });

    it('setDefaultFilteringMode moves all-urls and clears the target set (§18 item 19)', async () => {
        const { send } = setup();
        expect(await send({ what: 'setDefaultFilteringMode', level: 1 })).toBe(1);
        expect(await send({ what: 'getFilteringModeDetails' })).toEqual({ none: [], basic: ['all-urls'], optimal: [], complete: [] });
        expect(await send({ what: 'getDefaultFilteringMode' })).toBe(1);
    });

    it('toggles: void answers, broadcast echo, setDeveloperMode answers the new boolean', async () => {
        const { send, posted } = setup();
        expect(await send({ what: 'setAutoReload', state: false })).toBeUndefined();
        expect(await send({ what: 'setDeveloperMode', state: true })).toBe(true);
        expect(await send({ what: 'setDeveloperMode', state: 'yes' })).toBe(false);
        expect(posted).toEqual([{ autoReload: false }, { developerMode: true }, { developerMode: false }]);
        expect(((await send(POPUP_REQUEST)) as { autoReload: boolean }).autoReload).toBe(false);
    });

    it('applyRulesets: full list, [] disables everything, always echoes, unknown ids hit the undefined hazard', async () => {
        const { send, posted } = setup();
        expect(await send({ what: 'applyRulesets', enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'deu-0'] })).toBeUndefined();
        expect(await send({ what: 'getEnabledRulesets' })).toEqual(['ublock-filters', 'easylist', 'easyprivacy', 'deu-0']);
        expect(posted.at(-1)).toEqual({ enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'deu-0'] });
        await send({ what: 'applyRulesets', enabledRulesets: [] });
        expect(await send({ what: 'getEnabledRulesets' })).toEqual([]);
        const hz = setup();
        await hz.send({ what: 'applyRulesets', enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'no-such-list'] });
        expect(hz.posted.at(-1)).toEqual({ enabledRulesets: undefined });
        expect(((await hz.send({ what: 'getCurrentConfig' })) as Record<string, unknown>).enabledRulesets).toBeUndefined();
    });

    it('admin tokens are re-applied on every apply; the limit and dnrError leave the list unchanged', async () => {
        const admin = setup({ scenario: 'admin-locked' });
        await admin.send({ what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy'] });
        expect(await admin.send({ what: 'getEnabledRulesets' })).toEqual(['easylist', 'annoyances-cookies']);
        const max = setup({ scenario: 'max-rulesets' });
        const before = await max.send({ what: 'getEnabledRulesets' });
        await max.send({ what: 'applyRulesets', enabledRulesets: [...(before as string[]), 'fra-0'] });
        expect(await max.send({ what: 'getEnabledRulesets' })).toEqual(before);
        expect(max.posted.at(-1)).toEqual({ enabledRulesets: before });
        const dnr = setup({ dnrError: true });
        await dnr.send({ what: 'applyRulesets', enabledRulesets: ['easylist'] });
        expect(await dnr.send({ what: 'getEnabledRulesets' })).toEqual(['ublock-filters', 'easylist', 'easyprivacy']);
    });

    it('reset sequence (§21 line 29) leaves the factory state', async () => {
        const { send } = setup({ background: { developerMode: true, customFilters: [['a.example', ['.x']]], sandboxFilters: 'x' } });
        const d = (await send({ what: 'getDefaultConfig' })) as { rulesets: string[]; filteringModes: unknown };
        for (const [what, state] of [
            ['setAutoReload', true],
            ['setShowBlockedCount', true],
            ['setDeveloperMode', false],
            ['setStrictBlockMode', false],
            ['setPopupBlockMode', true],
        ] as const) {
            await send({ what, state });
        }
        await send({ what: 'applyRulesets', enabledRulesets: d.rulesets });
        expect(await send({ what: 'setFilteringModeDetails', modes: d.filteringModes })).toEqual(d.filteringModes);
        await send({ what: 'removeAllCustomFilters', hostname: '*' });
        await send({ what: 'setSandboxFilters', text: '' });
        expect(await send({ what: 'updateUserDnrRules' })).toEqual({ added: 0, removed: 0, errors: [] });
        expect(await send({ what: 'getAllCustomFilters' })).toEqual([]);
        expect(await send({ what: 'getSandboxFilters' })).toBeUndefined();
        expect(await send({ what: 'getDefaultFilteringMode' })).toBe(2);
        expect(((await send({ what: 'getCurrentConfig' })) as { developerMode: boolean }).developerMode).toBe(false);
    });

    it('a pending popup request is consumed by the next grant (bg:169-217)', async () => {
        const { send, browser } = setup({ defaultLevel: 1, background: { grantedOrigins: [] } });
        await send({ what: 'setPendingFilteringMode', tabId: 42, url: 'https://www.example.com/path?x=1', hostname: 'www.example.com', beforeLevel: 1, afterLevel: 2 });
        expect(await browser.permissions.request({ origins: ['*://*.www.example.com/*'] })).toBe(true);
        await flush();
        expect(((await send(POPUP_REQUEST)) as { level: number }).level).toBe(2);
        expect(await send({ what: 'hasBroadHostPermissions' })).toBe(false);
    });
});

describe('transport switches', () => {
    it('failures, nullishAs, verbatim responses, handler throw', async () => {
        const { send } = setup({ failures: { popupPanelData: 'reject', getEnabledRulesets: 'null' }, responses: { getDefaultFilteringMode: 7 } });
        await expect(send(POPUP_REQUEST)).rejects.toThrow('Receiving end does not exist');
        expect(await send({ what: 'getEnabledRulesets' })).toBeNull();
        expect(await send({ what: 'getDefaultFilteringMode' })).toBe(7);
        await expect(send({ what: 'setFilteringModeDetails' })).rejects.toThrow('message port closed');
        expect(await setup({ nullishAs: 'null' }).send({ what: 'setAutoReload', state: true })).toBeNull();
        expect(await send({ what: 'noSuchMessage' })).toBeUndefined();
    });

    it('error-on-apply rejects writes but answers reads', async () => {
        const { send } = setup({ scenario: 'error-on-apply' });
        await expect(send({ what: 'setFilteringMode', hostname: 'www.example.com', level: 0 })).rejects.toThrow();
        await expect(send({ what: 'setAutoReload', state: false })).rejects.toThrow();
        expect(await send({ what: 'setPendingFilteringMode', tabId: 42, url: 'u', hostname: 'h', beforeLevel: 1, afterLevel: 2 })).toBeUndefined();
        expect(((await send(POPUP_REQUEST)) as { level: number }).level).toBe(1);
    });

    it('permissions: deny, reject, invalid IPv6 pattern, getKeys and scripting switches', async () => {
        expect(await setup({ permission: 'deny' }).browser.permissions.request({ origins: ['<all_urls>'] })).toBe(false);
        await expect(setup({ permission: 'reject' }).browser.permissions.request({ origins: ['<all_urls>'] })).rejects.toThrow();
        await expect(setup().browser.permissions.request({ origins: ['*://*.[::1]/*'] })).rejects.toThrow('Invalid value');
        expect(setup({ storageGetKeys: false }).browser.storage.local.getKeys).toBeUndefined();
        expect(setup({ scripting: false }).browser.scripting).toBeUndefined();
    });
});

describe('record and i18n', () => {
    it('records a deep copy of every call with api, args, t', async () => {
        const { browser, calls } = setup();
        const msg = { what: 'setFilteringMode', hostname: 'www.example.com', level: 2 };
        const p = browser.runtime.sendMessage(msg);
        msg.level = 99;
        await p;
        await browser.storage.local.get('userDnrRules');
        expect(calls.map((c) => [c.api, c.args])).toEqual([
            ['runtime.sendMessage', [{ what: 'setFilteringMode', hostname: 'www.example.com', level: 2 }]],
            ['storage.local.get', ['userDnrRules']],
        ]);
        expect(typeof calls[0]?.t).toBe('number');
    });

    it('serves real locale text, @@ui_locale and empty strings for unknown keys', () => {
        expect(setup().browser.i18n.getMessage('extName')).toBe('Blocker');
        expect(setup().browser.i18n.getMessage('nope')).toBe('');
        const de = setup({ lang: 'de' }).browser.i18n;
        expect(de.getMessage('@@ui_locale')).toBe('de');
        expect(de.getMessage('filteringMode1Name')).toBe(LOCALES.de?.filteringMode1Name?.message);
        expect(setup({ lang: 'pt-BR' }).browser.i18n.getMessage('@@ui_locale')).toBe('pt_BR');
        expect(setup({ lang: 'en', dir: 'rtl' }).browser.i18n.getMessage('@@ui_locale')).toBe('ar');
        expect(setup({ lang: 'longest' }).browser.i18n.getMessage('@@ui_locale')).toBe('el');
    });
});

describe('query-string switches', () => {
    it('maps every switch onto MockOptions', () => {
        expect(
            parseMockOptions(
                '?scenario=slow,admin-locked&lang=ar&theme=dark&dir=rtl&perm=deny&url=about:blank&tabId=7&fail=applyRulesets:hang,all:null' +
                    '&nullAs=null&level=3&default=1&customFilters=2&dev=1&omni=0&max=none&disabled=zapper,report&admin=%2Beasylist&echo=off&delay=10',
            ),
        ).toEqual({
            scenario: ['slow', 'admin-locked'],
            lang: 'ar',
            theme: 'dark',
            dir: 'rtl',
            permission: 'deny',
            tabUrl: 'about:blank',
            tabId: 7,
            failures: { applyRulesets: 'hang', '*': 'null' },
            nullishAs: 'null',
            level: 3,
            defaultLevel: 1,
            customFilterCount: 2,
            echo: false,
            delay: 10,
            background: {
                developerMode: true,
                grantedOrigins: [],
                maxNumberOfEnabledRulesets: null,
                disabledFeatures: ['zapper', 'report'],
                adminRulesets: ['+easylist'],
            },
        });
        expect(parseMockOptions('?url=none&tab=none&disabled=null')).toEqual({ tabUrl: null, tab: null, background: { disabledFeatures: null } });
        expect(parseMockOptions(`?mock=${encodeURIComponent(JSON.stringify({ lang: 'fr', background: { autoReload: false } }))}&lang=de`)).toEqual({
            lang: 'fr',
            background: { autoReload: false },
        });
    });

    it('scenario presets resolve as documented', () => {
        expect(resolveMockConfig({ scenario: 'no-website' }).tab?.url).toBe('about:blank');
        expect(resolveMockConfig({ scenario: 'slow' }).delay).toBe(1500);
        expect(resolveMockConfig({ scenario: 'max-rulesets' }).background.maxNumberOfEnabledRulesets).toBe(5);
        expect(resolveMockConfig({ scenario: 'nonsense' }).scenarios).toEqual(['default']);
    });

    it('platform: URL scheme and platform defaults, overridable by later switches', async () => {
        expect(parseMockOptions('?platform=firefox&compiled=0&userScripts=1')).toEqual({
            platform: 'firefox',
            background: { supportsCompiledFilters: false, supportsUserScripts: true },
        });
        expect(parseMockOptions('?platform=netscape')).toEqual({});
        const safari = resolveMockConfig({});
        expect(safari.platform).toBe('safari');
        expect(safari.background.supportsCompiledFilters).toBe(false);
        expect(safari.background.strictBlockMode).toBe(false);
        for (const platform of ['chromium', 'firefox'] as const) {
            const cfg = resolveMockConfig({ platform });
            expect(cfg.background.supportsCompiledFilters).toBe(true);
            expect(cfg.background.strictBlockMode).toBe(true); // config.js:35
            expect(cfg.background.supportsUserScripts).toBe(false);
        }
        expect(resolveMockConfig(parseMockOptions('?platform=chromium&compiled=0')).background.supportsCompiledFilters).toBe(false);
        expect(setup({ platform: 'chromium' }).browser.runtime.getURL('/x.html')).toMatch(/^chrome-extension:\/\/[a-p]{32}\/x\.html$/);
        expect(setup({ platform: 'firefox' }).browser.runtime.getURL('')).toMatch(/^moz-extension:\/\//);
        expect(setup().browser.runtime.getURL('')).toMatch(/^safari-web-extension:\/\//);
        const data = (await setup({ platform: 'firefox' }).send({ what: 'getOptionsPageData' })) as Record<string, unknown>;
        expect(data.supportsCompiledFilters).toBe(true);
        expect(data.strictBlockMode).toBe(true);
    });
});

describe('production sources never import the mock', () => {
    // Every production source file as text (tests excluded). Paths are relative to ui/.
    const sources = import.meta.glob<string>(
        [
            '/src/popup/**/*.{ts,tsx,css}',
            '/src/dashboard/**/*.{ts,tsx,css}',
            '/src/container/**/*.{ts,tsx,css}',
            '/src/lib/**/*.{ts,tsx,css}',
            '/src/components/**/*.{ts,tsx,css}',
            '/src/styles/**/*.css',
            '/popup.html',
            '/dashboard.html',
            '/container/**/*.html',
            '!**/*.test.{ts,tsx}',
        ],
        { query: '?raw', import: 'default', eager: true },
    );

    it('finds the production entries', () => {
        expect(Object.keys(sources)).toEqual(expect.arrayContaining(['/src/popup/main.tsx', '/src/dashboard/main.tsx', '/popup.html']));
    });

    it.each(Object.entries(sources))('%s', (_path, text) => {
        // Comments may name the mock; code may not import or reference it.
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
        expect(code).not.toMatch(/(?:import|from)\s*\(?\s*['"][^'"]*(?:\/dev\/|install-mock|mock-ext)[^'"]*['"]/);
        expect(code).not.toMatch(/__blockerCalls|__blockerMock|__BLOCKER_MOCK__/);
    });
});

/**
 * About pane troubleshooting text: byte-exact against dashboard-shell.md §4.4
 * and messaging.md §21.6 item 35 (P-17).
 */
import { describe, expect, it } from 'vitest';

import { buildTroubleshootingConfig, renderData, vendorString, type TroubleshootingInputs } from '@/dashboard/panes/About/troubleshooting';
import { RULESET_DETAILS } from '@/dev/fixtures';

const SAFARI_URL = 'safari-web-extension://abc/';
const SAFARI_26_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const SAFARI_186_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

const REAL_DEFAULT_CONFIG = {
    autoReload: true,
    developerMode: false,
    showBlockedCount: true,
    strictBlockMode: false,
    popupBlockMode: true,
    rulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
};

function inputs(overrides: Partial<TroubleshootingInputs>): TroubleshootingInputs {
    return {
        manifest: { name: 'Blocker', version: '2026.1003.1243' },
        platformInfo: { os: 'mac' },
        defaultConfig: REAL_DEFAULT_CONFIG,
        currentConfig: { strictBlockMode: false, popupBlockMode: true },
        enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
        rulesetDetails: RULESET_DETAILS.map((d) => ({ id: d.id, rules: d.rules })),
        defaultMode: 2,
        userRules: [],
        consoleOutput: [],
        registeredScripts: [],
        hasOmnipotence: true,
        extURL: SAFARI_URL,
        userAgent: SAFARI_26_UA,
        ...overrides,
    };
}

describe('troubleshooting text', () => {
    it('matches the dashboard-shell.md §4.4 example byte for byte', () => {
        const enabled = ['ublock-filters', 'easylist', 'adguard-mobile'];
        const text = renderData(
            buildTroubleshootingConfig(
                inputs({
                    currentConfig: { strictBlockMode: false, popupBlockMode: false },
                    enabledRulesets: enabled,
                    rulesetDetails: [
                        { id: 'ublock-filters', rules: { total: 20, plain: 0, regex: 0 } },
                        { id: 'easylist', rules: { total: 10, plain: 0, regex: 0 } },
                        { id: 'adguard-mobile', rules: { total: 5, plain: 0, regex: 0 } },
                    ],
                    registeredScripts: ['css-specific.1', 'scriptlets.1'],
                }),
            ),
        );
        expect(text).toBe(
            [
                'name: Blocker',
                'version: 2026.1003.1243',
                'browser: Safari 26.0 (mac)',
                'filtering:',
                ' default: optimal',
                'permission: all',
                'popupblock: false',
                'rules: 35',
                'rulesets:',
                ' +adguard-mobile',
                ' -easyprivacy',
                ' easylist',
                ' ublock-filters',
                'scripting:',
                ' css-specific.1',
                ' scriptlets.1',
            ].join('\n'),
        );
        expect(text.endsWith('\n')).toBe(false);
        // Not mutated (upstream mutates the response array in place).
        expect(enabled).toEqual(['ublock-filters', 'easylist', 'adguard-mobile']);
    });

    it('matches messaging.md §21.6 item 35 (fixture F, Safari 18.6)', () => {
        const enabled = ['ublock-filters', 'easylist', 'easyprivacy'];
        const total = enabled
            .map((id) => RULESET_DETAILS.find((d) => d.id === id)?.rules.total ?? Number.NaN)
            .reduce((a, b) => a + b, 0);
        expect(Number.isFinite(total)).toBe(true);
        const text = renderData(buildTroubleshootingConfig(inputs({ userAgent: SAFARI_186_UA, enabledRulesets: enabled })));
        expect(text).toBe(
            renderData({
                name: 'Blocker',
                version: '2026.1003.1243',
                browser: 'Safari 18.6 (mac)',
                filtering: { default: 'optimal' },
                permission: 'all',
                rules: total,
                rulesets: ['easylist', 'easyprivacy', 'ublock-filters'],
            }),
        );
        for (const absent of ['strictblock', 'popupblock', 'badge', 'user rules', 'scripting', 'console']) {
            expect(text).not.toContain(`${absent}:`);
        }
        expect(enabled).toEqual(['ublock-filters', 'easylist', 'easyprivacy']);
    });

    it('prints optional lines in upstream order', () => {
        const text = renderData(
            buildTroubleshootingConfig(
                inputs({
                    currentConfig: { strictBlockMode: true, popupBlockMode: false },
                    hasOmnipotence: false,
                    defaultMode: 0,
                    userRules: [{}, {}],
                    consoleOutput: ['[1003.1200]a', '[1003.1201]b'],
                    registeredScripts: ['x'],
                }),
            ),
        );
        const keys = text
            .split('\n')
            .filter((line) => !line.startsWith(' '))
            .map((line) => line.split(':')[0]);
        expect(keys).toEqual([
            'name',
            'version',
            'browser',
            'filtering',
            'permission',
            'strictblock',
            'popupblock',
            'user rules',
            'rules',
            'rulesets',
            'scripting',
            'console',
        ]);
        expect(text).toContain('filtering:\n default: no filtering');
        expect(text).toContain('permission: ask');
        expect(text).toContain('user rules: 2');
        expect(text).toContain('console:\n [1003.1200]a\n [1003.1201]b');
    });

    it('fails like upstream when an enabled id has no details', () => {
        expect(() => buildTroubleshootingConfig(inputs({ enabledRulesets: ['nope'] }))).toThrow();
    });

    it('builds the browser line like upstream', () => {
        expect(vendorString(SAFARI_URL, SAFARI_26_UA, 'mac')).toBe('Safari 26.0 (mac)');
        expect(vendorString(SAFARI_URL, 'no version here', 'mac')).toBe('Safari ? (mac)');
        expect(vendorString(SAFARI_URL, 'Version/18.6 Mobile/15E148 Safari/604.1', 'ios')).toBe('Safari Mobile 18.6 (ios)');
        expect(vendorString('moz-extension://x/', 'Firefox/140.0', 'linux')).toBe('Firefox 140.0 (linux)');
        expect(vendorString('chrome-extension://x/', 'Chrome/140.0.1 Edg/140', 'win')).toBe('Edge 140 (win)');
        expect(vendorString('chrome-extension://x/', 'Chrome/140.0.1', 'win')).toBe('Chrome 140 (win)');
    });

    it('renderData follows js/troubleshooting.js:26-48', () => {
        expect(renderData({ a: 1, b: { c: [1, 2], d: null }, e: [] })).toBe('a: 1\nb:\n c:\n  1\n  2\n d: null\ne:\n');
        expect(renderData('x', 2)).toBe('  x');
    });
});

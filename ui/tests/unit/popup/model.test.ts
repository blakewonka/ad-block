/**
 * Pure helpers of the popup (src/popup/model.ts) against docs/specs/popup.md.
 */
import { describe, expect, it } from 'vitest';

import type { PopupPanelDataResponse } from '@/lib/bridge';
import {
    CLASSIC_POPUP_URL,
    RELOAD_DELAY_MS,
    TOOL_FILES,
    forbiddenTokens,
    needsPendingMessage,
    needsPermission,
    panelDataRequest,
    permissionOrigins,
    readyVisibility,
    reloadPlan,
    reportPath,
    resolveTabTarget,
    shouldReload,
} from '@/popup/model';

const EXT = 'safari-web-extension://ABCDEF';
const STRICT = `${EXT}/strictblock.`;

const PANEL: PopupPanelDataResponse = {
    hasOmnipotence: false,
    level: 1,
    autoReload: true,
    isSideloaded: false,
    developerMode: false,
    hasCustomFilters: 0,
};

function website(tab: unknown): URL {
    const r = resolveTabTarget(tab, STRICT);
    if (r.kind !== 'website') throw new Error(`expected a website for ${JSON.stringify(tab)}`);
    return r.tabURL;
}

describe('resolveTabTarget (§3.1)', () => {
    it('L1: a normal https tab', () => {
        const u = website({ id: 42, url: 'https://www.example.com/path?x=1' });
        expect(panelDataRequest(u)).toStrictEqual({ origin: 'https://www.example.com', hostname: 'www.example.com' });
        expect(u.href).toBe('https://www.example.com/path?x=1');
    });

    it('L2: unwraps the strict-block page', () => {
        const u = website({ id: 42, url: `${EXT}/strictblock.html#https://blocked.example/x?y=1` });
        expect(panelDataRequest(u)).toStrictEqual({ origin: 'https://blocked.example', hostname: 'blocked.example' });
        expect(u.href).toBe('https://blocked.example/x?y=1');
    });

    it('L3: IDN hostnames are punycode in the payload', () => {
        for (const url of ['https://xn--bcher-kva.example/pfad', 'https://bücher.example/pfad']) {
            expect(panelDataRequest(website({ url }))).toStrictEqual({
                origin: 'https://xn--bcher-kva.example',
                hostname: 'xn--bcher-kva.example',
            });
        }
    });

    it('L4: userinfo, port and case', () => {
        const u = website({ url: 'http://user:pw@Sub.Example.COM:8080/a b?q=1#frag' });
        expect(panelDataRequest(u)).toStrictEqual({ origin: 'http://sub.example.com:8080', hostname: 'sub.example.com' });
        expect(u.href).toBe('http://user:pw@sub.example.com:8080/a%20b?q=1#frag');
    });

    it('IPv6 and trailing dot', () => {
        expect(panelDataRequest(website({ url: 'http://[::1]:8080/' })).hostname).toBe('[::1]');
        expect(panelDataRequest(website({ url: 'https://EXAMPLE.com./' })).hostname).toBe('example.com.');
    });

    it('L5: not a website', () => {
        const cases: unknown[] = [
            undefined,
            null,
            'tab',
            { url: 'about:blank' },
            { url: 'file:///x' },
            { url: 'ftp://example.com/' },
            { url: `${EXT}/dashboard.html` },
            { url: '' },
            {},
            { url: `${EXT}/strictblock.html` },
            { url: `${EXT}/strictblock.html#` },
            { url: `${EXT}/strictblock.html#https%3A%2F%2Fblocked.example%2F` },
        ];
        for (const tab of cases) {
            expect(resolveTabTarget(tab, STRICT), JSON.stringify(tab)).toStrictEqual({ kind: 'no-website' });
        }
    });
});

describe('commit rules (§5.6)', () => {
    it('permission for every target 2 or 3, pending only when crossing from {0,1}', () => {
        const table: Array<[0 | 1 | 2 | 3, 0 | 1 | 2 | 3, boolean, boolean]> = [
            [1, 0, false, false],
            [2, 0, false, false],
            [3, 1, false, false],
            [0, 1, false, false],
            [1, 2, true, true],
            [1, 3, true, true],
            [0, 3, true, true],
            [0, 2, true, true],
            [2, 3, true, false],
            [3, 2, true, false],
            [2, 2, true, false],
            [1, 1, false, false],
        ];
        for (const [before, after, perm, pending] of table) {
            expect(needsPermission(after), `${before}->${after}`).toBe(perm);
            expect(needsPendingMessage(before, after), `${before}->${after}`).toBe(pending);
        }
    });

    it('permission pattern uses the full ASCII hostname', () => {
        expect(permissionOrigins('www.example.com')).toStrictEqual(['*://*.www.example.com/*']);
        expect(permissionOrigins('[::1]')).toStrictEqual(['*://*.[::1]/*']);
        expect(permissionOrigins('xn--bcher-kva.example')).toStrictEqual(['*://*.xn--bcher-kva.example/*']);
    });

    it('reload only when the level in force changed and autoReload is on (L19, L20, L21)', () => {
        expect(shouldReload(0, 1, true)).toBe(true);
        expect(shouldReload(1, 1, true)).toBe(false);
        expect(shouldReload(0, 1, false)).toBe(false);
        expect(shouldReload(0, 2, true)).toBe(true);
        expect(RELOAD_DELAY_MS).toBe(437);
    });

    it('tabs.reload when the tab URL is normalised, tabs.update otherwise (L22)', () => {
        expect(reloadPlan('https://www.example.com/path?x=1', 'https://www.example.com/path?x=1')).toStrictEqual({ kind: 'reload' });
        expect(reloadPlan('https://blocked.example/x?y=1', `${EXT}/strictblock.html#https://blocked.example/x?y=1`)).toStrictEqual({
            kind: 'update',
            url: 'https://blocked.example/x?y=1',
        });
        const u = website({ url: 'http://user:pw@Sub.Example.COM:8080/a b?q=1#frag' });
        expect(reloadPlan(u.href, 'http://user:pw@Sub.Example.COM:8080/a b?q=1#frag')).toStrictEqual({
            kind: 'update',
            url: 'http://user:pw@sub.example.com:8080/a%20b?q=1#frag',
        });
    });
});

describe('report (§6 call D)', () => {
    const page = `${EXT}/report.html`;
    it('L31', () => {
        expect(reportPath(page, 42, 'https://www.example.com/path?x=1', 1)).toBe(
            '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1',
        );
    });
    it('L33', () => {
        expect(reportPath(page, 42, 'https://blocked.example/x?y=1', 2)).toBe(
            '/report.html?tabid=42&url=https%3A%2F%2Fblocked.example%2Fx%3Fy%3D1&mode=2',
        );
    });
    it('L44', () => {
        const u = website({ url: 'http://user:pw@Sub.Example.COM:8080/a b?q=1#frag' });
        expect(reportPath(page, 42, u.href, 1)).toBe(
            '/report.html?tabid=42&url=http%3A%2F%2Fuser%3Apw%40sub.example.com%3A8080%2Fa%2520b%3Fq%3D1%23frag&mode=1',
        );
    });
});

describe('visibility (§6, §7, §8.4, §8.5)', () => {
    it('L1 defaults', () => {
        expect(readyVisibility(PANEL, 42)).toStrictEqual({
            modeReadOnly: false,
            zapper: true,
            picker: true,
            unpicker: false,
            report: true,
            localTools: true,
            dashboard: true,
            matchedRules: false,
        });
    });

    it('L8 / L46 unpicker follows the count', () => {
        expect(readyVisibility({ ...PANEL, hasCustomFilters: 2 }, 42).unpicker).toBe(true);
        expect(readyVisibility({ ...PANEL, hasCustomFilters: 1 }, 42).unpicker).toBe(true);
        expect(readyVisibility({ ...PANEL, hasCustomFilters: 0 }, 42).unpicker).toBe(false);
    });

    it('L9 matched rules', () => {
        const on = { ...PANEL, isSideloaded: true, developerMode: true };
        expect(readyVisibility(on, 42).matchedRules).toBe(true);
        expect(readyVisibility({ ...on, isSideloaded: false }, 42).matchedRules).toBe(false);
        expect(readyVisibility({ ...on, developerMode: false }, 42).matchedRules).toBe(false);
        expect(readyVisibility(on, undefined).matchedRules).toBe(false);
        expect(readyVisibility(on, '42').matchedRules).toBe(false);
        expect(readyVisibility(on, Number.NaN).matchedRules).toBe(false);
    });

    it('L10 admin tokens', () => {
        const v = (tokens: string[], extra: Partial<PopupPanelDataResponse> = {}) =>
            readyVisibility({ ...PANEL, ...extra, disabledFeatures: tokens }, 42);
        expect(v(['zapper']).zapper).toBe(false);
        expect(v(['picker'], { hasCustomFilters: 2 })).toMatchObject({ picker: false, unpicker: false, localTools: true });
        expect(v(['report']).report).toBe(false);
        expect(v(['zapper', 'picker', 'report']).localTools).toBe(false);
        expect(v(['dashboard'], { isSideloaded: true, developerMode: true })).toMatchObject({ dashboard: false, matchedRules: false });
        expect(v(['filteringMode']).modeReadOnly).toBe(true);
        expect(v(['develop'])).toStrictEqual(readyVisibility(PANEL, 42));
        expect(v([])).toStrictEqual(readyVisibility(PANEL, 42));
    });

    it('tokens are whitespace-separated, as CSS ~= matches them (parity review)', () => {
        const v = (tokens: string[]) => readyVisibility({ ...PANEL, disabledFeatures: tokens }, 42);
        expect(v([' filteringMode']).modeReadOnly).toBe(true);
        expect(v(['filteringMode ']).modeReadOnly).toBe(true);
        expect(v(['filteringMode zapper'])).toMatchObject({ modeReadOnly: true, zapper: false });
        expect(v(['zapper picker report']).localTools).toBe(false);
        expect(v(['dashboard\t']).dashboard).toBe(false);
        expect(v(['\nreport\r\fpicker']).report).toBe(false);
        expect([...forbiddenTokens(['  a\t\tb ', '', ' '])]).toStrictEqual(['a', 'b']);
        // Case-sensitive, like ~= in an HTML document: no restriction.
        expect(v(['FilteringMode', 'ZAPPER'])).toStrictEqual(readyVisibility(PANEL, 42));
        // A token that only contains another one does not match (~= is a whole-word match).
        expect(v(['filteringModeX', 'xzapper'])).toStrictEqual(readyVisibility(PANEL, 42));
    });

    it('L41 null tokens are no restriction', () => {
        expect(forbiddenTokens(null).size).toBe(0);
        expect(forbiddenTokens(undefined).size).toBe(0);
        expect(readyVisibility({ ...PANEL, disabledFeatures: null }, 42)).toStrictEqual(readyVisibility(PANEL, 42));
    });
});

describe('constants', () => {
    it('tool file lists keep their order (L27-L29)', () => {
        expect(TOOL_FILES.zapper).toStrictEqual(['/js/scripting/tool-overlay.js', '/js/scripting/zapper.js']);
        expect(TOOL_FILES.picker).toStrictEqual([
            '/js/scripting/css-procedural-api.js',
            '/js/scripting/tool-overlay.js',
            '/js/scripting/picker.js',
        ]);
        expect(TOOL_FILES.unpicker).toStrictEqual([
            '/js/scripting/css-procedural-api.js',
            '/js/scripting/tool-overlay.js',
            '/js/scripting/unpicker.js',
        ]);
    });
    it('classic popup file name', () => {
        expect(CLASSIC_POPUP_URL).toBe('popup-classic.html');
    });
});

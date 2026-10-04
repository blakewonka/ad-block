/**
 * A malformed getOptionsPageData answer degrades the
 * dashboard instead of failing it (dashboard-shell P-2/P-3, settings.md
 * checklist 6b). Pure `salvageOptionsData` + the store/pane against the mock.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPane } from '@/dashboard/panes/Settings';
import { salvageOptionsData } from '@/dashboard/panes/Settings/salvage';
import { getOptionsSnapshot, loadOptionsData, resetOptionsStoreForTests } from '@/dashboard/panes/Settings/store';
import { isBridgeError } from '@/lib/bridge';
import type { MockOptions } from '@/dev/mock-ext';

import { installMock, type InstalledMock } from './mock';

const VALID = {
    hasOmnipotence: true,
    defaultFilteringMode: 2,
    enabledRulesets: ['ublock-filters', 'easylist'],
    adminRulesets: [],
    rulesetDetails: [{ id: 'easylist' }],
    autoReload: true,
    showBlockedCount: true,
    canShowBlockedCount: true,
    strictBlockMode: false,
    popupBlockMode: true,
    firstRun: false,
    isSideloaded: false,
    developerMode: true,
    supportsCompiledFilters: false,
    supportsUserScripts: false,
};

describe('salvageOptionsData (pure)', () => {
    it('refuses what it cannot repair safely: non-objects and malformed ruleset arrays', () => {
        expect(salvageOptionsData(null)).toBeNull();
        expect(salvageOptionsData('x')).toBeNull();
        expect(salvageOptionsData([VALID])).toBeNull();
        // Even with a repairable field next to it, a bad ruleset array is never guessed.
        const bad = { ...VALID, disabledFeatures: 'develop' };
        expect(salvageOptionsData({ ...bad, enabledRulesets: null })).toBeNull();
        expect(salvageOptionsData({ ...bad, enabledRulesets: ['a', 1] })).toBeNull();
        expect(salvageOptionsData({ ...bad, adminRulesets: '+easylist' })).toBeNull();
        expect(salvageOptionsData({ ...bad, rulesetDetails: {} })).toBeNull();
    });

    it('refuses an answer with nothing it knows how to repair (does not second-guess the bridge)', () => {
        expect(salvageOptionsData(VALID)).toBeNull();
        expect(salvageOptionsData({ ...VALID, disabledFeatures: null })).toBeNull();
        expect(salvageOptionsData({ ...VALID, disabledFeatures: ['picker'] })).toBeNull();
    });

    it('P-3: a non-array disabledFeatures = unreadable admin policy -> Develop off, nothing else hidden', () => {
        for (const df of ['develop', 'dashboard', 5, true, {}]) {
            const r = salvageOptionsData({ ...VALID, disabledFeatures: df });
            expect(r?.repaired).toEqual(['disabledFeatures']);
            expect(r?.data.disabledFeatures).toEqual(['develop']);
            expect(r?.data.enabledRulesets).toEqual(VALID.enabledRulesets);
            expect(r?.data.defaultFilteringMode).toBe(2);
        }
        // Upstream: ''.length === 0 -> renderAdminRules returns early, nothing hidden.
        const empty = salvageOptionsData({ ...VALID, disabledFeatures: '' });
        expect(empty?.data).not.toHaveProperty('disabledFeatures');
        // An array keeps its string tokens.
        expect(salvageOptionsData({ ...VALID, disabledFeatures: ['picker', 7, null] })?.data.disabledFeatures).toEqual(['picker']);
    });

    it('6b: a malformed defaultFilteringMode selects nothing; "1".."3" select that level like upstream', () => {
        expect(salvageOptionsData({ ...VALID, defaultFilteringMode: '2' })?.data.defaultFilteringMode).toBe(2);
        expect(salvageOptionsData({ ...VALID, defaultFilteringMode: '3' })?.data.defaultFilteringMode).toBe(3);
        for (const bad of [undefined, null, 5, 2.5, NaN, 'optimal', '0x2']) {
            const r = salvageOptionsData({ ...VALID, defaultFilteringMode: bad });
            expect(r?.repaired).toEqual(['defaultFilteringMode']);
            expect(r?.data.defaultFilteringMode).toBe(0);
        }
    });

    it('never mutates its input', () => {
        const raw = { ...VALID, defaultFilteringMode: 'x', disabledFeatures: 'develop' };
        const copy = structuredClone(raw);
        salvageOptionsData(raw);
        expect(raw).toEqual(copy);
    });
});

describe('store + Settings pane with a malformed boot answer', () => {
    let mock: InstalledMock | null = null;

    async function boot(options: MockOptions, patch: Record<string, unknown> | null) {
        mock = installMock(options);
        if (patch !== null) {
            // A full, otherwise valid answer from the same mock, with the bad fields patched in.
            const real = (await (mock.browser.runtime as { sendMessage: (m: unknown) => Promise<Record<string, unknown>> }).sendMessage({
                what: 'getOptionsPageData',
            }));
            mock.control.setResponse('getOptionsPageData', { ...real, ...patch });
            mock.calls.length = 0;
        }
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<SettingsPane />);
        await waitFor(() => expect(screen.getByTestId('settings-pane')).toHaveAttribute('data-state', 'ready'));
        return mock;
    }

    beforeEach(() => resetOptionsStoreForTests());
    afterEach(() => {
        cleanup();
        resetOptionsStoreForTests();
        mock?.uninstall();
        mock = null;
        vi.restoreAllMocks();
    });

    it('P-3: string disabledFeatures with developer mode on -> pane renders, Develop gate off, one message', async () => {
        const m = await boot({ background: { developerMode: true, disabledFeatures: 'develop' as unknown as string[] } }, null);
        const state = getOptionsSnapshot();
        expect(state.status).toBe('ready');
        expect(state.status === 'ready' && state.develop).toBe(false);
        expect(document.querySelector('[data-setting="developerMode"]')).toBeNull();
        expect(document.querySelector('[data-setting="autoReload"]')).not.toBeNull();
        expect(screen.getByTestId('settings-mode')).toBeInTheDocument();
        expect(m.messages()).toEqual([{ what: 'getOptionsPageData' }]);
        expect(console.warn).toHaveBeenCalledWith(
            '[settings store] getOptionsPageData answer repaired:',
            'disabledFeatures',
            expect.anything(),
        );
    });

    it('P-2 (kept by design): null disabledFeatures means "absent" (messaging.md §1.4), so developer mode shows Develop', async () => {
        await boot({ background: { developerMode: true, disabledFeatures: null } }, null);
        const state = getOptionsSnapshot();
        expect(state.status === 'ready' && state.develop).toBe(true);
        expect(document.querySelector('[data-setting="developerMode"]')).not.toBeNull();
    });

    it('6b: an unexpected defaultFilteringMode leaves no card selected and every other control rendered', async () => {
        await boot({}, { defaultFilteringMode: 'optimal' });
        expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0);
        expect(screen.getAllByRole('switch').length).toBeGreaterThanOrEqual(3);
        expect(screen.queryByTestId('settings-load-error')).toBeNull();
    });

    it('6b: "2" selects optimal, like upstream', async () => {
        await boot({}, { defaultFilteringMode: '2' });
        const checked = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked);
        expect(checked).toHaveLength(1);
        expect((checked[0] as HTMLInputElement).value).toBe('2');
    });

    it('a malformed enabledRulesets still fails loudly (never guessed), with the bridge error', async () => {
        mock = installMock();
        const real = await (mock.browser.runtime as { sendMessage: (m: unknown) => Promise<Record<string, unknown>> }).sendMessage({
            what: 'getOptionsPageData',
        });
        mock.control.setResponse('getOptionsPageData', { ...real, enabledRulesets: 'easylist', disabledFeatures: 'develop' });
        const err = await loadOptionsData().catch((e: unknown) => e);
        expect(isBridgeError(err)).toBe(true);
        expect(getOptionsSnapshot().status).toBe('error');
    });
});

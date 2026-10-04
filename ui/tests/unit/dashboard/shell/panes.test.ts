/** Pure pane rules of the shell (dashboard-shell.md §2.2-§2.4, P-4..P-6). */
import { describe, expect, it } from 'vitest';

import {
    effectiveDeveloperMode,
    isClassicPane,
    PANE_IDS,
    PANE_LABEL_KEYS,
    resolveStartPane,
    visiblePanes,
} from '@/dashboard/shell/panes';

describe('dashboard shell pane rules', () => {
    it('has the upstream pane order and label keys (R-1)', () => {
        expect(PANE_IDS).toEqual(['settings', 'rulesets', 'filters', 'develop', 'about']);
        expect(PANE_IDS.map((id) => PANE_LABEL_KEYS[id])).toEqual([
            'settingsPageName',
            'aboutFilterLists',
            'customFiltersPageName',
            'developPageName',
            'aboutPageName',
        ]);
        expect(isClassicPane('filters')).toBe(true);
        expect(isClassicPane('develop')).toBe(true);
        expect(isClassicPane('about')).toBe(false);
    });

    it('computes effective developer mode like settings.js:72-76', () => {
        expect(effectiveDeveloperMode({ developerMode: true })).toBe(true);
        expect(effectiveDeveloperMode({ developerMode: 1 })).toBe(true);
        expect(effectiveDeveloperMode({ developerMode: false })).toBe(false);
        expect(effectiveDeveloperMode({ developerMode: true, disabledFeatures: ['develop'] })).toBe(false);
        expect(effectiveDeveloperMode({ developerMode: true, disabledFeatures: ['picker'] })).toBe(true);
    });

    it('hides tabs per §2.3', () => {
        expect(visiblePanes({}, false)).toEqual({ settings: true, rulesets: true, filters: true, develop: false, about: true });
        expect(visiblePanes({}, true).develop).toBe(true);
        expect(visiblePanes({ disabledFeatures: ['picker'] }, false)).toEqual({
            settings: true,
            rulesets: true,
            filters: false,
            develop: false,
            about: true,
        });
        // `dashboard` does not hide Develop (H2).
        expect(visiblePanes({ disabledFeatures: ['dashboard'] }, true)).toEqual({
            settings: false,
            rulesets: false,
            filters: false,
            develop: true,
            about: true,
        });
    });

    it('resolves the start pane (R-3, R-5, D-1)', () => {
        expect(resolveStartPane(undefined, {}, false)).toBe('settings');
        expect(resolveStartPane(42, {}, false)).toBe('settings');
        expect(resolveStartPane('rulesets', {}, false)).toBe('rulesets');
        expect(resolveStartPane('filters', {}, false)).toBe('filters');
        expect(resolveStartPane('about', {}, false)).toBe('about');
        // Q1: stored develop, developer mode off.
        expect(resolveStartPane('develop', {}, false)).toBe('settings');
        expect(resolveStartPane('develop', {}, true)).toBe('develop');
        // Q2: stored filters, picker disabled.
        expect(resolveStartPane('filters', { disabledFeatures: ['picker'] }, false)).toBe('settings');
        // Q3: unknown string.
        expect(resolveStartPane('busy', {}, false)).toBe('settings');
        expect(resolveStartPane('nonsense', {}, false)).toBe('settings');
        // R-5: forced About whatever was stored.
        expect(resolveStartPane('develop', { disabledFeatures: ['dashboard'] }, true)).toBe('about');
        expect(resolveStartPane(undefined, { disabledFeatures: ['dashboard'] }, false)).toBe('about');
    });
});

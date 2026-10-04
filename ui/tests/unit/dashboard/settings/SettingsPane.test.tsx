/**
 * SettingsPane behaviour against the project's mock background (happy-dom).
 * Parity lines: settings.md §14.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPane } from '@/dashboard/panes/Settings';
import { getOptionsSnapshot, registerBeforeRestore, resetOptionsStoreForTests } from '@/dashboard/panes/Settings/store';
import { settingsTiming } from '@/dashboard/panes/Settings/timing';
import type { MockOptions } from '@/dev/mock-ext';

import { en, installMock, type InstalledMock } from './mock';

let mock: InstalledMock | null = null;

function setup(options: MockOptions = {}, { strict = false }: { strict?: boolean } = {}) {
    mock = installMock(options);
    const ui = strict ? (
        <StrictMode>
            <SettingsPane />
        </StrictMode>
    ) : (
        <SettingsPane />
    );
    const view = render(ui);
    return { m: mock, view };
}

async function ready() {
    await waitFor(() => expect(screen.getByTestId('settings-pane')).toHaveAttribute('data-state', 'ready'));
}

const whats = (m: InstalledMock) => m.messages().map((x) => (x as { what: string }).what);
const radio = (name: string) => screen.getByRole('radio', { name });
const toggle = (key: string) => screen.getByTestId(`settings-toggle-${key}`);
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
    resetOptionsStoreForTests();
});
afterEach(() => {
    cleanup();
    resetOptionsStoreForTests();
    mock?.uninstall();
    mock = null;
    vi.restoreAllMocks();
});

describe('boot (checklist 1-6b)', () => {
    it('shows a skeleton, then the pane; exactly one getOptionsPageData even in StrictMode and with two panes', async () => {
        mock = installMock();
        render(
            <StrictMode>
                <SettingsPane />
                <SettingsPane />
            </StrictMode>,
        );
        expect(screen.getAllByTestId('settings-skeleton').length).toBeGreaterThan(0);
        await waitFor(() => expect(screen.getAllByTestId('settings-pane')[0]).toHaveAttribute('data-state', 'ready'));
        expect(whats(mock)).toEqual(['getOptionsPageData']);
    });

    it('a failed getOptionsPageData shows an error state, renders no widget and opens no channel', async () => {
        const spy = vi.spyOn(globalThis, 'BroadcastChannel');
        const { m } = setup({ failures: { getOptionsPageData: 'undefined' } });
        await waitFor(() => expect(screen.getByTestId('settings-load-error')).toBeInTheDocument());
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(spy.mock.calls.filter((c) => c[0] === 'uBOL')).toHaveLength(0);
        expect(whats(m)).toEqual(['getOptionsPageData']);
    });

    it('the channel is opened once, after the answer', async () => {
        const spy = vi.spyOn(globalThis, 'BroadcastChannel');
        setup();
        await ready();
        expect(spy.mock.calls.filter((c) => c[0] === 'uBOL')).toHaveLength(1);
    });

    it('Safari: the strict-blocking row is absent; toggle order is upstream order', async () => {
        setup();
        await ready();
        const rows = Array.from(document.querySelectorAll('[data-setting]')).map((r) => r.getAttribute('data-setting'));
        expect(rows).toEqual(['autoReload', 'showBlockedCount', 'popupBlockMode', 'developerMode']);
        expect(screen.queryByText(en('enableStrictBlockLabel'))).toBeNull();
    });

    it('admin tokens hide the mode block and the developer row (computed once), with a note', async () => {
        setup({ scenario: 'admin-locked' });
        await ready();
        expect(screen.queryByTestId('settings-mode')).toBeNull();
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(document.querySelector('[data-setting="developerMode"]')).toBeNull();
        expect(screen.getByTestId('settings-managed-note')).toBeInTheDocument();
        // A broadcast cannot change disabledFeatures.
        await act(async () => {
            mock!.control.broadcast({ disabledFeatures: [] });
            await new Promise((r) => setTimeout(r, 10));
        });
        expect(screen.queryByTestId('settings-mode')).toBeNull();
    });

    it('`dashboard` token: the pane renders nothing', async () => {
        setup({ background: { disabledFeatures: ['dashboard'] } });
        await ready();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByRole('heading')).toBeNull();
    });

    it('absent or empty disabledFeatures hides nothing and shows no note', async () => {
        setup({ background: { disabledFeatures: [] } });
        await ready();
        expect(screen.getByTestId('settings-mode')).toBeInTheDocument();
        expect(screen.queryByTestId('settings-managed-note')).toBeNull();
    });
});

describe('default filtering mode (checklist 7-16)', () => {
    it('three options in order basic/optimal/complete, stored level selected, descriptions keep paragraph breaks', async () => {
        setup();
        await ready();
        const group = screen.getByRole('radiogroup');
        // The group is named by the section heading.
        expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe(en('defaultFilteringModeSectionLabel'));
        const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
        expect(radios.map((r) => document.getElementById(r.getAttribute('aria-labelledby')!)!.textContent)).toEqual([
            en('filteringMode1Name'),
            en('filteringMode2Name'),
            en('filteringMode3Name'),
        ]);
        // Native radios of one group (arrow keys select, like upstream's <input type=radio>).
        expect(radios.every((r) => r.type === 'radio' && r.name === radios[0].name)).toBe(true);
        expect(radio(en('filteringMode2Name'))).toBeChecked();
        const cards = Array.from(document.querySelectorAll('[data-level-card]'));
        expect(cards.map((c) => c.tagName)).toEqual(['LABEL', 'LABEL', 'LABEL']);
        const description = cards[1].querySelector('p')!;
        expect(description.textContent).toBe(en('optimalFilteringModeDescription').trim());
        expect(description.className).toContain('whitespace-pre-line');
        // Each radio is described by its own card's description.
        expect(radios[1].getAttribute('aria-describedby')).toBe(description.id);
        // Names stay the catalogue's lower-case strings; capitalised by CSS only.
        expect(cards[0].querySelector('span.capitalize')!.textContent).toBe(en('filteringMode1Name'));
    });

    it('level 0 selects nothing', async () => {
        setup({ defaultLevel: 0 });
        await ready();
        for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked();
    });

    it('a click anywhere on a card selects it (the card is the radio label)', async () => {
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        fireEvent.click(document.querySelector('[data-level-card="1"] p')!);
        await waitFor(() => expect(radio(en('filteringMode1Name'))).toBeChecked());
        await flush();
        expect(m.messages()).toEqual([{ what: 'setDefaultFilteringMode', level: 1 }]);
    });

    it('basic: exactly setDefaultFilteringMode level 1, no permission call', async () => {
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode1Name')));
        await waitFor(() => expect(radio(en('filteringMode1Name'))).toBeChecked());
        await flush();
        expect(m.traffic().filter((c) => !c.api.startsWith('storage'))).toEqual([
            { api: 'runtime.sendMessage', args: [{ what: 'setDefaultFilteringMode', level: 1 }] },
        ]);
        expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 1 } });
    });

    it('complete: permissions.request is made synchronously inside the click, even with omnipotence; then the message', async () => {
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode3Name')));
        // Read synchronously, before any await: the request must already be recorded, and nothing else.
        expect(m.traffic()).toEqual([{ api: 'permissions.request', args: [{ origins: ['<all_urls>'] }] }]);
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 3, hasOmnipotence: true } }));
        expect(whats(m)).toEqual(['setDefaultFilteringMode']);
        expect(m.messages()[0]).toEqual({ what: 'setDefaultFilteringMode', level: 3 });
        expect(radio(en('filteringMode3Name'))).toBeChecked();
    });

    it('activating the selected option sends nothing', async () => {
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode2Name')));
        await flush();
        expect(m.traffic()).toEqual([]);
    });

    it('denied: no message, selection back to the stored mode, a warning', async () => {
        const { m } = setup({ permission: 'deny' });
        await ready();
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode3Name')));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/not granted/));
        expect(whats(m)).toEqual([]);
        expect(radio(en('filteringMode2Name'))).toBeChecked();
        expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 2 } });
    });

    it('a rejected permission request reverts and is surfaced', async () => {
        const { m } = setup({ permission: 'reject' });
        await ready();
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode3Name')));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be changed/));
        expect(whats(m)).toEqual([]);
        expect(radio(en('filteringMode2Name'))).toBeChecked();
    });

    it('a failed message reverts, keeps the store intact (no optimistic hasOmnipotence) and is surfaced', async () => {
        const { m } = setup({ scenario: 'error-on-apply', background: { grantedOrigins: [] } });
        await ready();
        expect(getOptionsSnapshot()).toMatchObject({ data: { hasOmnipotence: false } });
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode3Name')));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be changed/));
        expect(whats(m)).toEqual(['setDefaultFilteringMode']);
        expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 2, hasOmnipotence: false } });
        expect(radio(en('filteringMode2Name'))).toBeChecked();
    });

    it('the selection follows a later broadcast', async () => {
        setup();
        await ready();
        await act(async () => {
            mock!.control.broadcast({ defaultFilteringMode: 1 });
            await new Promise((r) => setTimeout(r, 10));
        });
        expect(radio(en('filteringMode1Name'))).toBeChecked();
    });

    it('never sends setPendingFilteringMode, never calls permissions.remove or tabs.reload', async () => {
        const { m } = setup();
        await ready();
        fireEvent.click(radio(en('filteringMode3Name')));
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 3 } }));
        fireEvent.click(radio(en('filteringMode1Name')));
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 1 } }));
        const apis = m.calls.map((c) => c.api);
        expect(apis).not.toContain('permissions.remove');
        expect(apis).not.toContain('tabs.reload');
        expect(whats(m)).not.toContain('setPendingFilteringMode');
    });
});

describe('toggles (checklist 17-24)', () => {
    it.each([
        ['autoReload', 'setAutoReload'],
        ['showBlockedCount', 'setShowBlockedCount'],
        ['popupBlockMode', 'setPopupBlockMode'],
        ['developerMode', 'setDeveloperMode'],
    ])('%s sends exactly { what: %s, state } once and shows the new state at once', async (key, what) => {
        const { m } = setup({ echo: false });
        await ready();
        const sw = toggle(key);
        const before = sw.getAttribute('aria-checked') === 'true';
        m.calls.length = 0;
        fireEvent.click(sw);
        expect(m.messages()).toEqual([{ what, state: !before }]); // sent synchronously in the event
        expect(sw).toHaveAttribute('aria-checked', String(!before));
        await flush();
        expect(m.messages()).toEqual([{ what, state: !before }]);
        // Acknowledged: the store holds the sent value even without an echo (reported deviation).
        expect((getOptionsSnapshot() as unknown as { data: Record<string, unknown> }).data[key]).toBe(!before);
    });

    it('developer mode flips the Develop gate immediately', async () => {
        setup({ delay: 50 });
        await ready();
        expect(getOptionsSnapshot()).toMatchObject({ develop: false });
        fireEvent.click(toggle('developerMode'));
        expect(getOptionsSnapshot()).toMatchObject({ develop: true });
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ data: { developerMode: true } }));
    });

    it('a failed toggle reverts and is surfaced (and resets the Develop gate)', async () => {
        setup({ scenario: 'error-on-apply' });
        await ready();
        fireEvent.click(toggle('developerMode'));
        expect(getOptionsSnapshot()).toMatchObject({ develop: true });
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en('developerModeLabel')));
        expect(toggle('developerMode')).toHaveAttribute('aria-checked', 'false');
        expect(getOptionsSnapshot()).toMatchObject({ develop: false, data: { developerMode: false } });
    });

    it('show blocked count is unchecked and disabled when it cannot be shown', async () => {
        setup({ background: { canShowBlockedCount: false } });
        await ready();
        expect(toggle('showBlockedCount')).toBeDisabled();
        expect(toggle('showBlockedCount')).toHaveAttribute('aria-checked', 'false');
    });

    it('non-Safari: strict blocking is shown, disabled without omnipotence and enabled with it', async () => {
        mock = installMock({ background: { grantedOrigins: [], strictBlockMode: true } });
        const runtime = mock.browser.runtime as { getURL: (p: string) => string };
        const original = runtime.getURL;
        runtime.getURL = (p: string) => original(p).replace('safari-web-extension:', 'chrome-extension:');
        render(<SettingsPane />);
        await ready();
        expect(toggle('strictBlockMode')).toBeDisabled();
        expect(toggle('strictBlockMode')).toHaveAttribute('aria-checked', 'false');
        await act(async () => {
            mock!.control.broadcast({ hasOmnipotence: true });
            await new Promise((r) => setTimeout(r, 10));
        });
        expect(toggle('strictBlockMode')).toBeEnabled();
        expect(toggle('strictBlockMode')).toHaveAttribute('aria-checked', 'true');
        mock.calls.length = 0;
        fireEvent.click(toggle('strictBlockMode'));
        expect(mock.messages()).toEqual([{ what: 'setStrictBlockMode', state: false }]);
    });

    it('legends stay attached to their toggle (aria-describedby)', async () => {
        setup();
        await ready();
        const sw = toggle('popupBlockMode');
        const id = sw.getAttribute('aria-describedby');
        expect(id).toBeTruthy();
        expect(document.getElementById(id!)!.textContent).toBe(en('enablePopupBlockLegend'));
        expect(toggle('autoReload').getAttribute('aria-describedby')).toBeNull();
    });
});

describe('live sync (checklist 25-29)', () => {
    it('applies broadcasts field by field; ignores non-objects and unknown fields', async () => {
        setup();
        await ready();
        await act(async () => {
            mock!.control.broadcast({ autoReload: false, popupBlockMode: false });
            mock!.control.broadcast('hello' as unknown as Record<string, unknown>);
            mock!.control.broadcast({ filteringModeDetails: {}, foo: 1 });
            await new Promise((r) => setTimeout(r, 10));
        });
        expect(toggle('autoReload')).toHaveAttribute('aria-checked', 'false');
        expect(toggle('popupBlockMode')).toHaveAttribute('aria-checked', 'false');
        expect(toggle('showBlockedCount')).toHaveAttribute('aria-checked', 'true');
    });

    it('a pending toggle is not overwritten by a broadcast about another field', async () => {
        setup({ delay: 100, echo: false });
        await ready();
        fireEvent.click(toggle('autoReload'));
        expect(toggle('autoReload')).toHaveAttribute('aria-checked', 'false');
        await act(async () => {
            mock!.control.broadcast({ popupBlockMode: false });
            await new Promise((r) => setTimeout(r, 10));
        });
        expect(toggle('autoReload')).toHaveAttribute('aria-checked', 'false');
        // Let the delayed (100 ms) toggle answer land inside this test: otherwise its late
        // store write leaks into the next test's store (flaky backup test). (integrate)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 250));
        });
    });

    it('enabledRulesets / adminRulesets replace the store arrays', async () => {
        setup();
        await ready();
        await act(async () => {
            mock!.control.broadcast({ enabledRulesets: ['easylist'], adminRulesets: ['+easylist'] });
            await new Promise((r) => setTimeout(r, 10));
        });
        expect(getOptionsSnapshot()).toMatchObject({ data: { enabledRulesets: ['easylist'], adminRulesets: ['+easylist'] }, listsRevision: 1 });
    });
});

describe('backup / restore / reset (checklist 31-45)', () => {
    it('backup downloads my-ubol-settings.json through a detached data: anchor', async () => {
        const clicks: HTMLAnchorElement[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            clicks.push(this);
        });
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        fireEvent.click(screen.getByTestId('settings-backup-button'));
        await waitFor(() => expect(clicks).toHaveLength(1));
        const a = clicks[0];
        expect(a.isConnected).toBe(false);
        expect(a.getAttribute('download')).toBe('my-ubol-settings.json');
        expect(a.getAttribute('type')).toBe('application/json');
        expect(a.href.startsWith('data:text/plain;charset=utf-8,')).toBe(true);
        const text = decodeURIComponent(a.href.slice('data:text/plain;charset=utf-8,'.length));
        expect(text.endsWith('\n')).toBe(true);
        expect(Object.keys(JSON.parse(text))).toEqual(['version', 'filteringModes']);
        expect(m.traffic().map((c) => c.api)).toEqual([
            'runtime.sendMessage',
            'runtime.sendMessage',
            'runtime.sendMessage',
            'runtime.sendMessage',
            'storage.local.get',
        ]);
        expect(screen.queryByTestId('settings-busy')).toBeNull();
    });

    it('a failed backup read produces no file and an error', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        setup({ failures: { getAllCustomFilters: 'reject' } });
        await ready();
        fireEvent.click(screen.getByTestId('settings-backup-button'));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/backup/i));
        expect(click).not.toHaveBeenCalled();
    });

    it('restore opens the picker synchronously, resets the input value, accepts application/json', async () => {
        setup();
        await ready();
        const input = screen.getByTestId('settings-restore-input') as HTMLInputElement;
        expect(input.accept).toBe('application/json');
        expect(input.multiple).toBe(false);
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});
        fireEvent.click(screen.getByTestId('settings-restore-button'));
        expect(click).toHaveBeenCalledTimes(1);
        expect(input.value).toBe('');
        expect(screen.queryByTestId('settings-busy')).toBeNull();
    });

    async function chooseFile(content: string, name = 'my-ubol-settings.json') {
        const input = screen.getByTestId('settings-restore-input') as HTMLInputElement;
        const file = new File([content], name, { type: 'application/json' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        fireEvent.change(input);
    }

    it('a valid file: busy while restoring, the §7.3 sequence, then success; busy left', async () => {
        const { m } = setup({ delay: 5 });
        await ready();
        m.calls.length = 0;
        await chooseFile('{"autoReload": false}');
        expect(screen.getByTestId('settings-busy')).toBeInTheDocument();
        expect(screen.getByTestId('settings-pane').querySelector('[aria-busy="true"]')).not.toBeNull();
        await waitFor(() => expect(screen.queryByTestId('settings-busy')).toBeNull(), { timeout: 3000 });
        expect(screen.getByRole('status')).toHaveTextContent(/restored/);
        expect(whats(m)).toEqual([
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
        expect(m.messages()[1]).toEqual({ what: 'setAutoReload', state: false });
        // The pane follows the echo (no reload).
        await waitFor(() => expect(toggle('autoReload')).toHaveAttribute('aria-checked', 'false'));
    });

    it.each(['this is not json', '', '42', '"abc"', 'null'])('file %j sends nothing and leaves busy', async (content) => {
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        await chooseFile(content);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/does not contain settings/));
        expect(screen.queryByTestId('settings-busy')).toBeNull();
        expect(whats(m)).toEqual([]);
    });

    // Regression (end-to-end review): the wrong .json file must not reset everything.
    it.each(['{}', '[]', '{"hello":1}', '{"name":"some-other-app","version":"1.0.0","dependencies":{}}'])(
        'a JSON file without any settings key (%s) sends nothing, says so, and keeps the custom filters',
        async (content) => {
            const { m } = setup();
            await ready();
            m.calls.length = 0;
            await chooseFile(content);
            await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/does not contain settings/));
            expect(screen.queryByTestId('settings-busy')).toBeNull();
            expect(m.traffic()).toEqual([]);
            expect(screen.queryByText(/Settings restored/)).toBeNull();
        },
    );

    // Regression (blocking-safety review): an id this build does not ship is never sent.
    it('a ruleset id this build does not ship is left out of applyRulesets and named in a warning', async () => {
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        await chooseFile('{"rulesets":["+fra-0","+removed-in-this-build"]}');
        await waitFor(() => expect(screen.getByTestId('settings-feedback-backup')).toHaveTextContent(/Settings restored/));
        const feedback = screen.getByTestId('settings-feedback-backup');
        expect(feedback).toHaveAttribute('data-tone', 'warning');
        expect(feedback).toHaveTextContent('were not enabled: removed-in-this-build');
        const applied = m.messages().filter((msg) => (msg as { what: string }).what === 'applyRulesets');
        expect(applied).toEqual([{ what: 'applyRulesets', enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy', 'fra-0'] }]);
        expect(screen.queryByTestId('settings-busy')).toBeNull();
    });

    it('a malformed file reports a partial restore and leaves busy', async () => {
        const { m } = setup();
        await ready();
        await chooseFile('{"customFilters": 5}');
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/only partly restored/));
        expect(screen.queryByTestId('settings-busy')).toBeNull();
        expect(whats(m).at(-1)).toBe('removeAllCustomFilters');
    });

    it('a bridge-refused toggle value reports that nothing was changed', async () => {
        setup();
        await ready();
        await chooseFile('{"autoReload": "yes"}');
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was changed/));
    });

    it('before-restore hooks run before step 1', async () => {
        const { m } = setup();
        await ready();
        m.calls.length = 0;
        const seen: string[] = [];
        registerBeforeRestore(() => {
            seen.push(`hook after ${m.messages().length} messages`);
        });
        await chooseFile('{"rulesets":[]}');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/restored/));
        expect(seen).toEqual(['hook after 0 messages']);
    });

    it('reset: confirmation text; Cancel sends nothing; confirm sends the reset traffic in a busy state', async () => {
        const { m } = setup({ delay: 5 });
        await ready();
        m.calls.length = 0;
        fireEvent.click(screen.getByTestId('settings-reset-button'));
        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent(en('resetToDefaultConfirm'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(m.traffic()).toEqual([]);
        expect(screen.queryByTestId('settings-busy')).toBeNull();

        fireEvent.click(screen.getByTestId('settings-reset-button'));
        const dialog2 = await screen.findByRole('alertdialog');
        fireEvent.click(within(dialog2).getByRole('button', { name: 'Reset to default settings' }));
        await waitFor(() => expect(screen.getByTestId('settings-busy')).toBeInTheDocument());
        await waitFor(() => expect(screen.queryByTestId('settings-busy')).toBeNull(), { timeout: 3000 });
        expect(screen.getByRole('status')).toHaveTextContent(/Default settings restored/);
        expect(whats(m)).toEqual([
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
        expect(m.calls.map((c) => c.api)).not.toContain('window.confirm');
        expect(m.calls.map((c) => c.api)).not.toContain('tabs.reload');
    });

    it('reset failing at transport level reports and leaves busy (error-on-apply)', async () => {
        setup({ scenario: 'error-on-apply' });
        await ready();
        fireEvent.click(screen.getByTestId('settings-reset-button'));
        const dialog = await screen.findByRole('alertdialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to default settings' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be restored/));
        expect(screen.queryByTestId('settings-busy')).toBeNull();
    });
});

/* ------------------------------------------------------------------------ */
/* Regression tests: findings of the three reviews                          */
/* ------------------------------------------------------------------------ */

describe('review fixes: nothing stays pending forever', () => {
    const savedWatchdog = settingsTiming.watchdogMs;
    afterEach(() => {
        settingsTiming.watchdogMs = savedWatchdog;
    });

    const broadcast = async (msg: Record<string, unknown>) => {
        await act(async () => {
            mock!.control.broadcast(msg);
            await new Promise((r) => setTimeout(r, 10));
        });
    };

    it('permission prompt that never settles: a broadcast of the mode wins over the pending choice', async () => {
        const { m } = setup({ permission: 'hang' });
        await ready();
        fireEvent.click(radio(en('filteringMode3Name')));
        expect(radio(en('filteringMode3Name'))).toBeChecked(); // pending choice shown
        expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByTestId('settings-mode-pending')).toBeInTheDocument();
        await broadcast({ defaultFilteringMode: 1 });
        expect(radio(en('filteringMode1Name'))).toBeChecked();
        expect(screen.getByRole('radiogroup')).not.toHaveAttribute('aria-busy');
        // Not locked: a new choice is accepted (level 1 needs no permission).
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode2Name')));
        expect(m.traffic()).toEqual([{ api: 'permissions.request', args: [{ origins: ['<all_urls>'] }] }]);
    });

    it('message that is never answered: the watchdog shows the stored mode again and announces the failure', async () => {
        settingsTiming.watchdogMs = 150;
        const { m } = setup({ failures: { setDefaultFilteringMode: 'hang' } });
        await ready();
        fireEvent.click(radio(en('filteringMode1Name')));
        expect(radio(en('filteringMode1Name'))).toBeChecked();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be changed/));
        expect(radio(en('filteringMode2Name'))).toBeChecked();
        expect(screen.getByRole('radiogroup')).not.toHaveAttribute('aria-busy');
        expect(screen.getByTestId('settings-feedback-mode')).toHaveTextContent(/could not be changed/);
        // A later change is possible again.
        mock!.control.setFailure('setDefaultFilteringMode', null);
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode1Name')));
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 1 } }));
        expect(m.messages()).toEqual([{ what: 'setDefaultFilteringMode', level: 1 }]);
    });

    it('permission granted after the watchdog gave up: the failure is replaced by the level in force', async () => {
        settingsTiming.watchdogMs = 150;
        const { m } = setup({ permissionDelay: 450 });
        await ready();
        fireEvent.click(radio(en('filteringMode3Name')));
        await waitFor(() => expect(screen.getByTestId('settings-feedback-mode')).toHaveTextContent(/could not be changed/));
        expect(radio(en('filteringMode2Name'))).toBeChecked();
        // The late grant still sends the message (the background's truth wins) ...
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 3 } }));
        expect(m.messages()).toEqual([{ what: 'getOptionsPageData' }, { what: 'setDefaultFilteringMode', level: 3 }]);
        // ... and the message now says what is in force instead of "could not be changed".
        await waitFor(() => expect(screen.getByTestId('settings-feedback-mode')).toHaveTextContent(en('filteringMode3Name')));
        expect(screen.getByTestId('settings-feedback-mode')).not.toHaveTextContent(/could not be changed/);
        expect(radio(en('filteringMode3Name'))).toBeChecked();
    });

    it('a late answer does not overwrite a newer message', async () => {
        settingsTiming.watchdogMs = 150;
        setup({ permissionDelay: 450, failures: { setAutoReload: 'reject' } });
        await ready();
        fireEvent.click(radio(en('filteringMode3Name')));
        await waitFor(() => expect(screen.getByTestId('settings-feedback-mode')).toBeInTheDocument());
        fireEvent.click(toggle('autoReload'));
        await waitFor(() => expect(screen.queryByTestId('settings-feedback-mode')).toBeNull());
        const before = document.querySelector('[data-testid^="settings-feedback-"]')?.textContent;
        expect(before).toBeTruthy();
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ data: { defaultFilteringMode: 3 } }));
        await flush();
        expect(document.querySelector('[data-testid^="settings-feedback-"]')?.textContent).toBe(before);
    });

    it('a second change is ignored only while the first is shown as pending (H15)', async () => {
        const { m } = setup({ permission: 'hang' });
        await ready();
        fireEvent.click(radio(en('filteringMode3Name')));
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode1Name')));
        await flush();
        expect(m.traffic()).toEqual([]);
        expect(radio(en('filteringMode3Name'))).toBeChecked();
    });

    it('toggle never answered: a broadcast of the same field wins; the watchdog reverts and announces', async () => {
        settingsTiming.watchdogMs = 150;
        setup({ failures: { setPopupBlockMode: 'hang', setAutoReload: 'hang' } });
        await ready();
        fireEvent.click(toggle('popupBlockMode'));
        expect(toggle('popupBlockMode')).toHaveAttribute('aria-checked', 'false');
        await broadcast({ popupBlockMode: false });
        await broadcast({ popupBlockMode: true }); // the background's truth
        expect(toggle('popupBlockMode')).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(toggle('autoReload'));
        expect(toggle('autoReload')).toHaveAttribute('aria-checked', 'false');
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en('autoReloadLabel')));
        expect(toggle('autoReload')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('settings-feedback-toggles')).toHaveTextContent(en('autoReloadLabel'));
    });

    it('developer mode never answered: the watchdog also re-derives the Develop gate', async () => {
        settingsTiming.watchdogMs = 150;
        setup({ failures: { setDeveloperMode: 'hang' } });
        await ready();
        fireEvent.click(toggle('developerMode'));
        expect(getOptionsSnapshot()).toMatchObject({ develop: true });
        await waitFor(() => expect(getOptionsSnapshot()).toMatchObject({ develop: false }));
        expect(toggle('developerMode')).toHaveAttribute('aria-checked', 'false');
    });
});

describe('review fixes: restore / reset', () => {
    async function chooseFile(content: string) {
        const input = screen.getByTestId('settings-restore-input') as HTMLInputElement;
        const file = new File([content], 'my-ubol-settings.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        fireEvent.change(input);
    }

    it('a restore started while a mode change waits for its permission waits for it, so the restore lands last', async () => {
        const { m } = setup({ permissionDelay: 300 });
        await ready();
        m.calls.length = 0;
        fireEvent.click(radio(en('filteringMode3Name')));
        await chooseFile('{"rulesets":[]}');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Settings restored/), { timeout: 3000 });
        const w = whats(m);
        expect(w[0]).toBe('setDefaultFilteringMode');
        expect(w.slice(1)).toEqual([
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
        await waitFor(() => expect(radio(en('filteringMode2Name'))).toBeChecked());
        expect(mock!.control.state()).toMatchObject({ background: { defaultFilteringMode: 2 } });
    });

    it('without echoes, a restore still updates the page store (toggles, rulesets, default mode)', async () => {
        setup({ echo: false });
        await ready();
        await chooseFile(
            JSON.stringify({
                autoReload: false,
                developerMode: true,
                popupBlockMode: false,
                showBlockedCount: false,
                filteringModes: { none: [], basic: ['all-urls'], optimal: [], complete: [] },
            }),
        );
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Settings restored/), { timeout: 3000 });
        expect(getOptionsSnapshot()).toMatchObject({
            develop: true,
            data: { autoReload: false, developerMode: true, popupBlockMode: false, showBlockedCount: false, defaultFilteringMode: 1 },
        });
        expect(toggle('autoReload')).toHaveAttribute('aria-checked', 'false');
        expect(radio(en('filteringMode1Name'))).toBeChecked();
    });

    it('busy: the status pill takes focus (pane inert), reset says "Restoring default settings", focus returns to Reset', async () => {
        setup({ delay: 20 });
        await ready();
        const resetButton = screen.getByTestId('settings-reset-button');
        fireEvent.click(resetButton);
        const dialog = await screen.findByRole('alertdialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to default settings' }));
        const pill = await screen.findByTestId('settings-busy-status');
        expect(pill).toHaveTextContent('Restoring default settings…');
        await waitFor(() => expect(document.activeElement).toBe(pill));
        expect(screen.getByRole('status')).toHaveTextContent('Restoring default settings…');
        await waitFor(() => expect(screen.queryByTestId('settings-busy')).toBeNull(), { timeout: 3000 });
        await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('settings-reset-button')));
        expect(screen.getByTestId('settings-feedback-backup')).toHaveTextContent('Default settings restored.');
    });

    it('focus returns to Restore after a restore, and the outcome is shown next to the backup buttons', async () => {
        setup({ delay: 5 });
        await ready();
        await chooseFile('{"autoReload": false}');
        await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('settings-busy-status')));
        expect(screen.getByTestId('settings-busy-status')).toHaveTextContent('Restoring settings…');
        await waitFor(() => expect(screen.queryByTestId('settings-busy')).toBeNull(), { timeout: 3000 });
        await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('settings-restore-button')));
        const fb = screen.getByTestId('settings-feedback-backup');
        expect(fb).toHaveTextContent('Settings restored.');
        expect(screen.getByTestId('settings-backup').contains(fb)).toBe(true);
        // The visible copy does not announce a second time.
        expect(fb.querySelector('[role="alert"]')).toBeNull();
    });
});

describe('review fixes: feedback placement and look (contrast)', () => {
    it('a failed toggle shows its Alert under the behaviour block, in default text colour; the next action clears it', async () => {
        setup({ scenario: 'error-on-apply' });
        await ready();
        fireEvent.click(toggle('autoReload'));
        const fb = await screen.findByTestId('settings-feedback-toggles');
        expect(screen.getByTestId('settings-behavior').contains(fb)).toBe(true);
        expect(fb).toHaveAttribute('data-tone', 'danger');
        expect(fb.firstElementChild!.className).toContain('[--alert-text-color:var(--color-text)]');
        expect(screen.queryByTestId('settings-feedback-mode')).toBeNull();
        fireEvent.click(toggle('popupBlockMode'));
        expect(screen.queryByTestId('settings-feedback-toggles')).toBeNull();
    });

    it('the live regions are screen-reader only (no layout shift above the pane)', async () => {
        setup();
        await ready();
        expect(document.querySelector('[data-blocker-status]')!.className).toContain('sr-only');
    });

    it('the reset trigger is a neutral button; the dialog confirm stays danger', async () => {
        setup();
        await ready();
        const reset = screen.getByTestId('settings-reset-button');
        expect(reset.className).toContain('whitespace-normal');
        expect(screen.getByTestId('settings-backup-button').className).toContain('whitespace-normal');
        fireEvent.click(reset);
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByRole('button', { name: 'Reset to default settings' })).toBeInTheDocument();
    });
});

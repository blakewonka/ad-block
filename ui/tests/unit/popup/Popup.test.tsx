/**
 * Component-level checks of the popup with a recording fake browser (happy-dom).
 * The full parity list runs in the browser: tests/e2e/popup.parity.mjs.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusProvider } from '@/components/StatusRegion';
import { PopupErrorBoundary } from '@/popup/ErrorBoundary';
import { Popup } from '@/popup/Popup';

import { createFakeBrowser, installFakeBrowser, type FakeBrowser } from '../lib/fake-browser';

const TAB = { id: 42, url: 'https://www.example.com/path?x=1' };
const PANEL = {
    hasOmnipotence: false,
    level: 1,
    autoReload: true,
    isSideloaded: true,
    developerMode: false,
    hasCustomFilters: 0,
};
const MESSAGES = {
    extName: 'Blocker',
    filteringMode0Name: 'no filtering',
    filteringMode1Name: 'basic',
    filteringMode2Name: 'optimal',
    filteringMode3Name: 'complete',
    popupFilteringModeLabel: 'filtering mode',
    popupLocalToolsLabel: 'On this website',
    zapperTipEnter: 'Remove an element',
    pickerTipEnter: 'Create a custom filter',
    unpickerTipEnter: 'Remove a custom filter',
    popupTipReport: 'Report an issue',
    popupTipDashboard: 'Open the dashboard',
    popupNoWebsite: 'not a website',
};

type Reply = (msg: { what: string; [k: string]: unknown }) => unknown;

let fake: FakeBrowser;
let order: string[];

function setup(reply: Reply = (m) => (m.what === 'popupPanelData' ? PANEL : m.what === 'setFilteringMode' ? m.level : undefined)) {
    fake = installFakeBrowser(createFakeBrowser({ messages: MESSAGES, reply: reply as (m: unknown) => unknown }));
    order = [];
    fake.tabs.query.mockImplementation(() => Promise.resolve([TAB]));
    const sendImpl = fake.runtime.sendMessage.getMockImplementation()!;
    fake.runtime.sendMessage.mockImplementation((msg: unknown) => {
        order.push(`msg:${(msg as { what: string }).what}`);
        return sendImpl(msg);
    });
    const permImpl = fake.permissions.request.getMockImplementation()!;
    fake.permissions.request.mockImplementation((req: unknown) => {
        order.push('permissions.request');
        return permImpl(req);
    });
}

async function renderPopup() {
    render(
        <StatusProvider>
            <Popup dir="ltr" />
        </StatusProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('popup')).toHaveAttribute('data-state', 'ready'));
}

const radio = (level: number) => document.querySelector(`[data-level="${level}"] [role="radio"]`) as HTMLElement;
const checkedLevel = () => Number(document.querySelector('[role="radio"][aria-checked="true"]')?.closest('[data-level]')?.getAttribute('data-level'));

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Popup', () => {
    it('opens: tabs.query then popupPanelData; shows hostname and level', async () => {
        setup();
        await renderPopup();
        expect(fake.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
        expect(fake.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ what: 'popupPanelData', origin: 'https://www.example.com', hostname: 'www.example.com' });
        expect(screen.getByTestId('hostname')).toHaveTextContent('www.example.com');
        expect(checkedLevel()).toBe(1);
        expect(screen.getByTestId('mode-badge')).toHaveTextContent('basic');
    });

    it('select 2: pending message and permissions.request inside the click, then setFilteringMode', async () => {
        setup();
        await renderPopup();
        order.length = 0;
        act(() => {
            radio(2).click();
            // Read synchronously, inside the same task as the click.
            expect(order).toStrictEqual(['msg:setPendingFilteringMode', 'permissions.request']);
        });
        await waitFor(() => expect(order).toContain('msg:setFilteringMode'));
        expect(fake.runtime.sendMessage).toHaveBeenCalledWith({
            what: 'setPendingFilteringMode',
            tabId: 42,
            url: 'https://www.example.com/path?x=1',
            hostname: 'www.example.com',
            beforeLevel: 1,
            afterLevel: 2,
        });
        expect(fake.permissions.request).toHaveBeenCalledWith({ origins: ['*://*.www.example.com/*'] });
        expect(fake.runtime.sendMessage).toHaveBeenLastCalledWith({ what: 'setFilteringMode', hostname: 'www.example.com', level: 2 });
        await waitFor(() => expect(fake.tabs.reload).toHaveBeenCalledWith(42), { timeout: 2000 });
        expect(checkedLevel()).toBe(2);
    });

    it('denied permission: back to the previous level, no setFilteringMode', async () => {
        setup();
        await renderPopup();
        fake.permissions.request.mockImplementation(() => {
            order.push('permissions.request');
            return Promise.resolve(false);
        });
        order.length = 0;
        act(() => radio(3).click());
        await waitFor(() => expect(checkedLevel()).toBe(1));
        await new Promise((r) => setTimeout(r, 50));
        expect(order).toStrictEqual(['msg:setPendingFilteringMode', 'permissions.request']);
    });

    it('failed setFilteringMode: error shown, level back, no reload (§13)', async () => {
        setup((m) => {
            if (m.what === 'popupPanelData') return PANEL;
            if (m.what === 'setFilteringMode') throw new Error('Could not establish connection.');
            return undefined;
        });
        await renderPopup();
        act(() => radio(0).click());
        await waitFor(() => expect(document.querySelector('[data-politeness="assertive"]')).not.toBeEmptyDOMElement());
        expect(checkedLevel()).toBe(1);
        await new Promise((r) => setTimeout(r, 600));
        expect(fake.tabs.reload).not.toHaveBeenCalled();
        expect(fake.tabs.update).not.toHaveBeenCalled();
    });

    it('malformed popupPanelData (string level) is an error state without a level control', async () => {
        setup((m) => (m.what === 'popupPanelData' ? { ...PANEL, level: '2' } : undefined));
        render(
            <StatusProvider>
                <Popup dir="ltr" />
            </StatusProvider>,
        );
        await waitFor(() => expect(screen.getByTestId('popup')).toHaveAttribute('data-state', 'error'));
        expect(document.querySelector('[role="radiogroup"]')).toBeNull();
        expect(document.querySelector('#gotoDashboard')).not.toBeNull();
    });

    it('zapper: executeScript with the file list, then window.close()', async () => {
        setup();
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        await renderPopup();
        fireEvent.click(document.getElementById('gotoZapper')!);
        expect(fake.scripting!.executeScript).toHaveBeenCalledWith({
            files: ['/js/scripting/tool-overlay.js', '/js/scripting/zapper.js'],
            target: { tabId: 42 },
        });
        expect(close).toHaveBeenCalledTimes(1);
        expect(fake.scripting!.executeScript.mock.invocationCallOrder[0]!).toBeLessThan(close.mock.invocationCallOrder[0]!);
    });

    it('the error boundary reports render errors', () => {
        const onError = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        function Boom(): never {
            throw new Error('boom');
        }
        render(
            <PopupErrorBoundary onError={onError}>
                <Boom />
            </PopupErrorBoundary>,
        );
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('admin-locked: the managed note names the group in parentheses, keeps its case', async () => {
        setup((m) => (m.what === 'popupPanelData' ? { ...PANEL, disabledFeatures: ['filteringMode'] } : undefined));
        await renderPopup();
        const group = screen.getByRole('radiogroup');
        const heading = document.getElementById(group.getAttribute('aria-labelledby') ?? '')!;
        const note = screen.getByTestId('mode-managed-note');
        expect(heading).toContainElement(note);
        expect(note).toHaveClass('sr-only', 'normal-case');
        // The sr-only span is block-level in name computation (a space precedes it):
        // "filtering mode (Managed by …)", never "filtering mode , managed by …".
        expect(note.textContent).toMatch(/^\(.+\)$/);
        expect(heading.textContent).not.toContain(',');
    });
});

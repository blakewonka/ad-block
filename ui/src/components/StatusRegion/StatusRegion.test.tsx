import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StatusProvider, StatusRegion, useAnnounce, useStatus, type AnnounceFn } from './StatusRegion';

let announce: AnnounceFn = () => {
    throw new Error('not captured');
};

function Capture() {
    announce = useAnnounce();
    return null;
}

function setup(region: ReactNode = <StatusRegion />) {
    return render(
        <StatusProvider>
            <Capture />
            {region}
        </StatusProvider>,
    );
}

const polite = () => screen.getByRole('status');
const assertive = () => screen.getByRole('alert');

describe('StatusRegion', () => {
    it('renders both live regions, empty, from the first render', () => {
        setup();
        expect(polite()).toHaveAttribute('aria-live', 'polite');
        expect(polite()).toHaveAttribute('aria-atomic', 'true');
        expect(polite()).toBeEmptyDOMElement();
        expect(assertive()).toHaveAttribute('aria-live', 'assertive');
        expect(assertive()).toHaveAttribute('aria-atomic', 'true');
        expect(assertive()).toBeEmptyDOMElement();
    });

    it('is screen-reader only unless visual', () => {
        const { container, unmount } = setup();
        expect(container.querySelector('[data-blocker-status]')).toHaveClass('sr-only');
        unmount();
        const visual = setup(<StatusRegion visual />);
        expect(visual.container.querySelector('[data-blocker-status]')).not.toHaveClass('sr-only');
    });

    it('announces politely by default, with the description appended', () => {
        setup();
        act(() => announce('Changes applied', { tone: 'success', description: '3 lists updated.' }));
        expect(polite()).toHaveTextContent('Changes applied 3 lists updated.');
        expect(assertive()).toBeEmptyDOMElement();
    });

    it('danger tone is assertive and replaces the previous message', () => {
        setup();
        act(() => announce('Changes applied'));
        act(() => announce('Could not save settings', { tone: 'danger' }));
        expect(assertive()).toHaveTextContent('Could not save settings');
        expect(polite()).toBeEmptyDOMElement();
    });

    it('politeness can be set explicitly', () => {
        setup();
        act(() => announce('Reverted', { politeness: 'assertive' }));
        expect(assertive()).toHaveTextContent('Reverted');
        act(() => announce('Failure shown politely', { tone: 'danger', politeness: 'polite' }));
        expect(polite()).toHaveTextContent('Failure shown politely');
        expect(assertive()).toBeEmptyDOMElement();
    });

    it('the same text announced twice is inserted as a new node (re-announced)', () => {
        setup();
        act(() => announce('Applied'));
        const first = polite().firstElementChild;
        act(() => announce('Applied'));
        const second = polite().firstElementChild;
        expect(second).toHaveTextContent('Applied');
        expect(second).not.toBe(first);
        expect(first?.isConnected).toBe(false);
    });

    it('visual: renders the library Alert inside the live region, without a nested alert role', () => {
        setup(<StatusRegion visual />);
        act(() => announce('Could not apply', { tone: 'danger', description: 'Try again.' }));
        const region = assertive();
        expect(region).toHaveTextContent('Could not apply');
        expect(region).toHaveTextContent('Try again.');
        // Only the region itself has role=alert (the Alert's own role is removed).
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(within(region).queryByRole('alert')).toBeNull();
        expect(region.querySelector('[data-color="danger"]')).not.toBeNull();
    });

    it('visual: tones map to Alert colours', () => {
        setup(<StatusRegion visual />);
        act(() => announce('Applied', { tone: 'success' }));
        expect(polite().querySelector('[data-color="success"]')).not.toBeNull();
        act(() => announce('Heads up', { tone: 'warning' }));
        expect(polite().querySelector('[data-color="warning"]')).not.toBeNull();
        act(() => announce('Info'));
        expect(polite().querySelector('[data-color="info"]')).not.toBeNull();
    });

    it('visual: text in the default ink (contrast in dark mode) and a hidden indicator icon', () => {
        setup(<StatusRegion visual />);
        act(() => announce('Could not apply', { tone: 'danger', description: 'Try again.' }));
        const region = assertive();
        expect(within(region).getByText('Could not apply')).toHaveClass('text-default');
        expect(within(region).getByText('Try again.')).toHaveClass('text-default');
        const svgs = Array.from(region.querySelectorAll('svg'));
        expect(svgs.length).toBeGreaterThan(0);
        for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    it('lang: a message in another language gets lang and dir (visual and screen-reader only)', () => {
        const { unmount } = setup(<StatusRegion visual />);
        act(() => announce('The mode is: x.', { tone: 'warning', lang: 'en' }));
        expect(within(polite()).getByText('The mode is: x.')).toHaveAttribute('lang', 'en');
        expect(within(polite()).getByText('The mode is: x.')).toHaveAttribute('dir', 'ltr');
        act(() => announce('Plain'));
        expect(within(polite()).getByText('Plain')).not.toHaveAttribute('lang');
        unmount();
        setup();
        act(() => announce('Failed', { tone: 'danger', lang: 'ar' }));
        const span = assertive().querySelector('[lang]');
        expect(span).toHaveAttribute('lang', 'ar');
        expect(span).toHaveAttribute('dir', 'rtl');
        expect(span).toHaveTextContent('Failed');
    });

    it('visual: the dismiss Button clears the message', async () => {
        const user = userEvent.setup();
        setup(<StatusRegion visual dismissLabel="Dismiss" />);
        act(() => announce('Applied', { tone: 'success' }));
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(polite()).toBeEmptyDOMElement();
    });

    it('no dismiss Button without dismissLabel', () => {
        setup(<StatusRegion visual />);
        act(() => announce('Applied'));
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('useStatus exposes current and clear; announce is stable across renders', () => {
        const wrapper = ({ children }: { children?: ReactNode }) => <StatusProvider>{children}</StatusProvider>;
        const { result, rerender } = renderHook(() => useStatus(), { wrapper });
        const first = result.current.announce;
        act(() => result.current.announce('Hello', { tone: 'warning' }));
        expect(result.current.current).toMatchObject({ message: 'Hello', tone: 'warning', politeness: 'polite' });
        rerender();
        expect(result.current.announce).toBe(first);
        act(() => result.current.clear());
        expect(result.current.current).toBeNull();
    });

    it('useAnnounce outside a provider throws', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => renderHook(() => useAnnounce())).toThrow(/StatusProvider/);
    });
});

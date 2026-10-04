import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Direction } from 'radix-ui';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs, type TabItem, type TabsProps } from './Tabs';

const ITEMS: TabItem[] = [
    { id: 'settings', label: 'Settings' },
    { id: 'lists', label: 'Filter lists' },
    { id: 'develop', label: 'Develop', hidden: true },
    { id: 'rules', label: 'My rules' },
    { id: 'about', label: 'About' },
];

type HarnessProps = Partial<Omit<TabsProps, 'value' | 'onValueChange'>> & {
    initial?: string;
    onChange?: (id: string) => void;
};

function Harness({ initial = 'settings', onChange, items = ITEMS, ...rest }: HarnessProps) {
    const [value, setValue] = useState(initial);
    return (
        <Tabs
            label="Dashboard"
            items={items}
            value={value}
            onValueChange={(id) => {
                onChange?.(id);
                setValue(id);
            }}
            {...rest}
        >
            {rest.renderPanel === undefined
                ? items.map((item) => (
                      <TabPanel key={item.id} value={item.id}>
                          <p>Panel {item.id}</p>
                          <input aria-label={`field ${item.id}`} />
                      </TabPanel>
                  ))
                : null}
        </Tabs>
    );
}

function mockMatchMedia(matches: boolean) {
    const listeners = new Set<() => void>();
    const mql = {
        matches,
        media: '(min-width: 768px)',
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    };
    vi.spyOn(window, 'matchMedia').mockImplementation(() => mql as unknown as MediaQueryList);
    return {
        set(next: boolean) {
            mql.matches = next;
            act(() => listeners.forEach((cb) => cb()));
        },
    };
}

describe('Tabs: semantics', () => {
    it('renders tablist / tab / tabpanel with the ARIA wiring', () => {
        render(<Harness />);
        const list = screen.getByRole('tablist', { name: 'Dashboard' });
        expect(list).toHaveAttribute('aria-orientation', 'horizontal');

        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((t) => t.textContent)).toEqual(['Settings', 'Filter lists', 'My rules', 'About']);

        const selected = screen.getByRole('tab', { name: 'Settings' });
        expect(selected).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'false');

        const panel = screen.getByRole('tabpanel', { name: 'Settings' });
        expect(selected).toHaveAttribute('aria-controls', panel.id);
        expect(panel).toHaveAttribute('aria-labelledby', selected.id);
        expect(panel).toHaveTextContent('Panel settings');
        // Only the active panel is mounted by default.
        expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    });

    it('uses roving tabindex and renders triggers as library Buttons', () => {
        render(<Harness initial="lists" />);
        const tabs = screen.getAllByRole('tab');
        // Radix: the tablist is the single tab stop until a tab has been focused,
        // then the focused tab is; every other tab is -1.
        expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1']);
        expect(screen.getByRole('tablist')).toHaveAttribute('tabindex', '0');
        act(() => screen.getByRole('tablist').focus());
        expect(screen.getByRole('tab', { name: 'Filter lists' })).toHaveFocus();
        expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
        for (const tab of tabs) {
            expect(tab.tagName).toBe('BUTTON');
            expect(tab).toHaveAttribute('type', 'button');
            // Selected = library soft Button; the others are ghost.
            expect(tab).toHaveAttribute('data-variant', tab.getAttribute('aria-selected') === 'true' ? 'soft' : 'ghost');
            expect(tab).toHaveAttribute('data-color', 'secondary');
        }
        expect(screen.getByRole('tab', { name: 'Filter lists' })).toHaveAttribute('data-selected', '');
        expect(screen.getByRole('tab', { name: 'Settings' })).not.toHaveAttribute('data-selected');
    });

    it('soft variant renders the selected trigger as a soft Button', () => {
        render(<Harness variant="soft" />);
        expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('data-variant', 'soft');
        expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('data-variant', 'ghost');
    });

    it('does not render hidden items as tabs', () => {
        render(<Harness />);
        expect(screen.queryByRole('tab', { name: 'Develop' })).toBeNull();
    });

    it('names the tablist through labelledBy', () => {
        render(
            <>
                <h2 id="nav-heading">Sections</h2>
                <Harness label={undefined} labelledBy="nav-heading" />
            </>,
        );
        expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    });
});

describe('Tabs: keyboard', () => {
    it('automatic mode: arrows move focus and select; Home/End jump', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        await user.tab();
        expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();

        await user.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: 'Filter lists' })).toHaveFocus();
        expect(onChange).toHaveBeenLastCalledWith('lists');
        expect(screen.getByRole('tabpanel', { name: 'Filter lists' })).toBeInTheDocument();

        // The hidden "develop" item is skipped: next is "rules".
        await user.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: 'My rules' })).toHaveFocus();

        await user.keyboard('{End}');
        expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus();
        expect(onChange).toHaveBeenLastCalledWith('about');

        await user.keyboard('{Home}');
        expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
        expect(onChange).toHaveBeenLastCalledWith('settings');

        // Loops from first to last.
        await user.keyboard('{ArrowLeft}');
        expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus();

        // Up/Down do nothing in a horizontal tablist.
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus();
    });

    it('manual mode: arrows move focus without selecting; Enter and Space select', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness onChange={onChange} activationMode="manual" />);

        await user.tab();
        await user.keyboard('{ArrowRight}');
        const lists = screen.getByRole('tab', { name: 'Filter lists' });
        expect(lists).toHaveFocus();
        expect(lists).toHaveAttribute('aria-selected', 'false');
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeInTheDocument();

        await user.keyboard('{Enter}');
        expect(onChange).toHaveBeenLastCalledWith('lists');
        expect(lists).toHaveAttribute('aria-selected', 'true');

        await user.keyboard('{End}');
        expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus();
        expect(onChange).toHaveBeenCalledTimes(1);
        await user.keyboard(' ');
        expect(onChange).toHaveBeenLastCalledWith('about');
    });

    it('Tab moves from the tablist into the active panel', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.tab();
        await user.tab();
        expect(screen.getByRole('tabpanel', { name: 'Settings' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('textbox', { name: 'field settings' })).toHaveFocus();
    });

    it('skips disabled tabs', async () => {
        const user = userEvent.setup();
        const items: TabItem[] = [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B', disabled: true },
            { id: 'c', label: 'C' },
        ];
        render(<Harness items={items} initial="a" />);
        expect(screen.getByRole('tab', { name: 'B' })).toBeDisabled();
        await user.tab();
        await user.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: 'C' })).toHaveFocus();
    });

    it('mirrors arrows in RTL (dir prop and Direction.Provider)', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Harness dir="rtl" />);
        await user.tab();
        await user.keyboard('{ArrowLeft}');
        expect(screen.getByRole('tab', { name: 'Filter lists' })).toHaveFocus();
        unmount();

        render(
            <Direction.Provider dir="rtl">
                <Harness />
            </Direction.Provider>,
        );
        await user.tab();
        await user.keyboard('{ArrowLeft}');
        expect(screen.getByRole('tab', { name: 'Filter lists' })).toHaveFocus();
    });
});

describe('Tabs: orientation', () => {
    it('vertical: Up/Down navigate, Left/Right do not', async () => {
        const user = userEvent.setup();
        render(<Harness orientation="vertical" />);
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
        await user.tab();
        await user.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('tab', { name: 'Filter lists' })).toHaveFocus();
        await user.keyboard('{ArrowUp}');
        expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
        // Sidebar triggers are full-width, non-pill buttons.
        expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('data-block', '');
        expect(screen.getByRole('tab', { name: 'Settings' })).not.toHaveAttribute('data-pill');
    });

    it('responsive: follows the (min-width: 768px) media query', () => {
        const media = mockMatchMedia(false);
        render(<Harness orientation="responsive" />);
        expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
        media.set(true);
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
        media.set(false);
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
    });

    it('responsive with verticalFrom="lg" follows (min-width: 1024px); pill={false} in both orientations', () => {
        const media = mockMatchMedia(false);
        render(<Harness orientation="responsive" verticalFrom="lg" pill={false} />);
        expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
        expect(screen.getByRole('tab', { name: 'Settings' })).not.toHaveAttribute('data-pill');
        media.set(true);
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
        expect(screen.getByRole('tab', { name: 'Settings' })).not.toHaveAttribute('data-pill');
    });
});

describe('Tabs: selected looks different from hovered', () => {
    function indicators() {
        return Array.from(document.querySelectorAll('[data-tab-indicator]'));
    }

    it('only the selected trigger is a soft, selected Button; the others are ghost', async () => {
        const user = userEvent.setup();
        render(<Harness pill={false} />);
        const settings = screen.getByRole('tab', { name: 'Settings' });
        const lists = screen.getByRole('tab', { name: 'Filter lists' });
        expect(settings).toHaveAttribute('data-variant', 'soft');
        expect(settings).toHaveAttribute('data-selected', '');
        expect(settings).toHaveAttribute('data-tab-selected', '');
        expect(lists).toHaveAttribute('data-variant', 'ghost');
        expect(lists).not.toHaveAttribute('data-selected');
        // Hover changes nothing in the markup: the ghost hover tint is CSS only.
        await user.hover(lists);
        expect(lists).toHaveAttribute('data-variant', 'ghost');
        await user.click(lists);
        expect(lists).toHaveAttribute('data-variant', 'soft');
        expect(settings).toHaveAttribute('data-variant', 'ghost');
    });

    it('square (non-pill) triggers: exactly one edge indicator, inside the selected tab, aria-hidden', async () => {
        const user = userEvent.setup();
        render(<Harness pill={false} />);
        expect(indicators()).toHaveLength(1);
        const settings = screen.getByRole('tab', { name: 'Settings' });
        expect(settings).toContainElement(indicators()[0] as HTMLElement);
        expect(indicators()[0]).toHaveAttribute('aria-hidden', 'true');
        // The indicator adds no text: the accessible name stays the label.
        expect(settings).toHaveAccessibleName('Settings');
        expect(settings.textContent).toBe('Settings');
        await user.click(screen.getByRole('tab', { name: 'About' }));
        expect(indicators()).toHaveLength(1);
        expect(screen.getByRole('tab', { name: 'About' })).toContainElement(indicators()[0] as HTMLElement);
    });

    it('row indicator sits under the label; sidebar indicator on the start edge (logical, mirrors in RTL)', () => {
        const { unmount } = render(<Harness pill={false} orientation="horizontal" />);
        expect(indicators()[0]).toHaveClass('bottom-[-3px]', 'h-[2px]');
        unmount();
        render(<Harness orientation="vertical" />);
        const bar = indicators()[0] as HTMLElement;
        expect(bar).toHaveClass('w-[3px]');
        expect(bar.className).toMatch(/(^|\s)start-\[/);
        expect(bar.className).not.toMatch(/(^|\s)(left|right)-/);
    });

    it('pill triggers and the soft variant draw no indicator (the soft fill marks the selection)', () => {
        const { unmount } = render(<Harness />); // horizontal: pills by default
        expect(indicators()).toHaveLength(0);
        expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('data-variant', 'soft');
        unmount();
        render(<Harness variant="soft" pill={false} />);
        expect(indicators()).toHaveLength(0);
    });
});

describe('Tabs: panel focus ring', () => {
    it('a panel never sets focus:outline-none (Tailwind 4 would then hide its focus-visible outline)', () => {
        render(<Harness />);
        const panel = screen.getByRole('tabpanel', { name: 'Settings' });
        expect(panel.className).not.toMatch(/(^|\s)focus:outline-none(\s|$)/);
        expect(panel).toHaveClass('focus-visible:outline-2');
    });
});

describe('Tabs: panels', () => {
    it('keepMounted keeps the panel node (and its state) while inactive, hidden', async () => {
        const user = userEvent.setup();
        render(<Harness keepMounted={['lists']} />);
        await user.click(screen.getByRole('tab', { name: 'Filter lists' }));
        const field = screen.getByRole('textbox', { name: 'field lists' });
        await user.type(field, 'typed');

        await user.click(screen.getByRole('tab', { name: 'About' }));
        // The kept panel is still in the DOM, hidden; the settings panel is gone.
        expect(field.isConnected).toBe(true);
        const keptPanel = field.closest('[role="tabpanel"]');
        expect(keptPanel).toHaveAttribute('hidden');
        expect(keptPanel).not.toBeVisible();
        expect(screen.queryByText('Panel settings')).toBeNull();
        expect(screen.getByRole('tabpanel', { name: 'About' })).toBeVisible();

        await user.click(screen.getByRole('tab', { name: 'Filter lists' }));
        const again = screen.getByRole('textbox', { name: 'field lists' });
        expect(again).toBe(field);
        expect(again).toHaveValue('typed');
        expect(again.closest('[role="tabpanel"]')).not.toHaveAttribute('hidden');
    });

    it('keepMounted={true} keeps every panel; TabPanel prop overrides', () => {
        // Radix always renders an (empty, hidden) panel element per TabPanel;
        // "mounted" here means the panel CONTENT is rendered.
        const { unmount } = render(<Harness keepMounted />);
        for (const item of ITEMS) {
            expect(screen.getByText(`Panel ${item.id}`)).toBeInTheDocument();
        }
        expect(screen.getAllByRole('tabpanel')).toHaveLength(1); // only the active one is exposed
        unmount();

        render(
            <Tabs label="X" items={ITEMS.slice(0, 2)} value="settings" onValueChange={() => {}} keepMounted>
                <TabPanel value="settings">S</TabPanel>
                <TabPanel value="lists" keepMounted={false}>
                    L
                </TabPanel>
            </Tabs>,
        );
        expect(screen.getByText('S')).toBeInTheDocument();
        expect(screen.queryByText('L')).toBeNull();
    });

    it('without keepMounted, inactive panel content is unmounted', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const field = screen.getByRole('textbox', { name: 'field settings' });
        await user.click(screen.getByRole('tab', { name: 'About' }));
        expect(field.isConnected).toBe(false);
        expect(screen.queryByText('Panel settings')).toBeNull();
    });

    it('renderPanel renders one panel per visible item', async () => {
        const user = userEvent.setup();
        render(<Harness renderPanel={(id) => <span>render {id}</span>} />);
        expect(screen.getByRole('tabpanel', { name: 'Settings' })).toHaveTextContent('render settings');
        await user.click(screen.getByRole('tab', { name: 'About' }));
        expect(screen.getByRole('tabpanel', { name: 'About' })).toHaveTextContent('render about');
    });

    it('TabPanel outside Tabs throws', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<TabPanel value="x" />)).toThrow(/inside <Tabs>/);
    });
});

/**
 * Tabs — accessible tab navigation (the library has none).
 * Built on Radix Tabs (`radix-ui`); every trigger
 * IS the library Button (colour "secondary"), so it looks native.
 *
 * Selected vs hovered: unselected triggers are library
 * `ghost` Buttons, whose hover fill is the ghost hover tint (alpha-08 light /
 * alpha-12 dark). The selected trigger is a library `soft` Button with
 * `selected` (alpha-12 light / alpha-16 dark) and, for the default `ghost`
 * variant with square (non-pill) triggers, an ink-coloured edge indicator: a
 * bar on the start edge in a sidebar, under the label in a row. So a hovered
 * tab never looks like a second selected tab, in light and dark.
 *
 *   <Tabs
 *       label={t('dashboardTabsLabel')}          // accessible name of the tablist
 *       items={[{ id: 'settings', label: t('settingsPageName') }, …]}
 *       value={pane} onValueChange={setPane}
 *       orientation="responsive"                // row below 768px, sidebar at >= 768px
 *       activationMode="manual"                 // arrows move focus only; Enter/Space activates
 *       keepMounted={['develop']}               // never unmount these panels (iframe state)
 *   >
 *       <TabPanel value="settings">…</TabPanel>
 *       <TabPanel value="develop" keepMounted>…</TabPanel>
 *   </Tabs>
 *
 * or, instead of children, `renderPanel={(id) => …}` renders one panel per
 * visible item.
 *
 * Semantics (from Radix): role=tablist (+ aria-orientation), role=tab with
 * aria-selected / aria-controls / roving tabindex, role=tabpanel with
 * aria-labelledby. Keyboard: Left/Right (horizontal) or Up/Down (vertical),
 * Home/End, mirrored in RTL (pass `dir` or wrap the app in
 * `<Direction.Provider dir=…>` from `radix-ui`).
 *
 * Panels: Radix always renders one (empty, `hidden`) tabpanel element per
 * TabPanel, so every tab's aria-controls points at an existing element; the
 * panel CONTENT is mounted only while active. Kept-mounted panels keep their
 * content: the element stays in the DOM in the same place and gets the
 * `hidden` attribute while inactive (display:none). An iframe inside it keeps
 * its document and state; it is never re-parented.
 *
 * Arrow-key focus moves in a setTimeout (Radix roving focus): browser tests
 * must wait a tick after a key press before reading document.activeElement.
 *
 * `items[].hidden` removes the TRIGGER only. The page must not select a hidden
 * id; with `renderPanel`, hidden items get no panel unless they are kept mounted.
 *
 * All text arrives through props; the component renders no text of its own.
 */
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Tabs as RadixTabs } from 'radix-ui';
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useSyncExternalStore,
    type HTMLAttributes,
    type ReactNode,
} from 'react';

export interface TabItem {
    /** Value of the tab; also used to build the DOM ids of trigger and panel. */
    id: string;
    /** Visible label (already localised). It is the tab's accessible name. */
    label: ReactNode;
    /** Optional leading icon (decorative; give the svg aria-hidden). */
    icon?: ReactNode;
    /** Do not render the trigger at all (e.g. a pane that is switched off). */
    hidden?: boolean;
    /** Render the trigger but make it unselectable and skip it in arrow navigation. */
    disabled?: boolean;
}

/** `responsive`: horizontal below the `verticalFrom` breakpoint (default md = 768px), vertical sidebar from there. */
export type TabsOrientation = 'horizontal' | 'vertical' | 'responsive';
export type TabsActivationMode = 'automatic' | 'manual';
/**
 * Both variants render unselected tabs as ghost Buttons and the selected tab as
 * a soft, `selected` Button. `ghost` (default) also draws the edge indicator on
 * the selected tab when the triggers are not pills; `soft` never does.
 */
export type TabsVariant = 'ghost' | 'soft';
export type TabsSize = 'sm' | 'md' | 'lg';

export interface TabsProps {
    items: readonly TabItem[];
    /** Id of the selected tab (controlled). */
    value: string;
    onValueChange: (id: string) => void;
    /** @default 'horizontal' */
    orientation?: TabsOrientation;
    /** `manual`: arrow keys move focus without selecting; Enter/Space/click selects. @default 'automatic' */
    activationMode?: TabsActivationMode;
    /** Accessible name of the tablist (use this or `labelledBy`). */
    label?: string;
    /** Id of an element that names the tablist. */
    labelledBy?: string;
    /** Reading direction for arrow-key mirroring; defaults to the Radix Direction.Provider value, else ltr. */
    dir?: 'ltr' | 'rtl';
    /** Whether arrow navigation wraps from last to first. @default true */
    loop?: boolean;
    /**
     * Keep inactive panels mounted (hidden) instead of unmounting them.
     * `true` = all panels; an array = only those ids. A `TabPanel`'s own
     * `keepMounted` prop wins over this. @default false
     */
    keepMounted?: boolean | readonly string[];
    /** Alternative to children: called once per visible item to render its panel. */
    renderPanel?: (id: string) => ReactNode;
    /** Panels (`<TabPanel>`), or anything else to render after the tablist. */
    children?: ReactNode;
    /** @default 'ghost' */
    variant?: TabsVariant;
    /** Library control size of the triggers. @default 'md' */
    size?: TabsSize;
    /** Extra classes on the root element. */
    className?: string;
    /** Extra classes on the tablist (e.g. a different sidebar width). */
    listClassName?: string;
    /** Extra classes on the element that wraps the panels. */
    panelsClassName?: string;
    /** `orientation="responsive"` only: the width from which the sidebar is used. md = 768px, lg = 1024px. @default 'md' */
    verticalFrom?: 'md' | 'lg';
    /** Pill-shaped triggers. @default true when horizontal, false when vertical */
    pill?: boolean;
}

const VERTICAL_QUERY = '(min-width: 768px)';
const VERTICAL_QUERY_LG = '(min-width: 1024px)';

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

function subscribeToQuery(query: string, onChange: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
    }
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
}

function readQuery(query: string): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(query).matches;
}

/** True while the media query matches; false when matchMedia is unavailable. */
export function useMediaQuery(query: string, enabled = true): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => (enabled ? subscribeToQuery(query, onChange) : () => {}),
        [query, enabled],
    );
    const getSnapshot = useCallback(() => (enabled ? readQuery(query) : false), [query, enabled]);
    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

interface TabsContextValue {
    value: string;
    orientation: 'horizontal' | 'vertical';
    isKeptMounted: (id: string) => boolean;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({
    items,
    value,
    onValueChange,
    orientation = 'horizontal',
    activationMode = 'automatic',
    label,
    labelledBy,
    dir,
    loop = true,
    keepMounted = false,
    renderPanel,
    children,
    variant = 'ghost',
    size = 'md',
    className,
    listClassName,
    panelsClassName,
    verticalFrom = 'md',
    pill,
}: TabsProps) {
    const wide = useMediaQuery(verticalFrom === 'lg' ? VERTICAL_QUERY_LG : VERTICAL_QUERY, orientation === 'responsive');
    const effective: 'horizontal' | 'vertical' =
        orientation === 'vertical' || (orientation === 'responsive' && wide) ? 'vertical' : 'horizontal';
    const vertical = effective === 'vertical';
    const isPill = pill ?? !vertical;
    const showIndicator = variant === 'ghost' && !isPill;

    const keepKey = Array.isArray(keepMounted) ? keepMounted.join('\u0000') : String(keepMounted);
    const isKeptMounted = useCallback(
        (id: string) => (Array.isArray(keepMounted) ? keepMounted.includes(id) : keepMounted === true),
        // keepKey captures the array contents, so a new array literal per render does not churn.
        [keepKey],
    );
    const context = useMemo<TabsContextValue>(
        () => ({ value, orientation: effective, isKeptMounted }),
        [value, effective, isKeptMounted],
    );

    const visibleItems = items.filter((item) => item.hidden !== true);

    return (
        <TabsContext.Provider value={context}>
            <RadixTabs.Root
                value={value}
                onValueChange={onValueChange}
                orientation={effective}
                activationMode={activationMode}
                dir={dir}
                data-blocker-tabs=""
                className={joinClasses(
                    'flex min-w-0',
                    vertical ? 'flex-row items-start gap-6' : 'flex-col gap-4',
                    className,
                )}
            >
                <RadixTabs.List
                    aria-label={label}
                    aria-labelledby={labelledBy}
                    loop={loop}
                    className={joinClasses(
                        'flex min-w-0',
                        vertical ? 'w-56 max-w-[40%] shrink-0 flex-col gap-1' : 'flex-row flex-wrap gap-1',
                        listClassName,
                    )}
                >
                    {visibleItems.map((item) => {
                        const selected = item.id === value;
                        const indicator = selected && showIndicator;
                        return (
                            <RadixTabs.Trigger key={item.id} value={item.id} disabled={item.disabled} asChild>
                                <Button
                                    color="secondary"
                                    // The selected tab is a soft Button: a stronger fill than the
                                    // ghost hover tint of the other tabs (see the header comment).
                                    variant={selected ? 'soft' : 'ghost'}
                                    size={size}
                                    selected={selected}
                                    pill={isPill}
                                    block={vertical}
                                    disabled={item.disabled}
                                    data-tab-selected={selected ? '' : undefined}
                                    className={joinClasses(
                                        // Long (translated) labels wrap instead of overflowing.
                                        'h-auto min-h-(--button-size) max-w-full whitespace-normal py-1 leading-snug',
                                        vertical && 'text-start [&>span]:justify-start',
                                    )}
                                >
                                    {item.icon}
                                    {item.label}
                                    {indicator ? (
                                        <span
                                            aria-hidden="true"
                                            data-tab-indicator=""
                                            className={joinClasses(
                                                // Positioned against the Button's inner box (position: relative,
                                                // inset by the Button gutter); logical sides, so RTL mirrors.
                                                'pointer-events-none absolute rounded-full bg-(--color-text)',
                                                vertical
                                                    ? 'top-1/2 h-5 w-[3px] -translate-y-1/2 start-[calc(var(--button-gutter)*-1+3px)]'
                                                    : 'inset-x-0 bottom-[-3px] h-[2px]',
                                            )}
                                        />
                                    ) : null}
                                </Button>
                            </RadixTabs.Trigger>
                        );
                    })}
                </RadixTabs.List>
                <div className={joinClasses('min-w-0 flex-1', panelsClassName)}>
                    {renderPanel !== undefined
                        ? items
                              .filter((item) => item.hidden !== true || isKeptMounted(item.id))
                              .map((item) => (
                                  <TabPanel key={item.id} value={item.id}>
                                      {renderPanel(item.id)}
                                  </TabPanel>
                              ))
                        : null}
                    {children}
                </div>
            </RadixTabs.Root>
        </TabsContext.Provider>
    );
}

export interface TabPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'hidden'> {
    /** Id of the tab this panel belongs to. */
    value: string;
    /** Keep this panel mounted (hidden) while inactive. Overrides `Tabs.keepMounted`. */
    keepMounted?: boolean;
    children?: ReactNode;
}

export function TabPanel({ value, keepMounted, className, children, ...rest }: TabPanelProps) {
    const context = useContext(TabsContext);
    if (context === null) {
        throw new Error('TabPanel must be rendered inside <Tabs>');
    }
    const keep = keepMounted ?? context.isKeptMounted(value);
    const active = context.value === value;
    // Radix leaves a force-mounted inactive panel visible; hide it ourselves.
    // (Only pass `hidden` when force-mounting: an explicit undefined would
    // override Radix's own `hidden` for the normal case.)
    const keepProps = keep ? { forceMount: true as const, hidden: !active } : {};
    return (
        <RadixTabs.Content
            value={value}
            {...rest}
            {...keepProps}
            className={joinClasses(
                // No `focus:outline-none` here: in Tailwind 4 it sets --tw-outline-style:none, which
                // the focus-visible outline then inherits (no visible ring, WCAG 2.4.7).
                'min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                className,
            )}
        >
            {children}
        </RadixTabs.Content>
    );
}

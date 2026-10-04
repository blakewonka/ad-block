/**
 * Dashboard "Filter lists" pane (docs/specs/filter-lists.md).
 *
 *   <FilterListsPane />   no props: loads its own data (pane contract, panes/index.ts)
 *
 * Rendering only. State and timing live in ./controller (one per page,
 * ./instance), every list rule in the pure model `@/lib/model/filterLists`
 * (`deriveListsView` decides what is shown, counted, locked and hidden).
 *
 * Presentation decisions that change no message (all in the reports):
 * - D2: nothing operable until the options data and the first read pair answered.
 * - Groups are sections; the whole header row is the disclosure button that
 *   toggles the upstream "hide unused" state (D3: keyboard operable). The number
 *   of rows it hides is shown in the header. Composite nodes have the same
 *   chevron at the same (end) position. The header switch puts every
 *   collapsible group in that state at once.
 * - Q6: rows locked by the limit or by the administrator are `aria-disabled`
 *   (still focusable, so the reason can be read), and a change is ignored. The
 *   home link stays usable. Admin-forced rows keep their real (checked) look,
 *   the lock icon carries the meaning.
 * - D6: the `imported` group is never shown without compiled-filter support,
 *   search included; its lists still count and are still sent.
 * - Imported lists (§12, only with compiled-filter support: the Chromium and
 *   Firefox builds, not Safari): the "Imported lists" card always has a
 *   disclosure; expanded, it ends with the user-scripts notice (when user
 *   scripts are not allowed) and "Add filter list…". Upstream shows that area
 *   below the tree under the same condition (settings.css:267-278). Each
 *   imported list has a remove button that toggles to undo; flagged lists are
 *   disabled now and deleted on page hide (`toRemove`, §14).
 * - Failures are shown (D4), a slow save is reported (Q14), and ids the browser
 *   did not enable after a commit are named (§9.5). Notices sit in the flow above
 *   the lists; the sticky header keeps one compact status line.
 * - Touch screens (`touch:` variant): 44px targets, and the rule counts that a
 *   mouse user reads in the name's tooltip are shown under the name.
 * - Focus never falls back to <body> when the focused control disappears (a
 *   row hidden by hide-unused, a dismissed notice): it moves to the nearest
 *   disclosure, or to the search field.
 */
import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Button, ButtonLink } from '@openai/apps-sdk-ui/components/Button';
import { Checkbox } from '@openai/apps-sdk-ui/components/Checkbox';
import { EmptyMessage } from '@openai/apps-sdk-ui/components/EmptyMessage';
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ChangeEvent,
    type FocusEvent,
    type KeyboardEvent,
    type ReactNode,
    type RefObject,
} from 'react';

import { Card } from '@/components/Card';
import { AppIcon, IconButton } from '@/components/icons';
import { Skeleton } from '@/components/Skeleton';
import { formatNumber, t, T } from '@/lib/i18n';
import {
    countText,
    deriveListsView,
    flagImagePath,
    formatStats,
    isValidImportUrl,
    splitFlags,
    type CompositeView,
    type GroupView,
    type LeafView,
    type ListsView,
    type RemovalFlags,
} from '@/lib/model/filterLists';

import { loadOptionsData, useOptionsStore } from '../Settings';
import type { FilterListsController, ListsState } from './controller';
import { getFilterListsController } from './instance';
import { S } from './strings';

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** A list name with flag emoji drawn as upstream's flag images (§3.5, i18n.js:301-344). */
function ListName({ text }: { text: string }) {
    const segments = useMemo(() => splitFlags(text), [text]);
    return (
        <>
            {segments.map((seg, i) =>
                seg.type === 'flag' ? (
                    <img
                        key={i}
                        src={flagImagePath(seg.cc)}
                        alt=""
                        title={seg.cc}
                        draggable={false}
                        // Hairline: flags with a white field (jp, cy) stay visible on white.
                        className="inline-block h-[1em] w-auto rounded-[1px] align-[-0.125em] ring-1 ring-(--color-border)"
                        data-flag={seg.cc}
                    />
                ) : (
                    <span key={i}>{seg.text}</span>
                ),
            )}
        </>
    );
}

/** A list name as plain text without its flags ("de ch at: EasyList Germany"), for notices. */
const plainName = (text: string): string =>
    splitFlags(text)
        .map((seg) => (seg.type === 'text' ? seg.text : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

/** Localised "a, b and c" (Intl.ListFormat in the page language). */
function joinList(items: string[]): string {
    try {
        const lang = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined;
        return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items);
    } catch {
        return items.join(', ');
    }
}

/**
 * "3/37" badge; the visible text is upstream's, the spoken text says what it means.
 * Info (blue) only when something is enabled, neutral "0/N" otherwise, in both themes.
 * Dark mode: the library's soft-info text is 4.0:1 on the card; its stronger info
 * text token is used instead (>= 4.5:1). The override applies to the info badge only:
 * as a utility it beats the library's secondary text colour too.
 */
export function CountBadge({ checked, total }: { checked: number; total: number }) {
    const info = checked > 0;
    return (
        <Badge
            color={info ? 'info' : 'secondary'}
            variant="soft"
            size="md"
            pill
            className={
                info ? 'shrink-0 tabular-nums dark:[--badge-text-color:var(--color-text-info)]' : 'shrink-0 tabular-nums'
            }
        >
            <span aria-hidden="true" data-count="">
                {countText({ checkedCount: checked, totalCount: total })}
            </span>
            <span className="sr-only">{S.count(checked, total)}</span>
        </Badge>
    );
}

/** "7 hidden", next to the badge of a group or node in the hide-unused state. */
function HiddenCount({ id, count }: { id?: string; count: number }) {
    if (count <= 0) return null;
    return (
        // dir="auto": an untranslated (English) string keeps its word order in RTL pages.
        <span id={id} dir="auto" className="shrink-0 text-sm text-secondary" data-testid="hidden-count">
            {S.hiddenCount(formatNumber(count))}
        </span>
    );
}

/** The chevron of every disclosure (groups and nodes), always at the inline end. */
function Chevron({ expanded }: { expanded: boolean }) {
    return <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} className="size-4" />;
}

/** `:focus-visible` (keyboard focus); false where the selector is unsupported. */
function isFocusVisible(el: Element): boolean {
    try {
        return el.matches(':focus-visible');
    } catch {
        return false;
    }
}

/** One end slot (28px; 44px on touch screens) shared by the home link, the node chevron and the group chevron. */
const END_SLOT = 'inline-flex size-7 shrink-0 items-center justify-center touch:size-11';

/** Library Button at 44px on touch screens (the `size` prop stays the desktop size). */
const TOUCH_BUTTON = 'touch:[--button-size:var(--control-size-2xl)]';

/** Focus ring of our own buttons, the same as the library's (2px --color-ring). */
const FOCUS_RING = 'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-(--color-ring)';

/**
 * The library Checkbox/Switch space their label with a physical padding-left
 * (Checkbox.module.css, Switch.module.css), so in RTL the label touches the box.
 * A logical padding (utilities layer wins over the library's components layer) fixes it.
 * `pt-1` puts the first text line on the centre line of the 28px end slot, so
 * wrapped names keep the box, the lock and the home link on their first line.
 */
const CHECKBOX_CLASS =
    'min-w-0 flex-1 pt-1 [&_label]:min-w-0 [&_label]:break-words [&_label]:[padding-inline:0.5rem_0]';
/** Rows locked by the limit or the administrator: aria-disabled, so no library disabled look. */
const LOCKED_CHECKBOX_CLASS = '[&_[role=checkbox]]:cursor-not-allowed [&_label]:cursor-not-allowed';
const SWITCH_CLASS = 'shrink-0 [&_label]:[padding-inline:var(--switch-label-gap)_0]';

/**
 * Checkbox boundaries (WCAG 1.4.11): the library's unchecked border is 1.6:1 (light)
 * and 2.0:1 (dark); #8f8f8f is >= 3:1 on the card in both themes. A box locked at the
 * limit gets a lighter but still visible border (the library's disabled border equals
 * the dark card).
 */
const PANE_CHECKBOX_TOKENS = [
    '[&_[role=checkbox][data-state=unchecked]]:border-(--gray-400)',
    'dark:[&_[role=checkbox][data-state=unchecked]]:border-(--gray-600)',
    '[&_[role=checkbox][data-state=unchecked][aria-disabled=true]]:border-(--gray-250)',
    'dark:[&_[role=checkbox][data-state=unchecked][aria-disabled=true]]:border-(--gray-550)',
].join(' ');

/**
 * Search field. The library Input pads its adornments physically (padding-left /
 * margin-left), so in RTL the icon touched the border: logical values instead.
 * Its focus indicator is a 1px inset change only; a 2px ring is added. The
 * placeholder (its only visible label) gets secondary text colour (>= 4.5:1).
 * The browser's own clear button is hidden; a library button replaces it.
 */
const INPUT_CLASS_BASE = [
    '[&>:first-child:not(input)]:[margin-inline:var(--input-adornment-offset,-2px)_0]',
    '[&>:last-child:not(input)]:[margin-inline:0_var(--input-adornment-offset,-2px)]',
    '[&_input::-webkit-search-cancel-button]:hidden',
    '[--input-placeholder-text-color:var(--color-text-secondary)]',
    'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-(--color-ring)',
].join(' ');
const INPUT_CLASS_START = `${INPUT_CLASS_BASE} [padding-inline:var(--input-gutter)_0] [&_input]:[padding-inline:0_var(--input-gutter)]`;
const INPUT_CLASS_BOTH = `${INPUT_CLASS_BASE} [padding-inline:var(--input-gutter)] [&_input]:[padding-inline:0]`;

/** A group or composite node can hide something only if it has a non-default child. */
const canCollapse = (children: readonly (LeafView | CompositeView)[]): boolean =>
    children.some((c) => c.kind === 'node' || !c.isDefault);

const hiddenByUnused = (children: readonly (LeafView | CompositeView)[]): number =>
    children.filter((c) => c.hiddenReason === 'hide-unused').length;

interface RowContext {
    controller: FilterListsController;
    searchMode: boolean;
    limitNoteId: string;
    managedNoteId: string;
    /** Compiled-filter support: imported lists can be added and removed (§12). */
    canImport: boolean;
    removing: RemovalFlags;
}

/* ------------------------------------------------------------------------ */
/* Rows                                                                      */
/* ------------------------------------------------------------------------ */

function LeafRow({ leaf, ctx }: { leaf: LeafView; ctx: RowContext }) {
    const id = useId();
    const statsId = `${id}-stats`;
    const details = leaf.entry.details;
    const removalId = `${id}-removal`;
    const stats = formatStats(t('perRulesetStats'), leaf.stats, formatNumber);
    const removable = ctx.canImport && leaf.isImported;
    const flagged = removable && ctx.removing.has(leaf.id);
    // A list flagged for removal has a disabled checkbox until undo (FL:507, 517).
    const locked = leaf.disabled || leaf.locked || flagged;
    // Locked at the limit (not by the administrator): the row looks unavailable.
    const dimmed = locked && !leaf.fromAdmin;
    const describedBy = [
        statsId,
        leaf.fromAdmin ? ctx.managedNoteId : '',
        leaf.locked ? ctx.limitNoteId : '',
        flagged ? removalId : '',
    ]
        .filter(Boolean)
        .join(' ');
    const plain = plainName(details.name);
    const home = typeof details.homeURL === 'string' && details.homeURL !== '' ? details.homeURL : null;
    // The rule counts open on keyboard focus too, not only on mouse hover.
    const [keyboardFocus, setKeyboardFocus] = useState(false);
    return (
        <li
            className="flex min-w-0 items-start gap-2 py-1.5 touch:py-1"
            data-leaf-id={leaf.id}
            data-checked={leaf.checked ? 'true' : 'false'}
            data-admin={leaf.fromAdmin ? '' : undefined}
            data-locked={leaf.locked ? '' : undefined}
            data-imported={leaf.isImported ? '' : undefined}
            data-remove={flagged ? '' : undefined}
        >
            <Checkbox
                id={id}
                className={locked ? `${CHECKBOX_CLASS} ${LOCKED_CHECKBOX_CLASS}` : CHECKBOX_CLASS}
                checked={leaf.checked}
                onCheckedChange={(next) => {
                    if (locked) return;
                    ctx.controller.toggleLeaf(leaf.id, next === true);
                }}
                label={
                    <span className="flex min-w-0 flex-col">
                        <Tooltip content={stats} side="bottom" align="start" openDelay={400} forceOpen={keyboardFocus || undefined}>
                            <span
                                dir="ltr"
                                className={[
                                    dimmed ? 'text-sm text-secondary' : 'text-sm text-default',
                                    flagged ? 'line-through' : '',
                                ].join(' ')}
                                data-name=""
                            >
                                <ListName text={details.name} />
                            </span>
                        </Tooltip>
                        {/* Touch: no hover, so the tooltip's rule counts are shown (aria-describedby already reads them). */}
                        <span aria-hidden="true" className="hidden text-xs text-secondary touch:block" data-touch-stats="">
                            {stats}
                        </span>
                        {flagged ? (
                            <span aria-hidden="true" className="text-xs text-secondary" data-removal-note="">
                                {S.removalPending()}
                            </span>
                        ) : null}
                    </span>
                }
                {...{
                    'aria-describedby': describedBy,
                    'aria-disabled': locked ? 'true' : undefined,
                    'data-testid': `leaf-checkbox-${leaf.id}`,
                    onFocus: (e: FocusEvent<HTMLElement>) => setKeyboardFocus(isFocusVisible(e.currentTarget)),
                    onBlur: () => setKeyboardFocus(false),
                    onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === 'Escape') setKeyboardFocus(false);
                    },
                }}
            />
            <span id={statsId} className="sr-only">
                {stats}
            </span>
            {flagged ? (
                <span id={removalId} className="sr-only">
                    {S.removalPending()}
                </span>
            ) : null}
            {leaf.fromAdmin ? (
                <Tooltip content={S.managed()} compact>
                    <span className={`${END_SLOT} text-secondary`} data-managed="">
                        <AppIcon name="lock" className="size-4" />
                    </span>
                </Tooltip>
            ) : null}
            {home !== null ? (
                <Tooltip content={S.homeLink(details.name)} compact>
                    <ButtonLink
                        href={home}
                        external
                        color="secondary"
                        variant="ghost"
                        size="sm"
                        aria-label={S.homeLink(details.name)}
                        className={`shrink-0 ${TOUCH_BUTTON}`}
                        data-uniform=""
                        data-home=""
                    >
                        <AppIcon name="home" />
                    </ButtonLink>
                </Tooltip>
            ) : removable ? null : (
                <span className={END_SLOT} aria-hidden="true" />
            )}
            {removable ? (
                <IconButton
                    icon={flagged ? 'undo' : 'trash'}
                    label={flagged ? S.undoRemoveList(plain) : S.removeList(plain)}
                    size="sm"
                    className={`shrink-0 ${TOUCH_BUTTON}`}
                    onClick={() => (flagged ? ctx.controller.undoRemoveImported(leaf.id) : ctx.controller.removeImported(leaf.id))}
                    data-testid={flagged ? 'leaf-undo-remove' : 'leaf-remove'}
                />
            ) : null}
        </li>
    );
}

function NodeRow({ node, ctx }: { node: CompositeView; ctx: RowContext }) {
    const id = useId();
    const listId = `${id}-list`;
    const nameId = `${id}-name`;
    const hiddenId = `${id}-hidden`;
    const locked = node.disabled || node.locked;
    const dimmed = node.locked && !node.disabled;
    const collapsible = !ctx.searchMode && canCollapse(node.children);
    const expanded = !node.hideUnused;
    const hidden = ctx.searchMode ? 0 : hiddenByUnused(node.children);
    const describedBy = [node.fromAdmin ? ctx.managedNoteId : '', node.locked ? ctx.limitNoteId : ''].filter(Boolean).join(' ');
    return (
        <li
            className="min-w-0"
            data-node-id={node.id}
            data-hide-unused={node.hideUnused ? '' : undefined}
            // Focus target when a focused child row disappears (hide-unused).
            data-focus-fallback={collapsible ? `${id}-toggle ${id}` : id}
        >
            <div className="flex min-w-0 items-start gap-2 py-1.5 touch:py-1">
                <Checkbox
                    id={id}
                    className={locked ? `${CHECKBOX_CLASS} ${LOCKED_CHECKBOX_CLASS}` : CHECKBOX_CLASS}
                    checked={node.partial ? 'indeterminate' : node.checked}
                    onCheckedChange={() => {
                        if (locked) return;
                        ctx.controller.toggleNode(node.id);
                    }}
                    label={
                        <span id={nameId} dir="ltr" className={dimmed ? 'text-sm text-secondary' : 'text-sm text-default'} data-name="">
                            <ListName text={node.name} />
                        </span>
                    }
                    {...{
                        'aria-describedby': describedBy || undefined,
                        'aria-disabled': locked ? 'true' : undefined,
                        'data-testid': `node-checkbox`,
                    }}
                />
                <span className="flex h-7 shrink-0 items-center gap-2 touch:h-11">
                    <HiddenCount id={hiddenId} count={hidden} />
                    <CountBadge checked={node.checkedCount} total={node.totalCount} />
                </span>
                {collapsible ? (
                    <button
                        id={`${id}-toggle`}
                        type="button"
                        className={`${END_SLOT} cursor-pointer rounded-md text-secondary hover:bg-(--color-background-secondary-ghost-hover) ${FOCUS_RING}`}
                        aria-expanded={expanded}
                        aria-controls={listId}
                        // Named by the list itself (its state is aria-expanded), plus "N hidden".
                        aria-labelledby={hidden > 0 ? `${nameId} ${hiddenId}` : nameId}
                        onClick={() => ctx.controller.toggleHideUnused(node.id)}
                        data-testid="node-hide-unused"
                    >
                        <Chevron expanded={expanded} />
                    </button>
                ) : (
                    <span className={END_SLOT} aria-hidden="true" />
                )}
            </div>
            <ul id={listId} className="flex min-w-0 flex-col ps-7" aria-label={node.name}>
                {node.children.map((child) => (child.visible ? <Row key={child.id} entry={child} ctx={ctx} /> : null))}
            </ul>
        </li>
    );
}

function Row({ entry, ctx }: { entry: LeafView | CompositeView; ctx: RowContext }) {
    return entry.kind === 'leaf' ? <LeafRow leaf={entry} ctx={ctx} /> : <NodeRow node={entry} ctx={ctx} />;
}

/** Card header: one row, 48px, title start, then "N hidden", badge and chevron slot at the end. */
const GROUP_HEADER_ROW = 'flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-start';

function GroupSection({ group, ctx, importArea }: { group: GroupView; ctx: RowContext; importArea?: ReactNode }) {
    const id = useId();
    const headingId = `${id}-heading`;
    const listId = `${id}-list`;
    const toggleId = `${id}-toggle`;
    const name = t(group.nameKey);
    // The import area lives in the expanded "Imported lists" card, so that card can always be
    // expanded (upstream hides the area while `imported` is in hide-unused state, §7.5).
    const hasImportArea = importArea !== undefined && importArea !== null && !ctx.searchMode;
    const collapsible = !ctx.searchMode && (hasImportArea || canCollapse(group.children));
    const expanded = !group.hideUnused;
    const hidden = ctx.searchMode ? 0 : hiddenByUnused(group.children);
    const visibleChildren = group.children.filter((c) => c.visible);
    const showImportArea = hasImportArea && expanded;
    const hasBody = visibleChildren.length > 0 || showImportArea;
    const content = (
        <>
            <span className="min-w-0 flex-1 break-words" data-group-name="">
                {name}
            </span>
            <HiddenCount count={hidden} />
            <CountBadge checked={group.checkedCount} total={group.totalCount} />
            <span className={`${END_SLOT} text-secondary`} aria-hidden="true">
                {collapsible ? <Chevron expanded={expanded} /> : null}
            </span>
        </>
    );
    return (
        <Card
            as="section"
            padding="none"
            aria-labelledby={headingId}
            className="overflow-hidden"
            data-group-id={group.id}
            data-hide-unused={group.hideUnused ? '' : undefined}
            data-focus-fallback={collapsible ? toggleId : undefined}
        >
            <h3 id={headingId} className="heading-xs min-w-0 text-default">
                {collapsible ? (
                    <button
                        id={toggleId}
                        type="button"
                        className={[
                            GROUP_HEADER_ROW,
                            'cursor-pointer rounded-t-2xl hover:bg-(--color-background-secondary-ghost-hover) focus-visible:outline-offset-[-2px]',
                            hasBody ? '' : 'rounded-b-2xl',
                            FOCUS_RING,
                        ].join(' ')}
                        aria-expanded={expanded}
                        aria-controls={listId}
                        onClick={() => ctx.controller.toggleHideUnused(group.id)}
                        data-testid="group-toggle"
                    >
                        {content}
                    </button>
                ) : (
                    <div className={GROUP_HEADER_ROW}>{content}</div>
                )}
            </h3>
            {visibleChildren.length > 0 ? (
                <ul id={listId} aria-labelledby={headingId} className="flex min-w-0 flex-col border-t border-subtle px-4 py-1">
                    {group.children.map((child) => (child.visible ? <Row key={child.id} entry={child} ctx={ctx} /> : null))}
                </ul>
            ) : (
                <ul id={listId} aria-labelledby={headingId} className="hidden" />
            )}
            {showImportArea ? importArea : null}
        </Card>
    );
}

/* ------------------------------------------------------------------------ */
/* Import area (§12.2; only with compiled-filter support)                    */
/* ------------------------------------------------------------------------ */

/**
 * End of the expanded "Imported lists" card: upstream's `aside` of the pane
 * (dashboard.html:118-126). The user-scripts notice is shown when user scripts
 * are not allowed (settings.css:274-279). "Add filter list…" is a disclosure
 * with a URL field and an Add button. Add sends `importFilterList` only for an
 * address that passes upstream's test (FL:493); the button is disabled
 * otherwise (upstream hides it, settings.css:288-290). Enter in the field does
 * what Add does. After an answer the form closes and clears, as upstream does.
 */
function ImportArea({
    controller,
    state,
    supportsUserScripts,
}: {
    controller: FilterListsController;
    state: ListsState;
    supportsUserScripts: boolean;
}) {
    const id = useId();
    const regionId = `${id}-import`;
    const errorId = `${id}-import-error`;
    const inputRef = useRef<HTMLInputElement | null>(null);
    const toggleRef = useRef<HTMLButtonElement | null>(null);
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState('');
    const [typeValid, setTypeValid] = useState(true);
    const { pending, error, done } = state.importing;
    const valid = url !== '' && typeValid && isValidImportUrl(url);

    // A successful import closes and clears the form (FL:496-497); focus returns to the toggle.
    const lastDone = useRef(done);
    useEffect(() => {
        if (done === lastDone.current) return;
        lastDone.current = done;
        setOpen(false);
        setUrl('');
        toggleRef.current?.focus();
    }, [done]);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    const submit = () => {
        if (!valid || pending) return;
        void controller.importList(url);
    };

    return (
        <div className="flex min-w-0 flex-col gap-2 border-t border-subtle px-4 py-3" data-testid="filter-lists-import-area">
            {supportsUserScripts ? null : (
                <p className="min-w-0 text-sm text-secondary break-words" data-testid="filter-lists-user-scripts-info">
                    <T k="customListImportUserScriptsInfo" productName /> <T k="userScriptsInfo" productName />
                </p>
            )}
            <div>
                <Button
                    ref={toggleRef}
                    color="secondary"
                    variant="ghost"
                    size="md"
                    className={`self-start ${TOUCH_BUTTON}`}
                    aria-expanded={open}
                    aria-controls={regionId}
                    onClick={() => {
                        controller.dismissImportError();
                        setOpen((o) => !o);
                    }}
                    data-testid="filter-lists-import-toggle"
                >
                    <AppIcon name="add" />
                    <span>{t('customListImportLabel')}</span>
                </Button>
            </div>
            <div id={regionId} hidden={!open}>
                {open ? (
                    <form
                        className="flex min-w-0 flex-wrap items-center gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            submit();
                        }}
                        noValidate
                        data-testid="filter-lists-import-form"
                    >
                        <div className="min-w-0 flex-[1_1_16rem]">
                            <Input
                                ref={inputRef}
                                type="url"
                                value={url}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                    setUrl(e.target.value);
                                    setTypeValid(e.target.validity.valid);
                                }}
                                placeholder={t('customListImportPlaceholder')}
                                aria-label={t('customListImportPlaceholder')}
                                aria-describedby={error !== null ? errorId : undefined}
                                aria-invalid={url !== '' && !valid ? true : undefined}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                inputMode="url"
                                disabled={pending}
                                className={`${INPUT_CLASS_BASE} [padding-inline:var(--input-gutter)] [&_input]:[padding-inline:0]`}
                                data-testid="filter-lists-import-url"
                            />
                        </div>
                        <Button
                            type="submit"
                            color="primary"
                            variant="soft"
                            size="md"
                            className={TOUCH_BUTTON}
                            disabled={!valid || pending}
                            loading={pending}
                            data-testid="filter-lists-import-add"
                        >
                            <AppIcon name="check" />
                            <span>{t('addButton')}</span>
                        </Button>
                        {url !== '' && !valid ? (
                            <p className="w-full text-sm text-secondary" data-testid="filter-lists-import-hint">
                                {S.importInvalid()}
                            </p>
                        ) : null}
                    </form>
                ) : null}
            </div>
            {/* The failure is announced (role="alert"); the technical reason is in the console. */}
            {error !== null ? (
                <div id={errorId}>
                    <Alert
                        color="danger"
                        variant="soft"
                        title={S.importFailed()}
                        actions={
                            <Button color="secondary" variant="soft" size="sm" onClick={() => controller.dismissImportError()}>
                                {S.dismiss()}
                            </Button>
                        }
                        data-testid="filter-lists-import-error"
                    />
                </div>
            ) : null}
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Header                                                                    */
/* ------------------------------------------------------------------------ */

function collapsibleIds(view: ListsView): string[] {
    const out: string[] = [];
    const walk = (entries: readonly (LeafView | CompositeView)[]) => {
        for (const e of entries) {
            if (e.kind !== 'node' || !e.visible) continue;
            if (canCollapse(e.children)) out.push(e.id);
            walk(e.children);
        }
    };
    for (const g of view.groups) {
        if (!g.visible) continue;
        if (canCollapse(g.children)) out.push(g.id);
        walk(g.children);
    }
    return out;
}

/** The most important notice, as one short line for the stuck header (the Alerts are in the flow). */
function compactNotice(state: ListsState): { tone: 'danger' | 'warning'; text: string } | null {
    if (state.commit.error !== null) return { tone: 'danger', text: S.saveFailed() };
    if (state.commit.notApplied.length > 0) return { tone: 'warning', text: S.notAppliedTitle() };
    if (state.read.error !== null && state.data !== null) return { tone: 'warning', text: S.refreshFailed() };
    return null;
}

/** True while the sticky header is stuck below the top edge (the pane's top scrolled past it). */
function useStuck(sentinel: RefObject<HTMLElement | null>, header: RefObject<HTMLElement | null>, active: boolean): boolean {
    const [stuck, setStuck] = useState(false);
    useEffect(() => {
        const s = sentinel.current;
        const h = header.current;
        if (!active || s === null || h === null || typeof IntersectionObserver === 'undefined') return;
        let io: IntersectionObserver | null = null;
        const observe = () => {
            io?.disconnect();
            const top = parseFloat(getComputedStyle(h).top) || 0;
            io = new IntersectionObserver(
                ([entry]) => {
                    if (entry !== undefined) setStuck(!entry.isIntersecting && entry.boundingClientRect.top < top + 1);
                },
                { rootMargin: `${-(top + 1)}px 0px 0px 0px`, threshold: 0 },
            );
            io.observe(s);
        };
        observe();
        // The sticky offset changes with the breakpoint (tabs row below lg).
        window.addEventListener('resize', observe);
        return () => {
            window.removeEventListener('resize', observe);
            io?.disconnect();
        };
    }, [sentinel, header, active]);
    return stuck;
}

function Header({
    state,
    view,
    controller,
    searchId,
    stuck,
    headerRef,
}: {
    state: ListsState;
    view: ListsView;
    controller: FilterListsController;
    searchId: string;
    stuck: boolean;
    headerRef: RefObject<HTMLDivElement | null>;
}) {
    const switchId = useId();
    const titleId = useId();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const totals = formatStats(t('perRulesetStats'), view.totals, formatNumber);
    const ids = view.searchMode ? [] : collapsibleIds(view);
    const allHidden = ids.length > 0 && ids.every((id) => state.hideUnused.has(id));
    const placeholder = t('findListsPlaceholder');
    const notice = stuck ? compactNotice(state) : null;
    const { committing, slow } = state.commit;
    return (
        <div
            ref={headerRef}
            className={[
                'sticky top-(--dashboard-sticky-top,0px) z-10 -mx-1 flex min-w-0 flex-col gap-3 bg-surface px-1 pb-3 pt-1',
                // `border-default` (10%/12% alpha): `border-subtle` was too faint to read as an edge.
                stuck ? 'border-b border-default' : 'border-b border-transparent',
            ].join(' ')}
            data-testid="filter-lists-header"
            data-stuck={stuck ? '' : undefined}
        >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
                    <h2 id={titleId} className="heading-sm text-default break-words" data-testid="filter-lists-title">
                        {t('aboutFilterLists')}
                    </h2>
                    <p className="min-w-0 text-sm text-secondary break-words" data-testid="filter-lists-totals">
                        {totals}
                    </p>
                </div>
                {/* Present from mount: "Saving…" and the slow notice are announced politely. */}
                <div
                    className="flex min-h-6 min-w-0 items-center gap-2 text-sm text-secondary"
                    role="status"
                    aria-live="polite"
                    data-testid="filter-lists-commit-status"
                >
                    {committing ? (
                        <>
                            <LoadingIndicator size={16} aria-hidden="true" />
                            <span>{S.saving()}</span>
                            {slow ? (
                                <span className="text-(--color-text-warning-soft)" data-testid="filter-lists-save-slow">
                                    {S.saveSlow()}
                                </span>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="min-w-0 flex-[1_1_16rem]">
                    <Input
                        ref={inputRef}
                        id={searchId}
                        type="search"
                        value={state.search}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => controller.setSearch(e.target.value)}
                        placeholder={placeholder}
                        aria-label={placeholder}
                        spellCheck={false}
                        autoComplete="off"
                        className={state.search !== '' ? INPUT_CLASS_BOTH : INPUT_CLASS_START}
                        startAdornment={<AppIcon name="search" className="size-4 text-secondary" />}
                        endAdornment={
                            state.search !== '' ? (
                                <Button
                                    color="secondary"
                                    variant="ghost"
                                    size="2xs"
                                    uniform
                                    pill
                                    aria-label={S.clearSearch()}
                                    onClick={() => {
                                        controller.setSearch('');
                                        inputRef.current?.focus();
                                    }}
                                    data-testid="filter-lists-search-clear"
                                >
                                    <AppIcon name="close" />
                                </Button>
                            ) : undefined
                        }
                        data-testid="filter-lists-search"
                    />
                </div>
                <Switch
                    id={switchId}
                    checked={allHidden}
                    disabled={ids.length === 0}
                    onCheckedChange={(on) => controller.setHideUnusedFor(ids, on)}
                    label={
                        <span className={ids.length === 0 ? 'text-sm text-secondary' : 'text-sm text-default'}>{S.hideUnused()}</span>
                    }
                    className={SWITCH_CLASS}
                    {...{ 'data-testid': 'filter-lists-hide-unused' }}
                />
            </div>
            {notice !== null ? (
                // Visual only: the Alert below already announced it.
                <p
                    aria-hidden="true"
                    className={[
                        'flex min-w-0 items-center gap-2 text-sm',
                        notice.tone === 'danger' ? 'text-(--color-text-danger-soft)' : 'text-(--color-text-warning-soft)',
                    ].join(' ')}
                    data-testid="filter-lists-sticky-notice"
                >
                    <AppIcon name={notice.tone === 'danger' ? 'error' : 'warning'} className="size-4 shrink-0" />
                    <span className="min-w-0 break-words">{notice.text}</span>
                </p>
            ) : null}
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Notices                                                                   */
/* ------------------------------------------------------------------------ */

function Notices({
    state,
    view,
    max,
    limitNoteId,
    managedNoteId,
    hasManaged,
    searchId,
    controller,
}: {
    state: ListsState;
    view: ListsView;
    max: number | null | undefined;
    limitNoteId: string;
    managedNoteId: string;
    hasManaged: boolean;
    searchId: string;
    controller: FilterListsController;
}) {
    const { commit } = state;
    const notAppliedNames = joinList(
        commit.notApplied.map((id) => {
            const name = state.data?.tree.leafById.get(id)?.details.name;
            return typeof name === 'string' ? plainName(name) : id;
        }),
    );
    const action = (label: string, fn: () => void): ReactNode => (
        <Button color="secondary" variant="soft" size="sm" onClick={fn}>
            {label}
        </Button>
    );
    return (
        <div
            // Live regions present from mount; while empty it is taken out of the flow (no gap), never display:none.
            className="flex min-w-0 flex-col gap-3 [&:not(:has([data-notice]))]:absolute"
            data-testid="filter-lists-notices"
            // A dismissed notice takes focus with it: give it to the search field.
            data-focus-fallback={searchId}
        >
            {/* role="alert" (library Alert, danger): announced on insertion. Technical details go to the console. */}
            {commit.error !== null ? (
                <Alert
                    color="danger"
                    variant="soft"
                    title={S.saveFailed()}
                    description={S.saveFailedHint()}
                    actions={action(S.dismiss(), () => controller.dismissCommitError())}
                    data-testid="filter-lists-save-error"
                    data-notice=""
                />
            ) : null}
            {/* Always present, so later insertions are announced politely. */}
            <div className="flex min-w-0 flex-col gap-3 empty:absolute" role="status" aria-live="polite">
                {commit.notApplied.length > 0 ? (
                    <Alert
                        color="warning"
                        variant="soft"
                        title={S.notAppliedTitle()}
                        description={
                            <>
                                <span className="block" data-testid="filter-lists-not-applied-names">
                                    {S.notApplied(notAppliedNames)}
                                </span>
                                <span className="block">{S.notAppliedHint()}</span>
                            </>
                        }
                        actions={action(S.dismiss(), () => controller.dismissNotApplied())}
                        data-testid="filter-lists-not-applied"
                        data-notice=""
                    />
                ) : null}
                {state.read.error !== null && state.data !== null ? (
                    <Alert
                        color="warning"
                        variant="soft"
                        title={S.refreshFailed()}
                        actions={action(S.retry(), () => controller.reread('retry'))}
                        data-testid="filter-lists-refresh-error"
                        data-notice=""
                    />
                ) : null}
                {state.prefError !== null ? (
                    <Alert
                        color="warning"
                        variant="soft"
                        title={S.prefSaveFailed()}
                        actions={action(S.dismiss(), () => controller.dismissPrefError())}
                        data-testid="filter-lists-pref-error"
                        data-notice=""
                    />
                ) : null}
            </div>
            {/* Limit (§10): always present as a polite region; locked rows are described by it. */}
            <div role="status" aria-live="polite" id={limitNoteId} className="min-w-0 empty:absolute">
                {view.atLimit && typeof max === 'number' ? (
                    <Alert
                        color="info"
                        variant="soft"
                        title={S.limitTitle()}
                        description={S.limitReached(formatNumber(max))}
                        data-testid="filter-lists-limit"
                        data-notice=""
                    />
                ) : null}
            </div>
            <span id={managedNoteId} className="sr-only">
                {hasManaged ? S.managed() : ''}
            </span>
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Pane                                                                      */
/* ------------------------------------------------------------------------ */

/** Placeholder with the boxes of the ready pane (title, totals, search + switch, cards). */
function LoadingSkeleton() {
    return (
        <div className="flex min-w-0 flex-col gap-4" aria-busy="true" data-testid="filter-lists-skeleton">
            <div className="flex min-w-0 flex-col gap-3 pb-3 pt-1">
                <div className="flex min-w-0 flex-col gap-1">
                    <Skeleton className="h-[26px] w-40 max-w-full" />
                    <Skeleton shape="text" className="w-96 max-w-full" />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                    <Skeleton className="h-8 min-w-0 flex-1" />
                    <Skeleton shape="pill" className="h-5 w-40" />
                </div>
            </div>
            {[176, 50, 90].map((h) => (
                <Skeleton
                    key={h}
                    className={h === 176 ? 'h-44 w-full rounded-2xl' : h === 50 ? 'h-[50px] w-full rounded-2xl' : 'h-[90px] w-full rounded-2xl'}
                />
            ))}
        </div>
    );
}

/**
 * Focus restoration: remembers the focused control and the fallbacks of its
 * containers (`data-focus-fallback`, innermost first, then the search field).
 * When a render removed the focused control and focus fell to <body>, the first
 * fallback still shown gets it.
 */
function useFocusRestore(root: RefObject<HTMLElement | null>, searchId: string) {
    const last = useRef<{ el: HTMLElement; fallbacks: string[] } | null>(null);
    const onFocus = useCallback(
        (e: FocusEvent<HTMLElement>) => {
            const el = e.target;
            const fallbacks: string[] = [];
            for (let n = el.parentElement; n !== null && n !== root.current; n = n.parentElement) {
                const f = n.getAttribute('data-focus-fallback');
                if (f) fallbacks.push(...f.split(' '));
            }
            fallbacks.push(searchId);
            last.current = { el, fallbacks };
        },
        [root, searchId],
    );
    useLayoutEffect(() => {
        const l = last.current;
        if (l === null || l.el.isConnected) return;
        last.current = null;
        const active = document.activeElement;
        if (active !== null && active !== document.body) return;
        for (const id of l.fallbacks) {
            const target = document.getElementById(id);
            if (target === null || target === l.el || target.getClientRects().length === 0) continue;
            if ((target as HTMLButtonElement).disabled) continue;
            target.focus();
            return;
        }
    });
    return onFocus;
}

export function FilterListsPane() {
    const controller = getFilterListsController();
    const options = useOptionsStore();
    const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
    const limitNoteId = useId();
    const managedNoteId = useId();
    const searchId = useId();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const onFocus = useFocusRestore(rootRef, searchId);

    useEffect(() => {
        // One getOptionsPageData per page, whoever asks first (settings.md §2.3).
        void loadOptionsData().catch(() => {});
        controller.start();
    }, [controller]);

    const ready = options.status === 'ready' ? options : null;
    const data = state.data;
    const view = useMemo<ListsView | null>(() => {
        if (ready === null || data === null) return null;
        return deriveListsView({
            tree: data.tree,
            checked: state.selection.checked,
            adminRulesets: ready.data.adminRulesets,
            maxNumberOfEnabledRulesets: ready.data.maxNumberOfEnabledRulesets,
            hideUnused: state.hideUnused,
            search: state.search,
            supportsCompiledFilters: ready.data.supportsCompiledFilters,
            keepVisible: new Set(state.removing.keys()),
        });
    }, [ready, data, state.selection.checked, state.hideUnused, state.search, state.removing]);

    const isReady = options.status !== 'error' && view !== null && state.hideUnusedLoaded;
    const stuck = useStuck(sentinelRef, headerRef, isReady);

    let body: ReactNode;
    let paneState: 'loading' | 'error' | 'ready';
    if (options.status === 'error') {
        paneState = 'error';
        // The technical reason is in the console (the page store logs it); the user gets the hint.
        body = (
            <Alert color="danger" variant="soft" title={S.loadFailed()} description={S.reloadHint()} data-testid="filter-lists-load-error" />
        );
    } else if (!isReady || view === null) {
        if (data === null && state.read.error !== null && !state.read.pending) {
            paneState = 'error';
            body = (
                <Alert
                    color="danger"
                    variant="soft"
                    title={S.loadFailed()}
                    actions={
                        <Button color="secondary" variant="soft" size="sm" onClick={() => controller.reread('retry')}>
                            {S.retry()}
                        </Button>
                    }
                    data-testid="filter-lists-load-error"
                />
            );
        } else {
            paneState = 'loading';
            body = <LoadingSkeleton />;
        }
    } else {
        paneState = 'ready';
        const canImport = ready?.data.supportsCompiledFilters === true;
        const ctx: RowContext = {
            controller,
            searchMode: view.searchMode,
            limitNoteId,
            managedNoteId,
            canImport,
            removing: state.removing,
        };
        const importArea = canImport ? (
            <ImportArea controller={controller} state={state} supportsUserScripts={ready?.data.supportsUserScripts === true} />
        ) : null;
        const shownGroups = view.groups.filter((g) => g.visible);
        const hasManaged = [...view.leafViews.values()].some((l) => l.fromAdmin);
        const noResults = view.searchMode && shownGroups.length === 0;
        body = (
            <>
                <Header state={state} view={view} controller={controller} searchId={searchId} stuck={stuck} headerRef={headerRef} />
                <Notices
                    state={state}
                    view={view}
                    max={ready?.data.maxNumberOfEnabledRulesets}
                    limitNoteId={limitNoteId}
                    managedNoteId={managedNoteId}
                    hasManaged={hasManaged}
                    searchId={searchId}
                    controller={controller}
                />
                {/* Always present, so "no results" is announced when it appears. */}
                <div role="status" aria-live="polite" className="min-w-0 empty:absolute" data-testid="filter-lists-results-status">
                    {noResults ? (
                        <div data-testid="filter-lists-no-results">
                            <EmptyMessage className="py-6">
                                <EmptyMessage.Icon>
                                    <AppIcon name="search" />
                                </EmptyMessage.Icon>
                                <EmptyMessage.Title>{S.noResults()}</EmptyMessage.Title>
                            </EmptyMessage>
                        </div>
                    ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-4" data-testid="filter-lists-tree">
                    {shownGroups.map((g) => (
                        <GroupSection key={g.id} group={g} ctx={ctx} importArea={g.id === 'imported' ? importArea : undefined} />
                    ))}
                </div>
            </>
        );
    }

    return (
        <div
            ref={rootRef}
            className={[
                'relative mx-auto flex w-full min-w-0 max-w-page flex-col gap-4',
                paneState === 'ready' ? PANE_CHECKBOX_TOKENS : '',
            ].join(' ')}
            data-testid="filter-lists-pane"
            data-state={paneState}
            aria-busy={paneState === 'loading' ? true : undefined}
            onFocus={onFocus}
        >
            {/* Sticky detection: the pane's top edge passing the header's sticky line. */}
            <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px" />
            {body}
        </div>
    );
}

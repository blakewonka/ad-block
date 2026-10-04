/**
 * Filter lists pane: pure model (no DOM, no browser API, no React).
 *
 * Implements docs/specs/filter-lists.md §20 ("Pure functions to extract") plus a
 * few compositions the pane needs (view derivation, commit planning). Every
 * function cites the upstream code it reproduces; `FL` below is
 * platform/mv3/extension/js/filter-lists.js, `CSS` is css/settings.css.
 *
 * Data model (spec §4.1), restated in the terms used here:
 *   - `checked: Set<id>`     = the leaf checkboxes that are ticked (upstream `desired`);
 *   - `toggled: Set<id>`     = leaves changed by the user since the last commit started;
 *   - `serverEnabled: Set<id>` = ids that have a leaf AND are in the last getEnabledRulesets
 *                              answer (upstream `visuallyEnabledRulesets`).
 *
 * Deliberate differences from upstream (all without message impact) are marked
 * DEVIATION; docs/specs/filter-lists.md lists the allowed ones (D-n, Q-n).
 */

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * A ruleset record as answered by getRulesetDetails (spec §1.3). Typed loosely on
 * purpose: the data is runtime JSON, `group` may hold values outside the known
 * union, and `title` / `preferred` matter for sorting (§3.4) although no shipped
 * record has them. `RulesetDetails` from src/lib/bridge.ts is assignable to it.
 */
export interface ListDetails {
    id: string;
    name: string;
    group?: string;
    parent?: string;
    lang?: string;
    tags?: string;
    enabled?: boolean;
    homeURL?: string;
    filters?: { accepted?: number; [k: string]: unknown };
    rules?: { plain?: number; regex?: number; [k: string]: unknown };
    title?: string;
    preferred?: boolean;
    [k: string]: unknown;
}

/** Root groups in their fixed display order (FL:240-283). */
export const GROUP_IDS = ['default', 'ads', 'privacy', 'malware', 'annoyances', 'misc', 'regions', 'imported'] as const;
export type GroupId = (typeof GROUP_IDS)[number];

/** Initial hide-unused set (FL:32). Same value as storage.ts DEFAULT_HIDE_UNUSED_FILTER_LISTS. */
export const DEFAULT_HIDE_UNUSED: readonly string[] = ['ads', 'regions', 'imported'];

/** Debounce of the commit timer, ms (FL:477-484). */
export const COMMIT_DEBOUNCE_MS = 997;

export interface RulesetStats {
    ruleCount: number;
    filterCount: number;
}

export interface Totals extends RulesetStats {
    /** Checked leaves that are not imported, admin-locked ones included (FL:43-50). */
    rulesetCount: number;
}

/** A leaf row: one ruleset. */
export interface LeafEntry {
    kind: 'leaf';
    /** Ruleset id (the value sent in applyRulesets). */
    id: string;
    details: ListDetails;
    /** 1 for a direct child of a root group, 2 under a composite node, ... */
    depth: number;
    groupId: GroupId;
    /** `group === 'imported'` (FL:155). */
    isImported: boolean;
    /** `enabled === true` and not imported (FL:155-158, spec §4.3). */
    isDefault: boolean;
}

/** A composite node row (from `parent`, §3.2). Its id is the parent segment text. */
export interface CompositeEntry {
    kind: 'node';
    id: string;
    name: string;
    depth: number;
    groupId: GroupId;
    children: TreeEntry[];
    /** Every leaf id below, any depth, display order. */
    leafIds: string[];
}

/** A root group row: no checkbox (§3.1). */
export interface GroupEntry {
    kind: 'group';
    id: GroupId;
    /** i18n key of the name, e.g. `3pGroupRegions`. */
    nameKey: string;
    depth: 0;
    children: TreeEntry[];
    leafIds: string[];
}

export type TreeEntry = LeafEntry | CompositeEntry;
export type NodeEntry = GroupEntry | CompositeEntry;

export interface ListTree {
    /** Always the 8 groups of GROUP_IDS, in that order, empty ones included. */
    groups: GroupEntry[];
    /** Every leaf in display (= upstream DOM) order. */
    leaves: LeafEntry[];
    leafById: ReadonlyMap<string, LeafEntry>;
    /** Groups and composite nodes by node id (first occurrence wins on a clash). */
    nodeById: ReadonlyMap<string, NodeEntry>;
    /** Every record by id, including records that got no row (FL:136-139 `rulesetMap`). */
    detailsById: ReadonlyMap<string, ListDetails>;
}

export type Comparator = (a: string, b: string) => number;

/* ------------------------------------------------------------------------ */
/* 1, 2: stats                                                               */
/* ------------------------------------------------------------------------ */

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/**
 * §20 #1, FL:95-102: `rules.plain + rules.regex`, `filters.accepted`.
 * DEVIATION (malformed data only): a missing number counts as 0 where upstream
 * would produce NaN or throw.
 */
export function rulesetStats(details: ListDetails): RulesetStats {
    return {
        ruleCount: num(details.rules?.plain) + num(details.rules?.regex),
        filterCount: num(details.filters?.accepted),
    };
}

/** `value.toLocaleString()` with no arguments (FL:36-38). */
export const defaultNumberFormat = (n: number): string => n.toLocaleString();

/**
 * §20 #2, FL:56-59,164-166: replaces the FIRST `{{ruleCount}}` and the FIRST
 * `{{filterCount}}` of `template` (the raw `perRulesetStats` message).
 */
export function formatStats(
    template: string,
    stats: RulesetStats,
    format: (n: number) => string = defaultNumberFormat,
): string {
    const rules = format(stats.ruleCount);
    const filters = format(stats.filterCount);
    // Function replacers: a `$` in a formatted number can never act as a pattern.
    return template.replace('{{ruleCount}}', () => rules).replace('{{filterCount}}', () => filters);
}

/* ------------------------------------------------------------------------ */
/* 3, 4: groups                                                              */
/* ------------------------------------------------------------------------ */

/** Which root group a record belongs to, or `undefined` (no row at all), FL:240-283. */
export function groupOf(details: ListDetails): GroupId | undefined {
    const g = details.group;
    if (g === undefined) {
        return typeof details.lang !== 'string' ? 'misc' : undefined;
    }
    switch (g) {
        case 'default':
        case 'ads':
        case 'privacy':
        case 'malware':
        case 'annoyances':
        case 'regions':
        case 'imported':
            return g;
        default:
            return undefined;
    }
}

/** §20 #3: the 8 groups in fixed order with their members in input order. */
export function groupRulesets<T extends ListDetails>(details: readonly T[]): [GroupId, T[]][] {
    const out = GROUP_IDS.map((id): [GroupId, T[]] => [id, []]);
    const index = new Map(out.map(([id, list]) => [id, list]));
    for (const d of details) {
        const g = groupOf(d);
        if (g !== undefined) index.get(g)!.push(d);
    }
    return out;
}

/** §20 #4, FL:293. */
export const groupNameKey = (groupId: string): string =>
    `3pGroup${groupId.charAt(0).toUpperCase()}${groupId.slice(1)}`;

/* ------------------------------------------------------------------------ */
/* 5: raw tree (upstream object shape) + promoteLonelySublist                */
/* ------------------------------------------------------------------------ */

const RAW_NODE: unique symbol = Symbol('rawNode');

export interface RawNode {
    [RAW_NODE]: true;
    name: string;
    /** Null-prototype object, key order = upstream object key order. */
    lists: Record<string, RawNode | ListDetails>;
}
export type RawTree = Record<GroupId, RawNode>;

export const isRawNode = (v: unknown): v is RawNode =>
    typeof v === 'object' && v !== null && (v as Partial<RawNode>)[RAW_NODE] === true;

const rawNode = (name: string): RawNode => ({ [RAW_NODE]: true, name, lists: Object.create(null) as RawNode['lists'] });

/**
 * FL:314-326. Every composite node (depth >= 1) with exactly one child is replaced
 * by that child; root groups (depth 0) never are.
 *
 * DEVIATION (Q2, multi-segment parents, absent from the shipped data): upstream
 * re-keys a promoted child under `child.id`, which a composite node lacks (key
 * "undefined"), and returns the lonely child through its pre-rename key (TypeError).
 * Here a promoted composite keeps its own key (its segment text) and the lookup
 * uses the current key, so nothing throws. All single-segment cases and the Q2
 * rows that do not hit those two bugs give the upstream result.
 */
export function promoteLonelySublist(parent: RawNode | ListDetails, depth = 0): RawNode | ListDetails {
    if (!isRawNode(parent)) return parent;
    const childKeys = Object.keys(parent.lists);
    for (const childKey of childKeys) {
        const before = parent.lists[childKey];
        const child = promoteLonelySublist(before, depth + 1);
        if (child === before) continue;
        const newKey = isRawNode(child) ? child.name : child.id;
        delete parent.lists[childKey];
        parent.lists[newKey] = child;
    }
    if (depth === 0) return parent;
    if (childKeys.length > 1) return parent;
    const keys = Object.keys(parent.lists);
    return parent.lists[keys[0]];
}

/**
 * §20 #5 (upstream shape), FL:287-329: groups, `parent` nesting split on `|`,
 * then promoteLonelySublist. Children are NOT sorted here (see buildListTree).
 * Records are placed under their id; a duplicate id overwrites the earlier record
 * in its original key position, as with upstream's plain object.
 */
export function buildRawTree(details: readonly ListDetails[]): RawTree {
    const tree = {} as RawTree;
    for (const [groupId, members] of groupRulesets(details)) {
        const group = rawNode(groupId);
        tree[groupId] = group;
        for (const record of members) {
            if (record.parent !== undefined) {
                let lists = group.lists;
                for (const segment of String(record.parent).split('|')) {
                    let next = lists[segment];
                    if (!isRawNode(next)) {
                        // Upstream tests `=== undefined`; a leaf already stored under the same key
                        // is replaced by the node here instead of crashing on `.lists` (malformed data).
                        next = rawNode(segment);
                        lists[segment] = next;
                    }
                    lists = next.lists;
                }
                lists[record.id] = record;
            } else {
                group.lists[record.id] = record;
            }
        }
    }
    for (const groupId of GROUP_IDS) promoteLonelySublist(tree[groupId]);
    return tree;
}

/* ------------------------------------------------------------------------ */
/* 6, 7: sort                                                                */
/* ------------------------------------------------------------------------ */

/** §20 #6, FL:199,204-205: `(value.title || key)` with every `\p{Emoji}+` run removed. */
export function sortKey(key: string, value?: object | null): string {
    const title = (value as { title?: unknown } | null | undefined)?.title;
    const base = typeof title === 'string' && title !== '' ? title : key;
    return base.replace(/\p{Emoji}+/gu, '');
}

/** `a.localeCompare(b)` with no locale argument (FL:206): the runtime's default collation. */
export const defaultComparator: Comparator = (a, b) => a.localeCompare(b);

/**
 * §20 #7, FL:200-207: stable sort, `preferred === true` first, then sortKey via
 * `compare`. Returns a new array.
 */
export function sortEntries<V extends object>(
    entries: readonly (readonly [string, V])[],
    compare: Comparator = defaultComparator,
): [string, V][] {
    return entries
        .map((e): [string, V] => [e[0], e[1]])
        .sort((a, b) => {
            const ap = (a[1] as { preferred?: unknown }).preferred === true;
            const bp = (b[1] as { preferred?: unknown }).preferred === true;
            if (ap !== bp) return ap ? -1 : 1;
            return compare(sortKey(a[0], a[1]), sortKey(b[0], b[1]));
        });
}

/* ------------------------------------------------------------------------ */
/* 5 + 7 + 8: typed, sorted tree                                             */
/* ------------------------------------------------------------------------ */

export interface BuildTreeOptions {
    /** Sort comparator, default `localeCompare()` without locale (spec §3.4). */
    compare?: Comparator;
}

/**
 * The tree the UI renders: groups in fixed order, children sorted (§3.4), with
 * leaf order = upstream DOM order (= the order of the applyRulesets payload).
 */
export function buildListTree(details: readonly ListDetails[], options: BuildTreeOptions = {}): ListTree {
    const compare = options.compare ?? defaultComparator;
    const raw = buildRawTree(details);
    const leaves: LeafEntry[] = [];
    const leafById = new Map<string, LeafEntry>();
    const nodeById = new Map<string, NodeEntry>();
    const detailsById = new Map<string, ListDetails>();
    for (const d of details) detailsById.set(d.id, d); // last wins, as upstream rulesetMap

    const convert = (lists: RawNode['lists'], depth: number, groupId: GroupId, leafIds: string[]): TreeEntry[] => {
        const sorted = sortEntries(
            Object.entries(lists) as [string, RawNode | ListDetails][],
            compare,
        );
        const out: TreeEntry[] = [];
        for (const [key, value] of sorted) {
            if (isRawNode(value)) {
                const node: CompositeEntry = {
                    kind: 'node',
                    id: key,
                    name: value.name,
                    depth,
                    groupId,
                    children: [],
                    leafIds: [],
                };
                if (!nodeById.has(key)) nodeById.set(key, node);
                node.children = convert(value.lists, depth + 1, groupId, node.leafIds);
                leafIds.push(...node.leafIds);
                out.push(node);
            } else {
                const isImported = value.group === 'imported';
                const leaf: LeafEntry = {
                    kind: 'leaf',
                    id: key,
                    details: value,
                    depth,
                    groupId,
                    isImported,
                    isDefault: value.enabled === true && !isImported,
                };
                leaves.push(leaf);
                if (!leafById.has(key)) leafById.set(key, leaf);
                leafIds.push(key);
                out.push(leaf);
            }
        }
        return out;
    };

    const groups = GROUP_IDS.map((id): GroupEntry => {
        const group: GroupEntry = { kind: 'group', id, nameKey: groupNameKey(id), depth: 0, children: [], leafIds: [] };
        nodeById.set(id, group);
        return group;
    });
    for (const group of groups) {
        group.children = convert(raw[group.id].lists, 1, group.id, group.leafIds);
    }
    return { groups, leaves, leafById, nodeById, detailsById };
}

/** §20 #8: leaf ids in display order. */
export function flattenLeaves(tree: ListTree): string[] {
    return tree.leaves.map((l) => l.id);
}

/** Depth-first walk over groups, composite nodes and leaves, in display order. */
export function* walkTree(tree: ListTree): Generator<GroupEntry | TreeEntry> {
    function* walk(entries: readonly TreeEntry[]): Generator<TreeEntry> {
        for (const e of entries) {
            yield e;
            if (e.kind === 'node') yield* walk(e.children);
        }
    }
    for (const g of tree.groups) {
        yield g;
        yield* walk(g.children);
    }
}

/* ------------------------------------------------------------------------ */
/* 9: flags                                                                  */
/* ------------------------------------------------------------------------ */

/** src/js/i18n.js:301-317, 63 entries, same order. */
export const UNICODE_FLAG_TO_CC: ReadonlyMap<string, string> = new Map([
    ['🇦🇱', 'al'], ['🇦🇷', 'ar'], ['🇦🇹', 'at'], ['🇧🇦', 'ba'],
    ['🇧🇪', 'be'], ['🇧🇬', 'bg'], ['🇧🇷', 'br'], ['🇨🇦', 'ca'],
    ['🇨🇭', 'ch'], ['🇨🇳', 'cn'], ['🇨🇴', 'co'], ['🇨🇾', 'cy'],
    ['🇨🇿', 'cz'], ['🇩🇪', 'de'], ['🇩🇰', 'dk'], ['🇩🇿', 'dz'],
    ['🇪🇪', 'ee'], ['🇪🇬', 'eg'], ['🇪🇸', 'es'], ['🇫🇮', 'fi'],
    ['🇫🇴', 'fo'], ['🇫🇷', 'fr'], ['🇬🇷', 'gr'], ['🇭🇷', 'hr'],
    ['🇭🇺', 'hu'], ['🇮🇩', 'id'], ['🇮🇱', 'il'], ['🇮🇳', 'in'],
    ['🇮🇷', 'ir'], ['🇮🇸', 'is'], ['🇮🇹', 'it'], ['🇯🇵', 'jp'],
    ['🇰🇷', 'kr'], ['🇰🇿', 'kz'], ['🇱🇰', 'lk'], ['🇱🇹', 'lt'],
    ['🇱🇻', 'lv'], ['🇲🇦', 'ma'], ['🇲🇩', 'md'], ['🇲🇰', 'mk'],
    ['🇲🇽', 'mx'], ['🇲🇾', 'my'], ['🇳🇱', 'nl'], ['🇳🇴', 'no'],
    ['🇳🇵', 'np'], ['🇵🇱', 'pl'], ['🇵🇹', 'pt'], ['🇷🇴', 'ro'],
    ['🇷🇸', 'rs'], ['🇷🇺', 'ru'], ['🇸🇦', 'sa'], ['🇸🇮', 'si'],
    ['🇸🇰', 'sk'], ['🇸🇪', 'se'], ['🇸🇷', 'sr'], ['🇹🇭', 'th'],
    ['🇹🇯', 'tj'], ['🇹🇼', 'tw'], ['🇹🇷', 'tr'], ['🇺🇦', 'ua'],
    ['🇺🇿', 'uz'], ['🇻🇳', 'vn'], ['🇽🇰', 'xk'],
]);

const reUnicodeFlags = new RegExp(Array.from(UNICODE_FLAG_TO_CC.keys()).join('|'), 'gu');

export type NameSegment = { type: 'text'; text: string } | { type: 'flag'; cc: string; emoji: string };

/** Path of the flag image inside the extension (src/js/i18n.js:332). */
export const flagImagePath = (cc: string): string => `/img/flags-of-the-world/${cc}.png`;

/**
 * §20 #9, src/js/i18n.js:322-343 (`patchUnicodeFlags`) without the DOM: every known
 * flag becomes `{ type: 'flag', cc }` followed by a `' '` text segment (upstream
 * appends the image and then a hair-space text node); other text is kept as is.
 */
export function splitFlags(text: string): NameSegment[] {
    const out: NameSegment[] = [];
    const re = new RegExp(reUnicodeFlags.source, 'gu');
    let i = 0;
    for (;;) {
        const match = re.exec(text);
        if (match === null) break;
        if (match.index > i) out.push({ type: 'text', text: text.slice(i, match.index) });
        out.push({ type: 'flag', cc: UNICODE_FLAG_TO_CC.get(match[0])!, emoji: match[0] });
        out.push({ type: 'text', text: ' ' });
        i = re.lastIndex;
    }
    if (i < text.length) out.push({ type: 'text', text: text.slice(i) });
    return out;
}

/* ------------------------------------------------------------------------ */
/* 10: admin                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * §20 #10, FL:106-116. Prefix test, not equality: some token starts with `id`, or
 * starts with `+id` / `-id`. Non-string tokens are skipped (upstream would throw).
 */
export function isAdminRuleset(id: string, adminRulesets: readonly unknown[] | undefined): boolean {
    for (const token of adminRulesets ?? []) {
        if (typeof token !== 'string') continue;
        const pos = token.indexOf(id);
        if (pos === 0) return true;
        if (pos !== 1) continue;
        const c = token.charAt(0);
        if (c === '+' || c === '-') return true;
    }
    return false;
}

/** A leaf carries the admin lock only when it is not imported (FL:167-174). */
export function isLeafAdminLocked(leaf: Pick<LeafEntry, 'id' | 'isImported'>, adminRulesets: readonly unknown[] | undefined): boolean {
    return !leaf.isImported && isAdminRuleset(leaf.id, adminRulesets);
}

/** The set of admin-locked leaf ids of a tree. */
export function adminLockedIds(tree: ListTree, adminRulesets: readonly unknown[] | undefined): Set<string> {
    const out = new Set<string>();
    for (const leaf of tree.leaves) if (isLeafAdminLocked(leaf, adminRulesets)) out.add(leaf.id);
    return out;
}

/* ------------------------------------------------------------------------ */
/* 11: server state                                                          */
/* ------------------------------------------------------------------------ */

/** FL:144-148: ids that have a leaf and are in the getEnabledRulesets answer. */
export function computeServerEnabled(enabledResponse: readonly string[], leafIds: Iterable<string>): Set<string> {
    const on = new Set(enabledResponse);
    const out = new Set<string>();
    for (const id of leafIds) if (on.has(id)) out.add(id);
    return out;
}

/** Ids reported enabled that have no leaf (a commit would disable them, §1.4 step 2). */
export function enabledWithoutRow(enabledResponse: readonly string[], tree: ListTree): string[] {
    return enabledResponse.filter((id) => !tree.leafById.has(id));
}

/**
 * §20 #11, FL:145-151: leaves in `toggled` keep the user's value, all others take
 * `serverEnabled.has(id)`. Returns the new `checked` set (only ids in `leafIds`).
 */
export function mergeServerState(
    checked: ReadonlySet<string>,
    toggled: ReadonlySet<string>,
    serverEnabled: ReadonlySet<string>,
    leafIds: Iterable<string>,
): Set<string> {
    const out = new Set<string>();
    for (const id of leafIds) {
        const on = toggled.has(id) ? checked.has(id) : serverEnabled.has(id);
        if (on) out.add(id);
    }
    return out;
}

/* ------------------------------------------------------------------------ */
/* Selection: user toggles                                                   */
/* ------------------------------------------------------------------------ */

export interface Selection {
    /** Ticked leaf ids (upstream `desired`). */
    checked: ReadonlySet<string>;
    /** Leaves changed by the user since the last commit started. */
    toggled: ReadonlySet<string>;
}

export const emptySelection = (): Selection => ({ checked: new Set(), toggled: new Set() });

/**
 * One successful read pair (getEnabledRulesets + getRulesetDetails) applied to the
 * current selection (spec §4.1, §13 item 4). Toggled ids whose leaf disappeared are
 * dropped (their row is removed upstream, FL:331-333).
 */
export function applyServerRead(
    selection: Selection,
    tree: ListTree,
    enabledResponse: readonly string[],
): { selection: Selection; serverEnabled: Set<string> } {
    const leafIds = flattenLeaves(tree);
    const serverEnabled = computeServerEnabled(enabledResponse, leafIds);
    const checked = mergeServerState(selection.checked, selection.toggled, serverEnabled, leafIds);
    const toggled = new Set([...selection.toggled].filter((id) => tree.leafById.has(id)));
    return { selection: { checked, toggled }, serverEnabled };
}

/** FL:547-549: a leaf checkbox change. `value` defaults to the flipped state. */
export function toggleLeaf(selection: Selection, id: string, value?: boolean): Selection {
    const on = value ?? !selection.checked.has(id);
    const checked = new Set(selection.checked);
    if (on) checked.add(id);
    else checked.delete(id);
    const toggled = new Set(selection.toggled);
    toggled.add(id);
    return { checked, toggled };
}

/** §20 #13, FL:541-542: `checkAll = newChecked || wasPartial`. */
export const nodeToggleTarget = (newChecked: boolean, wasPartial: boolean): boolean => newChecked || wasPartial;

export interface NodeToggleOptions {
    /**
     * Leaves left untouched by the node toggle. Upstream flips admin-locked leaves
     * too (QUIRK Q3); pass the admin-locked ids to leave them alone (spec §16 Q3:
     * "May fix"; no message impact either way since they are never sent).
     * The none/partial/all decision is then made over the other leaves only, so
     * a node whose admin leaf is forced off can still go back to none
     * (F5).
     */
    skip?: ReadonlySet<string>;
}

/**
 * FL:536-546: activation of a composite node checkbox. None -> all, partial -> all,
 * all -> none (spec §6). Every affected leaf is added to `toggled`.
 */
export function toggleNode(
    selection: Selection,
    node: Pick<CompositeEntry, 'leafIds'>,
    options: NodeToggleOptions = {},
): Selection {
    const operable = options.skip === undefined ? node.leafIds : node.leafIds.filter((id) => !options.skip!.has(id));
    const state = nodeState(operable, selection.checked);
    // The native box flips first: newChecked = !(checkedCount !== 0) (FL:82, FL:541).
    const checkAll = nodeToggleTarget(!state.checked, state.partial);
    const checked = new Set(selection.checked);
    const toggled = new Set(selection.toggled);
    for (const id of operable) {
        if (checkAll) checked.add(id);
        else checked.delete(id);
        toggled.add(id);
    }
    return { checked, toggled };
}

/** FL:440: a commit starts: `toggled` is emptied, `checked` kept. */
export const startCommit = (selection: Selection): Selection => ({ checked: selection.checked, toggled: new Set() });

/* ------------------------------------------------------------------------ */
/* 12: tri-state                                                             */
/* ------------------------------------------------------------------------ */

export interface NodeState {
    checkedCount: number;
    totalCount: number;
    /** The node checkbox `checked` property: `checkedCount !== 0` (FL:82). */
    checked: boolean;
    /** Indeterminate look: some but not all (FL:83-85). */
    partial: boolean;
    /** Every leaf below is admin-locked (FL:86-88); the checkbox is then disabled. True for 0 leaves. */
    fromAdmin: boolean;
}

/** §20 #12, FL:68-91. `isAdmin` decides per leaf id (default: none). */
export function nodeState(
    leafIds: readonly string[],
    checked: ReadonlySet<string>,
    isAdmin: (id: string) => boolean = () => false,
): NodeState {
    let checkedCount = 0;
    let adminCount = 0;
    for (const id of leafIds) {
        if (checked.has(id)) checkedCount += 1;
        if (isAdmin(id)) adminCount += 1;
    }
    const totalCount = leafIds.length;
    return {
        checkedCount,
        totalCount,
        checked: checkedCount !== 0,
        partial: checkedCount !== 0 && checkedCount !== totalCount,
        fromAdmin: adminCount === totalCount,
    };
}

/** `${checkedCount}/${totalCount}`, plain integers (FL:78). */
export const countText = (s: Pick<NodeState, 'checkedCount' | 'totalCount'>): string => `${s.checkedCount}/${s.totalCount}`;

/* ------------------------------------------------------------------------ */
/* 14-16: totals and the limit                                               */
/* ------------------------------------------------------------------------ */

/**
 * §20 #14, FL:42-55: sums over every checked leaf (hidden, admin-locked and
 * imported ones included); `rulesetCount` skips imported leaves.
 */
export function totals(
    leaves: readonly Pick<LeafEntry, 'id' | 'details' | 'isImported'>[],
    checked: ReadonlySet<string>,
): Totals {
    let rulesetCount = 0;
    let ruleCount = 0;
    let filterCount = 0;
    for (const leaf of leaves) {
        if (!checked.has(leaf.id)) continue;
        if (!leaf.isImported) rulesetCount += 1;
        const s = rulesetStats(leaf.details);
        ruleCount += s.ruleCount;
        filterCount += s.filterCount;
    }
    return { rulesetCount, ruleCount, filterCount };
}

/** §20 #15, FL:61-63: strict equality; never at the limit when `max` is not a number. */
export function isAtLimit(rulesetCount: number, max: number | null | undefined): boolean {
    return rulesetCount === max;
}

/** §20 #16, CSS:227-230: rows whose own checkbox is unchecked are locked at the limit. */
export const isRowLocked = (atLimit: boolean, ownChecked: boolean): boolean => atLimit && !ownChecked;

/* ------------------------------------------------------------------------ */
/* 17-20: hide unused                                                        */
/* ------------------------------------------------------------------------ */

/** §20 #17, FL:32,380-382: a stored array replaces the default; anything else keeps it. */
export function hideUnusedInit(stored: unknown): Set<string> {
    if (Array.isArray(stored)) return new Set(stored as string[]);
    return new Set(DEFAULT_HIDE_UNUSED);
}

/**
 * §20 #18, FL:364-376: flips membership of `nodeId` and returns the array to store
 * with `storage.local.set({ hideUnusedFilterLists: stored })` (whole set, insertion
 * order, any `'*'` kept as an opaque member, §7.4).
 */
export function toggleHideUnused(set: ReadonlySet<string>, nodeId: string): { set: Set<string>; stored: string[] } {
    const next = new Set(set);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return { set: next, stored: Array.from(next) };
}

/** Display state of a node: plain membership (FL:217, §7.4). */
export const isHideUnused = (set: ReadonlySet<string>, nodeId: string): boolean => set.has(nodeId);

/** §20 #19, CSS:164-166. A composite child is never `isDefault`. */
export const isHiddenByHideUnused = (parentHides: boolean, childIsDefault: boolean, childChecked: boolean): boolean =>
    parentHides && !childIsDefault && !childChecked;

/** §20 #20, CSS:167-169. */
export const isAdminHidden = (fromAdmin: boolean, ownChecked: boolean): boolean => fromAdmin && !ownChecked;

/* ------------------------------------------------------------------------ */
/* 21-23: search                                                             */
/* ------------------------------------------------------------------------ */

/** §20 #21, FL:404-409. The second element is a leaf's (absent) `data-nodeid`. */
export function searchHaystack(details: Pick<ListDetails, 'name' | 'group' | 'tags'>): string {
    return [details.name, undefined, details.group || '', details.tags || ''].join(' ').trim();
}

/** §20 #22, FL:396: literal, case-insensitive. */
export function searchRegex(pattern: string): RegExp {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** Search mode is on iff the raw (untrimmed) input is not empty (FL:393-395). */
export const isSearchMode = (pattern: string): boolean => pattern !== '';

export interface SearchResult {
    /** Matching leaf ids (admin-locked leaves skipped), display order. */
    leaves: Set<string>;
    /** Groups and composite nodes that contain at least one matching leaf. */
    nodes: Set<string>;
}

/**
 * §20 #23, FL:392-419, derived from state (D5, no stale classes). Imported leaves
 * are searched like any other (upstream); hiding them on Safari is the view's job (D6).
 * An empty pattern matches nothing (not in search mode).
 */
export function searchLeaves(
    tree: ListTree,
    pattern: string,
    adminRulesets: readonly unknown[] | undefined,
): SearchResult {
    const leaves = new Set<string>();
    const nodes = new Set<string>();
    if (!isSearchMode(pattern)) return { leaves, nodes };
    const re = searchRegex(pattern);
    for (const leaf of tree.leaves) {
        if (isLeafAdminLocked(leaf, adminRulesets)) continue;
        if (re.test(searchHaystack(leaf.details))) leaves.add(leaf.id);
    }
    const visit = (entries: readonly TreeEntry[]): boolean => {
        let any = false;
        for (const e of entries) {
            if (e.kind === 'leaf') {
                if (leaves.has(e.id)) any = true;
            } else if (visit(e.children)) {
                nodes.add(e.id);
                any = true;
            }
        }
        return any;
    };
    for (const g of tree.groups) if (visit(g.children)) nodes.add(g.id);
    return { leaves, nodes };
}

/* ------------------------------------------------------------------------ */
/* View derivation                                                           */
/* ------------------------------------------------------------------------ */

export interface ViewInput {
    tree: ListTree;
    checked: ReadonlySet<string>;
    adminRulesets?: readonly unknown[];
    maxNumberOfEnabledRulesets?: number | null;
    hideUnused: ReadonlySet<string>;
    /** Raw search input value. */
    search?: string;
    /** Options data `supportsCompiledFilters` (false on Safari, §12.1). */
    supportsCompiledFilters?: boolean;
    /**
     * Leaves kept visible under hide-unused although unchecked: imported lists flagged
     * for removal, so their undo stays reachable. DEVIATION without message impact:
     * upstream hides them like any unchecked list (settings.css hide-unused rule).
     */
    keepVisible?: ReadonlySet<string>;
}

/** Why a row is not displayed (first applicable reason), or `null` when displayed. */
export type HiddenReason = 'parent' | 'empty-group' | 'imported-unsupported' | 'hide-unused' | 'admin' | 'search' | null;

export interface LeafView {
    kind: 'leaf';
    entry: LeafEntry;
    id: string;
    checked: boolean;
    /** Admin-locked: checkbox disabled, never sent, never matched by search. */
    fromAdmin: boolean;
    /** Checkbox disabled (= fromAdmin for a leaf). */
    disabled: boolean;
    isDefault: boolean;
    isImported: boolean;
    /** Limit lock (pointer-only upstream, Q6). */
    locked: boolean;
    stats: RulesetStats;
    searchMatch: boolean;
    visible: boolean;
    hiddenReason: HiddenReason;
}

export interface CompositeView extends NodeState {
    kind: 'node';
    entry: CompositeEntry;
    id: string;
    name: string;
    disabled: boolean;
    hideUnused: boolean;
    locked: boolean;
    searchMatch: boolean;
    visible: boolean;
    hiddenReason: HiddenReason;
    children: (LeafView | CompositeView)[];
}

export interface GroupView extends NodeState {
    kind: 'group';
    entry: GroupEntry;
    id: GroupId;
    nameKey: string;
    hideUnused: boolean;
    searchMatch: boolean;
    visible: boolean;
    hiddenReason: HiddenReason;
    children: (LeafView | CompositeView)[];
}

export interface ListsView {
    groups: GroupView[];
    totals: Totals;
    atLimit: boolean;
    searchMode: boolean;
    /** Leaf ids displayed, in display order. */
    visibleLeafIds: string[];
    leafViews: ReadonlyMap<string, LeafView>;
}

/**
 * Everything the pane renders, derived from state (spec §3.1, §5-§8, §10, §11).
 *
 * Display rules (CSS:148-169, 227-241, 267-270):
 *   normal mode: an empty group other than `imported` is hidden; `imported` is hidden
 *   without compiled-filter support; under a hide-unused node, unchecked non-default
 *   direct children are hidden; an unchecked admin-locked row is hidden.
 *   search mode: only matching leaves and their ancestors are shown.
 * DEVIATION D6: the `imported` group stays hidden in search mode too when compiled
 * filters are unsupported (upstream reveals it, Q10).
 */
export function deriveListsView(input: ViewInput): ListsView {
    const { tree, checked, hideUnused } = input;
    const admin = input.adminRulesets ?? [];
    const pattern = input.search ?? '';
    const searchMode = isSearchMode(pattern);
    const search = searchLeaves(tree, pattern, admin);
    const adminIds = adminLockedIds(tree, admin);
    const isAdmin = (id: string): boolean => adminIds.has(id);
    const sums = totals(tree.leaves, checked);
    const atLimit = isAtLimit(sums.rulesetCount, input.maxNumberOfEnabledRulesets);
    const leafViews = new Map<string, LeafView>();
    const visibleLeafIds: string[] = [];
    const keep = input.keepVisible ?? new Set<string>();

    const children = (
        entries: readonly TreeEntry[],
        parentVisible: boolean,
        parentHides: boolean,
    ): (LeafView | CompositeView)[] =>
        entries.map((e) => {
            if (e.kind === 'leaf') {
                const on = checked.has(e.id);
                const fromAdmin = adminIds.has(e.id);
                const match = search.leaves.has(e.id);
                let hiddenReason: HiddenReason = null;
                if (!parentVisible) hiddenReason = 'parent';
                else if (searchMode) hiddenReason = match ? null : 'search';
                else if (isAdminHidden(fromAdmin, on)) hiddenReason = 'admin';
                else if (isHiddenByHideUnused(parentHides, e.isDefault, on || keep.has(e.id))) hiddenReason = 'hide-unused';
                const view: LeafView = {
                    kind: 'leaf',
                    entry: e,
                    id: e.id,
                    checked: on,
                    fromAdmin,
                    disabled: fromAdmin,
                    isDefault: e.isDefault,
                    isImported: e.isImported,
                    locked: isRowLocked(atLimit, on),
                    stats: rulesetStats(e.details),
                    searchMatch: match,
                    visible: hiddenReason === null,
                    hiddenReason,
                };
                if (!leafViews.has(e.id)) leafViews.set(e.id, view);
                if (view.visible) visibleLeafIds.push(e.id);
                return view;
            }
            const state = nodeState(e.leafIds, checked, isAdmin);
            const hides = isHideUnused(hideUnused, e.id);
            const match = search.nodes.has(e.id);
            let hiddenReason: HiddenReason = null;
            if (!parentVisible) hiddenReason = 'parent';
            else if (searchMode) hiddenReason = match ? null : 'search';
            else if (isAdminHidden(state.fromAdmin, state.checked)) hiddenReason = 'admin';
            else if (isHiddenByHideUnused(parentHides, false, state.checked)) hiddenReason = 'hide-unused';
            const visible = hiddenReason === null;
            return {
                kind: 'node',
                entry: e,
                id: e.id,
                name: e.name,
                ...state,
                disabled: state.fromAdmin,
                hideUnused: hides,
                locked: isRowLocked(atLimit, state.checked),
                searchMatch: match,
                visible,
                hiddenReason,
                children: children(e.children, visible, hides),
            };
        });

    const groups = tree.groups.map((g): GroupView => {
        const state = nodeState(g.leafIds, checked, isAdmin);
        const hides = isHideUnused(hideUnused, g.id);
        const match = search.nodes.has(g.id);
        let hiddenReason: HiddenReason = null;
        if (g.id === 'imported' && input.supportsCompiledFilters !== true) hiddenReason = 'imported-unsupported';
        else if (searchMode) hiddenReason = match ? null : 'search';
        else if (g.id !== 'imported' && g.children.length === 0) hiddenReason = 'empty-group';
        const visible = hiddenReason === null;
        return {
            kind: 'group',
            entry: g,
            id: g.id,
            nameKey: g.nameKey,
            ...state,
            // FL:79-80: updateNodes stops at the missing checkbox, so a root group never gets `fromAdmin`.
            fromAdmin: false,
            hideUnused: hides,
            searchMatch: match,
            visible,
            hiddenReason,
            children: children(g.children, visible, hides),
        };
    });

    return { groups, totals: sums, atLimit, searchMode, visibleLeafIds, leafViews };
}

/* ------------------------------------------------------------------------ */
/* 24-28, 30: commit                                                         */
/* ------------------------------------------------------------------------ */

/**
 * §20 #24, FL:429-438: every checked leaf, display order, admin-locked leaves
 * excluded, hidden and imported leaves included. Always a fresh string[].
 */
export function collectEnabled(
    leaves: readonly Pick<LeafEntry, 'id' | 'isImported'>[],
    checked: ReadonlySet<string>,
    adminRulesets: readonly unknown[] | undefined,
): string[] {
    const out: string[] = [];
    for (const leaf of leaves) {
        if (!checked.has(leaf.id)) continue;
        if (isLeafAdminLocked(leaf, adminRulesets)) continue;
        out.push(leaf.id);
    }
    return out;
}

/** §20 #25, dashboard.js:83-86. */
export function hashFromIterable(iter: Iterable<string> | null | undefined | false | 0 | ''): string {
    if (!iter) return '';
    return Array.from(iter).sort().join('\n');
}

/** §20 #26, FL:446-448. */
export function isModified(
    payload: Iterable<string>,
    serverEnabled: Iterable<string>,
    final = false,
    toRemove: readonly string[] = [],
): boolean {
    return hashFromIterable(payload) !== hashFromIterable(serverEnabled) || (final && toRemove.length !== 0);
}

/** §20 #27, FL:477-484: what to do when the 997 ms timer fires. */
export const commitTimerAction = (committing: boolean): 'rearm' | 'commit' => (committing ? 'rearm' : 'commit');

/** §20 #28, FL:466-471,449: upstream `beforeunload` (a pending timer loses the change, Q8). */
export const unloadAction = (timerPending: boolean, modified: boolean): 'none' | 'sendFinal' =>
    !timerPending && modified ? 'sendFinal' : 'none';

/** §20 #30, D8 (§9.3, Q16). */
export const afterCommitAction = (rereadSinceCommitStart: boolean): 'none' | 'reread' =>
    rereadSinceCommitStart ? 'none' : 'reread';

/** Payload of `bridge.applyRulesets(...)` (bridge adds `what: 'applyRulesets'`). */
export interface ApplyRulesetsPayload {
    enabledRulesets: string[];
    toRemove?: string[];
}

export interface CommitInput {
    tree: ListTree;
    checked: ReadonlySet<string>;
    adminRulesets?: readonly unknown[];
    /** Baseline of the last successful read (FL:446-447 `visuallyEnabledRulesets`). */
    serverEnabled: Iterable<string>;
    /** Unload-path commit (FL:466-471): adds `toRemove`, even when empty. */
    final?: boolean;
    /** Imported ids flagged for removal (non-Safari, §12.3). */
    toRemove?: readonly string[];
    /**
     * QUIRK Q5 option: compare against `serverEnabled` minus admin-locked ids, so an
     * admin-enabled ruleset does not cause a redundant re-send. Default false (upstream).
     */
    ignoreAdminInBaseline?: boolean;
}

export interface CommitPlan {
    /** The COMPLETE list to enable (never a delta), display order. */
    enabledRulesets: string[];
    /** Checked leaves left out because they are admin-locked. */
    excludedAdmin: string[];
    modified: boolean;
    /** What to pass to `bridge.applyRulesets`, or `null` when nothing must be sent. */
    payload: ApplyRulesetsPayload | null;
    /** Informational only (never sent): ids the commit turns on / off relative to the baseline. */
    delta: { enable: string[]; disable: string[] };
}

/**
 * FL:426-459 without side effects: the exact payload a commit sends now, or null.
 * The caller then calls startCommit(selection) (FL:440) whatever the result.
 */
export function planCommit(input: CommitInput): CommitPlan {
    const admin = input.adminRulesets ?? [];
    const enabledRulesets = collectEnabled(input.tree.leaves, input.checked, admin);
    const excludedAdmin = input.tree.leaves
        .filter((l) => input.checked.has(l.id) && isLeafAdminLocked(l, admin))
        .map((l) => l.id);
    const adminIds = adminLockedIds(input.tree, admin);
    let baseline = Array.from(input.serverEnabled);
    if (input.ignoreAdminInBaseline === true) baseline = baseline.filter((id) => !adminIds.has(id));
    const toRemove = input.final === true ? Array.from(input.toRemove ?? []) : [];
    const modified = isModified(enabledRulesets, baseline, input.final === true, toRemove);
    const sent = new Set(enabledRulesets);
    const base = new Set(baseline);
    const delta = {
        enable: enabledRulesets.filter((id) => !base.has(id)),
        disable: baseline.filter((id) => !sent.has(id) && !adminIds.has(id)),
    };
    let payload: ApplyRulesetsPayload | null = null;
    if (modified) {
        payload = input.final === true ? { enabledRulesets, toRemove } : { enabledRulesets };
    }
    return { enabledRulesets, excludedAdmin, modified, payload, delta };
}

/**
 * D1 (§14): what a page-hide flush sends. Same payload as the debounced commit
 * would send now; when a commit is still unsettled, compare against the list it
 * sent instead of the (possibly stale) baseline. `null` = send nothing.
 *
 * `toRemove` (imported lists flagged for removal, §12.3) turns it into upstream's
 * "final" unload commit (FL:466-471, 442-457): `{ enabledRulesets, toRemove }` is
 * sent even when no change is pending, because the flagged lists are only deleted
 * by that message. Without flagged lists (always the case on Safari, which has no
 * import UI) `toRemove` is never added and nothing is sent unless a change is
 * pending (D7). Unlike upstream, a pending change is not lost (Q8, D1).
 */
export function pageHideFlush(input: {
    tree: ListTree;
    checked: ReadonlySet<string>;
    adminRulesets?: readonly unknown[];
    serverEnabled: Iterable<string>;
    /** True while the 997 ms timer is pending (there is an unsent change). */
    timerPending: boolean;
    /** The `enabledRulesets` of an unsettled commit, if any. */
    inFlight?: readonly string[] | null;
    /** Imported ids flagged for removal; only ids that still have a row are sent. */
    toRemove?: readonly string[];
}): ApplyRulesetsPayload | null {
    const toRemove = (input.toRemove ?? []).filter((id) => input.tree.leafById.get(id)?.isImported === true);
    if (!input.timerPending && toRemove.length === 0) return null;
    const baseline = input.inFlight ?? input.serverEnabled;
    const plan = planCommit({
        tree: input.tree,
        checked: input.checked,
        adminRulesets: input.adminRulesets,
        serverEnabled: baseline,
        ...(toRemove.length !== 0 ? { final: true, toRemove } : {}),
    });
    return plan.payload;
}

/* ------------------------------------------------------------------------ */
/* Imported lists: removal flags (§12.3, FL:501-523)                         */
/* ------------------------------------------------------------------------ */

/** Imported ids flagged for removal, each with its checkbox state before the flag (FL:505). */
export type RemovalFlags = ReadonlyMap<string, boolean>;

/**
 * FL:501-511: the trash icon of an imported leaf. Remembers the checked state,
 * unchecks the leaf and marks it toggled (so the debounced commit disables it).
 * Not an imported leaf, or already flagged: unchanged.
 */
export function flagRemoval(
    selection: Selection,
    removing: RemovalFlags,
    leaf: Pick<LeafEntry, 'id' | 'isImported'> | undefined,
): { selection: Selection; removing: RemovalFlags } {
    if (leaf === undefined || !leaf.isImported || removing.has(leaf.id)) return { selection, removing };
    const next = new Map(removing);
    next.set(leaf.id, selection.checked.has(leaf.id));
    return { selection: toggleLeaf(selection, leaf.id, false), removing: next };
}

/** FL:513-523: the undo icon. Restores the remembered checked state and marks the leaf toggled. */
export function unflagRemoval(
    selection: Selection,
    removing: RemovalFlags,
    id: string,
): { selection: Selection; removing: RemovalFlags } {
    if (!removing.has(id)) return { selection, removing };
    const before = removing.get(id) === true;
    const next = new Map(removing);
    next.delete(id);
    return { selection: toggleLeaf(selection, id, before), removing: next };
}

/** Flags whose leaf is gone after a read are dropped (the row is removed, FL:331-333). */
export function pruneRemovalFlags(removing: RemovalFlags, tree: ListTree): RemovalFlags {
    let changed = false;
    const next = new Map<string, boolean>();
    for (const [id, before] of removing) {
        if (tree.leafById.get(id)?.isImported === true) next.set(id, before);
        else changed = true;
    }
    return changed ? next : removing;
}

/**
 * The only failure signal available after a commit (§9.5): compare what was sent
 * with the next successful read. Admin-locked ids are ignored (the background
 * forces them).
 */
export function commitMismatch(
    sent: readonly string[],
    serverEnabledAfter: ReadonlySet<string>,
    adminLocked: ReadonlySet<string> = new Set(),
): { notEnabled: string[]; unexpectedlyEnabled: string[] } {
    const sentSet = new Set(sent);
    return {
        notEnabled: sent.filter((id) => !serverEnabledAfter.has(id) && !adminLocked.has(id)),
        unexpectedlyEnabled: [...serverEnabledAfter].filter((id) => !sentSet.has(id) && !adminLocked.has(id)),
    };
}

/* ------------------------------------------------------------------------ */
/* 29: import URL (only with compiled-filter support, §12)                   */
/* ------------------------------------------------------------------------ */

/** §20 #29, FL:493 (note the `m` flag: any line may match). */
export function isValidImportUrl(url: string): boolean {
    return /^[a-z-]+:\/\/(?:\S+\/\S*|\/\S+)/m.test(url);
}

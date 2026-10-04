/**
 * Replays the scenarios recorded from the UPSTREAM pane
 * (tests/reference/filter-lists/upstream-reference.json, produced by
 * tests/reference/filter-lists/generate.mjs: unmodified PRISTINE dashboard.html in
 * headless Chrome with the project mock) on the pure model and compares, row by
 * row and step by step: tree order, depth, names and flags, counts, tri-state,
 * admin lock, isDefault, hide-unused, search matches, visibility, limit lock,
 * tooltips, links, totals line, `toggled` marks, the exact applyRulesets
 * messages and the hideUnusedFilterLists writes.
 *
 * Every place where the model differs from upstream on purpose is asserted
 * explicitly (`DEVIATION`), never silently skipped.
 */
import { describe, expect, it } from 'vitest';

import RULESET_DETAILS from '../../dev/fixtures/ruleset-details.json';
import EN from '../../dev/fixtures/locales/en.json';
import REF_JSON from '../../../tests/reference/filter-lists/upstream-reference.json';
import {
    applyServerRead,
    buildListTree,
    type CompositeEntry,
    type CompositeView,
    deriveListsView,
    emptySelection,
    flagImagePath,
    formatStats,
    hideUnusedInit,
    type LeafView,
    type ListDetails,
    type ListTree,
    planCommit,
    type Selection,
    splitFlags,
    startCommit,
    toggleHideUnused,
    toggleLeaf,
    toggleNode,
} from './filterLists';

/* ------------------------------------------------------------------------ */
/* Reference data                                                            */
/* ------------------------------------------------------------------------ */

type Cell = string | number | boolean | null;
interface Snapshot {
    totalsText: string;
    noMoreRuleset: boolean;
    searchMode: boolean;
    rows: Cell[][];
    names?: Array<Array<{ type: string; text?: string; cc?: string; src?: string }>>;
}
interface Call {
    api: string;
    msg?: { what: string; [k: string]: unknown };
    items?: Record<string, unknown>;
}
interface Step {
    step: { search?: string; leaf?: string; node?: string; hideUnused?: string; settle?: boolean; external?: string[] };
    snapshot?: Snapshot;
    calls: Call[];
}
interface ScenarioInput {
    details: 'real' | ListDetails[];
    enabled: string[] | 'ALL';
    admin: string[];
    max: number | null;
    supportsCompiledFilters: boolean;
    imported?: ListDetails[];
    hideUnusedStored?: unknown;
}
interface Scenario {
    input: ScenarioInput;
    initial: Snapshot;
    steps: Step[];
    pageErrors: string[];
}
interface Reference {
    rowColumns: string[];
    chrome: string;
    locales: Record<string, Record<string, Scenario>>;
}

const REF = REF_JSON as unknown as Reference;
const COLS = REF.rowColumns;
const STOCK = RULESET_DETAILS as unknown as ListDetails[];
const TEMPLATE = (EN as Record<string, { message: string }>).perRulesetStats.message;
const RU = '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList';

type Row = Record<string, Cell>;
const toRows = (snap: Snapshot): Row[] =>
    snap.rows.map((cells) => Object.fromEntries(COLS.map((c, i) => [c, cells[i]])) as Row);

/* ------------------------------------------------------------------------ */
/* Model replay                                                              */
/* ------------------------------------------------------------------------ */

interface State {
    tree: ListTree;
    details: ListDetails[];
    synthetic: boolean;
    enabled: string[];
    serverEnabled: Set<string>;
    selection: Selection;
    admin: string[];
    max: number | null;
    hideUnused: Set<string>;
    search: string;
    supports: boolean;
    locale: string;
}

function initState(sc: Scenario, locale: string): State {
    const synthetic = sc.input.details !== 'real';
    const details = synthetic ? (sc.input.details as ListDetails[]) : [...STOCK, ...(sc.input.imported ?? [])];
    const compare = new Intl.Collator(locale).compare;
    const tree = buildListTree(details, { compare });
    const enabled = sc.input.enabled === 'ALL' ? STOCK.map((d) => d.id) : sc.input.enabled;
    const { selection, serverEnabled } = applyServerRead(emptySelection(), tree, enabled);
    return {
        tree,
        details,
        synthetic,
        enabled,
        serverEnabled,
        selection,
        admin: sc.input.admin,
        max: sc.input.max,
        hideUnused: hideUnusedInit(sc.input.hideUnusedStored),
        search: '',
        supports: sc.input.supportsCompiledFilters,
        locale,
    };
}

/** What the (mock) background stores after applyRulesets (ruleset-manager.js:605-625). */
function backgroundApply(state: State, list: readonly string[]): string[] {
    if (state.synthetic) return state.enabled; // synthetic answers are verbatim, nothing changes
    const known = new Set(state.details.map((d) => d.id));
    const after = new Set(list.filter((id) => known.has(id)));
    for (const token of state.admin) {
        const id = token.slice(1);
        if (!known.has(id)) continue;
        if (token.startsWith('+')) after.add(id);
        if (token.startsWith('-')) after.delete(id);
    }
    return [...after];
}

function serverRead(state: State, enabled: string[]): void {
    state.enabled = enabled;
    const r = applyServerRead(state.selection, state.tree, enabled);
    state.selection = r.selection;
    state.serverEnabled = r.serverEnabled;
}

function view(state: State) {
    return deriveListsView({
        tree: state.tree,
        checked: state.selection.checked,
        adminRulesets: state.admin,
        maxNumberOfEnabledRulesets: state.max,
        hideUnused: state.hideUnused,
        search: state.search,
        supportsCompiledFilters: state.supports,
    });
}

const fmt = (locale: string) => (n: number) => n.toLocaleString(locale);

/** The model's rows, in the same columns and order as the upstream snapshot. */
function modelRows(state: State, withStatic: boolean): { rows: Row[]; names: unknown[]; totalsText: string; atLimit: boolean; searchMode: boolean } {
    const v = view(state);
    const rows: Row[] = [];
    const names: unknown[] = [];
    const segs = (text: string) =>
        splitFlags(text).map((s) => (s.type === 'flag' ? { type: 'flag', cc: s.cc, src: flagImagePath(s.cc) } : s));
    const visit = (items: (LeafView | CompositeView)[], parentId: string) => {
        for (const item of items) {
            if (item.kind === 'leaf') {
                const d = item.entry.details;
                rows.push({
                    role: 'leaf', id: item.id, depth: item.entry.depth, parentId, count: null,
                    checked: item.checked, partial: false, disabled: item.disabled,
                    fromAdmin: item.fromAdmin, isDefault: item.isDefault, hideUnused: false,
                    searchMatch: item.searchMatch, toggled: state.selection.toggled.has(item.id),
                    visible: item.visible, pointerNone: item.locked,
                    title: withStatic ? formatStats(TEMPLATE, item.stats, fmt(state.locale)) : null,
                    href: withStatic ? (d.homeURL ? d.homeURL : '#') : null,
                    imported: item.isImported,
                });
                names.push(segs(d.name));
            } else {
                rows.push({
                    role: 'node', id: item.id, depth: item.entry.depth, parentId, count: `${item.checkedCount}/${item.totalCount}`,
                    checked: item.checked, partial: item.partial, disabled: item.disabled,
                    fromAdmin: item.fromAdmin, isDefault: false, hideUnused: item.hideUnused,
                    searchMatch: item.searchMatch, toggled: false, visible: item.visible, pointerNone: item.locked,
                    title: null, href: null, imported: null,
                });
                names.push(segs(item.name));
                visit(item.children, item.id);
            }
        }
    };
    for (const g of v.groups) {
        rows.push({
            role: 'rootnode', id: g.id, depth: 0, parentId: null, count: `${g.checkedCount}/${g.totalCount}`,
            checked: null, partial: null, disabled: null,
            fromAdmin: g.fromAdmin, isDefault: false, hideUnused: g.hideUnused,
            searchMatch: g.searchMatch, toggled: false, visible: g.visible, pointerNone: false,
            title: null, href: null, imported: null,
        });
        names.push([{ type: 'text', text: (EN as Record<string, { message: string }>)[g.nameKey].message }]);
        visit(g.children, g.id);
    }
    return {
        rows,
        names,
        totalsText: formatStats(TEMPLATE, v.totals, fmt(state.locale)),
        atLimit: v.atLimit,
        searchMode: v.searchMode,
    };
}

interface Deviation {
    /** Upstream rows rewritten before comparing (documented quirk). */
    mapUpstream?: (row: Row) => Row;
    /** Columns not compared for a row (documented quirk); the model value is checked by `check`. */
    skip?: (row: Row, state: State) => string[];
}

const DEVIATIONS: Record<string, Deviation> = {
    // Q2 row 2: upstream re-keys the promoted node under "undefined"; the model keeps "B".
    'synthetic-q2-row2-two-under-two-segment': {
        mapUpstream: (r) => ({ ...r, id: r.id === 'undefined' ? 'B' : r.id, parentId: r.parentId === 'undefined' ? 'B' : r.parentId }),
    },
    // Missing rules.regex: upstream tooltip says "NaN rules", the model counts the missing number as 0.
    'synthetic-totals-missing-numbers': {
        skip: (r) => (r.id === 't2' ? ['title'] : []),
    },
};

function compareSnapshot(label: string, upstream: Snapshot, state: State, withStatic: boolean, scenario: string, stepIndex: number): void {
    const m = modelRows(state, withStatic);
    const dev = DEVIATIONS[scenario] ?? {};
    const up = toRows(upstream).map(dev.mapUpstream ?? ((r) => r));
    expect(m.rows.map((r) => `${r.role}:${r.id}`), `${label} row order`).toEqual(up.map((r) => `${r.role}:${r.id}`));
    expect(m.totalsText, `${label} totals line`).toBe(upstream.totalsText);
    expect(m.atLimit, `${label} noMoreRuleset`).toBe(upstream.noMoreRuleset);
    expect(m.searchMode, `${label} searchMode`).toBe(upstream.searchMode);
    up.forEach((u, i) => {
        const r = m.rows[i];
        const skip = new Set(dev.skip?.(u, state) ?? []);
        // Upstream never clears `searchMatch` when the search is emptied (FL:394-395): only meaningful in search mode.
        if (!upstream.searchMode) skip.add('searchMatch');
        if (!withStatic) {
            skip.add('title');
            skip.add('href');
        }
        // DEVIATION D6 (Q10): on Safari the imported group and its rows stay hidden in search mode too.
        const importedRow = r.id === 'imported' || r.imported === true;
        if (upstream.searchMode && !state.supports && importedRow) {
            skip.add('visible');
            expect(r.visible, `${label} ${r.id} D6 hidden`).toBe(false);
        }
        // QUIRK Q4 / DEVIATION D5: upstream evaluates group headers before clearing a nested node's
        // stale match (FL:414-418), so a header can stay "matching" with nothing visible below it.
        // The model derives matches from state.
        if (upstream.searchMode && u.role === 'rootnode' && u.searchMatch === true && r.searchMatch === false) {
            const below = up.filter((x) => x.role === 'leaf' && x.visible === true && x.depth !== 0);
            const under = new Set<string>([String(u.id)]);
            for (const x of up) if (x.parentId !== null && under.has(String(x.parentId))) under.add(String(x.id));
            expect(below.filter((x) => under.has(String(x.id))), `${label} Q4 header has no visible leaf`).toEqual([]);
            expect(up.some((x) => x.role === 'node' && under.has(String(x.id))), `${label} Q4 needs a composite node`).toBe(true);
            skip.add('searchMatch');
            skip.add('visible');
        }
        // §7.4: with '*' in the stored set, upstream's toggle sets the class with `had === hasStar`
        // while renders use membership; the model always uses membership.
        if (scenario === 'hide-unused-stored-star' && stepIndex >= 0) {
            skip.add('hideUnused');
            skip.add('visible');
            expect(r.hideUnused, `${label} ${r.id} plain membership`).toBe(r.role === 'leaf' ? false : state.hideUnused.has(String(r.id)));
        }
        for (const c of COLS) {
            if (skip.has(c)) continue;
            expect(r[c], `${label} row ${i} ${u.role}:${u.id} column ${c}`).toEqual(u[c]);
        }
    });
    if (withStatic && upstream.names) {
        upstream.names.forEach((n, i) => {
            expect(m.names[i], `${label} name of row ${i}`).toEqual(n);
        });
    }
}

const applyCalls = (calls: Call[]) => calls.filter((c) => c.api === 'runtime.sendMessage' && c.msg?.what === 'applyRulesets').map((c) => c.msg);
const storageWrites = (calls: Call[]) => calls.filter((c) => c.api === 'storage.local.set').map((c) => c.items);

function replay(name: string, sc: Scenario, locale: string): void {
    const state = initState(sc, locale);
    compareSnapshot(`${name} initial`, sc.initial, state, true, name, -1);
    sc.steps.forEach((s, i) => {
        const label = `${name} step ${i} ${JSON.stringify(s.step)}`;
        const st = s.step;
        let expectedApply: unknown[] = [];
        let expectedWrites: unknown[] = [];
        if (st.search !== undefined) {
            state.search = st.search;
        } else if (st.leaf !== undefined) {
            state.selection = toggleLeaf(state.selection, st.leaf);
        } else if (st.node !== undefined) {
            state.selection = toggleNode(state.selection, state.tree.nodeById.get(st.node) as CompositeEntry);
        } else if (st.hideUnused !== undefined) {
            const r = toggleHideUnused(state.hideUnused, st.hideUnused);
            state.hideUnused = r.set;
            expectedWrites = [{ hideUnusedFilterLists: r.stored }];
        } else if (st.external !== undefined) {
            serverRead(state, backgroundApply(state, st.external));
        } else if (st.settle) {
            const plan = planCommit({
                tree: state.tree,
                checked: state.selection.checked,
                adminRulesets: state.admin,
                serverEnabled: state.serverEnabled,
            });
            state.selection = startCommit(state.selection);
            if (plan.payload !== null) {
                expectedApply = [{ what: 'applyRulesets', ...plan.payload }];
                serverRead(state, backgroundApply(state, plan.payload.enabledRulesets));
                // Upstream order: the commit, then the echo-driven re-read pair (spec §9.3).
                expect(s.calls.filter((c) => c.api === 'runtime.sendMessage').map((c) => c.msg?.what), label).toEqual([
                    'applyRulesets',
                    'getEnabledRulesets',
                    'getRulesetDetails',
                ]);
            }
        }
        if (st.external === undefined) {
            expect(applyCalls(s.calls), `${label} applyRulesets`).toEqual(expectedApply);
            expect(storageWrites(s.calls), `${label} storage writes`).toEqual(expectedWrites);
            if (!st.settle) {
                // A change sends nothing immediately (spec §19 item 17); search sends nothing (item 16).
                expect(s.calls.filter((c) => c.api === 'runtime.sendMessage'), label).toEqual([]);
            }
        }
        if (s.snapshot) compareSnapshot(label, s.snapshot, state, false, name, i);
    });
}

/* ------------------------------------------------------------------------ */
/* Tests                                                                     */
/* ------------------------------------------------------------------------ */

describe('reference data', () => {
    it('was recorded for the expected scenarios', () => {
        const en = REF.locales['en-US'];
        expect(Object.keys(en).length).toBeGreaterThanOrEqual(30);
        expect(REF.locales['cs-CZ']).toBeDefined();
        // Sanity: the recorded first render is the one of spec §3.4 / §5.
        expect(en.default.initial.totalsText).toBe('113,615 rules, converted from 121,437 network filters');
        expect(toRows(en.default.initial).filter((r) => r.role === 'leaf')).toHaveLength(51);
    });

    it('upstream throws on a lonely two-segment parent (Q2 row 1); the model does not and promotes the leaf', () => {
        const sc = REF.locales['en-US']['synthetic-q2-row1-single-two-segment'];
        expect(sc.pageErrors.join('\n')).toMatch(/TypeError/);
        const tree = buildListTree(sc.input.details as ListDetails[]);
        const ads = tree.groups.find((g) => g.id === 'ads')!;
        expect(ads.children.map((c) => [c.kind, c.id])).toEqual([['leaf', 'x']]);
    });
});

for (const [locale, scenarios] of Object.entries(REF.locales)) {
    describe(`upstream replay, locale ${locale}`, () => {
        for (const [name, sc] of Object.entries(scenarios)) {
            if (sc.pageErrors.length !== 0) continue; // only Q2 row 1, asserted above
            it(name, () => {
                replay(name, sc, locale);
            });
        }
    });
}

describe('replay sanity', () => {
    it('the RU node exists in the real tree (scenario steps address it by id)', () => {
        const state = initState(REF.locales['en-US'].default, 'en-US');
        expect(state.tree.nodeById.get(RU)?.kind).toBe('node');
    });
});

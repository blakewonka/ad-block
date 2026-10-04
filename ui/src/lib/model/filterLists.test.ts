/**
 * src/lib/model/filterLists.ts against docs/specs/filter-lists.md §20 (every test
 * vector of the table), the real ruleset-details.json (byte copy of PRISTINE in
 * src/dev/fixtures) and hand-made edge cases. The upstream-run comparison lives in
 * filterLists.reference.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import RULESET_DETAILS from '../../dev/fixtures/ruleset-details.json';
import { groupNameKey as i18nGroupNameKey } from '../i18n';
import { DEFAULT_HIDE_UNUSED_FILTER_LISTS } from '../storage';
import {
    adminLockedIds,
    afterCommitAction,
    applyServerRead,
    buildListTree,
    buildRawTree,
    collectEnabled,
    COMMIT_DEBOUNCE_MS,
    commitMismatch,
    commitTimerAction,
    type CompositeEntry,
    computeServerEnabled,
    countText,
    DEFAULT_HIDE_UNUSED,
    deriveListsView,
    emptySelection,
    enabledWithoutRow,
    flagImagePath,
    flagRemoval,
    flattenLeaves,
    formatStats,
    GROUP_IDS,
    groupNameKey,
    groupOf,
    groupRulesets,
    hashFromIterable,
    hideUnusedInit,
    isAdminHidden,
    isAdminRuleset,
    isAtLimit,
    isHiddenByHideUnused,
    isModified,
    isRawNode,
    isRowLocked,
    isSearchMode,
    isValidImportUrl,
    type ListDetails,
    type ListTree,
    mergeServerState,
    nodeState,
    nodeToggleTarget,
    pageHideFlush,
    planCommit,
    promoteLonelySublist,
    pruneRemovalFlags,
    type RawNode,
    rulesetStats,
    searchHaystack,
    searchLeaves,
    searchRegex,
    sortEntries,
    sortKey,
    splitFlags,
    startCommit,
    toggleHideUnused,
    toggleLeaf,
    toggleNode,
    totals,
    UNICODE_FLAG_TO_CC,
    unflagRemoval,
    unloadAction,
    walkTree,
} from './filterLists';

const DETAILS = RULESET_DETAILS as unknown as ListDetails[];
const byId = new Map(DETAILS.map((d) => [d.id, d]));
const D = (id: string): ListDetails => byId.get(id)!;
const EN: (a: string, b: string) => number = new Intl.Collator('en-US').compare;
const TREE = buildListTree(DETAILS, { compare: EN });
const DEFAULTS = ['ublock-filters', 'easylist', 'easyprivacy'];
const RU = '🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList';
const TEMPLATE = '{{ruleCount}} rules, converted from {{filterCount}} network filters';
const enUS = (n: number) => n.toLocaleString('en-US');

const rec = (id: string, extra: Partial<ListDetails> = {}): ListDetails => ({
    id,
    name: `List ${id}`,
    enabled: false,
    homeURL: `https://example.org/${id}`,
    filters: { total: 2, accepted: 2, rejected: 0 },
    rules: { total: 1, plain: 1, regex: 0 },
    ...extra,
});
const IMPORTED = rec('https://example.com/list.txt', {
    name: 'My imported list',
    group: 'imported',
    enabled: true,
    homeURL: '',
    filters: { total: 11, accepted: 11, rejected: 0 },
    rules: { total: 9, plain: 7, regex: 2 },
});

/** Upstream-shaped raw tree as plain data: leaves become their id. */
const rawShape = (n: RawNode | ListDetails): unknown =>
    isRawNode(n) ? Object.fromEntries(Object.entries(n.lists).map(([k, v]) => [k, rawShape(v)])) : n.id;

/** Sorted typed tree as plain data. */
const treeShape = (tree: ListTree): Record<string, unknown[]> => {
    const conv = (e: ListTree['groups'][number]['children'][number]): unknown =>
        e.kind === 'leaf' ? e.id : { [e.id]: e.children.map(conv) };
    return Object.fromEntries(tree.groups.map((g) => [g.id, g.children.map(conv)]));
};

/* ======================================================================== */

describe('module purity', () => {
    it('imports nothing and touches no DOM or browser global', () => {
        const src = readFileSync(path.resolve(process.cwd(), 'src/lib/model/filterLists.ts'), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code).not.toMatch(/^\s*import\s/m);
        expect(code).not.toMatch(/\b(window|document|browser|chrome|localStorage|sessionStorage|setTimeout|fetch)\b/);
    });
});

describe('constants', () => {
    it('match upstream and the storage module', () => {
        expect(GROUP_IDS).toEqual(['default', 'ads', 'privacy', 'malware', 'annoyances', 'misc', 'regions', 'imported']);
        expect(DEFAULT_HIDE_UNUSED).toEqual(['ads', 'regions', 'imported']);
        expect(DEFAULT_HIDE_UNUSED).toEqual(DEFAULT_HIDE_UNUSED_FILTER_LISTS);
        expect(COMMIT_DEBOUNCE_MS).toBe(997);
    });
});

describe('#1 rulesetStats', () => {
    it.each([
        ['ublock-filters', 6913, 10703],
        ['easylist', 50512, 54506],
        ['easyprivacy', 56190, 56228],
        ['ublock-experimental', 0, 0],
        ['ubol-tests', 17, 10],
        ['deu-0', 2194, 2314],
        ['rus-0', 17148, 19827],
        ['rus-1', 1413, 1554],
    ])('%s -> %i / %i', (id, ruleCount, filterCount) => {
        expect(rulesetStats(D(id))).toEqual({ ruleCount, filterCount });
    });

    it('rule count equals rules.total for every real record (spec §1.3)', () => {
        for (const d of DETAILS) expect(rulesetStats(d).ruleCount).toBe((d.rules as { total: number }).total);
    });

    it('DEVIATION: missing numbers count as 0 instead of NaN / throwing', () => {
        expect(rulesetStats({ id: 'x', name: 'x' })).toEqual({ ruleCount: 0, filterCount: 0 });
        expect(rulesetStats(rec('y', { rules: { total: 5, plain: 5 } }))).toEqual({ ruleCount: 5, filterCount: 2 });
    });
});

describe('#2 formatStats', () => {
    it('en-US, ublock-filters', () => {
        expect(formatStats(TEMPLATE, rulesetStats(D('ublock-filters')), enUS)).toBe(
            '6,913 rules, converted from 10,703 network filters',
        );
    });
    it('replaces only the first occurrence of each placeholder', () => {
        expect(formatStats('{{ruleCount}} {{ruleCount}} {{filterCount}} {{filterCount}}', { ruleCount: 1, filterCount: 2 })).toBe(
            '1 {{ruleCount}} 2 {{filterCount}}',
        );
    });
    it('a formatter output with `$&` stays literal', () => {
        expect(formatStats('{{ruleCount}}|{{filterCount}}', { ruleCount: 1, filterCount: 2 }, (n) => `$&${n}`)).toBe('$&1|$&2');
    });
    it('default formatter is toLocaleString()', () => {
        expect(formatStats('{{ruleCount}}', { ruleCount: 1234567, filterCount: 0 })).toBe((1234567).toLocaleString());
    });
});

describe('#3 groupRulesets / groupOf', () => {
    it('real file: 8 groups in order with sizes 3,1,1,0,7,2,37,0; nothing left out', () => {
        const groups = groupRulesets(DETAILS);
        expect(groups.map(([id]) => id)).toEqual([...GROUP_IDS]);
        expect(groups.map(([, l]) => l.length)).toEqual([3, 1, 1, 0, 7, 2, 37, 0]);
        expect(groups.flatMap(([, l]) => l.map((d) => d.id)).sort()).toEqual(DETAILS.map((d) => d.id).sort());
        expect(groups[5][1].map((d) => d.id)).toEqual(['ublock-experimental', 'ubol-tests']);
    });
    it('members keep input order', () => {
        expect(groupRulesets(DETAILS)[0][1].map((d) => d.id)).toEqual(['ublock-filters', 'easylist', 'easyprivacy']);
    });
    it('unknown group, or no group with a string lang: no group at all', () => {
        expect(groupOf(rec('a', { group: 'x' }))).toBeUndefined();
        expect(groupOf(rec('b', { lang: 'de' }))).toBeUndefined();
        expect(groupOf(rec('c', { lang: '' }))).toBeUndefined();
        expect(groupOf(rec('d'))).toBe('misc');
        expect(groupOf(rec('e', { group: 'misc' }))).toBeUndefined(); // only group === undefined is misc
        const groups = groupRulesets([rec('a', { group: 'x' }), rec('b', { lang: 'de' })]);
        expect(groups.every(([, l]) => l.length === 0)).toBe(true);
    });
});

describe('#4 groupNameKey', () => {
    it('upstream key form, same as src/lib/i18n.tsx', () => {
        expect(groupNameKey('default')).toBe('3pGroupDefault');
        expect(groupNameKey('regions')).toBe('3pGroupRegions');
        for (const id of GROUP_IDS) expect(groupNameKey(id)).toBe(i18nGroupNameKey(id));
        expect(TREE.groups.map((g) => g.nameKey)).toEqual(GROUP_IDS.map((id) => groupNameKey(id)));
    });
});

describe('#5 buildRawTree / promoteLonelySublist', () => {
    it('real file: regions has 36 children, one of them the RU node with rus-0, rus-1; pol-0 promoted', () => {
        const raw = buildRawTree(DETAILS);
        const regions = raw.regions.lists;
        expect(Object.keys(regions)).toHaveLength(36);
        expect(rawShape(regions[RU] as RawNode)).toEqual({ 'rus-0': 'rus-0', 'rus-1': 'rus-1' });
        expect((regions['pol-0'] as ListDetails).id).toBe('pol-0');
        expect(regions['🇵🇱pl: Polskie listy filtrów']).toBeUndefined();
        // promoted pol-0 is appended after the other keys (FL:320-321)
        expect(Object.keys(regions).at(-1)).toBe('pol-0');
    });
    it('synthetic: x, y with parent A give node A; x alone with parent A gives a direct leaf', () => {
        expect(rawShape(buildRawTree([rec('x', { group: 'ads', parent: 'A' }), rec('y', { group: 'ads', parent: 'A' })]).ads)).toEqual({
            A: { x: 'x', y: 'y' },
        });
        expect(rawShape(buildRawTree([rec('x', { group: 'ads', parent: 'A' })]).ads)).toEqual({ x: 'x' });
    });
    it('Q2 table (multi-segment parents): no throw; rows 3-5 as upstream, rows 1-2 deliberately different', () => {
        const ads = (records: ListDetails[]) => rawShape(buildRawTree(records).ads);
        // row 1: upstream throws TypeError; here x is promoted to a direct leaf
        expect(ads([rec('x', { group: 'ads', parent: 'A|B' })])).toEqual({ x: 'x' });
        // row 2: upstream stores the node under "undefined"; here it keeps its key B
        expect(ads([rec('x', { group: 'ads', parent: 'A|B' }), rec('y', { group: 'ads', parent: 'A|B' })])).toEqual({ B: { x: 'x', y: 'y' } });
        // row 3
        expect(ads([rec('x', { group: 'ads', parent: 'A' }), rec('y', { group: 'ads', parent: 'A|B' })])).toEqual({ A: { x: 'x', y: 'y' } });
        // row 4
        expect(ads([rec('x', { group: 'ads', parent: 'A|B' }), rec('y', { group: 'ads', parent: 'A|C' })])).toEqual({ A: { x: 'x', y: 'y' } });
        // row 5
        expect(
            ads([
                rec('x', { group: 'ads', parent: 'A|B' }),
                rec('y', { group: 'ads', parent: 'A|B' }),
                rec('z', { group: 'ads', parent: 'A|C' }),
                rec('w', { group: 'ads', parent: 'A|C' }),
            ]),
        ).toEqual({ A: { B: { x: 'x', y: 'y' }, C: { z: 'z', w: 'w' } } });
    });
    it('three-level chain with one leaf collapses to the leaf', () => {
        expect(rawShape(buildRawTree([rec('x', { group: 'ads', parent: 'A|B|C' })]).ads)).toEqual({ x: 'x' });
    });
    it('root groups are never replaced, even with one child', () => {
        const raw = buildRawTree([rec('only', { group: 'privacy' })]);
        expect(promoteLonelySublist(raw.privacy)).toBe(raw.privacy);
        expect(rawShape(raw.privacy)).toEqual({ only: 'only' });
    });
    it('keys that collide with Object.prototype members are plain keys', () => {
        const raw = buildRawTree([
            rec('toString', { group: 'ads' }),
            rec('a', { group: 'ads', parent: 'constructor' }),
            rec('b', { group: 'ads', parent: 'constructor' }),
            rec('__proto__', { group: 'ads' }),
        ]);
        expect(rawShape(raw.ads)).toEqual({ toString: 'toString', constructor: { a: 'a', b: 'b' }, ['__proto__']: '__proto__' });
    });
    it('a duplicate id keeps the first position and the last record', () => {
        const raw = buildRawTree([rec('d', { group: 'ads', name: 'first' }), rec('e', { group: 'ads' }), rec('d', { group: 'ads', name: 'second' })]);
        expect(Object.keys(raw.ads.lists)).toEqual(['d', 'e']);
        expect((raw.ads.lists.d as ListDetails).name).toBe('second');
    });
    it('all 8 groups always exist, empty ones included', () => {
        const tree = buildListTree([]);
        expect(tree.groups.map((g) => [g.id, g.children.length])).toEqual(GROUP_IDS.map((id) => [id, 0]));
        expect(tree.leaves).toEqual([]);
    });
});

describe('#6 sortKey', () => {
    it.each([
        ['rus-0', 'rus-'],
        ['jpn-1', 'jpn-'],
        ['annoyances-ai', 'annoyances-ai'],
        [RU, 'ru ua uz kz: RU AdList'],
        ['a#b*c9', 'abc'],
    ])('%s -> %s', (key, out) => {
        expect(sortKey(key)).toBe(out);
    });
    it('title wins over the key when truthy', () => {
        expect(sortKey('zzz', { title: 'aaa1' })).toBe('aaa');
        expect(sortKey('zzz', { title: '' })).toBe('zzz');
        expect(sortKey('zzz', {})).toBe('zzz');
    });
});

describe('#7 sortEntries / #5 buildListTree order', () => {
    const SPEC_ORDER = {
        default: ['easylist', 'easyprivacy', 'ublock-filters'],
        ads: ['adguard-mobile'],
        privacy: ['block-lan'],
        malware: [],
        annoyances: [
            'annoyances-ai', 'annoyances-cookies', 'annoyances-notifications', 'annoyances-others',
            'annoyances-overlays', 'annoyances-social', 'annoyances-widgets',
        ],
        misc: ['ublock-experimental', 'ubol-tests'],
        regions: [
            'alb-0', 'ara-0', 'bgr-0', 'chn-0', 'cze-0', 'deu-0', 'est-0', 'fin-0', 'fra-0', 'grc-0', 'hrv-0', 'hun-0',
            'idn-0', 'ind-0', 'irn-0', 'isl-0', 'isr-0', 'ita-0', 'jpn-1', 'kor-1', 'ltu-0', 'lva-0', 'mkd-0', 'nld-0',
            'nor-0', 'pol-0', 'rou-1', { [RU]: ['rus-0', 'rus-1'] }, 'spa-0', 'spa-1', 'svn-0', 'swe-1', 'tha-0',
            'tur-0', 'ukr-0', 'vie-1',
        ],
        imported: [],
    };
    it('real file, en: equals the JSON of spec §3.4', () => {
        expect(treeShape(TREE)).toEqual(SPEC_ORDER);
    });
    it('real file, cs: chn-0 comes after hun-0', () => {
        const cs = flattenLeaves(buildListTree(DETAILS, { compare: new Intl.Collator('cs').compare }));
        expect(cs.indexOf('chn-0')).toBeGreaterThan(cs.indexOf('hun-0'));
    });
    it('preferred first, then by sortKey, stable for equal keys', () => {
        const sorted = sortEntries(
            [
                ['spa-1', {}],
                ['b', {}],
                ['spa-0', {}],
                ['z', { preferred: true }],
                ['a', { title: 'c' }],
                ['y', { preferred: true }],
            ],
            EN,
        ).map(([k]) => k);
        expect(sorted).toEqual(['y', 'z', 'b', 'a', 'spa-1', 'spa-0']); // preferred ones sorted among themselves
    });
    it('does not mutate its input', () => {
        const input: [string, object][] = [['b', {}], ['a', {}]];
        sortEntries(input, EN);
        expect(input.map(([k]) => k)).toEqual(['b', 'a']);
    });
    it('root groups are never sorted', () => {
        expect(buildListTree([rec('z', { group: 'imported' }), rec('a', { group: 'ads' })]).groups.map((g) => g.id)).toEqual([...GROUP_IDS]);
    });
});

describe('#8 flattenLeaves / tree indexes', () => {
    it('51 ids in display order', () => {
        const ids = flattenLeaves(TREE);
        expect(ids).toHaveLength(51);
        expect(ids.slice(0, 6)).toEqual(['easylist', 'easyprivacy', 'ublock-filters', 'adguard-mobile', 'block-lan', 'annoyances-ai']);
        const i = ids.indexOf('rou-1');
        expect(ids.slice(i, i + 5)).toEqual(['rou-1', 'rus-0', 'rus-1', 'spa-0', 'spa-1']);
        expect(ids.slice(-3)).toEqual(['tur-0', 'ukr-0', 'vie-1']);
    });
    it('leaf entries carry depth, group, isDefault, isImported', () => {
        expect(TREE.leaves.filter((l) => l.isDefault).map((l) => l.id)).toEqual(['easylist', 'easyprivacy', 'ublock-filters']);
        expect(TREE.leafById.get('rus-0')).toMatchObject({ depth: 2, groupId: 'regions', isImported: false });
        expect(TREE.leafById.get('pol-0')).toMatchObject({ depth: 1, groupId: 'regions' });
        const withImported = buildListTree([...DETAILS, IMPORTED], { compare: EN });
        expect(withImported.leaves.at(-1)).toMatchObject({ id: IMPORTED.id, isImported: true, isDefault: false, groupId: 'imported' });
    });
    it('composite and group leafIds; nodeById; walkTree order', () => {
        const node = TREE.nodeById.get(RU) as CompositeEntry;
        expect(node).toMatchObject({ kind: 'node', name: RU, depth: 1, leafIds: ['rus-0', 'rus-1'] });
        expect(TREE.groups.map((g) => g.leafIds.length)).toEqual([3, 1, 1, 0, 7, 2, 37, 0]);
        const walked = [...walkTree(TREE)];
        expect(walked).toHaveLength(8 + 1 + 51);
        expect(walked.filter((e) => e.kind === 'leaf').map((e) => e.id)).toEqual(flattenLeaves(TREE));
        expect(TREE.detailsById.size).toBe(51);
    });
    it('records without a row stay in detailsById but not in the tree', () => {
        const tree = buildListTree([rec('a', { group: 'x' }), rec('b', { group: 'ads' })]);
        expect(flattenLeaves(tree)).toEqual(['b']);
        expect(tree.detailsById.has('a')).toBe(true);
        expect(enabledWithoutRow(['a', 'b'], tree)).toEqual(['a']);
    });
});

describe('#9 splitFlags', () => {
    it('EasyList Germany', () => {
        expect(splitFlags('🇩🇪de 🇨🇭ch 🇦🇹at: EasyList Germany')).toEqual([
            { type: 'flag', cc: 'de', emoji: '🇩🇪' },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'de ' },
            { type: 'flag', cc: 'ch', emoji: '🇨🇭' },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'ch ' },
            { type: 'flag', cc: 'at', emoji: '🇦🇹' },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'at: EasyList Germany' },
        ]);
    });
    it('plain text is one segment; empty string no segment; unknown flag stays text', () => {
        expect(splitFlags('EasyList')).toEqual([{ type: 'text', text: 'EasyList' }]);
        expect(splitFlags('')).toEqual([]);
        expect(splitFlags('🇺🇸us')).toEqual([{ type: 'text', text: '🇺🇸us' }]);
    });
    it('flag map: 63 entries, image path', () => {
        expect(UNICODE_FLAG_TO_CC.size).toBe(63);
        expect(flagImagePath('de')).toBe('/img/flags-of-the-world/de.png');
    });
    it('every flag in the real names is known (59 distinct), no regional indicator left in text', () => {
        const ccs = new Set<string>();
        for (const d of DETAILS) {
            for (const s of splitFlags(d.name)) {
                if (s.type === 'flag') ccs.add(s.cc);
                else expect(s.text).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
            }
        }
        expect(ccs.size).toBe(59);
    });
    // PRISTINE js/i18n.js is a plain copy of upstream src/js/i18n.js (tools/make-mv3.sh).
    const I18N_JS = path.resolve(process.cwd(), '../upstream/src/js/i18n.js');
    it.runIf(existsSync(I18N_JS))('map equals the one in upstream js/i18n.js (= PRISTINE js/i18n.js)', () => {
        const src = readFileSync(I18N_JS, 'utf8');
        const pairs = [...src.matchAll(/\[\s*'([^']+)',\s*'([a-z]{2})'\s*\]/g)].map((m) => [m[1], m[2]]);
        expect(pairs).toEqual([...UNICODE_FLAG_TO_CC.entries()]);
    });
});

describe('#10 isAdminRuleset', () => {
    it.each([
        ['easylist', ['+easylist'], true],
        ['easylist', ['-easylist'], true],
        ['easylist', ['easylist'], true],
        ['easylist', ['+easylist-extra'], true],
        ['easylist', ['+xeasylist'], false],
        ['easylist', ['xeasylist'], false],
        ['easylist', [], false],
        ['spa-0', ['+spa-1'], false],
        ['easylist', ['*easylist'], false],
        ['easylist', undefined, false],
        ['easylist', [42, null, '+easylist'], true],
    ] as [string, unknown[] | undefined, boolean][])('(%s, %j) -> %s', (id, tokens, out) => {
        expect(isAdminRuleset(id, tokens)).toBe(out);
    });
    it('no real id is a prefix of another: prefix test == equality on shipped data', () => {
        for (const a of DETAILS) {
            for (const b of DETAILS) {
                expect(isAdminRuleset(a.id, [`+${b.id}`])).toBe(a.id === b.id);
            }
        }
    });
    it('imported leaves are never admin-locked', () => {
        const tree = buildListTree([...DETAILS, IMPORTED]);
        expect([...adminLockedIds(tree, ['+easylist', `+${IMPORTED.id}`, IMPORTED.id])]).toEqual(['easylist']);
    });
});

describe('#11 mergeServerState / computeServerEnabled / applyServerRead', () => {
    it('spec vector: toggled deu-0 kept, others from server (3 defaults + fra-0)', () => {
        const leafIds = flattenLeaves(TREE);
        const checked = new Set([...DEFAULTS, 'deu-0', 'ita-0']);
        const toggled = new Set(['deu-0']);
        const server = new Set([...DEFAULTS, 'fra-0']);
        const out = mergeServerState(checked, toggled, server, leafIds);
        expect([...out].sort()).toEqual([...DEFAULTS, 'deu-0', 'fra-0'].sort());
    });
    it('a toggled leaf keeps an unchecked value too', () => {
        const out = mergeServerState(new Set(), new Set(['easylist']), new Set(DEFAULTS), flattenLeaves(TREE));
        expect([...out].sort()).toEqual(['easyprivacy', 'ublock-filters']);
    });
    it('serverEnabled only holds ids with a leaf', () => {
        expect([...computeServerEnabled([...DEFAULTS, 'nope', IMPORTED.id], flattenLeaves(TREE))].sort()).toEqual([...DEFAULTS].sort());
    });
    it('applyServerRead drops toggled ids whose leaf is gone', () => {
        const sel = { checked: new Set(['gone', 'deu-0']), toggled: new Set(['gone', 'deu-0']) };
        const r = applyServerRead(sel, TREE, DEFAULTS);
        expect([...r.selection.toggled]).toEqual(['deu-0']);
        expect([...r.selection.checked].sort()).toEqual([...DEFAULTS, 'deu-0'].sort());
        expect([...r.serverEnabled].sort()).toEqual([...DEFAULTS].sort());
    });
});

describe('#12 nodeState / #13 nodeToggleTarget / toggles', () => {
    const ru = TREE.nodeById.get(RU) as CompositeEntry;
    const regions = TREE.nodeById.get('regions')!;
    it('RU node with rus-0 only: 1/2, checked, partial', () => {
        expect(nodeState(ru.leafIds, new Set(['rus-0']))).toEqual({
            checkedCount: 1, totalCount: 2, checked: true, partial: true, fromAdmin: false,
        });
        expect(countText(nodeState(ru.leafIds, new Set(['rus-0'])))).toBe('1/2');
    });
    it('regions with defaults only: 0/37', () => {
        const s = nodeState(regions.leafIds, new Set(DEFAULTS));
        expect(countText(s)).toBe('0/37');
        expect(s).toMatchObject({ checked: false, partial: false });
    });
    it('fromAdmin only when all leaves are admin-locked', () => {
        const admin = (tokens: string[]) => (id: string) => isAdminRuleset(id, tokens);
        expect(nodeState(ru.leafIds, new Set(), admin(['+rus-0', '+rus-1'])).fromAdmin).toBe(true);
        expect(nodeState(ru.leafIds, new Set(), admin(['+rus-0'])).fromAdmin).toBe(false);
        expect(nodeState([], new Set()).fromAdmin).toBe(true);
    });
    it('all checked: checked, not partial', () => {
        expect(nodeState(ru.leafIds, new Set(['rus-0', 'rus-1']))).toMatchObject({ checked: true, partial: false, checkedCount: 2 });
    });
    it.each([
        [true, false, true],
        [false, true, true],
        [false, false, false],
        [true, true, true],
    ])('nodeToggleTarget(%s, %s) -> %s', (a, b, out) => {
        expect(nodeToggleTarget(a, b)).toBe(out);
    });
    it('toggleNode: none -> all -> none, partial -> all; leaves marked toggled', () => {
        let sel = { checked: new Set(DEFAULTS) as ReadonlySet<string>, toggled: new Set<string>() as ReadonlySet<string> };
        sel = toggleNode(sel, ru);
        expect(ru.leafIds.every((id) => sel.checked.has(id))).toBe(true);
        expect([...sel.toggled]).toEqual(['rus-0', 'rus-1']);
        sel = toggleNode(sel, ru);
        expect(ru.leafIds.some((id) => sel.checked.has(id))).toBe(false);
        sel = toggleNode(toggleLeaf(sel, 'rus-1'), ru);
        expect(ru.leafIds.every((id) => sel.checked.has(id))).toBe(true);
        expect(DEFAULTS.every((id) => sel.checked.has(id))).toBe(true);
    });
    it('toggleNode skip option leaves admin leaves alone (Q3 fix); default flips them (upstream)', () => {
        const start = { checked: new Set(['rus-0']), toggled: new Set<string>() };
        expect([...toggleNode(start, ru).checked].sort()).toEqual(['rus-0', 'rus-1']);
        const skipped = toggleNode({ checked: new Set(['rus-0', 'rus-1']), toggled: new Set<string>() }, ru, { skip: new Set(['rus-0']) });
        expect([...skipped.checked]).toEqual(['rus-0']);
        expect([...skipped.toggled]).toEqual(['rus-1']);
        const upstream = toggleNode({ checked: new Set(['rus-0', 'rus-1']), toggled: new Set<string>() }, ru);
        expect([...upstream.checked]).toEqual([]);
    });
    it('toggleNode skip: none/partial/all is decided over the other leaves, so a node can return to none (F5)', () => {
        // admin -rus-0 (forced off): rus-1 alone decides. Upstream-style would stay partial forever.
        const skip = new Set(['rus-0']);
        let sel: { checked: ReadonlySet<string>; toggled: ReadonlySet<string> } = { checked: new Set(['rus-1']), toggled: new Set<string>() };
        sel = toggleNode(sel, ru, { skip });
        expect([...sel.checked]).toEqual([]);
        expect([...sel.toggled]).toEqual(['rus-1']);
        sel = toggleNode(sel, ru, { skip });
        expect([...sel.checked]).toEqual(['rus-1']);
        // admin +rus-0 (forced on): rus-1 alone decides as well.
        sel = toggleNode({ checked: new Set(['rus-0']), toggled: new Set<string>() }, ru, { skip });
        expect([...sel.checked].sort()).toEqual(['rus-0', 'rus-1']);
        sel = toggleNode(sel, ru, { skip });
        expect([...sel.checked]).toEqual(['rus-0']);
        // Every leaf skipped: nothing changes.
        const all = toggleNode({ checked: new Set(['rus-0']), toggled: new Set<string>() }, ru, { skip: new Set(ru.leafIds) });
        expect([...all.checked]).toEqual(['rus-0']);
        expect([...all.toggled]).toEqual([]);
    });
    it('toggleLeaf flips or sets, always marks toggled; startCommit empties toggled only', () => {
        let sel = toggleLeaf(emptySelection(), 'deu-0');
        expect(sel.checked.has('deu-0')).toBe(true);
        sel = toggleLeaf(sel, 'deu-0');
        expect(sel.checked.has('deu-0')).toBe(false);
        expect(sel.toggled.has('deu-0')).toBe(true);
        sel = toggleLeaf(sel, 'fra-0', true);
        sel = toggleLeaf(sel, 'fra-0', true);
        expect(sel.checked.has('fra-0')).toBe(true);
        const after = startCommit(sel);
        expect(after.toggled.size).toBe(0);
        expect(after.checked).toBe(sel.checked);
    });
    it('toggles never mutate their input', () => {
        const checked = new Set(['a']);
        const toggled = new Set<string>();
        toggleLeaf({ checked, toggled }, 'b');
        toggleNode({ checked, toggled }, { leafIds: ['a', 'c'] });
        expect([...checked]).toEqual(['a']);
        expect(toggled.size).toBe(0);
    });
});

describe('#14 totals / #15 isAtLimit / #16 isRowLocked', () => {
    const withImported = buildListTree([...DETAILS, IMPORTED], { compare: EN });
    it.each([
        ['3 defaults', DEFAULTS, 3, 113615, 121437],
        ['plus deu-0', [...DEFAULTS, 'deu-0'], 4, 115809, 123751],
        ['all 51', DETAILS.map((d) => d.id), 51, 196322, 214575],
        ['3 defaults + imported', [...DEFAULTS, IMPORTED.id], 3, 113624, 121448],
    ])('%s', (_, ids, rulesetCount, ruleCount, filterCount) => {
        expect(totals(withImported.leaves, new Set(ids))).toEqual({ rulesetCount, ruleCount, filterCount });
    });
    it('totals line text for the 3 defaults', () => {
        expect(formatStats(TEMPLATE, totals(TREE.leaves, new Set(DEFAULTS)), enUS)).toBe(
            '113,615 rules, converted from 121,437 network filters',
        );
    });
    it('ids without a leaf do not count', () => {
        expect(totals(TREE.leaves, new Set(['nope']))).toEqual({ rulesetCount: 0, ruleCount: 0, filterCount: 0 });
    });
    it.each([
        [3, 50, false],
        [50, 50, true],
        [51, 50, false],
        [3, undefined, false],
        [0, null, false],
    ] as [number, number | null | undefined, boolean][])('isAtLimit(%s, %s) -> %s', (n, max, out) => {
        expect(isAtLimit(n, max)).toBe(out);
    });
    it('isRowLocked: a partial (checked) node at the limit is not locked', () => {
        expect(isRowLocked(true, true)).toBe(false);
        expect(isRowLocked(true, false)).toBe(true);
        expect(isRowLocked(false, false)).toBe(false);
    });
});

describe('#17 hideUnusedInit / #18 toggleHideUnused', () => {
    it.each([
        [undefined, ['ads', 'regions', 'imported']],
        ['nope', ['ads', 'regions', 'imported']],
        [null, ['ads', 'regions', 'imported']],
        [{ 0: 'misc' }, ['ads', 'regions', 'imported']],
        [[], []],
        [['misc'], ['misc']],
        [['*', 'regions'], ['*', 'regions']],
    ])('%j -> %j', (stored, out) => {
        expect([...hideUnusedInit(stored)]).toEqual(out);
    });
    it('default set, regions -> stores [ads, imported]; again -> appended at the end', () => {
        const a = toggleHideUnused(hideUnusedInit(undefined), 'regions');
        expect(a.stored).toEqual(['ads', 'imported']);
        expect(toggleHideUnused(a.set, 'regions').stored).toEqual(['ads', 'imported', 'regions']);
    });
    it('empty set, RU node id -> [RU]; star kept', () => {
        expect(toggleHideUnused(new Set(), RU).stored).toEqual([RU]);
        expect(toggleHideUnused(new Set(['*']), 'ads').stored).toEqual(['*', 'ads']);
        expect(toggleHideUnused(new Set(['*', 'ads']), 'ads').stored).toEqual(['*']);
    });
    it('does not mutate the input set', () => {
        const s = new Set(['ads']);
        toggleHideUnused(s, 'ads');
        expect([...s]).toEqual(['ads']);
    });
});

describe('#19 isHiddenByHideUnused / #20 isAdminHidden / deriveListsView', () => {
    it('truth tables', () => {
        expect(isHiddenByHideUnused(true, false, false)).toBe(true);
        expect(isHiddenByHideUnused(true, true, false)).toBe(false);
        expect(isHiddenByHideUnused(true, false, true)).toBe(false);
        expect(isHiddenByHideUnused(false, false, false)).toBe(false);
        expect(isAdminHidden(true, false)).toBe(true);
        expect(isAdminHidden(true, true)).toBe(false);
        expect(isAdminHidden(false, false)).toBe(false);
    });
    const base = {
        tree: TREE,
        checked: new Set(DEFAULTS),
        adminRulesets: [] as string[],
        maxNumberOfEnabledRulesets: 50,
        hideUnused: hideUnusedInit(undefined),
        search: '',
        supportsCompiledFilters: false,
    };
    it('default state: 13 leaves displayed; regions children and adguard-mobile hidden; annoyances shown', () => {
        const v = deriveListsView(base);
        expect(v.visibleLeafIds).toHaveLength(13);
        const regions = v.groups.find((g) => g.id === 'regions')!;
        expect(regions.visible).toBe(true);
        expect(regions.children.every((c) => !c.visible && c.hiddenReason === 'hide-unused')).toBe(true);
        expect(regions.children).toHaveLength(36);
        expect(v.leafViews.get('adguard-mobile')!.visible).toBe(false);
        expect(v.groups.find((g) => g.id === 'annoyances')!.children.every((c) => c.visible)).toBe(true);
        expect(v.groups.filter((g) => !g.visible).map((g) => [g.id, g.hiddenReason])).toEqual([
            ['malware', 'empty-group'],
            ['imported', 'imported-unsupported'],
        ]);
        expect(v.leafViews.get('rus-0')!.hiddenReason).toBe('parent');
        expect(v.totals).toEqual({ rulesetCount: 3, ruleCount: 113615, filterCount: 121437 });
    });
    it('isDefault leaves stay visible under a hide-unused group even when unchecked', () => {
        const v = deriveListsView({ ...base, checked: new Set(['ublock-filters']), hideUnused: new Set(['default', 'annoyances']) });
        expect(v.leafViews.get('easylist')).toMatchObject({ checked: false, isDefault: true, visible: true });
        expect(v.leafViews.get('annoyances-ai')).toMatchObject({ checked: false, visible: false, hiddenReason: 'hide-unused' });
    });
    it('the imported group shows when supported, even empty; hidden in search on Safari (D6)', () => {
        const tree = buildListTree([...DETAILS, IMPORTED], { compare: EN });
        const supported = deriveListsView({ ...base, tree, supportsCompiledFilters: true, hideUnused: new Set() });
        expect(supported.groups.find((g) => g.id === 'imported')!.visible).toBe(true);
        const emptySupported = deriveListsView({ ...base, supportsCompiledFilters: true });
        expect(emptySupported.groups.find((g) => g.id === 'imported')!.visible).toBe(true);
        const safariSearch = deriveListsView({ ...base, tree, search: 'imported' });
        expect(safariSearch.leafViews.get(IMPORTED.id)).toMatchObject({ searchMatch: true, visible: false });
        expect(safariSearch.visibleLeafIds).toEqual([]);
    });
    it('admin: unchecked locked leaf hidden, checked one shown and disabled; node locked when all leaves are', () => {
        const v = deriveListsView({ ...base, checked: new Set(['ublock-filters', 'easylist']), adminRulesets: ['+easylist', '-easyprivacy'] });
        expect(v.leafViews.get('easyprivacy')).toMatchObject({ fromAdmin: true, disabled: true, visible: false, hiddenReason: 'admin' });
        expect(v.leafViews.get('easylist')).toMatchObject({ fromAdmin: true, disabled: true, visible: true });
        const n = deriveListsView({ ...base, adminRulesets: ['-rus-0', '-rus-1'], hideUnused: new Set() });
        const node = n.groups.find((g) => g.id === 'regions')!.children.find((c) => c.id === RU)!;
        expect(node).toMatchObject({ fromAdmin: true, disabled: true, visible: false, hiddenReason: 'admin' });
        expect(n.groups.every((g) => g.fromAdmin === false)).toBe(true);
    });
    it('limit: every unchecked row locked, checked and partial rows not, groups never', () => {
        const v = deriveListsView({ ...base, checked: new Set([...DEFAULTS, 'rus-0']), maxNumberOfEnabledRulesets: 4 });
        expect(v.atLimit).toBe(true);
        expect(v.leafViews.get('deu-0')!.locked).toBe(true);
        expect(v.leafViews.get('easylist')!.locked).toBe(false);
        const node = v.groups.find((g) => g.id === 'regions')!.children.find((c) => c.id === RU)!;
        expect(node).toMatchObject({ partial: true, locked: false });
        expect(deriveListsView({ ...base, maxNumberOfEnabledRulesets: undefined }).atLimit).toBe(false);
    });
    it('imported leaves do not count toward the limit', () => {
        const tree = buildListTree([...DETAILS, IMPORTED], { compare: EN });
        const v = deriveListsView({ ...base, tree, checked: new Set([...DEFAULTS, IMPORTED.id]), maxNumberOfEnabledRulesets: 3 });
        expect(v.totals.rulesetCount).toBe(3);
        expect(v.atLimit).toBe(true);
    });
    it('search overrides hide-unused and shows ancestors only', () => {
        const v = deriveListsView({ ...base, search: 'ru adlist' });
        expect(v.searchMode).toBe(true);
        expect(v.visibleLeafIds).toEqual(['rus-0', 'rus-1']);
        expect(v.groups.filter((g) => g.visible).map((g) => g.id)).toEqual(['regions']);
        expect(deriveListsView({ ...base, search: 'zzz' }).groups.some((g) => g.visible)).toBe(false);
    });
});

describe('#21 searchHaystack / #22 searchRegex', () => {
    it.each([
        ['easylist', 'EasyList  default'],
        ['ubol-tests', 'uBO Lite Test Filters'],
        ['adguard-mobile', 'AdGuard/uBO – Mobile Ads  ads mobile'],
        ['deu-0', '🇩🇪de 🇨🇭ch 🇦🇹at: EasyList Germany  regions ads german deutschland luxembourgish lëtzebuerg romansh'],
    ])('%s', (id, out) => {
        expect(searchHaystack(D(id))).toBe(out);
    });
    it('regex is a literal, case-insensitive', () => {
        expect(searchRegex('a.b').source).toBe('a\\.b');
        expect(searchRegex('[x]').source).toBe('\\[x\\]');
        expect(searchRegex('a').flags).toBe('i');
        expect(searchRegex('$^*+?(){}|\\').test('x$^*+?(){}|\\y')).toBe(true);
        expect(isSearchMode('')).toBe(false);
        expect(isSearchMode(' ')).toBe(true);
    });
});

describe('#23 searchLeaves', () => {
    const ids = (pattern: string, admin: string[] = []) =>
        DETAILS.map((d) => d.id).filter((id) => searchLeaves(TREE, pattern, admin).leaves.has(id));
    it.each([
        ['german', ['deu-0']],
        ['GERMAN', ['deu-0']],
        ['default', ['ublock-filters', 'easylist', 'easyprivacy']],
        ['mobile', ['adguard-mobile']],
        ['privacy', ['easyprivacy', 'block-lan']],
        ['ru adlist', ['rus-0', 'rus-1']],
        ['counters', ['rus-1']],
        ['русский', ['rus-0', 'rus-1']],
        ['(中文)', ['chn-0']],
        ['pl', ['pol-0']],
        ['rus-0', []],
        ['a.b', []],
        ['zzz', []],
        ['', []],
    ])('%j', (pattern, out) => {
        expect(ids(pattern)).toEqual(out);
    });
    it('regions gives the 37 regional lists; a single space matches all 51', () => {
        expect(ids('regions')).toHaveLength(37);
        expect(ids(' ')).toHaveLength(51);
    });
    it('admin-locked leaves never match', () => {
        expect(ids('easylist', ['+easylist'])).not.toContain('easylist');
        expect(ids('easylist', ['+easylist'])).toContain('deu-0');
    });
    it('nodes holding a match are reported', () => {
        expect([...searchLeaves(TREE, 'counters', []).nodes].sort()).toEqual(['regions', RU].sort());
        expect([...searchLeaves(TREE, 'pl', []).nodes]).toEqual(['regions']);
    });
});

describe('#24 collectEnabled / #25 hashFromIterable / #26 isModified', () => {
    const withImported = buildListTree([...DETAILS, IMPORTED], { compare: EN });
    it('3 defaults plus deu-0, display order', () => {
        expect(collectEnabled(TREE.leaves, new Set([...DEFAULTS, 'deu-0']), [])).toEqual(['easylist', 'easyprivacy', 'ublock-filters', 'deu-0']);
    });
    it('admin token +easylist: easylist absent', () => {
        expect(collectEnabled(TREE.leaves, new Set(DEFAULTS), ['+easylist'])).toEqual(['easyprivacy', 'ublock-filters']);
    });
    it('a checked imported id is present, last', () => {
        expect(collectEnabled(withImported.leaves, new Set([...DEFAULTS, IMPORTED.id]), [])).toEqual([
            'easylist', 'easyprivacy', 'ublock-filters', IMPORTED.id,
        ]);
    });
    it('checked ids without a leaf are never sent', () => {
        expect(collectEnabled(TREE.leaves, new Set(['nope', 'easylist']), [])).toEqual(['easylist']);
    });
    it('hashFromIterable', () => {
        expect(hashFromIterable(['b', 'a'])).toBe('a\nb');
        expect(hashFromIterable(undefined)).toBe('');
        expect(hashFromIterable([])).toBe('');
        expect(hashFromIterable(new Set())).toBe('');
        expect(hashFromIterable(new Set(['z', 'y']))).toBe('y\nz');
    });
    it('isModified', () => {
        expect(isModified(['a', 'b'], new Set(['b', 'a']))).toBe(false);
        expect(isModified(['a'], ['a'], true, ['u'])).toBe(true);
        expect(isModified(['a'], ['a'], false, ['u'])).toBe(false);
        expect(isModified(['a'], ['a'], true, [])).toBe(false);
        expect(isModified(['easyprivacy'], new Set(['easyprivacy', 'easylist']))).toBe(true);
    });
});

describe('#27 #28 #30 timer / unload / after-commit actions', () => {
    it('commitTimerAction', () => {
        expect(commitTimerAction(true)).toBe('rearm');
        expect(commitTimerAction(false)).toBe('commit');
    });
    it('unloadAction', () => {
        expect(unloadAction(true, true)).toBe('none');
        expect(unloadAction(true, false)).toBe('none');
        expect(unloadAction(false, false)).toBe('none');
        expect(unloadAction(false, true)).toBe('sendFinal');
    });
    it('afterCommitAction (D8)', () => {
        expect(afterCommitAction(true)).toBe('none');
        expect(afterCommitAction(false)).toBe('reread');
    });
});

describe('#29 isValidImportUrl', () => {
    it.each([
        ['https://example.com/list.txt', true],
        ['https://example.com', false],
        ['HTTPS://example.com/x', false],
        ['file:///a/b', true],
        ['ftp://h/', true],
        ['nonsense\nhttps://a/b', true],
        ['', false],
    ])('%j -> %s', (url, out) => {
        expect(isValidImportUrl(url)).toBe(out);
    });
});

describe('planCommit: the exact applyRulesets payload', () => {
    const server = new Set(DEFAULTS);
    it('tick deu-0: complete list (not a delta), display order', () => {
        const sel = toggleLeaf({ checked: new Set(DEFAULTS), toggled: new Set() }, 'deu-0');
        const plan = planCommit({ tree: TREE, checked: sel.checked, serverEnabled: server });
        expect(plan.payload).toEqual({ enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] });
        expect(plan.modified).toBe(true);
        expect(plan.delta).toEqual({ enable: ['deu-0'], disable: [] });
        expect(plan.excludedAdmin).toEqual([]);
    });
    it('tick and untick within the window: nothing to send', () => {
        let sel = toggleLeaf({ checked: new Set(DEFAULTS), toggled: new Set() }, 'fra-0');
        sel = toggleLeaf(sel, 'fra-0');
        const plan = planCommit({ tree: TREE, checked: sel.checked, serverEnabled: server });
        expect(plan).toMatchObject({ modified: false, payload: null });
    });
    it('unticking a default: the list simply lacks it; delta says disable', () => {
        const sel = toggleLeaf({ checked: new Set(DEFAULTS), toggled: new Set() }, 'easylist');
        const plan = planCommit({ tree: TREE, checked: sel.checked, serverEnabled: server });
        expect(plan.payload).toEqual({ enabledRulesets: ['easyprivacy', 'ublock-filters'] });
        expect(plan.delta).toEqual({ enable: [], disable: ['easylist'] });
    });
    it('unticking everything sends [] (an array, never undefined)', () => {
        const plan = planCommit({ tree: TREE, checked: new Set(), serverEnabled: server });
        expect(plan.payload).toEqual({ enabledRulesets: [] });
    });
    it('admin-locked leaves excluded and reported; Q5 re-send unless ignoreAdminInBaseline', () => {
        const checked = new Set(DEFAULTS);
        const adminServer = new Set(DEFAULTS);
        const plan = planCommit({ tree: TREE, checked, adminRulesets: ['+easylist'], serverEnabled: adminServer });
        expect(plan.enabledRulesets).toEqual(['easyprivacy', 'ublock-filters']);
        expect(plan.excludedAdmin).toEqual(['easylist']);
        expect(plan.modified).toBe(true); // QUIRK Q5: identical list re-sent
        expect(plan.delta.disable).toEqual([]); // the background forces easylist back on
        const fixed = planCommit({ tree: TREE, checked, adminRulesets: ['+easylist'], serverEnabled: adminServer, ignoreAdminInBaseline: true });
        expect(fixed.payload).toBeNull();
    });
    it('imported: checked id included; final adds toRemove (even empty), debounced never', () => {
        const tree = buildListTree([...DETAILS, IMPORTED], { compare: EN });
        const checked = new Set([...DEFAULTS, IMPORTED.id, 'deu-0']);
        const base = new Set([...DEFAULTS, IMPORTED.id]);
        expect(planCommit({ tree, checked, serverEnabled: base, toRemove: ['x'] }).payload).toEqual({
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0', IMPORTED.id],
        });
        expect(planCommit({ tree, checked, serverEnabled: base, final: true }).payload).toEqual({
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0', IMPORTED.id],
            toRemove: [],
        });
        const unchanged = planCommit({ tree, checked: base, serverEnabled: base, final: true, toRemove: [IMPORTED.id] });
        expect(unchanged.payload).toEqual({ enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', IMPORTED.id], toRemove: [IMPORTED.id] });
    });
    it('never page-visible state: hidden (hide-unused, search) leaves are included', () => {
        const checked = new Set([...DEFAULTS, 'rus-1', 'adguard-mobile']);
        expect(planCommit({ tree: TREE, checked, serverEnabled: server }).enabledRulesets).toEqual([
            'easylist', 'easyprivacy', 'ublock-filters', 'adguard-mobile', 'rus-1',
        ]);
    });
    it('property: payload is always a duplicate-free string[] of current leaf ids, in display order, no admin id', () => {
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        const leafIds = flattenLeaves(TREE);
        const order = new Map(leafIds.map((id, i) => [id, i]));
        const violations: string[] = [];
        for (let round = 0; round < 300; round++) {
            const admin = leafIds.filter(() => rnd() < 0.05).map((id) => (rnd() < 0.5 ? `+${id}` : `-${id}`));
            let sel = applyServerRead(emptySelection(), TREE, leafIds.filter(() => rnd() < 0.3)).selection;
            const base = new Set(leafIds.filter(() => rnd() < 0.3));
            for (let k = 0; k < 10; k++) {
                const id = leafIds[Math.floor(rnd() * leafIds.length)];
                sel = rnd() < 0.2 ? toggleNode(sel, TREE.nodeById.get(RU) as CompositeEntry) : toggleLeaf(sel, id);
            }
            const plan = planCommit({ tree: TREE, checked: sel.checked, adminRulesets: admin, serverEnabled: base });
            const list = plan.enabledRulesets;
            // Plain checks collected per round (one expect at the end keeps this fast).
            const bad: string[] = [];
            if (!Array.isArray(list)) bad.push('not an array');
            if (new Set(list).size !== list.length) bad.push('duplicates');
            for (const id of list) {
                if (typeof id !== 'string' || !order.has(id)) bad.push(`unknown id ${String(id)}`);
                if (isAdminRuleset(id, admin)) bad.push(`admin id ${id}`);
                if (!sel.checked.has(id)) bad.push(`unchecked id ${id}`);
            }
            const idx = list.map((id) => order.get(id)!);
            if (idx.some((v, j) => j > 0 && v < idx[j - 1])) bad.push('not in display order');
            for (const id of sel.checked) {
                if (order.has(id) && !isAdminRuleset(id, admin) && !list.includes(id)) bad.push(`missing ${id}`);
            }
            if ((plan.payload === null) !== (hashFromIterable(list) === hashFromIterable(base))) bad.push('modified flag');
            violations.push(...bad.map((b) => `round ${round}: ${b}`));
        }
        expect(violations).toEqual([]);
    });
});

describe('pageHideFlush (D1) and commitMismatch (§9.5)', () => {
    const checked = new Set([...DEFAULTS, 'deu-0']);
    it('nothing pending: nothing sent', () => {
        expect(pageHideFlush({ tree: TREE, checked, serverEnabled: DEFAULTS, timerPending: false })).toBeNull();
    });
    it('pending change: the debounced payload', () => {
        expect(pageHideFlush({ tree: TREE, checked, serverEnabled: DEFAULTS, timerPending: true })).toEqual({
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'],
        });
        expect(pageHideFlush({ tree: TREE, checked: new Set(DEFAULTS), serverEnabled: DEFAULTS, timerPending: true })).toBeNull();
    });
    it('with a commit in flight it compares against the in-flight list', () => {
        const inFlight = ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'];
        expect(pageHideFlush({ tree: TREE, checked, serverEnabled: DEFAULTS, timerPending: true, inFlight })).toBeNull();
        expect(
            pageHideFlush({ tree: TREE, checked: new Set(DEFAULTS), serverEnabled: DEFAULTS, timerPending: true, inFlight }),
        ).toEqual({ enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters'] });
    });
    it('commitMismatch', () => {
        expect(commitMismatch(['a', 'b'], new Set(['a', 'c']))).toEqual({ notEnabled: ['b'], unexpectedlyEnabled: ['c'] });
        expect(commitMismatch(['a'], new Set(['a', 'adm']), new Set(['adm']))).toEqual({ notEnabled: [], unexpectedlyEnabled: [] });
    });
});

describe('imported lists: removal flags and the final page-hide commit (§12.3, §14)', () => {
    const IMP: ListDetails = { id: 'https://example.org/l.txt', name: 'L', group: 'imported', enabled: true };
    const tree = buildListTree([...(RULESET_DETAILS as unknown as ListDetails[]), IMP]);
    const leaf = tree.leafById.get(IMP.id);

    it('flag remembers the state and unchecks; unflag restores it; stock leaves are ignored', () => {
        const sel = { checked: new Set([...DEFAULTS, IMP.id]), toggled: new Set<string>() };
        const a = flagRemoval(sel, new Map(), leaf);
        expect([...a.removing]).toEqual([[IMP.id, true]]);
        expect(a.selection.checked.has(IMP.id)).toBe(false);
        expect(a.selection.toggled.has(IMP.id)).toBe(true);
        expect(flagRemoval(a.selection, a.removing, leaf)).toEqual(a);
        const b = unflagRemoval(a.selection, a.removing, IMP.id);
        expect(b.removing.size).toBe(0);
        expect(b.selection.checked.has(IMP.id)).toBe(true);
        const stock = flagRemoval(sel, new Map(), tree.leafById.get('easylist'));
        expect(stock.removing.size).toBe(0);
    });

    it('a flagged (unchecked) list stays visible under hide-unused so its undo is reachable', () => {
        const base = { tree, checked: new Set(DEFAULTS), hideUnused: new Set(['imported']), supportsCompiledFilters: true };
        expect(deriveListsView(base).leafViews.get(IMP.id)?.hiddenReason).toBe('hide-unused');
        expect(deriveListsView({ ...base, keepVisible: new Set([IMP.id]) }).leafViews.get(IMP.id)?.visible).toBe(true);
    });

    it('pruneRemovalFlags drops flags whose list is gone', () => {
        const flags = new Map([[IMP.id, true]]);
        expect(pruneRemovalFlags(flags, tree)).toBe(flags);
        expect(pruneRemovalFlags(flags, buildListTree(RULESET_DETAILS as unknown as ListDetails[])).size).toBe(0);
    });

    it('pageHideFlush adds toRemove when lists are flagged, pending change or not', () => {
        const checked = new Set(DEFAULTS);
        expect(pageHideFlush({ tree, checked, serverEnabled: DEFAULTS, timerPending: false, toRemove: [IMP.id] })).toEqual({
            enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters'],
            toRemove: [IMP.id],
        });
        // Unknown or stock ids are never sent for deletion.
        expect(pageHideFlush({ tree, checked, serverEnabled: DEFAULTS, timerPending: false, toRemove: ['easylist', 'x'] })).toBeNull();
        expect(pageHideFlush({ tree, checked, serverEnabled: DEFAULTS, timerPending: false, toRemove: [] })).toBeNull();
    });
});

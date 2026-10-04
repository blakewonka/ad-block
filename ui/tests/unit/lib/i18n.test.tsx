/**
 * src/lib/i18n.tsx against docs/specs/i18n.md (§5.1 rules, §5.4 table, §7 checklist).
 */
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LocaleDirectionProvider,
    RTL_LANGUAGES,
    T,
    formatNumber,
    getLocaleInfo,
    groupNameKey,
    initDocumentLocale,
    modeNameKey,
    parseRich,
    t,
    tNew,
} from '@/lib/i18n';
import { Direction } from 'radix-ui';
import { createFakeBrowser, installFakeBrowser } from './fake-browser';
import type { FakeBrowser } from './fake-browser';
import i18nSource from '../../../src/lib/i18n.tsx?raw';

/**
 * PRISTINE/_locales/<locale>/messages.json, through the committed byte-identical copies in
 * src/dev/fixtures/locales/<locale>.json (tests/e2e/harness.smoke.mjs checks them against PRISTINE).
 */
const LOCALE_FILES = import.meta.glob<Record<string, { message: string }>>(
    '../../../src/dev/fixtures/locales/*.json',
    { eager: true, import: 'default' },
);

/* Real shipped strings (PRISTINE/_locales/<l>/messages.json), copied verbatim. */
const EN_USER_SCRIPTS_INFO = 'Open your browser\'s extensions page (<code>chrome://extensions</code> in Chrome or <code>about:addons</code> in Firefox), open <b>uBO Lite</b> details, and toggle on <b>Allow user scripts</b> (also referred to as “unverified third-party scripts”).';
const HE_USER_SCRIPTS_INFO = 'פתחו את התוספים או ההרחבות בדפדפן שלכם (<code>chrome://extensions</code> בכרום או <code>chrome://extensions</code> בפיירפוקס), פתחו את הפרטים של <b>uBO Lite</b>, ותנו <b>אישור לסקריפטים של משתמשים<b> (או "לאפשר לתסריטי צד שלישי לא מאומתים לגשת לנתונים שלך").';
const ZH_CN_USER_SCRIPTS_INFO = '打开浏览器的扩展页面（Chrome 中为 <code>chrome://extensions</code>，Firefox 中为 <code>about:addons</code>），打开 <b>uBO Lite</b> 详情</b>，然后开启 <b>允许用户脚本</b>（也称为“未经验证的第三方脚本”）。';
const ZH_TW_USER_SCRIPTS_INFO = '請開啟瀏覽器的擴充功能頁面（Chrome 中輸入 chrome://extensions，Firefox 中輸入 about:addons），開啟 uBO Lite 的詳細資料，並啟用允許使用者腳本（亦稱為『未經驗證的第三方腳本』）。';
const EN_PER_RULESET_STATS = '{{ruleCount}} rules, converted from {{filterCount}} network filters';
const BE_PER_RULESET_STATS = 'Правілы (колькасць: {{ruleCount}}), якія пераўтвораны з сеткавых фільтраў (колькасць: {{filterCount}})';
const EN_COMPLETE_DESC = 'Advanced network filtering plus specific and generic extended filtering from selected filter lists.\n\nRequires broad permission to read and modify data on all websites.\n\nGeneric extended filtering may cause higher web page resources usage.';

const ALLOWED_TAGS = new Set(['A', 'B', 'CODE', 'EM', 'I', 'SPAN', 'U']);

/** Every element is an allowed tag; only <a> carries attributes, and only https href + target + rel. */
function expectSafeDom(root: Element): void {
    for (const el of Array.from(root.querySelectorAll('*'))) {
        expect(ALLOWED_TAGS.has(el.tagName), `tag <${el.tagName}>`).toBe(true);
        const names = el.getAttributeNames().sort();
        if (el.tagName === 'A') {
            expect(names).toEqual(['href', 'rel', 'target']);
            expect(el.getAttribute('href')).toMatch(/^https:\/\/[^\s"'<>]+$/);
            expect(el.getAttribute('target')).toBe('_blank');
            expect(el.getAttribute('rel')).toBe('noopener noreferrer');
        } else {
            expect(names, `attributes of <${el.tagName}>`).toEqual([]);
        }
    }
}

function renderT(props: Parameters<typeof T>[0]): HTMLElement {
    const { container } = render(<T {...props} />);
    expectSafeDom(container);
    return container;
}

let fake: FakeBrowser;

function setMessages(messages: Record<string, string>): void {
    fake = installFakeBrowser(createFakeBrowser({ messages }));
}

beforeEach(() => {
    setMessages({});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
    document.body.removeAttribute('dir');
});

/* ------------------------------------------------------------------------ */

describe('t()', () => {
    it("returns '' for a missing key (§5.4 row 1) and when getMessage throws or returns a non-string", () => {
        expect(t('missing')).toBe('');
        fake.i18n.getMessage.mockImplementation(() => { throw new Error('x'); });
        expect(t('extName')).toBe('');
        fake.i18n.getMessage.mockImplementation(() => undefined as unknown as string);
        expect(t('extName')).toBe('');
    });

    it("returns '' when no browser API exists at all", () => {
        vi.stubGlobal('browser', undefined);
        expect(t('extName')).toBe('');
        expect(tNew('blockerX', 'English')).toBe('English');
    });

    it('calls getMessage with exactly one argument', () => {
        setMessages({ extName: 'Blocker' });
        expect(t('extName')).toBe('Blocker');
        for (const call of fake.i18n.getMessage.mock.calls) { expect(call).toHaveLength(1); }
    });

    it('trims leading/trailing whitespace and keeps inner \\n\\n (§7 item 4)', () => {
        setMessages({ filteringMode0Name: 'iragazkirik gabe\n', completeFilteringModeDescription: EN_COMPLETE_DESC, x: ' \n tiada penapisan ' });
        expect(t('filteringMode0Name')).toBe('iragazkirik gabe');
        expect(t('completeFilteringModeDescription')).toBe(EN_COMPLETE_DESC);
        expect(t('completeFilteringModeDescription').split('\n\n')).toHaveLength(3);
        expect(t('x')).toBe('tiada penapisan');
    });

    it('substitutes {{placeholders}} (§5.4 rows 3-4)', () => {
        setMessages({ perRulesetStats: EN_PER_RULESET_STATS });
        expect(t('perRulesetStats', { ruleCount: '1', filterCount: '2' })).toBe('1 rules, converted from 2 network filters');
        expect(t('perRulesetStats', { ruleCount: 113615, filterCount: 121437 })).toBe('113615 rules, converted from 121437 network filters');
        expect(t('perRulesetStats')).toBe(EN_PER_RULESET_STATS);
        expect(t('perRulesetStats', { ruleCount: 'X' })).toBe('X rules, converted from {{filterCount}} network filters');
    });

    it('follows the locale word order (be) and inserts values literally ($&, <b>)', () => {
        setMessages({ perRulesetStats: BE_PER_RULESET_STATS, m: 'a {{v}} b {{v}}' });
        const out = t('perRulesetStats', { ruleCount: '1', filterCount: '2' });
        expect(out).toBe('Правілы (колькасць: 1), якія пераўтвораны з сеткавых фільтраў (колькасць: 2)');
        expect(out.indexOf('1')).toBeLessThan(out.indexOf('2'));
        expect(t('m', { v: '$&' })).toBe('a $& b $&');
        expect(t('m', { v: '<b>x</b>' })).toBe('a <b>x</b> b <b>x</b>');
        expect(t('m', { v: '$1$$' })).toBe('a $1$$ b $1$$');
    });

    it('single-brace {count} is not a placeholder; prototype names are not looked up', () => {
        setMessages({ dnr: '{count} rules', p: '{{constructor}} {{toString}}' });
        expect(t('dnr', { count: 3 })).toBe('{count} rules');
        expect(t('p', {})).toBe('{{constructor}} {{toString}}');
    });

    it('strips allowed tags (keeps their text) so the result is safe for attributes', () => {
        setMessages({ userScriptsInfo: EN_USER_SCRIPTS_INFO });
        expect(t('userScriptsInfo')).toBe('Open your browser\'s extensions page (chrome://extensions in Chrome or about:addons in Firefox), open uBO Lite details, and toggle on Allow user scripts (also referred to as “unverified third-party scripts”).');
    });

    it('does not change letter case (case transforms stay in CSS, §2.1)', () => {
        setMessages({ filteringMode1Name: 'Basique', filteringMode2Name: 'optimal' });
        expect(t(modeNameKey(1))).toBe('Basique');
        expect(t(modeNameKey(2))).toBe('optimal');
    });

    it('preserves invisible characters (ZWNJ, NBSP, soft hyphen)', () => {
        setMessages({ a: 'x‌y', b: 'Sichern …', c: 'Zap­per' });
        expect(t('a')).toBe('x‌y');
        expect(t('b')).toBe('Sichern …');
        expect(t('c')).toBe('Zap­per');
    });

    it('decodes exactly the seven upstream entities (§5.4 entity row)', () => {
        setMessages({ e: '&shy;&ldquo;q&rdquo; &amp; &nbsp; &lsquo;&rsquo;&lt;&gt;' });
        expect(t('e')).toBe('­“q” &amp; &nbsp; ‘’<>');
    });

    it('in development (not in tests) reports an empty lookup once per key, still returning ""', () => {
        vi.stubEnv('MODE', 'development');
        vi.stubEnv('DEV', true);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(t('blockerTypoKey')).toBe('');
        expect(t('blockerTypoKey')).toBe('');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('blockerTypoKey');
        // tNew never warns: English is its normal path.
        expect(tNew('blockerOtherKey', 'Hello')).toBe('Hello');
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('tNew()', () => {
    it('returns English (with substitution) when the browser has no message (§5.4)', () => {
        expect(tNew('blockerNewThing', 'Hello {{name}}', { name: 'x' })).toBe('Hello x');
    });

    it('returns the translation when there is one (ml empty heading case, §5.1 item 7)', () => {
        setMessages({ aboutContributors: 'Mitwirkende', aboutTranslations: '' });
        expect(tNew('aboutContributors', 'Contributors')).toBe('Mitwirkende');
        expect(tNew('aboutTranslations', 'Translations')).toBe('Translations');
    });
});

describe('<T> rich renderer (§5.4)', () => {
    it('renders nothing for an empty message, the fallback otherwise', () => {
        expect(render(<T k="missing" />).container.innerHTML).toBe('');
        const c = renderT({ k: 'blockerNew', fallback: 'New <b>bold</b> {{n}}', subs: { n: <em>3</em> } });
        expect(c.innerHTML).toBe('New <b>bold</b> <em>3</em>');
    });

    it('en userScriptsInfo: two <code>, two <b>, no attributes', () => {
        setMessages({ userScriptsInfo: EN_USER_SCRIPTS_INFO });
        const c = renderT({ k: 'userScriptsInfo' });
        expect(c.querySelectorAll('code')).toHaveLength(2);
        expect(c.querySelectorAll('b')).toHaveLength(2);
        expect(c.textContent).toBe(t('userScriptsInfo'));
    });

    it('he userScriptsInfo (unclosed <b>): bold to the end, no exception', () => {
        setMessages({ userScriptsInfo: HE_USER_SCRIPTS_INFO });
        const c = renderT({ k: 'userScriptsInfo' });
        const bs = c.querySelectorAll('b');
        expect(bs.length).toBeGreaterThanOrEqual(2);
        const last = bs[1];
        expect(last.textContent?.endsWith('שלך").')).toBe(true);
        expect(c.textContent).toBe(t('userScriptsInfo'));
    });

    it('zh_CN userScriptsInfo (stray </b>) and zh_TW (no tags)', () => {
        setMessages({ userScriptsInfo: ZH_CN_USER_SCRIPTS_INFO });
        const c = renderT({ k: 'userScriptsInfo' });
        expect(c.querySelectorAll('b')).toHaveLength(2);
        expect(c.textContent).toBe(t('userScriptsInfo'));
        setMessages({ userScriptsInfo: ZH_TW_USER_SCRIPTS_INFO });
        const d = renderT({ k: 'userScriptsInfo' });
        expect(d.innerHTML).toBe(ZH_TW_USER_SCRIPTS_INFO);
    });

    it('drops javascript: and http: links (text kept, no <a>)', () => {
        setMessages({ m: '<a href="javascript:alert(1)">x</a>, <a href="http://e.com">y</a>' });
        const c = renderT({ k: 'm' });
        expect(c.querySelector('a')).toBeNull();
        expect(c.textContent).toBe('x, y');
    });

    it('keeps an https href only; drops onclick and style', () => {
        setMessages({ m: '<a href="https://e.com/a?b=1" onclick="evil()" style="color:red">z</a>' });
        const c = renderT({ k: 'm' });
        expect(c.innerHTML).toBe('<a href="https://e.com/a?b=1" target="_blank" rel="noopener noreferrer">z</a>');
    });

    it('<script> and <img onerror> become text-only', () => {
        setMessages({ m: 'a <script>alert(1)</script> b <img src=x onerror=alert(1)> c' });
        const c = renderT({ k: 'm' });
        expect(c.children).toHaveLength(0);
        expect(c.textContent).toBe('a alert(1) b  c');
    });

    it('mixes literal "<", escaped entities and nested tags', () => {
        setMessages({ m: '1 < 2 &lt;b&gt; <b>bold <i>both</b> after' });
        const c = renderT({ k: 'm' });
        expect(c.innerHTML).toBe('1 &lt; 2 &lt;b&gt; <b>bold <i>both</i></b> after');
    });

    it('is case-insensitive for tags and strips attributes of allowed tags', () => {
        setMessages({ m: '<B>upper</B> <span class="c" data-url="https://x">s</span>' });
        expect(renderT({ k: 'm' }).innerHTML).toBe('<b>upper</b> <span>s</span>');
    });

    it('drops <br/>; <b/> opens a tag', () => {
        setMessages({ m: 'line<br/>break <b/>x' });
        expect(renderT({ k: 'm' }).innerHTML).toBe('linebreak <b>x</b>');
    });

    it('string subs are text nodes; element subs are rendered', () => {
        setMessages({ m: 'A {{v}} B {{e}} {{missing}}' });
        const c = renderT({ k: 'm', subs: { v: '<img src=x onerror=alert(1)>$&', e: <code>7</code> } });
        expect(c.querySelector('img')).toBeNull();
        expect(c.innerHTML).toBe('A &lt;img src=x onerror=alert(1)&gt;$&amp; B <code>7</code> {{missing}}');
    });
});

describe('sanitiser against hostile input', () => {
    const HOSTILE: string[] = [
        '<script>alert(1)</script>',
        '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
        '<img src=x onerror=alert(1)>',
        '<img src="x" onerror="alert(1)"/>',
        '<svg onload=alert(1)><circle/></svg>',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<style>body{display:none}</style>',
        '<b onclick="alert(1)" onmouseover=alert(2) style="x:y" id="i" class="c">bold</b>',
        '<a href="javascript:alert(1)">js</a>',
        '<a href="JaVaScRiPt:alert(1)">js2</a>',
        '<a href=" javascript:alert(1)">js3</a>',
        '<a href="java&#115;cript:alert(1)">js4</a>',
        '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data</a>',
        '<a href="vbscript:msgbox(1)">vb</a>',
        '<a href="//evil.example">proto-relative</a>',
        '<a href="http://evil.example">http</a>',
        '<a href=https://unquoted.example>unquoted</a>',
        '<a href="https://ok.example/" onclick="alert(1)">ok-but-onclick</a>',
        '<a href=\'https://e.example/"onmouseover=alert(1)\'>quote-break</a>',
        '<a href="https://e.example/ x">space</a>',
        '<a title="t" href="javascript:x" href="https://second.example">dup</a>',
        '<a href="https://ok.example"><b><i><u><code><span><em>deep</em></span></code></u></i></b></a>',
        '<b><i>mis</b>nested</i>',
        '<b><b><b><b>' + 'x'.repeat(10) + '</b></b>',
        '<u><a href="javascript:alert(1)"><script>alert(1)</script>inner</a></u>',
        '<<b>>double<</b>>',
        '<b <i>broken</i>',
        '<!-- comment --><b>after</b>',
        '<![CDATA[<script>x</script>]]>',
        '<math><mi xlink:href="javascript:alert(1)">m</mi></math>',
        '<object data="x"></object><embed src="x"><form action="x"><input onfocus=alert(1) autofocus>',
        '<template><script>alert(1)</script></template>',
        '<span style="background:url(javascript:alert(1))">s</span>',
        '&lt;script&gt;alert(1)&lt;/script&gt;',
        '{{x}}<b>{{y}}</b>',
        '<b>'.repeat(500) + 'deep' + '</b>'.repeat(500),
    ];

    it.each(HOSTILE)('%s', (msg) => {
        setMessages({ m: msg });
        const c = renderT({ k: 'm', subs: { x: '<script>', y: '<img onerror=1>' } });
        expect(c.querySelector('script, img, svg, iframe, style, object, embed, form, input, math, template')).toBeNull();
        // Plain t() for the same message never contains an allowed tag token any more.
        expect(t('m')).not.toMatch(/<\/?(a|b|code|em|i|span|u)(\s[^<>]*)?\/?>/i);
    });

    it('literal "<script>" from a message stays visible text, never an element', () => {
        setMessages({ m: '&lt;script&gt;alert(1)&lt;/script&gt;' });
        const c = renderT({ k: 'm' });
        expect(c.textContent).toBe('<script>alert(1)</script>');
        expect(c.children).toHaveLength(0);
    });

    it('random fuzz: output only ever contains allowed tags and safe links', () => {
        const pieces = ['<a href="https://ok.example/p">', '<a href="javascript:alert(1)">', '</a>', '<b>', '</b>', '<i>', '</i>', '<u>', '</u>',
            '<code>', '</code>', '<span onclick=x>', '</span>', '<em>', '</em>', '<script>', '</script>', '<img onerror=x>', '<', '>', '&lt;',
            '&gt;', '&amp;', '{{v}}', 'text', ' ', '"', "'", '<a href=\'https://q.example\'>', '<br/>', '<b/>', '<p>'];
        let seed = 12345;
        const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
        for (let round = 0; round < 300; round++) {
            let msg = '';
            const len = 1 + rnd(25);
            for (let i = 0; i < len; i++) { msg += pieces[rnd(pieces.length)]; }
            setMessages({ m: msg });
            const markup = renderToStaticMarkup(<T k="m" subs={{ v: '<b>v</b>' }} />);
            const host = document.createElement('div');
            host.innerHTML = markup; // test-side inspection only
            expectSafeDom(host);
            expect(host.textContent).toBe(t('m', { v: '<b>v</b>' }));
        }
    });

    it('the renderer source never uses raw-HTML or HTML-parser APIs (§7 item 22)', () => {
        expect(i18nSource.length).toBeGreaterThan(1000);
        expect(i18nSource).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment/);
    });
});

describe('parseRich', () => {
    it('produces text, slot and tag nodes', () => {
        expect(parseRich('a {{n}} <b>c</b>')).toEqual([
            { type: 'text', text: 'a ' },
            { type: 'slot', name: 'n' },
            { type: 'text', text: ' ' },
            { type: 'tag', tag: 'b', children: [{ type: 'text', text: 'c' }] },
        ]);
        expect(parseRich('<a href="https://x.example">l</a>')).toEqual([
            { type: 'tag', tag: 'a', href: 'https://x.example', children: [{ type: 'text', text: 'l' }] },
        ]);
    });
});

describe('direction and language (§2.2, §5.4)', () => {
    it('RTL list is upstream\'s', () => {
        expect([...RTL_LANGUAGES]).toEqual(['ar', 'he', 'fa', 'ps', 'ur']);
    });

    it.each(['ar', 'ar_SA', 'fa-IR', 'he_IL', 'ur_PK', 'ps', 'AR'])('%s → rtl', (loc) => {
        setMessages({ '@@ui_locale': loc });
        expect(getLocaleInfo().dir).toBe('rtl');
    });

    it.each([
        ['en_US', 'en-US'], ['pt_BR', 'pt-BR'], ['zh_TW', 'zh-TW'], ['nn', 'en'], ['de', 'de'], ['fil', 'fil'],
    ])('%s → ltr, lang %s', (loc, lang) => {
        setMessages({ '@@ui_locale': loc });
        expect(getLocaleInfo()).toMatchObject({ dir: 'ltr', lang });
    });

    it("'' falls back to getUILanguage(), then to en", () => {
        setMessages({ '@@ui_locale': '' });
        fake.i18n.getUILanguage.mockReturnValue('he-IL');
        expect(getLocaleInfo()).toMatchObject({ uiLocale: 'he-IL', dir: 'rtl', lang: 'he-IL' });
        fake.i18n.getUILanguage.mockReturnValue('');
        expect(getLocaleInfo()).toEqual({ uiLocale: 'en', language: 'en', dir: 'ltr', lang: 'en' });
        vi.stubGlobal('browser', undefined);
        expect(getLocaleInfo()).toEqual({ uiLocale: 'en', language: 'en', dir: 'ltr', lang: 'en' });
    });

    it('initDocumentLocale() with fa sets html dir+lang and body dir', () => {
        setMessages({ '@@ui_locale': 'fa' });
        const info = initDocumentLocale();
        expect(info.dir).toBe('rtl');
        expect(document.documentElement.getAttribute('dir')).toBe('rtl');
        expect(document.documentElement.getAttribute('lang')).toBe('fa');
        expect(document.body.getAttribute('dir')).toBe('rtl');
    });

    it('initDocumentLocale() with en_US sets ltr / en-US', () => {
        setMessages({ '@@ui_locale': 'en_US' });
        initDocumentLocale();
        expect(document.documentElement.getAttribute('dir')).toBe('ltr');
        expect(document.documentElement.getAttribute('lang')).toBe('en-US');
        expect(document.body.getAttribute('dir')).toBe('ltr');
    });

    it('LocaleDirectionProvider feeds Radix direction context', () => {
        function Probe() { return <span>{Direction.useDirection()}</span>; }
        const { container } = render(<LocaleDirectionProvider dir="rtl"><Probe /></LocaleDirectionProvider>);
        expect(container.textContent).toBe('rtl');
    });
});

describe('helpers', () => {
    it('formatNumber is toLocaleString() with no argument', () => {
        expect(formatNumber(113615)).toBe((113615).toLocaleString());
        expect(formatNumber(0)).toBe('0');
    });

    it('modeNameKey / groupNameKey', () => {
        expect([0, 1, 2, 3].map(l => modeNameKey(l as 0 | 1 | 2 | 3))).toEqual(['filteringMode0Name', 'filteringMode1Name', 'filteringMode2Name', 'filteringMode3Name']);
        expect(['default', 'ads', 'misc', 'imported'].map(groupNameKey)).toEqual(['3pGroupDefault', '3pGroupAds', '3pGroupMisc', '3pGroupImported']);
    });
});

/* ------------------------------------------------------------------------ */
/* Every shipped message (fixture copies of PRISTINE/_locales)               */
/* ------------------------------------------------------------------------ */

const localeEntries = Object.entries(LOCALE_FILES)
    .map(([path, json]) => [/locales\/([^/]+)\.json$/.exec(path)![1], json] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

describe.skipIf(localeEntries.length === 0)('all shipped messages (PRISTINE/_locales)', () => {
    it('t() equals <T> text for every message, <T> output is always safe, dir is rtl exactly for ar fa he ur', () => {
        let count = 0;
        const rtl: string[] = [];
        expect(localeEntries).toHaveLength(71);
        for (const [locale, json] of localeEntries) {
            const messages: Record<string, string> = { '@@ui_locale': locale };
            for (const [k, v] of Object.entries(json)) { messages[k] = v.message; }
            setMessages(messages);
            if (getLocaleInfo().dir === 'rtl') { rtl.push(locale); }
            for (const key of Object.keys(json)) {
                const markup = renderToStaticMarkup(<T k={key} />);
                const host = document.createElement('div');
                host.innerHTML = markup; // test-side inspection only
                expectSafeDom(host);
                expect(host.textContent, `${locale}:${key}`).toBe(t(key));
                expect(t(key)).toBe(t(key).trim());
                count += 1;
            }
        }
        expect(count).toBe(8236);
        expect(rtl).toEqual(['ar', 'fa', 'he', 'ur']);
    });
});

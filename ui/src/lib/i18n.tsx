/**
 * Localisation for the React pages. Contract and reference implementation:
 * docs/specs/i18n.md §5 (this file follows §5.2, adapted to src/lib/ext.ts).
 *
 * - `t(key, subs)`: plain text. '' when the key is missing or empty in the active
 *   locale (spec §5.4 row 1; upstream skips such elements, i18n.js:195). The
 *   result is trimmed, allowed inline tags are stripped (their text is kept),
 *   `{{name}}` placeholders are replaced from `subs`; unknown ones stay verbatim.
 * - `tNew(key, english, subs)`: for strings no locale has; English unless the
 *   browser has a message for `key`. Every tNew key must be listed in the
 *   author's report (spec §5.1 item 8).
 * - `<T k subs fallback />`: rich rendering. The seven allowed tags
 *   (`a b code em i span u`) become React elements; every other tag token is
 *   dropped (its inner text is kept as text); attributes are all dropped except an
 *   `https://` `href` on `<a>` (rendered with target=_blank, rel=noopener
 *   noreferrer). It never injects raw HTML and never runs an HTML parser:
 *   text only ever becomes React text nodes.
 * - `initDocumentLocale()`: sets `<html dir lang>` and `<body dir>` before the
 *   first render; `LocaleDirectionProvider` passes the direction to Radix.
 * - `formatNumber(n)` = `n.toLocaleString()` (the one place numbers are formatted).
 *
 * Missing keys: the result is '' in every build (spec §5.4). In a development
 * build (not in unit tests) the first empty lookup of each key is reported with
 * `console.warn`, so typos show up without changing what is rendered.
 */

import { Fragment, cloneElement, createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Direction } from 'radix-ui';
import { i18n } from './ext';

/** Upstream list, src/js/i18n.js:41. `ps` has no _locales folder. */
export const RTL_LANGUAGES: readonly string[] = ['ar', 'he', 'fa', 'ps', 'ur'];

/** Primary language subtags of the 71 folders in PRISTINE/_locales. */
export const SHIPPED_LANGUAGES: readonly string[] = [
    'ar', 'az', 'be', 'bg', 'bn', 'br', 'bs', 'ca', 'cs', 'cv', 'cy', 'da', 'de',
    'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'fy', 'gl', 'gu',
    'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'ja', 'ka', 'kk', 'kn', 'ko', 'lt',
    'lv', 'mk', 'ml', 'mr', 'ms', 'nb', 'nl', 'oc', 'pa', 'pl', 'pt', 'ro', 'ru',
    'si', 'sk', 'sl', 'so', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk',
    'ur', 'vi', 'zh',
];

export type RichTag = 'a' | 'b' | 'code' | 'em' | 'i' | 'span' | 'u';
const ALLOWED_TAGS: ReadonlySet<string> = new Set<RichTag>(['a', 'b', 'code', 'em', 'i', 'span', 'u']);

export type RichNode =
    | { type: 'text'; text: string }
    | { type: 'slot'; name: string }
    | { type: 'tag'; tag: RichTag; href?: string; children: RichNode[] };

export type Subs = Readonly<Record<string, string | number>>;
export type RichSubs = Readonly<Record<string, ReactNode>>;

const ENTITIES: Readonly<Record<string, string>> = {
    '&shy;': '­', '&ldquo;': '“', '&rdquo;': '”',
    '&lsquo;': '‘', '&rsquo;': '’', '&lt;': '<', '&gt;': '>',
};
const decodeEntities = (s: string): string =>
    s.indexOf('&') === -1 ? s : s.replace(/&[a-z]+;/g, m => ENTITIES[m] ?? m);

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)\/?>/g;
const SLOT_RE = /\{\{(\w+)\}\}/g;
const HREF_RE = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const SAFE_HREF_RE = /^https:\/\/[^\s"'<>]+$/;

function pushText(out: RichNode[], raw: string): void {
    let last = 0;
    for (const m of raw.matchAll(SLOT_RE)) {
        if (m.index > last) out.push({ type: 'text', text: decodeEntities(raw.slice(last, m.index)) });
        out.push({ type: 'slot', name: m[1] });
        last = m.index + m[0].length;
    }
    if (last < raw.length) out.push({ type: 'text', text: decodeEntities(raw.slice(last)) });
}

/**
 * Pure parser (exported for unit tests). Allowed tags become `tag` nodes,
 * `{{name}}` becomes a `slot`, everything else is text. A closing tag with no
 * matching opener is ignored; tags left open are closed at the end.
 */
export function parseRich(message: string): RichNode[] {
    const root: RichNode[] = [];
    const stack: { tag: string; children: RichNode[] }[] = [{ tag: '', children: root }];
    let last = 0;
    for (const m of message.matchAll(TAG_RE)) {
        pushText(stack[stack.length - 1].children, message.slice(last, m.index));
        last = m.index + m[0].length;
        const tag = m[2].toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) continue;            // tag token dropped, inner text kept
        if (m[1] === '/') {
            let i = stack.length - 1;
            while (i > 0 && stack[i].tag !== tag) i -= 1;
            if (i > 0) stack.length = i;                   // unmatched close tags are ignored
            continue;
        }
        const node: RichNode = { type: 'tag', tag: tag as RichTag, children: [] };
        if (tag === 'a') {
            const h = HREF_RE.exec(m[3]);
            const href = h === null ? undefined : (h[1] ?? h[2]);
            if (href !== undefined && SAFE_HREF_RE.test(href)) node.href = href;
        }
        stack[stack.length - 1].children.push(node);
        stack.push({ tag, children: node.children });
    }
    pushText(stack[stack.length - 1].children, message.slice(last));
    return root;                                         // tags left open are closed implicitly
}

function plain(nodes: readonly RichNode[], subs?: Subs): string {
    let out = '';
    for (const n of nodes) {
        if (n.type === 'text') out += n.text;
        else if (n.type === 'slot') out += subs !== undefined && Object.hasOwn(subs, n.name) ? String(subs[n.name]) : `{{${n.name}}}`;
        else out += plain(n.children, subs);
    }
    return out;
}

/* ------------------------------------------------------------------------ */
/* Lookup                                                                    */
/* ------------------------------------------------------------------------ */

const warned = new Set<string>();

function reportEmpty(key: string): void {
    if (!import.meta.env.DEV || import.meta.env.MODE === 'test') { return; }
    if (warned.has(key)) { return; }
    warned.add(key);
    console.warn(`[i18n] no message for "${key}" (missing key, empty translation, or no browser.i18n)`);
}

function rawMessage(key: string): string {
    let s: unknown;
    try {
        s = i18n.getMessage(key);                      // exactly one argument (spec §7 item 1)
    } catch {
        s = '';
    }
    return typeof s === 'string' ? s.trim() : '';
}

/** Plain text for `key` ('' when missing/empty). Safe for attributes. */
export function t(key: string, subs?: Subs): string {
    const raw = rawMessage(key);
    if (raw === '') {
        reportEmpty(key);
        return '';
    }
    return plain(parseRich(raw), subs);
}

/** A string that exists in no locale file: `english` unless the browser has `key`. */
export function tNew(key: string, english: string, subs?: Subs): string {
    return plain(parseRich(rawMessage(key) || english), subs);
}

/**
 * Upstream strings name the upstream product ("uBO Lite") in prose, e.g. the
 * user-scripts hints that tell the user which extension to look for in the
 * browser's extensions page. That extension is listed under this extension's
 * name (`extName`, "Blocker"), so the name is substituted. Only for the keys
 * that need it; `t()` itself never rewrites text.
 */
export function withProductName(text: string): string {
    if (!text.includes(UPSTREAM_PRODUCT_NAME)) return text;
    const name = rawMessage('extName') || 'Blocker';
    return text.split(UPSTREAM_PRODUCT_NAME).join(name);
}
const UPSTREAM_PRODUCT_NAME = 'uBO Lite';

/** `n.toLocaleString()` with no argument (parity: filter-lists.js:36-38). */
export function formatNumber(n: number): string {
    return n.toLocaleString();
}

export const modeNameKey = (level: 0 | 1 | 2 | 3): string => `filteringMode${level}Name`;
export const groupNameKey = (groupId: string): string =>
    `3pGroup${groupId.charAt(0).toUpperCase()}${groupId.slice(1)}`;  // filter-lists.js:293

/* ------------------------------------------------------------------------ */
/* <T>                                                                       */
/* ------------------------------------------------------------------------ */

export interface TProps {
    k: string;
    subs?: RichSubs;
    /** English text used when the key resolves to '' (tNew-style keys). */
    fallback?: string;
    /** Replace the upstream product name with this extension's name (see withProductName). */
    productName?: boolean;
}

function render(nodes: readonly RichNode[], subs: RichSubs | undefined, prefix: string): ReactNode[] {
    return nodes.map((n, i): ReactNode => {
        const key = `${prefix}${i}`;
        if (n.type === 'text') return n.text;
        if (n.type === 'slot') {
            if (subs === undefined || !Object.hasOwn(subs, n.name)) return `{{${n.name}}}`;
            const v = subs[n.name];
            return isValidElement(v) ? cloneElement(v, { key }) : v;
        }
        const children = render(n.children, subs, `${key}.`);
        if (n.tag !== 'a') return createElement(n.tag, { key }, ...children);
        if (n.href === undefined) return createElement(Fragment, { key }, ...children);
        return createElement('a', { key, href: n.href, target: '_blank', rel: 'noopener noreferrer' }, ...children);
    });
}

/** Rich rendering of `k` (see file header). Renders nothing when the message is ''. */
export function T({ k, subs, fallback, productName }: TProps): ReactElement | null {
    const message = rawMessage(k) || fallback || '';
    const raw = productName === true ? withProductName(message) : message;
    if (raw === '') {
        reportEmpty(k);
        return null;
    }
    return createElement(Fragment, null, ...render(parseRich(raw), subs, ''));
}

/* ------------------------------------------------------------------------ */
/* Direction and language                                                    */
/* ------------------------------------------------------------------------ */

export interface LocaleInfo {
    /** Raw `@@ui_locale` (or getUILanguage()). */
    uiLocale: string;
    /** Lower-cased primary subtag. */
    language: string;
    dir: 'ltr' | 'rtl';
    /** BCP 47 tag for <html lang>. */
    lang: string;
}

export function getLocaleInfo(): LocaleInfo {
    let uiLocale = '';
    try { uiLocale = i18n.getMessage('@@ui_locale') || ''; } catch { /* empty */ }
    if (typeof uiLocale !== 'string') uiLocale = '';
    if (uiLocale === '') {
        try { uiLocale = i18n.getUILanguage() || ''; } catch { /* empty */ }
        if (typeof uiLocale !== 'string') uiLocale = '';
    }
    if (uiLocale === '') uiLocale = 'en';
    const language = uiLocale.split(/[-_]/)[0].toLowerCase();
    const dir = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
    const lang = SHIPPED_LANGUAGES.includes(language) ? uiLocale.replace(/_/g, '-') : 'en';
    return { uiLocale, language, dir, lang };
}

/**
 * Sets `<html dir>`, `<html lang>` and `<body dir>` (upstream sets body[dir],
 * i18n.js:39-44). Call once per entry, before createRoot().render().
 */
export function initDocumentLocale(doc: Document = document): LocaleInfo {
    const info = getLocaleInfo();
    doc.documentElement.setAttribute('dir', info.dir);
    doc.documentElement.setAttribute('lang', info.lang);
    doc.body?.setAttribute('dir', info.dir);
    return info;
}

/**
 * Radix direction context for an app root (spec §2.2 item 4). Radix reads the
 * direction from React context, not from the DOM.
 */
export function LocaleDirectionProvider({ dir, children }: { dir: 'ltr' | 'rtl'; children?: ReactNode }): ReactElement {
    return <Direction.Provider dir={dir}>{children}</Direction.Provider>;
}

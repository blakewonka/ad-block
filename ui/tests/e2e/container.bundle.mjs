/**
 * Container window, built bundle checks without a browser
 * (docs/specs/container.md §12.1 static checks and §12.2 happy-dom behaviour).
 *
 *   npm run build:container && node --test tests/e2e/container.bundle.mjs
 *   BLOCKER_CONTAINER_DIR=<private build> node --test tests/e2e/container.bundle.mjs
 *
 * Skips when the container build does not exist.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { Script } from 'node:vm';

import { Window } from 'happy-dom';

import { CONTAINER_DIR } from './lib/harness.mjs';

const HAVE_BUILD = existsSync(path.join(CONTAINER_DIR, 'Script.js'));
const skip = HAVE_BUILD ? false : `container build not found at ${CONTAINER_DIR} (run npm run build:container)`;

const T = {
    prefs: {
        unknown: 'You can turn on Blocker’s extension in Safari Extensions preferences.',
        on: 'Blocker’s extension is currently on. You can turn it off in Safari Extensions preferences.',
        off: 'Blocker’s extension is currently off. You can turn it on in Safari Extensions preferences.',
        button: 'Quit and Open Safari Extensions Preferences…',
    },
    settings: {
        unknown: 'You can turn on Blocker’s extension in the Extensions section of Safari Settings.',
        on: 'Blocker’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.',
        off: 'Blocker’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.',
        button: 'Quit and Open Safari Settings…',
    },
};
const SENTENCES = [T.prefs.unknown, T.prefs.on, T.prefs.off, T.settings.unknown, T.settings.on, T.settings.off];

/** Lines 1-11 of the Xcode template Main.html (spec §11.2.12, parity row 21). */
const TEMPLATE_HEAD = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    `    <meta http-equiv="Content-Security-Policy" content="default-src 'self'">`,
    '',
    '    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">',
    '',
    '    <link rel="stylesheet" href="../Style.css">',
    '    <script src="../Script.js" defer></script>',
    '</head>',
].join('\n');

const read = (rel) => readFileSync(path.join(CONTAINER_DIR, rel), 'utf8');
const count = (haystack, needle) => haystack.split(needle).length - 1;

function listFiles(dir, base = dir) {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
    });
}

/** Container sources whose edits must be followed by a rebuild (tests excluded). */
function containerSources() {
    const uiRoot = path.resolve(import.meta.dirname, '../..');
    const srcDir = path.join(uiRoot, 'src/container');
    const files = listFiles(srcDir)
        .filter((rel) => !/\.test\.[cm]?[jt]sx?$/.test(rel))
        .map((rel) => path.join(srcDir, rel));
    files.push(path.join(uiRoot, 'container/Main.html'));
    return files;
}

describe('container bundle: static checks (spec §12.1)', { skip }, () => {
    // A stale build (for example the scaffold placeholder left in dist/container)
    // otherwise shows up as a dozen unrelated assertion failures further down.
    test('the build is newer than every container source (else run npm run build:container)', () => {
        const built = Math.min(...['Script.js', 'Style.css', 'Base.lproj/Main.html'].map((rel) => statSync(path.join(CONTAINER_DIR, rel)).mtimeMs));
        const stale = containerSources().filter((file) => statSync(file).mtimeMs > built);
        assert.deepEqual(
            stale.map((file) => path.relative(path.resolve(import.meta.dirname, '../..'), file)),
            [],
            `${CONTAINER_DIR} is older than these sources; run npm run build:container (or rebuild the private BLOCKER_CONTAINER_DIR) first`,
        );
    });

    test('exactly Base.lproj/Main.html, Script.js, Style.css', () => {
        assert.deepEqual(listFiles(CONTAINER_DIR).sort(), ['Base.lproj/Main.html', 'Script.js', 'Style.css']);
    });

    test('Main.html keeps the template head byte-for-byte and has no inline code', () => {
        const html = read('Base.lproj/Main.html');
        assert.ok(html.startsWith(TEMPLATE_HEAD + '\n'), 'lines 1-11 equal the Xcode template');
        assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`));
        assert.ok(html.includes('<div id="root"></div>'));
        for (const re of [/type\s*=\s*["']?module/i, /<style/i, /\sstyle\s*=/i, /\son[a-z]+\s*=/i, /<a\s/i, /<form/i, /https?:\/\//i, /data:/i, /blob:/i]) {
            assert.doesNotMatch(html, re);
        }
        for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) assert.equal(m[1].trim(), '');
    });

    test('Script.js is one classic script without forbidden constructs', () => {
        const js = read('Script.js');
        assert.doesNotThrow(() => new Script(js, { filename: 'Script.js' }), 'parses as a classic script');
        for (const banned of [
            'eval(', 'new Function(', 'import(', 'import.meta', 'react-style-singleton', 'RemoveScroll', 'cdn.openai.com',
            'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'BroadcastChannel', 'fetch(',
            'XMLHttpRequest', 'location.reload', 'location.replace', 'location.assign', 'history.pushState',
            'insertRule', 'adoptedStyleSheets', '.cssRules', '__BLOCKER_MOCK__',
        ]) {
            assert.equal(js.includes(banned), false, `Script.js must not contain ${banned}`);
        }
        // The one tolerated bare Function( call: lodash's global-object idiom
        // `freeGlobal || freeSelf || Function('return this')()` (pulled in through the
        // library). In a page `self` is an object, so the `||` short-circuits and it
        // never runs; under CSP it would throw, not evaluate. Any other Function( fails.
        const GLOBAL_IDIOM = /\|\|\s*Function\(\s*(?:`return this`|"return this"|'return this')\s*\)\(\)/g;
        assert.ok((js.match(GLOBAL_IDIOM) ?? []).length <= 1, 'at most one lodash global idiom');
        const rest = js.replace(GLOBAL_IDIOM, '||null');
        assert.equal(rest.match(/(?<![\w$.])Function\s*\(/g), null, 'no Function( call besides the guarded global idiom');
        assert.ok(count(js, 'createElement(`style`)') + count(js, 'createElement("style")') <= 1, 'at most React DOM’s one createElement(style)');
        assert.equal(count(js, 'messageHandlers'), 1, 'one place touches webkit.messageHandlers');
        assert.equal(count(js, 'open-preferences'), 1, 'one shared literal "open-preferences"');
    });

    test('Script.js contains the 8 template strings verbatim', () => {
        const js = read('Script.js');
        for (const s of [...SENTENCES, T.prefs.button, T.settings.button, 'Blocker Icon']) {
            const escaped = s.replace(/’/g, '\\u2019').replace(/…/g, '\\u2026');
            assert.ok(js.includes(s) || js.includes(escaped), `missing: ${s}`);
        }
    });

    test('Style.css: no remote/data URLs, no @import/@font-face, color-scheme + pre-theme fallback', () => {
        const css = read('Style.css');
        assert.doesNotMatch(css, /url\(\s*["']?(?:data:|https?:|\/\/)/i);
        assert.doesNotMatch(css, /@import\b/i);
        assert.doesNotMatch(css, /@font-face/i);
        assert.match(css, /:root[^{}]*\{[^}]*color-scheme:\s*light dark/);
        assert.match(css, /html:not\(\[data-theme\]\)[^{]*\{[^}]*background:\s*canvas/i);
        assert.match(css, /-webkit-user-drag:\s*none/);
        assert.match(css, /user-select:\s*none/);
        assert.match(css, /cursor:\s*default/);
        // Pre-theme dark first paint uses the dark surface/text values, not Canvas (#121212 in Chrome).
        assert.match(css, /@media \(prefers-color-scheme:\s*dark\)\s*\{\s*html:not\(\[data-theme\]\)[^{]*\{[^}]*background:\s*#212121/i);
        // Fallback button: token hover/pressed fills and the library ring colour are generated.
        assert.match(css, /\.focus-visible\\:outline-\\\(--color-ring\\\)/);
        assert.match(css, /\.hover\\:bg-primary-solid-hover/);
        assert.match(css, /\.active\\:bg-primary-solid-active/);
        // The library Button may wrap (classes from src/container/texts.ts LAYOUT.button).
        assert.match(css, /\.min-h-\\\(--button-size\\\)/);
        assert.match(css, /\.text-balance\{/);
    });
});

/**
 * Loads the built page into a fresh happy-dom window and evaluates Script.js
 * synchronously. `beforeEval(w)` runs first (stubs, property hooks).
 */
function openPage({ webkit = true, beforeEval } = {}) {
    const html = read('Base.lproj/Main.html')
        .replace(/<script\b[^>]*><\/script>/gi, '')
        .replace(/<link\b[^>]*>/gi, '');
    const w = new Window({ url: 'file:///app/Contents/Resources/Base.lproj/Main.html', width: 425, height: 325 });
    w.document.write(html);
    const posted = [];
    if (webkit) w.webkit = { messageHandlers: { controller: { postMessage: (m) => posted.push(m) } } };
    beforeEval?.(w);
    w.eval(read('Script.js'));
    const syncType = typeof w.show; // read in the same synchronous turn as the evaluation
    return { w, posted, syncType };
}

async function settle(w) {
    await new Promise((r) => setTimeout(r, 30));
    await w.happyDOM.waitUntilComplete();
}

function snapshot(w) {
    const d = w.document;
    const text = d.body.textContent ?? '';
    const status = d.querySelector('[role="status"]');
    return {
        sentences: SENTENCES.filter((s) => text.includes(s)),
        status: status?.textContent ?? null,
        live: status?.getAttribute('aria-live') ?? null,
        buttons: [...d.querySelectorAll('button')].map((b) => b.textContent),
        icons: d.querySelectorAll('img[src="../Icon.png"][alt="Blocker Icon"]').length,
        banned: d.querySelectorAll('a, form, style').length,
        decorative: d.querySelectorAll('[aria-hidden="true"]').length,
        lang: d.documentElement.getAttribute('lang'),
        fallback: d.querySelector('[data-container-fallback]') !== null,
    };
}

function assertShows(w, sentence, button) {
    const s = snapshot(w);
    assert.deepEqual(s.sentences, [sentence], 'exactly one state sentence in the DOM');
    assert.equal(s.status, sentence, 'the sentence is the live status region');
    assert.equal(s.live, 'polite');
    assert.deepEqual(s.buttons, [button], 'exactly one button with the expected label');
    assert.equal(s.icons, 1, 'icon present');
    assert.equal(s.banned, 0, 'no a/form/style element');
    assert.equal(s.decorative, 0, 'no decorative status dot');
    assert.equal(s.lang, 'en');
    assert.equal(s.fallback, false, 'React mounted (not the plain fallback)');
}

describe('container bundle: show() and the button in happy-dom (spec §12.2)', { skip }, () => {
    test('show is a function synchronously after evaluation and is assigned before React initialises', async () => {
        const order = [];
        const { w, syncType } = openPage({
            beforeEval(win) {
                let fn;
                Object.defineProperty(win, 'show', {
                    configurable: true,
                    get: () => fn,
                    set: (v) => {
                        fn = v;
                        order.push('show');
                    },
                });
                // React's first module-level work: Symbol.for('react.…') (react, react-dom).
                const symbolFor = win.Symbol.for;
                win.Symbol.for = function (key) {
                    if (typeof key === 'string' && key.startsWith('react.') && !order.some((o) => o.startsWith('react'))) {
                        order.push(`react theme=${win.document.documentElement.getAttribute('data-theme')}`);
                    }
                    return symbolFor.call(this, key);
                };
            },
        });
        try {
            assert.equal(syncType, 'function');
            assert.equal(w.document.documentElement.getAttribute('lang'), 'en', 'html[lang] set at evaluation (WCAG 3.1.1)');
            assert.deepEqual(order, ['show', 'react theme=light'], 'show is assigned, and data-theme set, before React initialises');
        } finally {
            await w.happyDOM.close();
        }
    });

    test('initial state, a call before mount, and every state/wording', async () => {
        // No call: unknown / Preferences.
        let page = openPage();
        await settle(page.w);
        assertShows(page.w, T.prefs.unknown, T.prefs.button);
        await page.w.happyDOM.close();

        // A call in the same turn as the evaluation (before React could mount) is not lost.
        page = openPage();
        assert.equal(page.syncType, 'function');
        page.w.show(false, true);
        await settle(page.w);
        assertShows(page.w, T.settings.off, T.settings.button);
        // Repeated calls (upstream breaks here; spec §4.4.5) and the one-way wording.
        for (const [args, sentence] of [
            [[true, true], T.settings.on],
            [[false, true], T.settings.off],
            [[true, true], T.settings.on],
            [[true, false], T.settings.on],
            [[undefined, false], T.settings.unknown],
        ]) {
            assert.equal(page.w.show(...args), undefined);
            await settle(page.w);
            assertShows(page.w, sentence, T.settings.button);
        }
        await page.w.happyDOM.close();

        for (const [args, sentence] of [
            [[true, false], T.prefs.on],
            [[false, false], T.prefs.off],
            [[undefined, false], T.prefs.unknown],
            [['x', false], T.prefs.unknown],
            [[1, false], T.prefs.unknown],
            [[null, false], T.prefs.unknown],
        ]) {
            page = openPage();
            page.w.show(...args);
            await settle(page.w);
            assertShows(page.w, sentence, T.prefs.button);
            await page.w.happyDOM.close();
        }
    });

    test('odd arguments never throw and return undefined', async () => {
        const { w } = openPage();
        try {
            for (const args of [[], [{}, {}], [Symbol('s'), 1], [null, 0]]) {
                assert.equal(w.show(...args), undefined);
            }
            await settle(w);
            // {} and 1 were truthy second arguments: Settings wording, unknown state.
            assertShows(w, T.settings.unknown, T.settings.button);
        } finally {
            await w.happyDOM.close();
        }
    });

    test('the button posts the bare string "open-preferences", once per click', async () => {
        const { w, posted } = openPage();
        try {
            await settle(w);
            w.document.querySelector('button').click();
            assert.deepEqual(posted, ['open-preferences']);
            assert.equal(typeof posted[0], 'string');
            w.document.querySelector('button').click();
            assert.deepEqual(posted, ['open-preferences', 'open-preferences']);
        } finally {
            await w.happyDOM.close();
        }
    });

    test('without window.webkit a click does not throw', async () => {
        const { w } = openPage({ webkit: false });
        const errors = [];
        w.addEventListener('error', (e) => errors.push(String(e.message ?? e)));
        try {
            await settle(w);
            assert.doesNotThrow(() => w.document.querySelector('button').click());
            await settle(w);
            assert.deepEqual(errors, []);
        } finally {
            await w.happyDOM.close();
        }
    });
});

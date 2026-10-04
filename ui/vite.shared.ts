/**
 * Shared pieces of the three Vite configs (extension, container, harness).
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin, PluginOption } from 'vite';

/** Absolute path of ui/ (this file lives at its top level). */
export const projectRoot = dirname(fileURLToPath(import.meta.url));

/** `@/foo` -> `src/foo` (mirrors `paths` in tsconfig.json). */
export const alias = { '@': resolve(projectRoot, 'src') };

/**
 * Syntax floor for emitted JS and CSS. The extension manifest requires
 * Safari 18.6; the container window uses the system WebKit of the same OS.
 */
export const BUILD_TARGET = 'safari18';

/** React (JSX + Fast Refresh in dev) and Tailwind 4. */
export function basePlugins(): PluginOption[] {
    return [react(), tailwindcss(), cssLayerOrder()];
}

/**
 * Cascade-layer order is fixed by the first time each layer name appears in
 * the document. Vite splits the library's CSS-module rules (`@layer
 * components`) into per-chunk files that a page may link BEFORE app.css, which
 * would make `components` the lowest layer so Tailwind's preflight (`@layer
 * base`) overrides the library's component styles (invisible Switch tracks and
 * Checkbox boxes in the shipped dashboard). Prepending the canonical order to
 * every emitted stylesheet makes the result independent of link order.
 */
export const CSS_LAYER_ORDER = '@layer properties, theme, base, components, utilities;';

export function cssLayerOrder(): Plugin {
    return {
        name: 'blocker-css-layer-order',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            for (const asset of Object.values(bundle)) {
                if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) { continue; }
                const css = typeof asset.source === 'string'
                    ? asset.source
                    : new TextDecoder().decode(asset.source);
                if (css.startsWith(CSS_LAYER_ORDER)) { continue; }
                asset.source = `${CSS_LAYER_ORDER}\n${css}`;
            }
        },
    };
}

const PRELOAD_HELPER_ID = '\0vite/preload-helper.js';

/**
 * Removes every `crossorigin` attribute Vite adds to the tags it injects
 * (<script type="module">, <link rel="modulepreload">, <link rel="stylesheet">)
 * and the `link.crossOrigin = ""` assignment in Vite's runtime preload helper
 * (used for dynamic `import()`), so that no request is made in CORS mode.
 * Pages are served from `safari-web-extension://` (extension) or `file://`
 * (container), where a CORS-mode fetch of a local file can fail.
 */
export function stripCrossorigin(): Plugin {
    return {
        name: 'blocker:strip-crossorigin',
        apply: 'build',
        enforce: 'post',
        transform(code, id) {
            if (id !== PRELOAD_HELPER_ID) return null;
            const out = code.replace(/\blink\.crossOrigin\s*=\s*(?:""|'')\s*;?/g, '');
            if (out === code) {
                this.error(
                    'blocker:strip-crossorigin: Vite preload helper no longer contains `link.crossOrigin = ""`; ' +
                        'update the pattern in vite.shared.ts for this Vite version.',
                );
            }
            return { code: out, map: null };
        },
        transformIndexHtml: {
            order: 'post',
            handler(html) {
                return html.replace(/<(?:script|link)\b[^>]*>/gi, (tag) =>
                    tag.replace(/\s+crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, ''),
                );
            },
        },
    };
}

/** Returns a list of rule violations found in an HTML document we ship. */
export function findHtmlViolations(html: string): string[] {
    const problems: string[] = [];
    const tags = html.match(/<[a-zA-Z][^>]*>/g) ?? [];
    for (const tag of tags) {
        const name = /^<([a-zA-Z0-9-]+)/.exec(tag)?.[1]?.toLowerCase() ?? '';
        if (name === 'style') problems.push(`inline <style> element: ${tag}`);
        if (/\sstyle\s*=/i.test(tag)) problems.push(`style attribute: ${tag}`);
        if (/\son[a-z]+\s*=/i.test(tag)) problems.push(`inline event handler: ${tag}`);
        if (/\scrossorigin\b/i.test(tag)) problems.push(`crossorigin attribute: ${tag}`);
        if (name === 'script' && !/\ssrc\s*=/i.test(tag)) problems.push(`<script> without src: ${tag}`);
        if (/\s(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(tag)) problems.push(`remote URL: ${tag}`);
        if (/\s(?:src|href)\s*=\s*["']?\s*(?:data|javascript|blob):/i.test(tag)) problems.push(`non-file URL: ${tag}`);
    }
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        if ((m[1] ?? '').trim() !== '') problems.push('<script> with an inline body');
    }
    return problems;
}

/**
 * Build-time gate for UI rules §5 and §6.1 (docs/specs/README.md): the emitted HTML
 * may reference external files only. Fails the build otherwise.
 */
export function htmlGuard(): Plugin {
    return {
        name: 'blocker:html-guard',
        apply: 'build',
        enforce: 'post',
        transformIndexHtml: {
            order: 'post',
            handler(html, ctx) {
                const problems = findHtmlViolations(html);
                if (problems.length > 0) {
                    throw new Error(
                        `blocker:html-guard: ${ctx.path} breaks the "external files only" rule:\n  - ` +
                            problems.join('\n  - '),
                    );
                }
                return html;
            },
        },
    };
}

/**
 * Build-time gate for UI rule §6.4 (docs/specs/README.md): production bundles
 * (extension, container) must never contain the mock browser API or any
 * other harness-only module. Fails the build when a module from `src/dev/`
 * or `harness/` ends up in a chunk.
 */
export function noDevModules(): Plugin {
    const banned = [resolve(projectRoot, 'src/dev') + sep, resolve(projectRoot, 'harness') + sep];
    return {
        name: 'blocker:no-dev-modules',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            const hits = new Set<string>();
            for (const item of Object.values(bundle)) {
                if (item.type !== 'chunk') continue;
                for (const id of item.moduleIds) {
                    const file = id.replace(/^\0+/, '').split('?')[0] ?? id;
                    if (banned.some((dir) => file.startsWith(dir))) hits.add(relative(projectRoot, file));
                }
            }
            if (hits.size > 0) {
                this.error(
                    'blocker:no-dev-modules: harness-only modules were bundled into a production build ' +
                        '(production entries must not import src/dev/* or harness/*):\n  - ' +
                        [...hits].sort().join('\n  - '),
                );
            }
        },
    };
}

/**
 * Container-app page: emits `container/Main.html` as `Base.lproj/Main.html`
 * next to the single `Script.js` / `Style.css`, and refuses to produce
 * anything the Xcode project could not load (ES module syntax, extra files,
 * data:/remote URLs that `default-src 'self'` would block).
 */
export function containerPage(): Plugin {
    const source = resolve(projectRoot, 'container/Main.html');
    return {
        name: 'blocker:container-page',
        apply: 'build',
        enforce: 'post',
        buildStart() {
            this.addWatchFile(source);
        },
        generateBundle(_options, bundle) {
            const html = readFileSync(source, 'utf8');
            const problems = findHtmlViolations(html);
            if (!html.includes('href="../Style.css"')) problems.push('missing <link rel="stylesheet" href="../Style.css">');
            if (!/<script src="\.\.\/Script\.js" defer><\/script>/.test(html)) {
                problems.push('missing <script src="../Script.js" defer></script>');
            }
            if (/type\s*=\s*["']?module/i.test(html)) problems.push('type="module" is not allowed (file:// origin)');
            if (!/http-equiv="Content-Security-Policy"/.test(html)) problems.push('missing CSP <meta>');

            const names = Object.keys(bundle).sort();
            const expected = ['Script.js', 'Style.css'];
            if (names.join(',') !== expected.join(',')) {
                problems.push(`bundle must be exactly ${expected.join(' + ')}, got: ${names.join(', ') || '(nothing)'}`);
            }
            const script = bundle['Script.js'];
            if (script && script.type === 'chunk') {
                try {
                    // Parses as a classic script: import/export/import.meta are syntax errors here.
                    new Script(script.code, { filename: 'Script.js' });
                } catch (err) {
                    problems.push(`Script.js is not a classic script: ${(err as Error).message}`);
                }
            }
            const style = bundle['Style.css'];
            if (style && style.type === 'asset') {
                const css = typeof style.source === 'string' ? style.source : Buffer.from(style.source).toString('utf8');
                if (/url\(\s*["']?(?:data:|https?:|\/\/)/i.test(css)) problems.push('Style.css contains a data: or remote url()');
                if (/@import\b/i.test(css)) problems.push('Style.css contains @import');
            }
            if (problems.length > 0) {
                this.error(`blocker:container-page:\n  - ${problems.join('\n  - ')}`);
            }
            this.emitFile({ type: 'asset', fileName: 'Base.lproj/Main.html', source: html });
        },
    };
}

/* ------------------------------------------------------------------------ */
/* Third-party licence notices                                               */
/* ------------------------------------------------------------------------ */

/**
 * Copyright holders of every third-party package that can end up in a
 * production bundle (checked against each package's LICENSE file). The
 * minifier drops the packages' licence headers, so the notices are shipped
 * separately: `ui/THIRD-PARTY-NOTICES.txt` in the extension, a `/*! … *\/`
 * banner at the top of the container's `Script.js` (the Xcode project takes
 * exactly Main.html, Script.js and Style.css). `thirdPartyNotices()` fails the
 * build when a bundled package has no entry here, so a new dependency cannot
 * ship without its notice.
 */
const NOTICE_HOLDERS: { match: (name: string) => boolean; license: 'MIT' | '0BSD'; copyright: string }[] = [
    { match: (n) => n === '@openai/apps-sdk-ui', license: 'MIT', copyright: 'Copyright 2025 OpenAI' },
    { match: (n) => ['react', 'react-dom', 'scheduler'].includes(n), license: 'MIT', copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.' },
    { match: (n) => n.startsWith('@radix-ui/'), license: 'MIT', copyright: 'Copyright (c) 2022 WorkOS' },
    { match: (n) => n.startsWith('@floating-ui/'), license: 'MIT', copyright: 'Copyright (c) 2021-present Floating UI contributors' },
    {
        match: (n) => ['aria-hidden', 'react-remove-scroll', 'react-style-singleton', 'use-callback-ref', 'use-sidecar'].includes(n),
        license: 'MIT',
        copyright: 'Copyright (c) 2017 Anton Korzunov',
    },
    // The package has no LICENSE file; package.json says MIT, author Anton Korzunov.
    { match: (n) => n === 'react-remove-scroll-bar', license: 'MIT', copyright: 'Copyright (c) Anton Korzunov' },
    { match: (n) => n === 'get-nonce', license: 'MIT', copyright: 'Copyright (c) 2020 Anton Korzunov' },
    { match: (n) => n === 'clsx', license: 'MIT', copyright: 'Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)' },
    {
        match: (n) => n === 'lodash.debounce',
        license: 'MIT',
        copyright:
            'Copyright jQuery Foundation and other contributors <https://jquery.org/>\n' +
            'Based on Underscore.js, copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors',
    },
    { match: (n) => n === 'react-merge-refs', license: 'MIT', copyright: 'Copyright (c) 2020 Greg Bergé' },
    { match: (n) => n === 'usehooks-ts', license: 'MIT', copyright: 'Copyright (c) 2020 Julien CARON' },
    { match: (n) => n === 'tslib', license: '0BSD', copyright: 'Copyright (c) Microsoft Corporation.' },
    { match: (n) => n === 'tailwindcss', license: 'MIT', copyright: 'Copyright (c) Tailwind Labs, Inc.' },
    { match: (n) => n === 'vite', license: 'MIT', copyright: 'Copyright (c) 2019-present, VoidZero Inc. and Vite contributors' },
    { match: (n) => n === 'rolldown', license: 'MIT', copyright: 'Copyright (c) 2024-present VoidZero Inc. & Contributors' },
];

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const ZERO_BSD_TEXT = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`;

/** Package name of a bundled module id (`…/node_modules/<name>/…`, or a bundler helper), else null. */
function bundledPackage(id: string): { name: string; dir: string } | null {
    const file = id.replace(/^\0+/, '').split('?')[0] ?? id;
    if (file.startsWith('vite/')) return { name: 'vite', dir: resolve(projectRoot, 'node_modules/vite') };
    if (file.startsWith('rolldown/')) return { name: 'rolldown', dir: resolve(projectRoot, 'node_modules/rolldown') };
    const m = /^(.*[\\/]node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(file);
    if (m === null) return null;
    return { name: m[2]!.split(sep).join('/'), dir: m[1]! + m[2]! };
}

/**
 * Emits the notices for every package bundled into this build, plus
 * Tailwind (its CSS is not a module id). `file`: `ui/THIRD-PARTY-NOTICES.txt`
 * (extension). `banner`: a `/*! … *\/` comment at the top of `bannerChunk`
 * (container Script.js; added after minification, so it is kept).
 */
export function thirdPartyNotices(output: { file: string } | { bannerChunk: string }): Plugin {
    return {
        name: 'blocker:third-party-notices',
        apply: 'build',
        generateBundle(_options, bundle) {
            const packages = new Map<string, string>([['tailwindcss', resolve(projectRoot, 'node_modules/tailwindcss')]]);
            for (const item of Object.values(bundle)) {
                if (item.type !== 'chunk') continue;
                for (const id of item.moduleIds) {
                    const pkg = bundledPackage(id);
                    if (pkg !== null && !packages.has(pkg.name)) packages.set(pkg.name, pkg.dir);
                }
            }
            const groups = new Map<(typeof NOTICE_HOLDERS)[number], string[]>();
            const missing: string[] = [];
            for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
                const holder = NOTICE_HOLDERS.find((h) => h.match(name));
                if (holder === undefined) {
                    missing.push(name);
                    continue;
                }
                const meta = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as { version?: string; license?: string };
                if (meta.license !== holder.license) {
                    missing.push(`${name} (licence is ${String(meta.license)}, the notice says ${holder.license})`);
                    continue;
                }
                groups.set(holder, [...(groups.get(holder) ?? []), `${name} ${meta.version ?? ''}`.trim()]);
            }
            if (missing.length > 0) {
                this.error(
                    'blocker:third-party-notices: bundled packages without a licence notice ' +
                        '(add them to NOTICE_HOLDERS in vite.shared.ts):\n  - ' + missing.join('\n  - '),
                );
            }
            const section = (license: 'MIT' | '0BSD', text: string): string[] => {
                const entries = [...groups].filter(([h]) => h.license === license);
                if (entries.length === 0) return [];
                return [
                    '-------------------------------------------------------------------------------',
                    `${license}-licensed components`,
                    '-------------------------------------------------------------------------------',
                    ...entries.flatMap(([h, names]) => [...names, ...h.copyright.split('\n').map((l) => `    ${l}`), '']),
                    `Each of the ${license}-licensed components above is provided under these terms:`,
                    '',
                    ...text.split('\n').map((l) => (l === '' ? '' : `  ${l}`)),
                    '',
                ];
            };
            const text = [
                'Blocker user interface: third-party software notices',
                '',
                'This user interface includes the third-party software listed below.',
                'Blocker itself is based on uBlock Origin Lite and licensed under GPL-3.0-or-later',
                '(see LICENSE.txt in the extension, or LICENSE in the Blocker source).',
                '',
                ...section('MIT', MIT_TEXT),
                ...section('0BSD', ZERO_BSD_TEXT),
            ].join('\n');
            if (text.includes('*/')) this.error('blocker:third-party-notices: the notice text must not contain "*/"');
            if ('file' in output) {
                this.emitFile({ type: 'asset', fileName: output.file, source: text });
                return;
            }
            const chunk = bundle[output.bannerChunk];
            if (chunk === undefined || chunk.type !== 'chunk') {
                this.error(`blocker:third-party-notices: no chunk named ${output.bannerChunk}`);
            }
            chunk.code = `/*!\n${text}\n*/\n${chunk.code}`;
        },
    };
}

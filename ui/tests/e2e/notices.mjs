/**
 * Third-party licence notices ship with the built UI (regression test: an
 * earlier build shipped none).
 *
 *   npm run build && node --test tests/e2e/notices.mjs
 *   BLOCKER_EXT_DIR=<private ext build> BLOCKER_CONTAINER_DIR=<private container build> node --test tests/e2e/notices.mjs
 *
 * The build itself fails when a bundled package has no notice
 * (`thirdPartyNotices()` in vite.shared.ts); this checks the shipped result.
 * Skips a part whose build does not exist.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { CONTAINER_DIR, UI_ROOT } from './lib/harness.mjs';

const EXT_DIR = process.env.BLOCKER_EXT_DIR ?? path.join(UI_ROOT, 'dist', 'extension');
const EXT_NOTICES = path.join(EXT_DIR, 'ui', 'THIRD-PARTY-NOTICES.txt');
const SCRIPT_JS = path.join(CONTAINER_DIR, 'Script.js');

const version = (name) => JSON.parse(readFileSync(path.join(UI_ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
const MIT_CLAUSE = 'The above copyright notice and this permission notice shall be included in all';

/** Packages that every build bundles, with the copyright line their LICENSE carries. */
const COMMON = [
    ['@openai/apps-sdk-ui', 'Copyright 2025 OpenAI'],
    ['react', 'Copyright (c) Meta Platforms, Inc. and affiliates.'],
    ['react-dom', 'Copyright (c) Meta Platforms, Inc. and affiliates.'],
    ['scheduler', 'Copyright (c) Meta Platforms, Inc. and affiliates.'],
    ['clsx', 'Copyright (c) Luke Edwards'],
    ['lodash.debounce', 'Copyright jQuery Foundation and other contributors'],
    ['usehooks-ts', 'Copyright (c) 2020 Julien CARON'],
    ['tailwindcss', 'Copyright (c) Tailwind Labs, Inc.'],
];

function assertListed(text, name, copyright) {
    assert.ok(text.includes(`\n${name} ${version(name)}\n`), `${name} ${version(name)} is listed`);
    assert.ok(text.includes(copyright), `${name}: "${copyright}"`);
}

describe('extension: ui/THIRD-PARTY-NOTICES.txt', { skip: existsSync(path.join(EXT_DIR, 'popup.html')) ? false : `no extension build in ${EXT_DIR}` }, () => {
    test('ships next to the chunks and names every bundled package with its notice', () => {
        assert.ok(existsSync(EXT_NOTICES), `${EXT_NOTICES} exists`);
        const text = readFileSync(EXT_NOTICES, 'utf8');
        for (const [name, copyright] of [
            ...COMMON,
            ['@radix-ui/react-dialog', 'Copyright (c) 2022 WorkOS'],
            ['@floating-ui/dom', 'Copyright (c) 2021-present Floating UI contributors'],
            ['react-remove-scroll', 'Copyright (c) 2017 Anton Korzunov'],
            ['tslib', 'Copyright (c) Microsoft Corporation.'],
        ]) {
            assertListed(text, name, copyright);
        }
        assert.ok(text.includes(MIT_CLAUSE), 'MIT permission notice');
        assert.ok(text.includes('Permission to use, copy, modify, and/or distribute this software for any'), '0BSD notice (tslib)');
        // Every package whose code is in the chunks is listed: the Radix packages are many, count them.
        const radix = readdirSync(path.join(UI_ROOT, 'node_modules', '@radix-ui')).filter((n) => text.includes(`\n@radix-ui/${n} `));
        assert.ok(radix.length >= 20, `Radix packages listed: ${radix.length}`);
    });
});

describe('container: licence banner at the top of Script.js', { skip: existsSync(SCRIPT_JS) ? false : `no container build in ${CONTAINER_DIR}` }, () => {
    test('Script.js starts with a /*! */ notice that names the bundled packages', () => {
        const js = readFileSync(SCRIPT_JS, 'utf8');
        assert.ok(js.startsWith('/*!\nBlocker user interface: third-party software notices\n'), 'banner first');
        const banner = js.slice(0, js.indexOf('*/'));
        for (const [name, copyright] of [...COMMON, ['react-merge-refs', 'Copyright (c) 2020 Greg Bergé']]) assertListed(banner, name, copyright);
        assert.ok(banner.includes(MIT_CLAUSE), 'MIT permission notice');
        // Only what the container bundles: no Radix / Dialog machinery is named (container spec: no Dialog).
        assert.equal(banner.includes('@radix-ui/'), false);
    });
});

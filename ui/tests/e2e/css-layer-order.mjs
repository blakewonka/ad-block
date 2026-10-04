// Regression: every shipped stylesheet must start with the canonical cascade-layer
// order, otherwise a component chunk linked before app.css makes `@layer components`
// the lowest layer and Tailwind preflight hides Switch tracks / Checkbox boxes
// (found in a shipped dashboard). Run after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ORDER = '@layer properties, theme, base, components, utilities;';
const root = path.resolve(import.meta.dirname, '../../dist');
const files = [
    ...fs.readdirSync(path.join(root, 'extension/ui')).filter(f => f.endsWith('.css')).map(f => path.join(root, 'extension/ui', f)),
    path.join(root, 'container/Style.css'),
];

test('every shipped stylesheet declares the cascade-layer order first', () => {
    assert.ok(files.length >= 2, 'no built stylesheets found; run npm run build first');
    for (const f of files) {
        assert.ok(fs.readFileSync(f, 'utf8').startsWith(ORDER), `${path.relative(root, f)} does not start with ${ORDER}`);
    }
});

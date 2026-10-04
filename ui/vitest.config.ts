/**
 * Unit tests: vitest + happy-dom + @testing-library/react.
 * Test files: src/**\/*.test.ts(x) and tests/unit/**\/*.test.ts(x).
 * (tests/e2e/*.mjs are NOT vitest files; they run with `npm run e2e`.)
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { alias, projectRoot } from './vite.shared.ts';

export default defineConfig({
    root: projectRoot,
    plugins: [react()],
    resolve: { alias },
    test: {
        environment: 'happy-dom',
        setupFiles: ['tests/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
        // Stylesheets are not evaluated in unit tests; CSS-module imports resolve to class-name proxies.
        css: false,
        restoreMocks: true,
        server: {
            deps: {
                // The library ships extensionless ESM that imports .module.css files:
                // Node cannot load it natively, so Vite has to transform it.
                inline: [/@openai\/apps-sdk-ui/],
            },
        },
    },
});

/**
 * Extension pages (popup.html, dashboard.html) -> dist/extension/
 *
 *   dist/extension/popup.html
 *   dist/extension/dashboard.html
 *   dist/extension/ui/*            hashed JS/CSS chunks + ui/theme-init.js (from public/)
 *                                  + ui/THIRD-PARTY-NOTICES.txt (licence notices)
 *
 * Building somewhere else: add `--outDir <absolute path>`; add
 * `--emptyOutDir` when that path is outside ui/.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { alias, basePlugins, BUILD_TARGET, htmlGuard, noDevModules, projectRoot, stripCrossorigin, thirdPartyNotices } from './vite.shared.ts';

export default defineConfig({
    root: projectRoot,
    // Relative URLs everywhere: the pages live at the root of the extension origin.
    base: './',
    publicDir: resolve(projectRoot, 'public'),
    // thirdPartyNotices: ui/THIRD-PARTY-NOTICES.txt.
    plugins: [...basePlugins(), stripCrossorigin(), htmlGuard(), noDevModules(), thirdPartyNotices({ file: 'ui/THIRD-PARTY-NOTICES.txt' })],
    resolve: { alias },
    build: {
        outDir: resolve(projectRoot, 'dist/extension'),
        emptyOutDir: true,
        assetsDir: 'ui',
        sourcemap: false,
        target: BUILD_TARGET,
        // Keep <link rel="modulepreload"> tags, drop the polyfill (Safari 17+ has native support).
        modulePreload: { polyfill: false },
        rolldownOptions: {
            input: {
                popup: resolve(projectRoot, 'popup.html'),
                dashboard: resolve(projectRoot, 'dashboard.html'),
            },
        },
    },
});

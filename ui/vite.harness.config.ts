/**
 * Test harness (never shipped) -> dist/harness/
 *
 *   dist/harness/popup.html, dashboard.html, gallery.html, container.html
 *   dist/harness/ui/*              hashed JS/CSS chunks + ui/theme-init.js
 *
 * The pages run in a normal browser. Each one loads harness/boot/<page>.ts,
 * which imports src/dev/install-mock.ts (mock browser API) and only then
 * loads the real app entry through a dynamic import.
 *
 * `npm run dev` serves the same pages (http://127.0.0.1:<port>/popup.html ...).
 *
 * NOTE: Vite's root is harness/, so a relative `--outDir` resolves against
 * harness/. Always pass an absolute path for private builds.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { alias, basePlugins, BUILD_TARGET, htmlGuard, projectRoot, stripCrossorigin } from './vite.shared.ts';

const harnessRoot = resolve(projectRoot, 'harness');

/**
 * The React dashboard references upstream images that exist next to it in
 * the extension (img/ublock.svg logo, img/icon_64.png favicon, flag images). The harness
 * build copies them so harness pages do not 404 on them. Each image is taken from the
 * first place that has it: the editable icons (assets/icons/extension, what the build
 * ships), PRISTINE (build/pristine/safari or BLOCKER_PRISTINE_DIR), then the upstream
 * sources in the upstream/ submodule, so a fresh clone needs no extension build.
 */
function upstreamImages(): Plugin {
    const repoRoot = resolve(projectRoot, '..');
    const pristine = process.env.BLOCKER_PRISTINE_DIR
        ? resolve(process.env.BLOCKER_PRISTINE_DIR)
        : resolve(repoRoot, 'build/pristine/safari');
    const imgDirs = [
        resolve(repoRoot, 'assets/icons/extension'),
        resolve(pristine, 'img'),
        resolve(repoRoot, 'upstream/platform/mv3/extension/img'),
    ];
    const flagDirs = [
        resolve(pristine, 'img/flags-of-the-world'),
        resolve(repoRoot, 'upstream/src/img/flags-of-the-world'),
    ];
    const firstFile = (dirs: string[], name: string) => dirs.map((d) => resolve(d, name)).find((f) => existsSync(f));
    return {
        name: 'blocker-harness-upstream-images',
        apply: 'build',
        generateBundle() {
            for (const name of ['ublock.svg', 'icon_64.png']) {
                const file = firstFile(imgDirs, name);
                if (file !== undefined) {
                    this.emitFile({ type: 'asset', fileName: `img/${name}`, source: readFileSync(file) });
                }
            }
            // Container window picture (Resources/Icon.png): assets/icons/app-window/Icon.png.
            const icon = firstFile([resolve(repoRoot, 'assets/icons/app-window'), ...imgDirs], 'Icon.png')
                ?? firstFile(imgDirs, 'icon_512.png');
            if (icon !== undefined) {
                this.emitFile({ type: 'asset', fileName: 'Icon.png', source: readFileSync(icon) });
            }
            // Flag images of the Filter lists pane (filter-lists.md §3.5).
            const flags = flagDirs.find((d) => existsSync(d));
            if (flags !== undefined) {
                for (const name of readdirSync(flags)) {
                    if (!name.endsWith('.png')) continue;
                    this.emitFile({ type: 'asset', fileName: `img/flags-of-the-world/${name}`, source: readFileSync(resolve(flags, name)) });
                }
            }
        },
    };
}

export default defineConfig({
    root: harnessRoot,
    base: './',
    publicDir: resolve(projectRoot, 'public'),
    // Keep Vite's dependency cache in the usual place rather than harness/node_modules.
    cacheDir: resolve(projectRoot, 'node_modules/.vite-harness'),
    plugins: [...basePlugins(), stripCrossorigin(), htmlGuard(), upstreamImages()],
    resolve: { alias },
    server: {
        host: '127.0.0.1',
        // Sources live outside the Vite root (../src, ../node_modules).
        fs: { allow: [projectRoot] },
    },
    preview: { host: '127.0.0.1' },
    build: {
        outDir: resolve(projectRoot, 'dist/harness'),
        emptyOutDir: true,
        assetsDir: 'ui',
        sourcemap: false,
        target: BUILD_TARGET,
        modulePreload: { polyfill: false },
        rolldownOptions: {
            input: {
                popup: resolve(harnessRoot, 'popup.html'),
                dashboard: resolve(harnessRoot, 'dashboard.html'),
                gallery: resolve(harnessRoot, 'gallery.html'),
                // Container window for the gallery and review screenshots. (Added by integrate.)
                container: resolve(harnessRoot, 'container.html'),
            },
        },
    },
});

/**
 * macOS container-app window -> dist/container/
 *
 *   dist/container/Base.lproj/Main.html   copy of container/Main.html
 *   dist/container/Script.js              ONE classic IIFE script (no ES modules)
 *   dist/container/Style.css              ONE stylesheet
 *
 * Same layout as the Xcode template (Resources/Base.lproj/Main.html loading
 * ../Script.js and ../Style.css). The page is loaded from file:// with
 * CSP `default-src 'self'`, hence: no module scripts, no code splitting,
 * no data: URLs, no runtime <style> injection.
 *
 * Building somewhere else: add `--outDir <absolute path> --emptyOutDir`.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { alias, basePlugins, BUILD_TARGET, containerPage, noDevModules, projectRoot, thirdPartyNotices } from './vite.shared.ts';

/**
 * The library probes `typeof import.meta` in this one file. In an IIFE the
 * bundler replaces `import.meta` with `{}` (so the probe yields `undefined`,
 * which the library handles) and warns about it on every build. That single
 * known case is silenced; the same warning from any other file still shows.
 */
const KNOWN_IMPORT_META_PROBE = /[\\/]@openai[\\/]apps-sdk-ui[\\/]dist[\\/]es[\\/]lib[\\/]environment\.js$/;

export default defineConfig({
    root: projectRoot,
    base: './',
    publicDir: false,
    // thirdPartyNotices: licence notices as a /*! */ banner of Script.js.
    plugins: [...basePlugins(), thirdPartyNotices({ bannerChunk: 'Script.js' }), containerPage(), noDevModules()],
    resolve: { alias },
    build: {
        outDir: resolve(projectRoot, 'dist/container'),
        emptyOutDir: true,
        sourcemap: false,
        target: BUILD_TARGET,
        modulePreload: false,
        cssCodeSplit: false,
        // Never turn imported assets into data: URLs (blocked by default-src 'self').
        // Any imported asset then becomes an extra file, which containerPage() rejects.
        assetsInlineLimit: 0,
        rolldownOptions: {
            input: resolve(projectRoot, 'src/container/main.tsx'),
            output: {
                format: 'iife',
                codeSplitting: false,
                entryFileNames: 'Script.js',
                assetFileNames: (asset) =>
                    asset.names.some((name) => name.endsWith('.css')) ? 'Style.css' : 'assets/[name][extname]',
            },
            onwarn(warning, warn) {
                if (warning.code === 'EMPTY_IMPORT_META' && KNOWN_IMPORT_META_PROBE.test(warning.id ?? '')) return;
                warn(warning);
            },
        },
    },
});

/**
 * Installs the mock browser API (src/dev/mock-ext.ts) on `globalThis.browser`.
 * Harness and tests only: harness/boot/boot.ts imports this module statically,
 * BEFORE the app entry is loaded with a dynamic import. Production entries
 * (src/popup/main.tsx, src/dashboard/main.tsx, src/container/main.tsx) must
 * never import it; `vite.shared.ts` `noDevModules` fails such a build and
 * src/dev/mock-ext.test.ts greps the production sources. Gate check for the
 * shipped files: `grep -r "__blockerCalls\|__BLOCKER_MOCK__" dist/extension` must find nothing.
 *
 * Contract relied on by harness/boot/boot.ts and the tests:
 *   - importing this module installs everything synchronously (no top-level await);
 *   - it does nothing when a real API exists (`globalThis.browser`, or `globalThis.chrome.runtime.id`);
 *   - afterwards `globalThis.__BLOCKER_MOCK__` (= `window.__blockerMock`, the control object) is truthy
 *     and `window.__blockerCalls` is the call record array: `{ api, args, t }[]`.
 *
 * Configuration, lowest to highest precedence:
 *   1. scenario presets (`?scenario=a,b`, src/dev/fixtures/scenarios.ts);
 *   2. query-string switches (`?lang=ar&theme=dark&perm=deny&url=about:blank` ...);
 *   3. `?mock=<URL-encoded JSON MockOptions>`;
 *   4. `globalThis.__BLOCKER_MOCK_CONFIG__` (a MockOptions object set before the page
 *      scripts run, e.g. with Playwright's page.addInitScript).
 * Every switch is documented in docs/mock-harness.md.
 *
 * Besides `browser`, it patches these page globals so that tests can record them:
 * `window.close` (recorded, does not close), `window.confirm` (recorded, answers
 * `config.confirm` without a dialog), `BroadcastChannel` (construction and
 * postMessage recorded; delivery unchanged), and — with `?theme=` — the
 * `prefers-color-scheme` answers of `matchMedia` plus `html[data-theme]`.
 */
import {
    createMockExt,
    type MockCall,
    type MockControl,
    type MockOptions,
    mergeOptions,
    parseMockOptions,
    resolveMockConfig,
} from './mock-ext';

declare global {
    var __BLOCKER_MOCK__: unknown;
    var __blockerCalls: MockCall[] | undefined;
    var __blockerMock: MockControl | undefined;
    var __BLOCKER_MOCK_CONFIG__: MockOptions | undefined;
}

function realApiPresent(): boolean {
    const g = globalThis as { browser?: unknown; chrome?: { runtime?: { id?: unknown } } };
    if (g.browser !== undefined && g.browser !== null) return true;
    return typeof g.chrome?.runtime?.id === 'string';
}

function forceTheme(theme: 'light' | 'dark'): void {
    const root = document.documentElement;
    const apply = (): void => {
        if (root.getAttribute('data-theme') !== theme) root.setAttribute('data-theme', theme);
        if (!root.classList.contains(theme)) root.classList.add(theme);
        const other = theme === 'dark' ? 'light' : 'dark';
        if (root.classList.contains(other)) root.classList.remove(other);
    };
    apply();
    // theme-init.js keeps following the OS scheme; undo its writes.
    if (typeof MutationObserver === 'function') {
        new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    }
    // Code that asks matchMedia later (e.g. src/lib/theme.ts) sees the forced scheme.
    if (typeof window.matchMedia === 'function') {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query: string): MediaQueryList => {
            const m = /prefers-color-scheme\s*:\s*(dark|light)/.exec(query);
            if (m === null) return original(query);
            const mql = original(query);
            const matches = m[1] === theme;
            return new Proxy(mql, {
                get(target, prop) {
                    if (prop === 'matches') return matches;
                    const value: unknown = Reflect.get(target, prop, target);
                    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
                },
            });
        };
    }
}

function patchPageGlobals(record: (api: string, args: unknown[]) => void, control: MockControl): void {
    if (typeof window === 'undefined') return;
    window.close = () => {
        record('window.close', []);
        control.closed = true;
    };
    window.confirm = (message?: string) => {
        record('window.confirm', message === undefined ? [] : [message]);
        return control.config.confirm;
    };
    const Original = globalThis.BroadcastChannel;
    if (typeof Original === 'function') {
        class RecordingBroadcastChannel extends Original {
            constructor(name: string) {
                record('BroadcastChannel', [name]);
                super(name);
            }
            override postMessage(message: unknown): void {
                record('BroadcastChannel.postMessage', [this.name, message]);
                super.postMessage(message);
            }
        }
        globalThis.BroadcastChannel = RecordingBroadcastChannel;
    }
}

function install(): void {
    if (realApiPresent()) return;
    const search = typeof location !== 'undefined' ? location.search : '';
    const options = mergeOptions(parseMockOptions(search), globalThis.__BLOCKER_MOCK_CONFIG__);
    const config = resolveMockConfig(options);
    const calls: MockCall[] = [];
    // The background posts with the ORIGINAL constructor, so its echoes are not recorded as page calls.
    const OriginalBroadcastChannel = typeof BroadcastChannel === 'function' ? BroadcastChannel : undefined;
    const { browser, control, record } = createMockExt(config, { calls, BroadcastChannel: OriginalBroadcastChannel });

    // Not declared globally here: src/lib/ext.ts owns the typing of `browser`.
    // Chromium has no `browser` global: there the mock is `chrome` only, so the
    // `globalThis.browser ?? globalThis.chrome` fallback of src/lib/ext.ts is exercised.
    if (config.platform === 'chromium') (globalThis as Record<string, unknown>).chrome = browser;
    else (globalThis as Record<string, unknown>).browser = browser;
    globalThis.__blockerCalls = calls;
    globalThis.__blockerMock = control;
    globalThis.__BLOCKER_MOCK__ = control;

    patchPageGlobals(record, control);
    if (typeof document !== 'undefined') {
        if (config.theme !== null) forceTheme(config.theme);
        if (config.dir !== null) {
            document.documentElement.setAttribute('dir', config.dir);
            document.body?.setAttribute('dir', config.dir);
        }
        document.documentElement.setAttribute('data-mock-scenario', config.scenarios.join(' '));
        document.documentElement.setAttribute('data-mock-platform', config.platform);
    }
}

install();

export {};

/**
 * Test helper (not a test file): installs the project's mock browser API
 * (src/dev/mock-ext.ts, the same mock the harness uses) on globalThis.browser
 * and gives access to its call record.
 */
import { createMockExt, resolveMockConfig, type MockCall, type MockOptions } from '@/dev/mock-ext';
import { LOCALES } from '@/dev/fixtures';

export interface InstalledMock {
    calls: MockCall[];
    browser: Record<string, unknown>;
    control: ReturnType<typeof createMockExt>['control'];
    /** Recorded calls without the pure lookups (i18n, getURL, getManifest). */
    traffic: () => { api: string; args: unknown[] }[];
    /** Only the sendMessage payloads. */
    messages: () => unknown[];
    uninstall: () => void;
}

const PURE = new Set(['i18n.getMessage', 'i18n.getUILanguage', 'runtime.getURL', 'runtime.getManifest']);

export function installMock(options: MockOptions = {}): InstalledMock {
    const calls: MockCall[] = [];
    // Echoes go out on the environment's BroadcastChannel (happy-dom's, when it has one).
    const { browser, control } = createMockExt(resolveMockConfig(options), { calls });
    const g = globalThis as Record<string, unknown>;
    const before = g.browser;
    g.browser = browser;
    return {
        calls,
        browser,
        control,
        traffic: () => calls.filter((c) => !PURE.has(c.api)).map((c) => ({ api: c.api, args: c.args })),
        messages: () => calls.filter((c) => c.api === 'runtime.sendMessage').map((c) => c.args[0]),
        uninstall: () => {
            if (before === undefined) delete g.browser;
            else g.browser = before;
        },
    };
}

/** English catalogue (for expected strings). */
export function en(key: string): string {
    return LOCALES.en[key]?.message ?? '';
}

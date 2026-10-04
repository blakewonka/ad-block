/**
 * Minimal recording fake of the WebExtension API for the src/lib unit tests.
 * Not a test file (no `.test.`), imported by the tests in this folder only.
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';

export interface FakeBrowser {
    runtime: {
        sendMessage: Mock<(msg: unknown) => Promise<unknown>>;
        getURL: Mock<(path: string) => string>;
        getManifest: Mock<() => { name: string; version: string }>;
        getPlatformInfo?: Mock<() => Promise<{ os: string }>>;
        openOptionsPage: Mock<() => Promise<void>>;
    };
    i18n: {
        getMessage: Mock<(...args: unknown[]) => string>;
        getUILanguage: Mock<() => string>;
    };
    storage: {
        local: {
            get: Mock<(keys: string | string[] | null) => Promise<Record<string, unknown>>>;
            set: Mock<(items: Record<string, unknown>) => Promise<void>>;
            remove: Mock<(keys: string | string[]) => Promise<void>>;
            getKeys?: Mock<() => Promise<string[]>>;
        };
    };
    permissions: { request: Mock<(req: unknown) => Promise<boolean>> };
    tabs: {
        query: Mock<(q: unknown) => Promise<unknown[]>>;
        reload: Mock<(id: number) => Promise<void>>;
        update: Mock<(id: number, p: unknown) => Promise<unknown>>;
    };
    scripting?: { executeScript: Mock<(d: unknown) => Promise<unknown>> };
    alarms: {
        create: Mock<(name: string, info: unknown) => Promise<void>>;
        clear: Mock<(name: string) => Promise<boolean>>;
    };
    /** Backing store of storage.local. */
    store: Map<string, unknown>;
    /** Messages for i18n.getMessage. */
    messages: Record<string, string>;
}

export function createFakeBrowser(options: { messages?: Record<string, string>; reply?: (msg: unknown) => unknown } = {}): FakeBrowser {
    const store = new Map<string, unknown>();
    const messages: Record<string, string> = { ...(options.messages ?? {}) };
    const reply = options.reply ?? (() => undefined);
    const fake: FakeBrowser = {
        runtime: {
            sendMessage: vi.fn((msg: unknown) => Promise.resolve(reply(msg))),
            getURL: vi.fn((path: string) => `safari-web-extension://ABCDEF/${path.replace(/^\//, '')}`),
            getManifest: vi.fn(() => ({ name: 'Blocker', version: '2026.1003.1243' })),
            getPlatformInfo: vi.fn(() => Promise.resolve({ os: 'mac' })),
            openOptionsPage: vi.fn(() => Promise.resolve()),
        },
        i18n: {
            getMessage: vi.fn((...args: unknown[]) => {
                const key = String(args[0]);
                return Object.hasOwn(messages, key) ? messages[key] : '';
            }),
            getUILanguage: vi.fn(() => 'en-US'),
        },
        storage: {
            local: {
                get: vi.fn((keys: string | string[] | null) => {
                    const out: Record<string, unknown> = {};
                    if (keys === null) {
                        for (const [k, v] of store) { out[k] = v; }
                    } else {
                        for (const k of Array.isArray(keys) ? keys : [keys]) {
                            if (store.has(k)) { out[k] = store.get(k); }
                        }
                    }
                    return Promise.resolve(out);
                }),
                set: vi.fn((items: Record<string, unknown>) => {
                    for (const [k, v] of Object.entries(items)) { store.set(k, v); }
                    return Promise.resolve();
                }),
                remove: vi.fn((keys: string | string[]) => {
                    for (const k of Array.isArray(keys) ? keys : [keys]) { store.delete(k); }
                    return Promise.resolve();
                }),
                getKeys: vi.fn(() => Promise.resolve(Array.from(store.keys()))),
            },
        },
        permissions: { request: vi.fn(() => Promise.resolve(true)) },
        tabs: {
            query: vi.fn(() => Promise.resolve([])),
            reload: vi.fn(() => Promise.resolve()),
            update: vi.fn(() => Promise.resolve(undefined)),
        },
        scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
        alarms: {
            create: vi.fn(() => Promise.resolve()),
            clear: vi.fn(() => Promise.resolve(true)),
        },
        store,
        messages,
    };
    return fake;
}

/** Installs `fake` as `globalThis.browser` (removing any `chrome`); returns it. */
export function installFakeBrowser(fake: FakeBrowser = createFakeBrowser()): FakeBrowser {
    vi.stubGlobal('browser', fake);
    vi.stubGlobal('chrome', undefined);
    return fake;
}

/**
 * JS view of the page theme (UI rule §6.8).
 *
 * The attribute itself is owned by public/ui/theme-init.js, a classic script
 * that sets `html[data-theme="light|dark"]` before first paint and on every
 * `prefers-color-scheme` change. This module only READS it, for the few
 * components that need to know the theme in JS. It never writes the attribute.
 *
 * Nothing runs at import time; observers are created on the first subscription
 * and removed with the last one.
 */

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_ATTRIBUTE = 'data-theme';

function systemTheme(): Theme {
    try {
        if (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches === true) {
            return 'dark';
        }
    } catch {
        /* fall through */
    }
    return 'light';
}

/**
 * Current theme: `html[data-theme]` when it is `light` or `dark`; otherwise
 * (theme-init.js not loaded, e.g. a unit test) the OS preference; `light` when
 * there is no document at all.
 */
export function getTheme(doc: Document | undefined = globalThis.document): Theme {
    const value = doc?.documentElement?.getAttribute(THEME_ATTRIBUTE);
    if (value === 'light' || value === 'dark') { return value; }
    if (doc === undefined) { return 'light'; }
    return systemTheme();
}

type ThemeListener = (theme: Theme) => void;

const listeners = new Set<ThemeListener>();
let observer: MutationObserver | null = null;
let mql: MediaQueryList | null = null;
let last: Theme | null = null;

function notify(): void {
    const now = getTheme();
    if (now === last) { return; }
    last = now;
    for (const fn of Array.from(listeners)) {
        try {
            fn(now);
        } catch (err) {
            console.error('[theme] listener failed', err);
        }
    }
}

function start(): void {
    last = getTheme();
    const root = globalThis.document?.documentElement;
    if (root !== undefined && typeof globalThis.MutationObserver === 'function') {
        observer = new MutationObserver(notify);
        observer.observe(root, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });
    }
    // Only matters when theme-init.js did not set the attribute (getTheme then
    // follows the OS preference); harmless otherwise because notify() dedupes.
    try {
        if (typeof globalThis.matchMedia === 'function') {
            mql = globalThis.matchMedia('(prefers-color-scheme: dark)');
            mql.addEventListener?.('change', notify);
        }
    } catch {
        mql = null;
    }
}

function stop(): void {
    observer?.disconnect();
    observer = null;
    mql?.removeEventListener?.('change', notify);
    mql = null;
    last = null;
}

/**
 * Calls `listener(theme)` whenever the theme changes (not on subscription).
 * Returns the unsubscribe function (idempotent).
 */
export function subscribeTheme(listener: ThemeListener): () => void {
    listeners.add(listener);
    if (listeners.size === 1) { start(); }
    let active = true;
    return () => {
        if (!active) { return; }
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0) { stop(); }
    };
}

/** React hook: the current theme, re-rendering on change. */
export function useTheme(): Theme {
    return useSyncExternalStore(subscribeTheme, () => getTheme(), () => 'light');
}

/**
 * Native bridge of the macOS container-app window (docs/specs/container.md §4, §5, §8).
 *
 * THIS MODULE HAS NO IMPORTS ON PURPOSE and `src/container/main.tsx` imports
 * it FIRST. In the single IIFE bundle (Script.js) modules are evaluated in
 * import order, so everything below runs synchronously during evaluation of
 * Script.js, before React, react-dom's scheduler or the library initialise:
 *
 *   - `window.show(enabled, useSettingsInsteadOfPreferences)` is assigned
 *     (ViewController.swift calls it through evaluateJavaScript once the page
 *     has loaded, possibly before React has mounted; calls are kept in the
 *     store below, so nothing is lost);
 *   - `html[data-theme]` (+ class light/dark) is set from prefers-color-scheme
 *     and follows changes (ui/theme-init.js does not ship with this page);
 *   - `html[lang]` is set to "en" (the texts are fixed English, spec §6.4, and
 *     Main.html line 2 is a bare `<html>` that must stay byte-for-byte, §11.2.12;
 *     WCAG 3.1.1 needs the page language to be programmatically determinable).
 *
 * The page has no browser/extension API, no storage, no network, no timers.
 */

/** What the page shows. `enabled === undefined` = unknown (initial state). */
export type ContainerState = Readonly<{
    enabled: boolean | undefined;
    /** macOS 13+ "Settings" wording; one-way: once true it stays true (upstream Script.js:2-7). */
    useSettings: boolean;
}>;

type ControllerHandler = { postMessage: (message: string) => void };

declare global {
    interface Window {
        /** Called by ViewController.swift: `show(true|false, true|false)`. */
        show?: (enabled?: unknown, useSettingsInsteadOfPreferences?: unknown) => void;
        webkit?: { messageHandlers?: { controller?: ControllerHandler } };
    }
}

export const INITIAL_STATE: ContainerState = Object.freeze({ enabled: undefined, useSettings: false });

/** The ONLY message this page ever posts to Swift (`message.body as! String`, VC:46). */
export const OPEN_PREFERENCES = 'open-preferences';

let state: ContainerState = INITIAL_STATE;
const listeners = new Set<() => void>();

/** Current state (stable object between calls; for useSyncExternalStore). */
export function getState(): ContainerState {
    return state;
}

/** Subscribes to state changes; returns the unsubscribe function. */
export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Parity with upstream Script.js:1-16, minus its double-call breakage (§4.3):
 *   enabled: true -> on, false -> off, anything else -> unknown;
 *   useSettingsInsteadOfPreferences: truthy -> Settings wording, for the life of the page.
 * Never throws (Swift ignores errors, a throw would leave the UI stale); returns undefined.
 */
export function show(enabled?: unknown, useSettingsInsteadOfPreferences?: unknown): void {
    try {
        state = Object.freeze({
            enabled: typeof enabled === 'boolean' ? enabled : undefined,
            useSettings: state.useSettings || Boolean(useSettingsInsteadOfPreferences),
        });
        for (const listener of Array.from(listeners)) {
            try {
                listener();
            } catch (err) {
                reportError(err);
            }
        }
    } catch (err) {
        reportError(err);
    }
}

/** Unit tests only: back to the initial state, listeners dropped. Never called by the page. */
export function resetStateForTests(): void {
    state = INITIAL_STATE;
    listeners.clear();
}

/**
 * Asks Swift to open Safari's extension settings (the app then quits, VC:50-53).
 * Posts exactly the string "open-preferences", nothing else, no reply expected.
 * Does nothing (and does not throw) where there is no `webkit` (Chrome, tests).
 */
export function openPreferences(): void {
    try {
        const controller = window.webkit?.messageHandlers?.controller;
        if (controller !== undefined && controller !== null && typeof controller.postMessage === 'function') {
            controller.postMessage(OPEN_PREFERENCES);
        }
    } catch (err) {
        reportError(err);
    }
}

function reportError(err: unknown): void {
    try {
        console.error('[container]', err);
    } catch {
        /* nothing left to do */
    }
}

/** Sets html[data-theme] and class light/dark (same attributes as public/ui/theme-init.js). */
export function applyTheme(dark: boolean, root: HTMLElement = document.documentElement): void {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
}

/** Applies the OS colour scheme now and on every change. Never throws. */
export function initTheme(): void {
    try {
        const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        applyTheme(mql !== null && mql.matches === true);
        if (mql === null) return;
        const onChange = (ev: MediaQueryListEvent): void => {
            try {
                applyTheme(ev.matches === true);
            } catch (err) {
                reportError(err);
            }
        };
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
        } else if (typeof mql.addListener === 'function') {
            mql.addListener(onChange);
        }
    } catch (err) {
        reportError(err);
    }
}

/** The page's only language (spec §6.4). */
export const PAGE_LANG = 'en';

/** Sets html[lang] to "en" unless the document already declares a language. Never throws. */
export function initLang(root: HTMLElement = document.documentElement): void {
    try {
        if (!root.getAttribute('lang')) root.setAttribute('lang', PAGE_LANG);
    } catch (err) {
        reportError(err);
    }
}

// --- evaluated synchronously, first thing in Script.js (spec §4.4.1, §11.2.1) ---
if (typeof window !== 'undefined') {
    // Explicit assignment: a top-level `function show` inside an IIFE is not global.
    window.show = show;
    initLang();
    initTheme();
}

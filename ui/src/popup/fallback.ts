/**
 * Mount guard of the React popup (UI rule §6.9): when the new popup cannot
 * mount, the user gets the upstream popup instead (`popup-classic.html`, kept next to
 * `popup.html` by scripts/stage.mjs).
 *
 * - Window `error` / `unhandledrejection` listeners are registered by the entry module
 *   BEFORE the app code is loaded; they fall back while the popup is not mounted yet.
 * - The entry also falls back when the app chunk cannot be loaded at all.
 * - The React error boundary (PopupErrorBoundary) falls back on any render error.
 * - `markMounted()` (called after the first commit of the popup) removes the window
 *   listeners: later unrelated errors do not navigate away.
 *
 * No DOM access at import time; everything works on the `win` passed in, so the guard
 * can be unit-tested with a fake window.
 */
import { CLASSIC_POPUP_URL } from './model';

export interface GuardWindow {
    addEventListener(type: string, listener: (ev: Event) => void): void;
    removeEventListener(type: string, listener: (ev: Event) => void): void;
    location: { replace(url: string): void };
}

export interface MountGuard {
    /** Replaces the page with the classic popup (once). */
    fallBack(reason?: unknown): void;
    /** The React popup committed its first render: stop watching window errors. */
    markMounted(): void;
    readonly mounted: boolean;
    readonly fellBack: boolean;
}

export function createMountGuard(win: GuardWindow, log: Pick<Console, 'error'> = console): MountGuard {
    let mounted = false;
    let fellBack = false;

    const fallBack = (reason?: unknown): void => {
        if (fellBack) return;
        fellBack = true;
        try {
            log.error('[Blocker popup] the new popup could not be shown; opening the classic popup.', reason);
        } catch {
            /* logging must never stop the fallback */
        }
        win.location.replace(CLASSIC_POPUP_URL);
    };

    const onError = (ev: Event): void => {
        if (mounted) return;
        const e = ev as ErrorEvent;
        fallBack(e.error ?? e.message);
    };
    const onRejection = (ev: Event): void => {
        if (mounted) return;
        fallBack((ev as PromiseRejectionEvent).reason);
    };

    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);

    return {
        fallBack,
        markMounted() {
            if (mounted) return;
            mounted = true;
            win.removeEventListener('error', onError);
            win.removeEventListener('unhandledrejection', onRejection);
        },
        get mounted() {
            return mounted;
        },
        get fellBack() {
            return fellBack;
        },
    };
}

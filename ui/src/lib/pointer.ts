/**
 * Touch screens: a device whose primary pointer is a finger (Safari on
 * iPhone/iPad, Firefox for Android). Same media query as the `touch:` Tailwind
 * variant in src/styles/app.css; upstream makes the same split with its
 * `html.mobile` class (js/theme.js: no `(hover: hover)`).
 *
 * Prefer the CSS variant. Use this only where markup differs, e.g. the popup
 * shows the whole hostname on a touch screen because there is no hover to read
 * a `title`.
 */
import { useSyncExternalStore } from 'react';

export const TOUCH_MEDIA_QUERY = '(hover: none) and (pointer: coarse)';

function query(): MediaQueryList | null {
    try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(TOUCH_MEDIA_QUERY)
            : null;
    } catch {
        return null;
    }
}

/** `true` on a touch screen (see the file comment). Never throws. */
export function isTouchScreen(): boolean {
    return query()?.matches === true;
}

function subscribe(onChange: () => void): () => void {
    const mql = query();
    if (mql === null || typeof mql.addEventListener !== 'function') return () => {};
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
}

/** React view of isTouchScreen(), updated when the primary pointer changes. */
export function useTouchScreen(): boolean {
    return useSyncExternalStore(subscribe, isTouchScreen, () => false);
}

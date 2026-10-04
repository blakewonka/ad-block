/**
 * Harness boot sequence.
 *
 * 1. `@/styles/app.css` is a STATIC import so that the built harness page
 *    links the stylesheet from <head> (render-blocking), exactly like the
 *    production pages do. The app entry imports the same file again; that
 *    second import is a no-op.
 * 2. `@/dev/install-mock` is a STATIC import: it is fully evaluated before
 *    any line of `boot()` runs, so the mock browser API exists first.
 * 3. The app entry is loaded with a DYNAMIC import afterwards, so no module
 *    of the app (not even one hoisted into a shared chunk) can be evaluated
 *    before the mock is in place.
 *
 * <html data-harness="..."> tells tests what happened:
 *   "mock-installed"  the mock marker was present before the app was loaded
 *   "mock-missing"    install-mock ran but left no `globalThis.__BLOCKER_MOCK__`
 *   "boot-failed"     the app entry threw while loading
 *
 * Production entries (popup.html, dashboard.html at the project root) never
 * go through this file and never import the mock.
 */
import '@/styles/app.css';

import '@/dev/install-mock';

export function boot(loadApp: () => Promise<unknown>): void {
    document.documentElement.setAttribute('data-harness', globalThis.__BLOCKER_MOCK__ ? 'mock-installed' : 'mock-missing');
    loadApp().catch((err: unknown) => {
        document.documentElement.setAttribute('data-harness', 'boot-failed');
        console.error('[harness] app entry failed to load', err);
        throw err;
    });
}

/*
 * Blocker UI — theme bootstrap.
 *
 * Classic (non-module) script, loaded with a plain <script src> in <head> so
 * that it runs before first paint. Extension pages cannot use inline scripts
 * (CSP script-src 'self'), hence a separate file.
 *
 * Sets on <html>, from the OS colour scheme, now and whenever it changes:
 *   - data-theme="light" | "dark"   (what @openai/apps-sdk-ui styles key on)
 *   - class "light" / "dark"        (what the upstream uBO Lite css keys on)
 *
 * It does not set a background or `color-scheme`; the stylesheets do.
 */
(function () {
    'use strict';

    var root = document.documentElement;
    var mql = null;
    try {
        if (typeof self.matchMedia === 'function') {
            mql = self.matchMedia('(prefers-color-scheme: dark)');
        }
    } catch (e) {
        mql = null;
    }

    function apply(dark) {
        root.setAttribute('data-theme', dark ? 'dark' : 'light');
        root.classList.toggle('dark', dark);
        root.classList.toggle('light', !dark);
    }

    apply(mql !== null && typeof mql === 'object' && mql.matches === true);

    if (mql === null || typeof mql !== 'object') { return; }

    function onChange(ev) {
        apply(ev.matches === true);
    }

    if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange);
    } else if (typeof mql.addListener === 'function') {
        mql.addListener(onChange);
    }
})();

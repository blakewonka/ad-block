/**
 * Harness entry of the macOS container-app window (added by integrate).
 *
 * The real page (container/Main.html) has no extension API, so this entry does
 * NOT go through boot.ts / install-mock: it loads the production entry
 * src/container/main.tsx unchanged (./native first, as in Script.js) and then
 * plays the part of ViewController.swift:
 *
 *   ?enabled=on|off|unknown   window.show(true|false) — omitted/unknown = never called
 *   ?settings=1               useSettingsInsteadOfPreferences (macOS 13+ wording)
 *   ?theme=light|dark         forces html[data-theme] (Script.js follows the OS otherwise)
 *
 * Differences from the shipped page, for review only: the module script (not a
 * deferred classic IIFE), no CSP meta (Vite's dev server injects inline code),
 * and the icon comes from the harness build (Icon.png = PRISTINE img/icon_512.png).
 */
// Static first, like boot.ts: the stylesheet is linked from <head> before the
// library component CSS that the dynamic import below brings in. (With a static
// import of the entry, the shared library chunk's CSS was linked BEFORE app.css
// and the Button lost its colours; the shipped Style.css has one fixed order.)
import '@/styles/app.css';

async function start(): Promise<void> {
    await import('@/container/main');
    const { applyTheme, show } = await import('@/container/native');
    const params = new URLSearchParams(location.search);
    const enabled = params.get('enabled');
    const settings = params.get('settings') === '1';
    if (enabled === 'on' || enabled === 'off') {
        show(enabled === 'on', settings);
    } else if (settings) {
        show(undefined, true);
    }
    const theme = params.get('theme');
    if (theme === 'light' || theme === 'dark') {
        applyTheme(theme === 'dark');
    }
    document.documentElement.setAttribute('data-harness', 'container');
}

start().catch((err: unknown) => {
    document.documentElement.setAttribute('data-harness', 'boot-failed');
    console.error('[harness] container entry failed to load', err);
});

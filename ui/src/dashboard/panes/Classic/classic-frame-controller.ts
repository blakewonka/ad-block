/**
 * Parent-side driver of the embedded upstream dashboard
 * (`dashboard-classic.html`), following the EMBEDDING CONTRACT of
 * docs/specs/dashboard-shell.md §5 (E-1 … E-11):
 *
 * - one iframe, `src` set exactly once, never changed and never reloaded (E-1, R-21);
 * - from the moment `src` is set, every animation frame checks whether the
 *   iframe already holds the classic document (path ends with
 *   `/dashboard-classic.html`, `body` exists). At the first hit (or at `load`,
 *   as a fallback) the setup runs ONCE (R-17):
 *     1. marker `html[data-blocker-embed="classic-dashboard"]` (the generated
 *        css/default.css hides the classic header/nav and the Settings,
 *        Filter lists, About and busy sections under it: R-18, legacy-tokens.md §6);
 *     2. `body.dataset.pane = desired` (R-19);
 *     3. a MutationObserver guard that puts `data-pane` back whenever the
 *        frame changes it itself (stored-pane read, forced `about`) (R-20);
 *     4. the frame's `<html lang>` (upstream has none) = the shell's language,
 *        so assistive technology speaks it right (E-10 "MAY"); `dir` is left to
 *        the frame's own i18n code;
 *     5. theme mirror (P-32, legacy-tokens.md 6.4): the shell's theme is put on
 *        the frame's `<html>` exactly the way upstream `js/theme.js` marks it
 *        (class `dark` or `light`, the other one removed; `mobile`/`desktop`
 *        untouched) plus an inline `color-scheme` so native controls and
 *        scrollbars agree. It is re-applied on every shell theme change, at
 *        `load`, and whenever the frame's own `theme.js` (a deferred module
 *        that runs after this setup) writes a different class. The frame is
 *        never reloaded for it (R-21), so unsaved editor text survives;
 * - the iframe stays invisible (visibility, not display) until the frame body
 *   has lost its `loading` class (E-9, E-11 step 4);
 * - if it still has `loading` after `stallTimeoutMs`, status `stalled` (R-25);
 *   nothing is reloaded;
 * - if the loaded document is not the classic dashboard at all (no
 *   `body > section[data-pane]`, e.g. the 404 page of the test harness, where
 *   the upstream page does not exist), status `unavailable`.
 *
 * Nothing here posts messages into the frame, clicks its buttons, or writes
 * storage: the shell does the `dashboard.activePane` write itself (R-2).
 */
import type { ClassicPaneId } from '@/dashboard/shell/panes';
import { getTheme, subscribeTheme, type Theme } from '@/lib/theme';

export const CLASSIC_DASHBOARD_SRC = 'dashboard-classic.html';
export const EMBED_ATTRIBUTE = 'data-blocker-embed';
export const EMBED_VALUE = 'classic-dashboard';
/** R-25: the timeout is the implementer's choice. */
export const DEFAULT_STALL_TIMEOUT_MS = 15_000;

export type ClassicFrameStatus = 'warming' | 'ready' | 'stalled' | 'unavailable';

/** Where the shell's theme comes from; injected by unit tests. */
export interface ClassicThemeSource {
    get: () => Theme;
    /** Calls `listener` on every change; returns the unsubscribe function. */
    subscribe: (listener: () => void) => () => void;
}

/**
 * Marks `doc` with `theme` the way upstream `js/theme.js` does (class `dark`
 * xor `light` on `<html>`) and sets its `color-scheme`. Writes only what
 * differs, so it is safe to call from a MutationObserver on the same element.
 */
export function applyThemeToDocument(doc: Document, theme: Theme): void {
    const root = doc.documentElement;
    if (root === null) { return; }
    const dark = theme === 'dark';
    if (root.classList.contains('dark') !== dark) { root.classList.toggle('dark', dark); }
    if (root.classList.contains('light') === dark) { root.classList.toggle('light', !dark); }
    if (root.style.colorScheme !== theme) { root.style.colorScheme = theme; }
}

export interface ClassicFrameControllerOptions {
    iframe: HTMLIFrameElement;
    desired: ClassicPaneId;
    onStatus: (status: ClassicFrameStatus) => void;
    src?: string;
    stallTimeoutMs?: number;
    /** Injected for unit tests; default window.requestAnimationFrame. */
    requestFrame?: (cb: () => void) => number;
    cancelFrame?: (handle: number) => void;
    /** Default: `html[data-theme]` of the iframe's own document, via src/lib/theme.ts. */
    themeSource?: ClassicThemeSource;
}

function isClassicLocation(doc: Document | null, src: string): doc is Document {
    if (doc === null) { return false; }
    try {
        return doc.location.pathname.endsWith(`/${src}`);
    } catch {
        return false;
    }
}

/** True when the document is the upstream dashboard (it has its pane sections). */
export function looksLikeClassicDashboard(doc: Document): boolean {
    return doc.querySelector('body > section[data-pane]') !== null;
}

export class ClassicFrameController {
    readonly iframe: HTMLIFrameElement;
    private desired: ClassicPaneId;
    private readonly src: string;
    private readonly stallTimeoutMs: number;
    private readonly onStatus: (status: ClassicFrameStatus) => void;
    private readonly requestFrame: (cb: () => void) => number;
    private readonly cancelFrame: (handle: number) => void;

    private started = false;
    private disposed = false;
    private doc: Document | null = null;
    private observer: MutationObserver | null = null;
    private themeObserver: MutationObserver | null = null;
    private unsubscribeTheme: (() => void) | null = null;
    private readonly themeSource: ClassicThemeSource;
    private pollHandle: number | null = null;
    private stallTimer: ReturnType<typeof setTimeout> | null = null;
    private status: ClassicFrameStatus = 'warming';
    /** How the setup was reached: 'poll' (normal) or 'load' (fallback). For tests/diagnostics. */
    setupVia: 'poll' | 'load' | null = null;

    constructor(options: ClassicFrameControllerOptions) {
        this.iframe = options.iframe;
        this.desired = options.desired;
        this.onStatus = options.onStatus;
        this.src = options.src ?? CLASSIC_DASHBOARD_SRC;
        this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
        this.requestFrame = options.requestFrame ?? ((cb) => window.requestAnimationFrame(cb));
        this.cancelFrame = options.cancelFrame ?? ((h) => window.cancelAnimationFrame(h));
        this.themeSource = options.themeSource ?? {
            get: () => getTheme(this.iframe.ownerDocument ?? undefined),
            subscribe: (listener) => subscribeTheme(listener),
        };
    }

    /** E-11 step 2: start polling, then set `src` (once). */
    start(): void {
        if (this.started || this.disposed) { return; }
        this.started = true;
        this.iframe.addEventListener('load', this.onLoad);
        this.poll();
        this.iframe.src = this.src;
        this.stallTimer = setTimeout(this.onStallTimeout, this.stallTimeoutMs);
    }

    /** R-19: later switches between `filters` and `develop`. */
    setDesired(pane: ClassicPaneId): void {
        this.desired = pane;
        this.applyPane();
    }

    getDesired(): ClassicPaneId {
        return this.desired;
    }

    getStatus(): ClassicFrameStatus {
        return this.status;
    }

    /** Stops polling/observing (only when the iframe really leaves the DOM, e.g. unit tests). */
    dispose(): void {
        this.disposed = true;
        if (this.pollHandle !== null) {
            this.cancelFrame(this.pollHandle);
            this.pollHandle = null;
        }
        if (this.stallTimer !== null) {
            clearTimeout(this.stallTimer);
            this.stallTimer = null;
        }
        this.observer?.disconnect();
        this.observer = null;
        this.themeObserver?.disconnect();
        this.themeObserver = null;
        this.unsubscribeTheme?.();
        this.unsubscribeTheme = null;
        this.iframe.removeEventListener('load', this.onLoad);
    }

    private readonly poll = (): void => {
        this.pollHandle = null;
        if (this.disposed || this.doc !== null) { return; }
        const doc = this.safeContentDocument();
        if (isClassicLocation(doc, this.src) && doc.body !== null) {
            this.setup(doc, 'poll');
            return;
        }
        this.pollHandle = this.requestFrame(this.poll);
    };

    private readonly onLoad = (): void => {
        if (this.disposed) { return; }
        const doc = this.safeContentDocument();
        if (this.doc === null) {
            if (isClassicLocation(doc, this.src) && doc.body !== null) {
                this.setup(doc, 'load');
            } else {
                this.setStatus('unavailable');
                return;
            }
        }
        if (this.doc !== null && !looksLikeClassicDashboard(this.doc)) {
            this.setStatus('unavailable');
            return;
        }
        this.applyTheme();
        this.checkReady();
    };

    private readonly onStallTimeout = (): void => {
        this.stallTimer = null;
        if (this.status === 'warming') {
            this.setStatus('stalled');
        }
    };

    private safeContentDocument(): Document | null {
        try {
            return this.iframe.contentDocument;
        } catch {
            return null;
        }
    }

    /** E-11 step 3, run once. */
    private setup(doc: Document, via: 'poll' | 'load'): void {
        if (this.doc !== null) { return; }
        this.doc = doc;
        this.setupVia = via;
        if (this.pollHandle !== null) {
            this.cancelFrame(this.pollHandle);
            this.pollHandle = null;
        }
        doc.documentElement.setAttribute(EMBED_ATTRIBUTE, EMBED_VALUE);
        const lang = this.iframe.ownerDocument?.documentElement?.lang ?? '';
        if (lang !== '' && doc.documentElement.lang === '') {
            doc.documentElement.lang = lang;
        }
        this.applyPane();
        this.applyTheme();
        this.themeObserver = new MutationObserver(this.applyTheme);
        this.themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
        this.unsubscribeTheme = this.themeSource.subscribe(this.applyTheme);
        const body = doc.body;
        this.observer = new MutationObserver(() => {
            this.applyPane();
            this.checkReady();
        });
        this.observer.observe(body, { attributes: true, attributeFilter: ['data-pane', 'class'] });
        this.checkReady();
    }

    private applyPane(): void {
        const body = this.doc?.body;
        if (body === undefined || body === null) { return; }
        if (body.dataset.pane !== this.desired) {
            body.dataset.pane = this.desired;
        }
    }

    /** Step 5: mirror the shell's theme onto the frame (no reload). */
    private readonly applyTheme = (): void => {
        const doc = this.doc;
        if (doc === null || this.disposed) { return; }
        let theme: Theme;
        try {
            theme = this.themeSource.get();
        } catch {
            return;
        }
        try {
            applyThemeToDocument(doc, theme);
        } catch {
            /* the frame navigated away or was torn down; nothing to mirror onto */
        }
    };

    /** The theme last mirrored onto the frame, or null before setup (tests/diagnostics). */
    getFrameTheme(): Theme | null {
        const root = this.doc?.documentElement;
        if (root === undefined || root === null) { return null; }
        return root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : null;
    }

    private checkReady(): void {
        const doc = this.doc;
        if (doc === null || doc.body === null) { return; }
        if (this.status === 'unavailable') { return; }
        if (doc.body.classList.contains('loading')) { return; }
        if (!looksLikeClassicDashboard(doc)) { return; }
        this.setStatus('ready');
    }

    private setStatus(status: ClassicFrameStatus): void {
        if (this.status === status) { return; }
        if (status === 'ready' && this.stallTimer !== null) {
            clearTimeout(this.stallTimer);
            this.stallTimer = null;
        }
        this.status = status;
        this.onStatus(status);
    }
}

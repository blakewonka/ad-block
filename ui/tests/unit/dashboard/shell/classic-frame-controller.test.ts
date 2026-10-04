/**
 * Parent-side embedding of dashboard-classic.html (dashboard-shell.md §5,
 * E-1..E-11), driven with a fake iframe so the order of events is controlled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClassicFrameController, EMBED_ATTRIBUTE, type ClassicFrameStatus } from '@/dashboard/panes/Classic';

interface FakeFrame {
    iframe: HTMLIFrameElement;
    srcSets: string[];
    setDocument: (doc: Document | null) => void;
    fireLoad: () => void;
}

function makeDoc(path: string, html: string, bodyClass = ''): Document {
    const doc = document.implementation.createHTMLDocument('x');
    doc.body.innerHTML = html;
    if (bodyClass !== '') doc.body.className = bodyClass;
    Object.defineProperty(doc, 'location', { value: { pathname: path }, configurable: true });
    return doc;
}

const CLASSIC_BODY = '<header></header><section data-pane="settings"></section><section data-pane="filters"></section><section data-pane="develop"></section>';

function fakeFrame(): FakeFrame {
    let doc: Document | null = makeDoc('blank', '');
    const listeners: Array<() => void> = [];
    const srcSets: string[] = [];
    const iframe = {
        get contentDocument() {
            return doc;
        },
        set src(value: string) {
            srcSets.push(value);
        },
        addEventListener: (type: string, fn: () => void) => {
            if (type === 'load') listeners.push(fn);
        },
        removeEventListener: () => {},
        ownerDocument: document,
    } as unknown as HTMLIFrameElement;
    return {
        iframe,
        srcSets,
        setDocument: (d) => {
            doc = d;
        },
        fireLoad: () => listeners.forEach((fn) => fn()),
    };
}

async function flushMutations(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ClassicFrameController', () => {
    let frames: Array<() => void>;
    const requestFrame = (cb: () => void) => {
        frames.push(cb);
        return frames.length;
    };
    const runFrame = () => {
        const pending = frames;
        frames = [];
        pending.forEach((cb) => cb());
    };

    beforeEach(() => {
        frames = [];
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('polls before setting src once, and sets marker + pane + guard at the first poll hit', async () => {
        const f = fakeFrame();
        const statuses: ClassicFrameStatus[] = [];
        const c = new ClassicFrameController({ iframe: f.iframe, desired: 'filters', onStatus: (s) => statuses.push(s), requestFrame, cancelFrame: () => {} });
        c.start();
        c.start();
        expect(f.srcSets).toEqual(['dashboard-classic.html']);
        expect(frames.length).toBe(1);
        // about:blank: keep polling.
        runFrame();
        expect(frames.length).toBe(1);
        // The classic document exists (still loading).
        const doc = makeDoc('/dashboard-classic.html', CLASSIC_BODY, 'loading');
        doc.body.dataset.pane = 'settings';
        f.setDocument(doc);
        runFrame();
        expect(frames.length).toBe(0);
        expect(c.setupVia).toBe('poll');
        expect(doc.documentElement.getAttribute(EMBED_ATTRIBUTE)).toBe('classic-dashboard');
        expect(doc.body.dataset.pane).toBe('filters');
        // Guard: the frame's own stored-pane read lands later.
        doc.body.dataset.pane = 'rulesets';
        await flushMutations();
        expect(doc.body.dataset.pane).toBe('filters');
        // Forced about (dashboard disabled) is reverted too.
        doc.body.dataset.pane = 'about';
        await flushMutations();
        expect(doc.body.dataset.pane).toBe('filters');
        // Not visible while loading.
        expect(statuses).toEqual([]);
        doc.body.classList.remove('loading');
        await flushMutations();
        expect(statuses).toEqual(['ready']);
        // Later switch (R-19).
        c.setDesired('develop');
        expect(doc.body.dataset.pane).toBe('develop');
        // Setup is idempotent: load does not add a second marker/guard.
        f.fireLoad();
        expect(c.getStatus()).toBe('ready');
        c.dispose();
    });

    it('copies the shell language onto the frame (E-10), without overwriting one the frame has', () => {
        document.documentElement.lang = 'fr';
        try {
            const f = fakeFrame();
            const c = new ClassicFrameController({ iframe: f.iframe, desired: 'filters', onStatus: () => {}, requestFrame: () => 1, cancelFrame: () => {} });
            c.start();
            const doc = makeDoc('/dashboard-classic.html', CLASSIC_BODY);
            f.setDocument(doc);
            f.fireLoad();
            expect(doc.documentElement.lang).toBe('fr');
            c.dispose();

            const f2 = fakeFrame();
            const c2 = new ClassicFrameController({ iframe: f2.iframe, desired: 'filters', onStatus: () => {}, requestFrame: () => 1, cancelFrame: () => {} });
            c2.start();
            const doc2 = makeDoc('/dashboard-classic.html', CLASSIC_BODY);
            doc2.documentElement.lang = 'de';
            f2.setDocument(doc2);
            f2.fireLoad();
            expect(doc2.documentElement.lang).toBe('de');
            c2.dispose();
        } finally {
            document.documentElement.lang = '';
        }
    });

    it('falls back to the load event when the poll never hit', () => {
        const f = fakeFrame();
        const c = new ClassicFrameController({ iframe: f.iframe, desired: 'develop', onStatus: () => {}, requestFrame: () => 1, cancelFrame: () => {} });
        c.start();
        const doc = makeDoc('/dashboard-classic.html', CLASSIC_BODY);
        f.setDocument(doc);
        f.fireLoad();
        expect(c.setupVia).toBe('load');
        expect(doc.documentElement.hasAttribute(EMBED_ATTRIBUTE)).toBe(true);
        expect(doc.body.dataset.pane).toBe('develop');
        expect(c.getStatus()).toBe('ready');
        c.dispose();
    });

    it('reports "unavailable" when the loaded page is not the classic dashboard (harness 404)', () => {
        const f = fakeFrame();
        const statuses: ClassicFrameStatus[] = [];
        const c = new ClassicFrameController({ iframe: f.iframe, desired: 'filters', onStatus: (s) => statuses.push(s), requestFrame, cancelFrame: () => {} });
        c.start();
        const doc = makeDoc('/dashboard-classic.html', '<pre>not found</pre>');
        f.setDocument(doc);
        runFrame();
        expect(statuses).toEqual([]);
        f.fireLoad();
        expect(statuses).toEqual(['unavailable']);
        c.dispose();
    });

    it('reports "stalled" when the frame body keeps its loading class (R-25), and recovers', async () => {
        vi.useFakeTimers();
        const f = fakeFrame();
        const statuses: ClassicFrameStatus[] = [];
        const c = new ClassicFrameController({
            iframe: f.iframe,
            desired: 'filters',
            onStatus: (s) => statuses.push(s),
            requestFrame,
            cancelFrame: () => {},
            stallTimeoutMs: 1000,
        });
        c.start();
        const doc = makeDoc('/dashboard-classic.html', CLASSIC_BODY, 'loading');
        f.setDocument(doc);
        runFrame();
        f.fireLoad();
        vi.advanceTimersByTime(1000);
        expect(statuses).toEqual(['stalled']);
        vi.useRealTimers();
        doc.body.classList.remove('loading');
        await flushMutations();
        expect(statuses).toEqual(['stalled', 'ready']);
        c.dispose();
    });
});

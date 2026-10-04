/**
 * Scaffold checks on the HTML shells (source files, not build output):
 *  - external files only (no inline script/style/handlers),
 *  - every page loads ui/theme-init.js as a classic script before the app,
 *  - a harness page is the production page with only the entry script swapped,
 *    so what the harness tests is what ships.
 */
import { describe, expect, it } from 'vitest';

import containerHtml from '../../container/Main.html?raw';
import dashboardHtml from '../../dashboard.html?raw';
import harnessDashboardHtml from '../../harness/dashboard.html?raw';
import harnessGalleryHtml from '../../harness/gallery.html?raw';
import harnessPopupHtml from '../../harness/popup.html?raw';
import popupHtml from '../../popup.html?raw';

const pages: Record<string, string> = {
    'popup.html': popupHtml,
    'dashboard.html': dashboardHtml,
    'harness/popup.html': harnessPopupHtml,
    'harness/dashboard.html': harnessDashboardHtml,
    'harness/gallery.html': harnessGalleryHtml,
    'container/Main.html': containerHtml,
};

const ENTRY_SCRIPT = /<script type="module" src="[^"]+"><\/script>/;

describe('scaffold: HTML shells', () => {
    for (const [name, html] of Object.entries(pages)) {
        it(`${name} references external files only`, () => {
            expect(html).not.toMatch(/<style\b/i);
            expect(html).not.toMatch(/\sstyle\s*=/i);
            expect(html).not.toMatch(/\son[a-z]+\s*=/i);
            expect(html).not.toMatch(/\scrossorigin\b/i);
            expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
            const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
            expect(scripts.length).toBeGreaterThan(0);
            for (const [, attrs, body] of scripts) {
                expect(attrs).toMatch(/\ssrc="/);
                expect((body ?? '').trim()).toBe('');
            }
        });
    }

    for (const name of ['popup.html', 'dashboard.html', 'harness/popup.html', 'harness/dashboard.html', 'harness/gallery.html']) {
        it(`${name} loads theme-init.js as a classic script before the entry module`, () => {
            const html = pages[name] ?? '';
            const themeAt = html.indexOf('<script src="/ui/theme-init.js"></script>');
            const entryAt = html.search(ENTRY_SCRIPT);
            expect(themeAt).toBeGreaterThan(-1);
            expect(entryAt).toBeGreaterThan(themeAt);
            expect(html.indexOf('</head>')).toBeGreaterThan(themeAt);
        });
    }

    it('harness/popup.html is popup.html with only the entry script swapped', () => {
        expect(harnessPopupHtml.replace(ENTRY_SCRIPT, '')).toBe(popupHtml.replace(ENTRY_SCRIPT, ''));
        expect(popupHtml).toContain('<script type="module" src="/src/popup/main.tsx"></script>');
        expect(harnessPopupHtml).toContain('<script type="module" src="./boot/popup.ts"></script>');
    });

    it('harness/dashboard.html is dashboard.html with only the entry script swapped', () => {
        expect(harnessDashboardHtml.replace(ENTRY_SCRIPT, '')).toBe(dashboardHtml.replace(ENTRY_SCRIPT, ''));
        expect(dashboardHtml).toContain('<script type="module" src="/src/dashboard/main.tsx"></script>');
        expect(harnessDashboardHtml).toContain('<script type="module" src="./boot/dashboard.ts"></script>');
    });

    it('container/Main.html keeps the Xcode template conventions', () => {
        expect(containerHtml).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`);
        expect(containerHtml).toContain('<link rel="stylesheet" href="../Style.css">');
        expect(containerHtml).toContain('<script src="../Script.js" defer></script>');
        expect(containerHtml).not.toMatch(/type\s*=\s*"module"/);
    });
});

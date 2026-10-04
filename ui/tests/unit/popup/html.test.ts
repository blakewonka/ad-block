/**
 * popup.html gives <body> the popup's final size, so the document has its height from the
 * first paint, before the stylesheet-linked app has mounted (UI rule §6.9, docs/specs/README.md;
 * regression: the body was 0 px high until React mounted).
 */
import { describe, expect, it } from 'vitest';

import harnessPopupHtml from '../../../harness/popup.html?raw';
import popupHtml from '../../../popup.html?raw';
import { POPUP_HEIGHT_CLASS, POPUP_HEIGHT_PX, POPUP_TOUCH_BODY_CLASSES } from '@/popup/Popup';

function bodyClasses(html: string): string[] {
    const m = /<body\s+class="([^"]*)"/.exec(html);
    return m === null ? [] : m[1].split(/\s+/);
}

describe('popup.html size from the first paint', () => {
    it('POPUP_HEIGHT_CLASS matches POPUP_HEIGHT_PX', () => {
        expect(POPUP_HEIGHT_CLASS).toBe(`h-[${POPUP_HEIGHT_PX}px]`);
    });

    it.each([
        ['popup.html', popupHtml],
        ['harness/popup.html', harnessPopupHtml],
    ])('%s: <body> has the popup width and POPUP_HEIGHT_CLASS', (_name, html) => {
        const classes = bodyClasses(html);
        expect(classes).toContain('w-[340px]');
        expect(classes).toContain(POPUP_HEIGHT_CLASS);
        expect(classes).toContain('bg-surface');
    });

    it.each([
        ['popup.html', popupHtml],
        ['harness/popup.html', harnessPopupHtml],
    ])('%s: <body> undoes the fixed size on touch screens (full-width sheet)', (_name, html) => {
        const classes = bodyClasses(html);
        for (const c of POPUP_TOUCH_BODY_CLASSES) expect(classes).toContain(c);
    });
});

describe('middleEllipsis (header hostname)', () => {
    it('leaves short names alone', async () => {
        const { middleEllipsis } = await import('@/popup/Popup');
        expect(middleEllipsis('www.example.com')).toBe('www.example.com');
        expect(middleEllipsis('a'.repeat(44))).toBe('a'.repeat(44));
    });

    it('elides the middle, keeps the end from a label boundary, at most `max` code points', async () => {
        const { middleEllipsis } = await import('@/popup/Popup');
        const host = 'very-long-subdomain-name.another-example-company.co.uk.example-cdn.net';
        const out = middleEllipsis(host);
        expect(Array.from(out).length).toBeLessThanOrEqual(44);
        expect(out.endsWith('…co.uk.example-cdn.net')).toBe(true);
        expect(out).toBe('very-long-subdomain-na…co.uk.example-cdn.net');
        // No label boundary in reach: the plain tail is kept.
        expect(middleEllipsis('x'.repeat(80))).toBe(`${'x'.repeat(15)}…${'x'.repeat(28)}`);
        // Code points, not UTF-16 units: no broken surrogate pair.
        const emoji = '😀'.repeat(60);
        expect(middleEllipsis(emoji)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });
});

/**
 * Count badge colour: "0/N" is neutral in both themes, only
 * "n/N" with n > 0 is info; the dark-mode stronger info text applies to the info badge only.
 * (Stylesheets are not evaluated in unit tests: the computed colours are asserted in
 * tests/e2e/filter-lists.parity.mjs "[fix visual] dark badge contrast …".)
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CountBadge } from './FilterListsPane';

const DARK_INFO_OVERRIDE = 'dark:[--badge-text-color:var(--color-text-info)]';

function badgeOf(checked: number, total: number): HTMLElement {
    const { container } = render(<CountBadge checked={checked} total={total} />);
    const count = container.querySelector('[data-count]');
    expect(count).not.toBeNull();
    return count!.parentElement as HTMLElement;
}

describe('CountBadge', () => {
    it('0/N is a neutral (secondary) badge without the dark info text override', () => {
        const badge = badgeOf(0, 37);
        expect(badge.getAttribute('data-color')).toBe('secondary');
        expect(badge.className).not.toContain(DARK_INFO_OVERRIDE);
        expect(badge.querySelector('[data-count]')!.textContent).toBe('0/37');
    });

    it('n/N with n > 0 is an info badge with the stronger dark info text', () => {
        const badge = badgeOf(3, 3);
        expect(badge.getAttribute('data-color')).toBe('info');
        expect(badge.className).toContain(DARK_INFO_OVERRIDE);
    });
});

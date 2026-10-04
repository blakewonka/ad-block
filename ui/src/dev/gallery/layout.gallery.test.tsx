import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LayoutGallery } from './layout.gallery';

describe('LayoutGallery', () => {
    it('renders every block in a light and a dark scope without landmarks of its own', () => {
        const { container } = render(<LayoutGallery />);
        expect(screen.getByRole('heading', { level: 2, name: 'Layout building blocks' })).toBeInTheDocument();
        for (const block of ['Level tokens', 'Card', 'Section', 'SettingRow', 'SettingRow, dir=rtl', 'Skeleton', 'PageShell']) {
            const scopes = container.querySelectorAll(`[data-gallery-block="${block}"] > [data-theme]`);
            expect(Array.from(scopes, (el) => el.getAttribute('data-theme'))).toEqual(['light', 'dark']);
        }
        expect(screen.queryByRole('main')).toBeNull();
        expect(screen.queryByRole('banner')).toBeNull();
        // every switch in the setting rows is labelled
        for (const sw of screen.getAllByRole('switch')) {
            expect(sw).toHaveAccessibleName();
        }
        expect(container.querySelectorAll('[dir="rtl"]').length).toBe(2);
    });
});

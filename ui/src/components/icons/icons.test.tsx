import * as LibraryIcons from '@openai/apps-sdk-ui/components/Icon';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppIcon } from './AppIcon';
import { IconButton } from './IconButton';
import { icons, iconMirrorsInRtl, type IconName } from './icons';

const REQUIRED: IconName[] = [
    'zapper',
    'picker',
    'unpicker',
    'report',
    'dashboard',
    'matchedRules',
    'search',
    'chevronDown',
    'chevronRight',
    'externalLink',
    'check',
    'warning',
    'info',
    'shield',
    'settings',
    'download',
    'upload',
    'trash',
    'copy',
    'home',
];

describe('icons map', () => {
    it('covers every semantic name the UI needs', () => {
        for (const name of REQUIRED) {
            expect(icons[name], name).toBeTypeOf('function');
        }
    });

    it('maps only to real library icon components', () => {
        const libraryComponents = new Set(Object.values(LibraryIcons));
        for (const [name, component] of Object.entries(icons)) {
            expect(libraryComponents.has(component), `${name} is not a library icon`).toBe(true);
        }
    });

    it('never uses an Openai* logo icon', () => {
        const logos = new Set(
            Object.entries(LibraryIcons)
                .filter(([exportName]) => /^openai/i.test(exportName))
                .map(([, component]) => component),
        );
        expect(logos.size).toBeGreaterThan(0); // the check is meaningful
        for (const [name, component] of Object.entries(icons)) {
            expect(logos.has(component), `${name} maps to an Openai logo`).toBe(false);
        }
    });

    it('marks only direction-dependent icons for RTL mirroring', () => {
        expect(iconMirrorsInRtl('chevronRight')).toBe(true);
        expect(iconMirrorsInRtl('arrowLeft')).toBe(true);
        expect(iconMirrorsInRtl('externalLink')).toBe(false);
        expect(iconMirrorsInRtl('zapper')).toBe(false);
    });
});

describe('AppIcon', () => {
    it('renders a decorative svg', () => {
        const { container } = render(<AppIcon name="zapper" className="size-4" />);
        const svg = container.querySelector('svg')!;
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('data-icon', 'zapper');
        expect(svg.getAttribute('class')).toContain('size-4');
        expect(svg.getAttribute('class')).not.toContain('rtl:-scale-x-100');
    });

    it('mirrors directional icons under rtl', () => {
        const { container } = render(<AppIcon name="chevronRight" />);
        expect(container.querySelector('svg')!.getAttribute('class')).toContain('rtl:-scale-x-100');
    });
});

describe('IconButton', () => {
    it('is a button named by its label, with a ghost uniform library Button', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        render(<IconButton icon="trash" label="Remove" onClick={onClick} />);
        const button = screen.getByRole('button', { name: 'Remove' });
        expect(button).toHaveAttribute('data-variant', 'ghost');
        expect(button).toHaveAttribute('data-uniform');
        expect(button).toHaveAttribute('data-color', 'secondary');
        expect(button.querySelector('svg[data-icon="trash"]')).toHaveAttribute('aria-hidden', 'true');
        await user.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('shows its label as a tooltip on keyboard focus', async () => {
        const user = userEvent.setup();
        render(<IconButton icon="copy" label="Copy to clipboard" />);
        await user.tab();
        expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toHaveFocus();
        // happy-dom has no layout, so Radix keeps the popper `visibility: hidden`: query hidden too.
        const tips = await screen.findAllByRole('tooltip', { hidden: true });
        expect(tips[0]).toHaveTextContent('Copy to clipboard');
        expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toHaveAttribute('aria-describedby', tips[0].id);
    });

    it('can show a different tooltip, or none', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<IconButton icon="info" label="About" tooltip="About Blocker" />);
        await user.tab();
        expect((await screen.findAllByRole('tooltip', { hidden: true }))[0]).toHaveTextContent('About Blocker');
        unmount();

        render(<IconButton icon="info" label="About" tooltip={null} />);
        const button = screen.getByRole('button', { name: 'About' });
        fireEvent.focus(button);
        await new Promise((r) => setTimeout(r, 200));
        expect(screen.queryAllByRole('tooltip', { hidden: true })).toHaveLength(0);
    });

    it('passes Button props through (disabled, size)', () => {
        render(<IconButton icon="download" label="Export" disabled size="sm" />);
        const button = screen.getByRole('button', { name: 'Export' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('data-size', 'sm');
    });
});

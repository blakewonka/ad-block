import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NavGallery } from './nav.gallery';

describe('NavGallery', () => {
    it('renders the tab demos, dialogs and the status region', () => {
        render(<NavGallery />);
        expect(screen.getByTestId('nav-gallery')).toBeInTheDocument();
        expect(screen.getAllByRole('tablist')).toHaveLength(4);
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reset to default…' })).toBeInTheDocument();
    });

    it('confirming the reset dialog announces the result', async () => {
        const user = userEvent.setup();
        render(<NavGallery />);
        const trigger = screen.getByRole('button', { name: 'Reset to default…' });
        await user.click(trigger);
        await user.click(await screen.findByRole('button', { name: 'Reset' }));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(screen.getByRole('status')).toHaveTextContent('Settings were reset');
        expect(trigger).toHaveFocus();
    });
});

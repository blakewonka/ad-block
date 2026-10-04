/**
 * Scaffold check: the library's components can be imported and rendered
 * under vitest + happy-dom, and the jest-dom matchers are registered.
 */
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

describe('scaffold: @openai/apps-sdk-ui under vitest', () => {
    it('renders a Button that reacts to a click', async () => {
        const onClick = vi.fn();
        render(
            <Button color="primary" onClick={onClick}>
                Scaffold button
            </Button>,
        );
        const button = screen.getByRole('button', { name: 'Scaffold button' });
        expect(button).toBeInTheDocument();
        expect(button).toBeEnabled();
        await userEvent.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders a Badge', () => {
        render(<Badge color="success">Scaffold</Badge>);
        expect(screen.getByText('Scaffold')).toBeVisible();
    });

    it('resolves the "@/..." alias', async () => {
        await import('@/dev/install-mock');
        expect(globalThis.__BLOCKER_MOCK__).toBeTruthy();
    });
});

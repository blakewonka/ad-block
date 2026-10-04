/**
 * Keeps one failing pane from taking the whole dashboard down: the pane is
 * replaced by an Alert, the tabs and the other panes keep working.
 */
import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { tNew } from '@/lib/i18n';

interface Props {
    children?: ReactNode;
}

interface State {
    error: unknown;
}

export class PaneErrorBoundary extends Component<Props, State> {
    override state: State = { error: null };

    static getDerivedStateFromError(error: unknown): State {
        return { error };
    }

    override componentDidCatch(error: unknown, info: ErrorInfo): void {
        console.error('[dashboard] pane failed to render', error, info.componentStack);
    }

    override render(): ReactNode {
        if (this.state.error !== null) {
            const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
            return (
                <Alert
                    color="danger"
                    variant="soft"
                    title={tNew('paneRenderError', 'This section could not be displayed.')}
                    description={message}
                />
            );
        }
        return this.props.children;
    }
}

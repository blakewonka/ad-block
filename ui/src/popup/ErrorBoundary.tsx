/**
 * Any render error in the popup tree hands over to the classic popup (UI rule §6.9).
 * Until the replacement page loads, nothing is rendered (a blank popup rather than a
 * half-broken one).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface PopupErrorBoundaryProps {
    onError: (error: unknown) => void;
    children?: ReactNode;
}

interface State {
    failed: boolean;
}

export class PopupErrorBoundary extends Component<PopupErrorBoundaryProps, State> {
    override state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    override componentDidCatch(error: unknown, info: ErrorInfo): void {
        void info;
        this.props.onError(error);
    }

    override render(): ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

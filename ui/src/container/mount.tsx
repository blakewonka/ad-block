/**
 * Mounts the container window, with the plain-DOM fallback of
 * docs/specs/container.md §11.2.11 for every way the mount can fail:
 *   - createRoot()/render() throws synchronously;
 *   - a render error reaches the error boundary (or escapes it: onUncaughtError);
 *   - a window `error` event fires before the tree has committed.
 * `window.show` keeps working throughout: it lives in ./native, evaluated first.
 */
import { Component, type ErrorInfo, type ReactNode, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ContainerApp } from './App';
import { isFallbackActive, renderFallback } from './fallback';

type BoundaryProps = { onError: (error: unknown) => void; children: ReactNode };

class MountErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
    override state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    override componentDidCatch(error: unknown, _info: ErrorInfo): void {
        this.props.onError(error);
    }

    override render(): ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

/** Mounts into `container` (the page's #root). Never throws. */
export function mount(container: HTMLElement | null): void {
    const doc = globalThis.document;
    let target = container;
    if (target === null) {
        // Main.html always has #root; if a copy lost it, still show something.
        target = doc.createElement('div');
        target.id = 'root';
        doc.body.append(target);
    }
    const host = target;
    let root: Root | null = null;
    let failed = false;
    let watching = true;

    const stopWatching = (): void => {
        if (!watching) return;
        watching = false;
        window.removeEventListener('error', onWindowError);
    };

    const fail = (error: unknown): void => {
        if (failed || isFallbackActive()) return;
        failed = true;
        stopWatching();
        try {
            console.error('[container] React mount failed; showing the plain page', error);
        } catch {
            /* ignore */
        }
        // Leave React's commit phase before unmounting, then replace the content.
        queueMicrotask(() => {
            try {
                root?.unmount();
            } catch {
                /* the fallback replaces whatever is left */
            }
            root = null;
            renderFallback(host);
        });
    };

    function onWindowError(ev: ErrorEvent): void {
        fail(ev.error ?? ev.message);
    }

    window.addEventListener('error', onWindowError);

    try {
        root = createRoot(host, { onUncaughtError: (error) => fail(error) });
        root.render(
            <StrictMode>
                <MountErrorBoundary onError={fail}>
                    <ContainerApp onMounted={stopWatching} />
                </MountErrorBoundary>
            </StrictMode>,
        );
    } catch (error) {
        fail(error);
    }
}

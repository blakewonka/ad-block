/**
 * The single, persistent iframe of `dashboard-classic.html` that renders the
 * upstream "Custom filters" and "Develop" panes inside the React dashboard
 * (dashboard-shell.md §5). Mount it once, the first time a classic pane is
 * shown, and never unmount it (R-21): the shell hides its container instead.
 *
 * - `pane` is the classic pane the frame must show (R-19); changing it only
 *   flips `body.dataset.pane` inside the frame.
 * - `title` is the active pane's tab label (R-24).
 * - The iframe fills its container (`h-full w-full`, no border) so the frame
 *   is the only scroll container (R-23).
 */
import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/Skeleton';
import { useAnnounce } from '@/components/StatusRegion';
import type { ClassicPaneId } from '@/dashboard/shell/panes';
import { tNew } from '@/lib/i18n';

import { ClassicFrameController, type ClassicFrameStatus } from './classic-frame-controller';

export interface ClassicFrameProps {
    pane: ClassicPaneId;
    title: string;
    /** R-25 timeout; tests may shorten it. */
    stallTimeoutMs?: number;
}

/** True only in the test harness pages (harness/boot sets html[data-harness]); never in the extension. */
function isTestHarness(): boolean {
    return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-harness');
}

/**
 * Placeholder shaped like the frame's content: inside the dashboard the
 * generated css/default.css lays the classic sections out in a start-aligned
 * column of min(48rem, 100%), like the React panes (legacy-tokens.md 6.5, B9).
 */
export function ClassicFrameSkeleton() {
    return (
        <div className="flex w-full max-w-3xl flex-col gap-3 px-1 pt-3" aria-hidden="true" data-testid="classic-frame-skeleton">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton shape="text" lines={2} />
            <Skeleton className="h-64 w-full" />
        </div>
    );
}

const controllers = new WeakMap<HTMLIFrameElement, ClassicFrameController>();

export function ClassicFrame({ pane, title, stallTimeoutMs }: ClassicFrameProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<ClassicFrameStatus>('warming');
    const initialPane = useRef(pane);

    useEffect(() => {
        const iframe = iframeRef.current;
        if (iframe === null) { return; }
        let controller = controllers.get(iframe);
        if (controller === undefined) {
            controller = new ClassicFrameController({
                iframe,
                desired: initialPane.current,
                onStatus: setStatus,
                stallTimeoutMs,
            });
            controllers.set(iframe, controller);
            controller.start();
        }
        const owned = controller;
        return () => {
            // StrictMode re-runs effects on the same element; only a real removal disposes.
            queueMicrotask(() => {
                if (!iframe.isConnected) {
                    owned.dispose();
                    controllers.delete(iframe);
                }
            });
        };
        // The controller is created once per iframe element (deliberately no deps).
    }, []);

    useEffect(() => {
        const iframe = iframeRef.current;
        if (iframe === null) { return; }
        controllers.get(iframe)?.setDesired(pane);
    }, [pane]);

    const announce = useAnnounce();
    useEffect(() => {
        if (status === 'unavailable') {
            announce(tNew('classicFrameUnavailable', 'This pane could not be loaded.'), { tone: 'warning' });
        }
    }, [status, announce]);

    const ready = status === 'ready';
    return (
        <div className="relative h-full min-h-0 w-full" data-classic-frame-status={status} aria-busy={status === 'warming'}>
            {/* No `src` prop: the controller sets it once, after its poll has started (E-11). */}
            <iframe
                ref={iframeRef}
                title={title}
                data-blocker-classic-frame=""
                className={['block h-full w-full border-0 bg-surface', ready ? 'visible' : 'invisible'].join(' ')}
            />
            {status === 'warming' && (
                <div className="absolute inset-0">
                    <ClassicFrameSkeleton />
                </div>
            )}
            {status === 'stalled' && (
                <div className="absolute inset-x-0 top-0" data-testid="classic-frame-stalled">
                    <Alert
                        color="danger"
                        variant="soft"
                        title={tNew(
                            'classicFrameStalled',
                            'This pane did not finish loading. Close the dashboard and open it again.',
                        )}
                        actions={
                            // A user action (R-25 forbids only an automatic reload).
                            <Button color="secondary" variant="soft" size="sm" onClick={() => window.location.reload()}>
                                {tNew('reloadButton', 'Reload')}
                            </Button>
                        }
                    />
                </div>
            )}
            {status === 'unavailable' && (
                // Announced through the page's status region (effect above); the stalled Alert has role=alert.
                <div className="absolute inset-x-0 top-0" data-testid="classic-frame-unavailable">
                    <Alert
                        color="warning"
                        variant="soft"
                        title={tNew('classicFrameUnavailable', 'This pane could not be loaded.')}
                        description={
                            <span>
                                {tNew('classicFrameUnavailableDetail', 'The page that provides it ({{page}}) did not load.', {
                                    page: 'dashboard-classic.html',
                                })}
                                {/* Test harness only (html[data-harness] is set by harness/boot): explain why. */}
                                {isTestHarness()
                                    ? ' Test harness: the upstream page is not part of the harness build, so this is expected here.'
                                    : null}
                            </span>
                        }
                    />
                </div>
            )}
        </div>
    );
}

/**
 * Mounts the React popup. Loaded by main.tsx with a dynamic import, after the mount
 * guard is in place.
 */
import { StatusProvider } from '@/components/StatusRegion';
import { initDocumentLocale, LocaleDirectionProvider, t } from '@/lib/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PopupErrorBoundary } from './ErrorBoundary';
import type { MountGuard } from './fallback';
import { Popup } from './Popup';

export function mountPopup(guard: MountGuard): void {
    // dir/lang on <html> and <body> before the first render (i18n.md §2.2).
    const { dir } = initDocumentLocale();
    const title = t('extName');
    if (title !== '') document.title = title;

    const container = document.getElementById('root');
    if (container === null) {
        throw new Error('popup: #root is missing');
    }
    createRoot(container).render(
        <StrictMode>
            <PopupErrorBoundary onError={guard.fallBack}>
                <LocaleDirectionProvider dir={dir}>
                    <StatusProvider>
                        <Popup dir={dir} onMounted={guard.markMounted} />
                    </StatusProvider>
                </LocaleDirectionProvider>
            </PopupErrorBoundary>
        </StrictMode>,
    );
}

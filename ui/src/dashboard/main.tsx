/**
 * Entry of the React dashboard (`dashboard.html`, the extension's options page).
 * Spec: docs/specs/dashboard-shell.md.
 *
 * Before the first render: `dir`/`lang` on <html> and <body> (i18n.md §2.2),
 * document.title = t('dashboardName') (R-7) and the favicon img/icon_64.png
 * (§1.1). The favicon <link> is added here rather than in dashboard.html so
 * that Vite does not try to bundle a file that only exists in the extension.
 */
import '@/styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { initDocumentLocale, t } from '@/lib/i18n';

import { App } from './App';

export const DASHBOARD_FAVICON = 'img/icon_64.png';

function addFavicon(doc: Document): void {
    if (doc.head.querySelector('link[rel="icon"]') !== null) { return; }
    const link = doc.createElement('link');
    link.rel = 'icon';
    link.href = DASHBOARD_FAVICON;
    doc.head.append(link);
}

const locale = initDocumentLocale();
const title = t('dashboardName');
if (title !== '') {
    document.title = title;
}
addFavicon(document);

const container = document.getElementById('root');
if (container === null) {
    throw new Error('dashboard: #root is missing');
}
createRoot(container).render(
    <StrictMode>
        <App dir={locale.dir} />
    </StrictMode>,
);

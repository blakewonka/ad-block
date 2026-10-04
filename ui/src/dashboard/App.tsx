/**
 * Dashboard application root: Radix direction context (RTL arrow keys,
 * i18n.md §2.2 item 4), the page-wide live-region provider, and the shell.
 */
import { StatusProvider } from '@/components/StatusRegion';
import { LocaleDirectionProvider } from '@/lib/i18n';

import { DashboardShell } from './shell';

export function App({ dir }: { dir: 'ltr' | 'rtl' }) {
    return (
        <LocaleDirectionProvider dir={dir}>
            <StatusProvider>
                <DashboardShell />
            </StatusProvider>
        </LocaleDirectionProvider>
    );
}

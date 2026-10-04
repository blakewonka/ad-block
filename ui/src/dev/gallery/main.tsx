/**
 * Entry of harness/gallery.html (loaded through harness/boot/gallery.ts, after the mock).
 * Dev only, never shipped.
 *
 * One page to review the whole design:
 *   1. Surfaces — the finished pages in their main states, each in its own
 *      iframe of the harness build (popup.html, dashboard.html, container.html)
 *      with the mock switches of docs/mock-harness.md §3. Every frame
 *      has its own mock background, so what you see is what the e2e tests see.
 *   2. Components — the component galleries of src/dev/gallery/*.gallery.tsx.
 *
 * Note: frames share the origin, so the mock backgrounds' BroadcastChannel
 * echoes reach every frame. Clicking a setting in one dashboard frame can
 * therefore update another; reload the page to get the listed states back.
 */
import '@/styles/app.css';

import { Button } from '@openai/apps-sdk-ui/components/Button';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { initDocumentLocale, LocaleDirectionProvider } from '@/lib/i18n';

import { LayoutGallery } from './layout.gallery';
import { ModeGallery } from './mode.gallery';
import { NavGallery } from './nav.gallery';

type Params = Readonly<Record<string, string | number | object>>;

/** Same encoding as tests/e2e/helpers openHarness(): objects become JSON. */
export function harnessUrl(page: 'popup' | 'dashboard' | 'container', params: Params = {}): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const qs = query.toString();
    return `./${page}.html${qs === '' ? '' : `?${qs}`}`;
}

const pane = (id: string): object => ({ storage: { local: { 'dashboard.activePane': id } } });

type Surface = Readonly<{ title: string; note?: string; params: Params }>;

const POPUP_STATES: readonly Surface[] = [
    { title: 'Basic on example.com', note: 'fixture F', params: { theme: 'light' } },
    { title: 'Basic on example.com, dark', params: { theme: 'dark' } },
    { title: 'Optimal, 3 custom filters', params: { theme: 'light', level: 2, customFilters: 3 } },
    { title: 'Complete, dark', params: { theme: 'dark', level: 3 } },
    { title: 'No filtering', params: { theme: 'light', level: 0 } },
    { title: 'Managed by an administrator', note: 'scenario admin-locked', params: { theme: 'light', scenario: 'admin-locked' } },
    { title: 'Not a website', note: 'about:blank', params: { theme: 'light', scenario: 'no-website' } },
    { title: 'Loading', note: 'popupPanelData never answers', params: { theme: 'light', fail: 'popupPanelData:hang' } },
    { title: 'Load failed', note: 'popupPanelData rejects', params: { theme: 'dark', fail: 'popupPanelData:reject' } },
    { title: 'Arabic (RTL)', params: { theme: 'light', lang: 'ar' } },
    { title: 'Greek (longest strings), dark', params: { theme: 'dark', lang: 'el', level: 2 } },
];

const DASHBOARD_STATES: readonly Surface[] = [
    { title: 'Settings', params: { theme: 'light', mock: pane('settings') } },
    { title: 'Settings, dark', params: { theme: 'dark', mock: pane('settings') } },
    { title: 'Filter lists', params: { theme: 'light', mock: pane('rulesets') } },
    { title: 'Filter lists, dark', params: { theme: 'dark', mock: pane('rulesets') } },
    { title: 'About', params: { theme: 'light', mock: pane('about') } },
    { title: 'About, dark', params: { theme: 'dark', mock: pane('about') } },
    { title: 'Settings, managed', note: 'scenario admin-locked', params: { theme: 'light', scenario: 'admin-locked', mock: pane('settings') } },
    { title: 'Filter lists at the limit', note: 'scenario max-rulesets', params: { theme: 'light', scenario: 'max-rulesets', mock: pane('rulesets') } },
    { title: 'Settings, Arabic (RTL)', params: { theme: 'light', lang: 'ar', mock: pane('settings') } },
    { title: 'Filter lists, Greek, dark', params: { theme: 'dark', lang: 'el', mock: pane('rulesets') } },
    { title: 'Loading', note: 'getOptionsPageData never answers', params: { theme: 'light', fail: 'getOptionsPageData:hang' } },
    { title: 'Load failed', note: 'getOptionsPageData rejects', params: { theme: 'light', fail: 'getOptionsPageData:reject' } },
];

const CONTAINER_STATES: readonly Surface[] = [
    { title: 'Before show()', note: 'Preferences wording', params: { theme: 'light' } },
    { title: 'Extension on', note: 'macOS 13+ Settings wording', params: { theme: 'light', enabled: 'on', settings: 1 } },
    { title: 'Extension off, dark', params: { theme: 'dark', enabled: 'off', settings: 1 } },
    { title: 'Before show(), dark', params: { theme: 'dark' } },
];

function FrameCard({ title, note, src, children }: { title: string; note?: string; src: string; children: ReactNode }) {
    return (
        <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-default">{title}</span>
                {note !== undefined && <span className="text-secondary">{note}</span>}
                <a className="text-sm text-secondary underline underline-offset-2 hover:text-default" href={src} target="_blank" rel="noreferrer">
                    open
                </a>
            </figcaption>
            {children}
        </figure>
    );
}

function PopupFrames() {
    return (
        <div className="flex flex-wrap gap-6">
            {POPUP_STATES.map((s) => {
                const src = harnessUrl('popup', s.params);
                return (
                    <FrameCard key={s.title} title={s.title} note={s.note} src={src}>
                        <iframe
                            title={`Popup: ${s.title}`}
                            src={src}
                            loading="lazy"
                            className="h-[456px] w-[340px] shrink-0 rounded-lg border border-default bg-surface shadow-sm"
                        />
                    </FrameCard>
                );
            })}
        </div>
    );
}

/** Dashboard frames: rendered at 1100x800 (DASHBOARD_VIEWPORT) and shown at half size. */
function DashboardFrames() {
    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {DASHBOARD_STATES.map((s) => {
                const src = harnessUrl('dashboard', s.params);
                return (
                    <FrameCard key={s.title} title={s.title} note={s.note} src={src}>
                        <div className="h-[400px] w-[550px] max-w-full overflow-hidden rounded-lg border border-default bg-surface shadow-sm">
                            <iframe
                                title={`Dashboard: ${s.title}`}
                                src={src}
                                loading="lazy"
                                tabIndex={-1}
                                className="h-[800px] w-[1100px] origin-top-left scale-50 rtl:origin-top-right"
                            />
                        </div>
                    </FrameCard>
                );
            })}
        </div>
    );
}

function ContainerFrames() {
    return (
        <div className="flex flex-wrap gap-6">
            {CONTAINER_STATES.map((s) => {
                const src = harnessUrl('container', s.params);
                return (
                    <FrameCard key={s.title} title={s.title} note={s.note} src={src}>
                        <iframe
                            title={`Container window: ${s.title}`}
                            src={src}
                            loading="lazy"
                            className="h-[325px] w-[425px] max-w-full shrink-0 rounded-lg border border-default bg-surface shadow-sm"
                        />
                    </FrameCard>
                );
            })}
        </div>
    );
}

function Part({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
    return (
        <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4 border-t border-subtle pt-6" id={id}>
            <div className="flex flex-col gap-1">
                <h2 id={`${id}-title`} className="heading-md text-default">
                    {title}
                </h2>
                {note !== undefined && <p className="max-w-3xl text-sm text-secondary">{note}</p>}
            </div>
            {children}
        </section>
    );
}

const TOC: readonly [string, string][] = [
    ['popup', 'Popup'],
    ['dashboard', 'Dashboard'],
    ['container', 'Container window'],
    ['layout', 'Layout components'],
    ['nav', 'Navigation, dialogs, status'],
    ['mode', 'Filtering level and icons'],
];

function Gallery() {
    return (
        <main className="mx-auto flex max-w-[1180px] flex-col gap-8 px-4 py-6 sm:px-6" data-testid="gallery">
            <header className="flex flex-col gap-3">
                <h1 className="heading-lg text-default">Blocker — design review</h1>
                <p className="max-w-3xl text-sm text-secondary">
                    Every surface runs here against the mock browser API (each frame has its own mock background). Use “open” to see
                    a state full size. Custom filters and Develop are the upstream page inside the dashboard; they need the staged
                    extension and are not shown here.
                </p>
                <nav aria-label="Sections">
                    <ul className="flex flex-wrap gap-2">
                        {TOC.map(([id, label]) => (
                            <li key={id}>
                                <a
                                    className="inline-flex rounded-full border border-default px-3 py-1 text-sm text-default hover:bg-surface-secondary"
                                    href={`#${id}`}
                                >
                                    {label}
                                </a>
                            </li>
                        ))}
                    </ul>
                </nav>
                <div className="flex flex-wrap items-center gap-2">
                    <Button color="primary" size="sm">
                        Primary
                    </Button>
                    <Button color="secondary" variant="soft" size="sm">
                        Secondary
                    </Button>
                    <Button color="danger" variant="outline" size="sm">
                        Danger
                    </Button>
                </div>
            </header>

            <Part id="popup" title="Popup" note="340 × 456 px, the fixed size of the toolbar popover.">
                <PopupFrames />
            </Part>
            <Part id="dashboard" title="Dashboard" note="Rendered at 1100 × 800 px and shown at half size.">
                <DashboardFrames />
            </Part>
            <Part id="container" title="Container window" note="425 × 325 px, the macOS app window. English only (no extension API).">
                <ContainerFrames />
            </Part>
            <div className="border-t border-subtle pt-6" id="layout">
                <LayoutGallery />
            </div>
            <div className="border-t border-subtle pt-6" id="nav">
                <NavGallery />
            </div>
            <div className="flex flex-col gap-4 border-t border-subtle pt-6" id="mode">
                <h2 className="heading-md text-default">Filtering level and icons</h2>
                <ModeGallery />
            </div>
        </main>
    );
}

const locale = initDocumentLocale();
const container = document.getElementById('root');
if (container === null) {
    throw new Error('gallery: #root is missing');
}
createRoot(container).render(
    <StrictMode>
        <LocaleDirectionProvider dir={locale.dir}>
            <Gallery />
        </LocaleDirectionProvider>
    </StrictMode>,
);

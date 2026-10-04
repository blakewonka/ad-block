/**
 * About pane (dashboard-shell.md §4): name + version, copyright, links,
 * contributors, dependency credits (upstream's six, verbatim, plus the UI
 * libraries), and the "Troubleshooting information" disclosure.
 *
 * Parity notes:
 * - every link opens in a new tab (R-10; TextLink adds target=_blank and
 *   rel="noopener noreferrer" to https links);
 * - version line = `${manifest.name} ${manifest.version}`, isolated LTR; a raw
 *   `__MSG_…` name is replaced by t('extName') in this line only (D-4);
 * - the troubleshooting text is fetched by an IntersectionObserver on the text
 *   element (viewport root, never disconnected), so it loads when the
 *   disclosure is opened while in view, again on every reopen, on scrolling
 *   back into view and on returning to this pane (R-13; the shell keeps this
 *   pane mounted once visited);
 * - one click selects the whole text (user-select: all), the text is LTR
 *   (R-14). A Copy button is added (tNew); the result of the clipboard write
 *   (success or failure) is announced through the status region.
 * - `ml` has empty `aboutContributors` / `aboutTranslations` messages: those
 *   two use tNew with the English text (i18n.md §5.1 item 7).
 */
import { Alert } from '@openai/apps-sdk-ui/components/Alert';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { TextLink } from '@openai/apps-sdk-ui/components/TextLink';
import { useEffect, useRef, useState } from 'react';

import { AppIcon } from '@/components/icons';
import { Skeleton } from '@/components/Skeleton';
import { useAnnounce } from '@/components/StatusRegion';
import { getManifest } from '@/lib/ext';
import { t, tNew } from '@/lib/i18n';

import { CONTRIBUTOR_LINKS, COPYRIGHT_LINE, REDESIGN_LINES, TOP_LINKS, UI_CREDITS, UPSTREAM_CREDITS, type Credit } from './credits';
import { fetchTroubleshootingInfo } from './troubleshooting';

/** D-4: header line only. */
export function aboutNameVersion(): string {
    let name = '';
    let version = '';
    try {
        const manifest = getManifest();
        name = typeof manifest.name === 'string' ? manifest.name : String(manifest.name ?? '');
        version = typeof manifest.version === 'string' ? manifest.version : String(manifest.version ?? '');
    } catch {
        /* no API: leave empty */
    }
    if (name.startsWith('__MSG_')) {
        name = t('extName');
    }
    return `${name} ${version}`;
}

function CreditItem({ credit }: { credit: Credit }) {
    return (
        <li>
            {/* Hard-coded English credit, as upstream (dashboard-shell.md §4.2). */}
            <span dir="ltr">
                <TextLink href={credit.workHref}>{credit.work}</TextLink>
                {' by '}
                <TextLink href={credit.authorHref}>{credit.author}</TextLink>
            </span>
        </li>
    );
}

function errorText(err: unknown): string {
    if (err instanceof Error) { return err.message; }
    return String(err);
}

/** English fallbacks for messages that are empty in some locale (i18n.md §5.1 item 7). */
const EMPTY_IN_SOME_LOCALE: Readonly<Record<string, string>> = {
    aboutContributors: 'Contributors',
    aboutTranslations: 'Translations',
};

/** t(), or tNew() with the English text for the keys listed above. */
export function aboutText(key: string): string {
    const english = EMPTY_IN_SOME_LOCALE[key];
    return english === undefined ? t(key) : tNew(key, english);
}

/** Writes `text` to the clipboard; resolves true on success, false otherwise (never rejects). */
export function copyText(text: string): Promise<boolean> {
    try {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
            return Promise.resolve(false);
        }
        return clipboard.writeText(text).then(
            () => true,
            (err: unknown) => {
                console.warn('[about] clipboard write failed', err);
                return false;
            },
        );
    } catch (err) {
        console.warn('[about] clipboard write failed', err);
        return Promise.resolve(false);
    }
}

export function TroubleshootingInfo() {
    const preRef = useRef<HTMLPreElement>(null);
    const [text, setText] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [pending, setPending] = useState(0);
    const announce = useAnnounce();

    useEffect(() => {
        const pre = preRef.current;
        if (pre === null || typeof IntersectionObserver !== 'function') { return; }
        let alive = true;
        // Upstream (js/dashboard.js:57-66): never disconnected while the page lives;
        // ignore callbacks in which no entry intersects; the last answer to resolve wins.
        const observer = new IntersectionObserver((entries) => {
            if (entries.every((entry) => entry.isIntersecting === false)) { return; }
            setPending((n) => n + 1);
            fetchTroubleshootingInfo()
                .then(
                    (info) => {
                        if (!alive) { return; }
                        setText(info);
                        setError(null);
                    },
                    (err: unknown) => {
                        if (!alive) { return; }
                        console.error('[about] troubleshooting information failed', err);
                        setError(err);
                    },
                )
                .finally(() => {
                    if (alive) { setPending((n) => n - 1); }
                });
        });
        observer.observe(pre);
        return () => {
            alive = false;
            observer.disconnect();
        };
    }, []);

    const loading = pending > 0 && text === '';
    const onCopy = () => {
        void copyText(text).then((ok) => {
            if (ok) {
                announce(tNew('troubleshootingCopied', 'Troubleshooting information copied to the clipboard.'), {
                    tone: 'success',
                });
            } else {
                announce(tNew('troubleshootingCopyFailed', 'The troubleshooting information could not be copied.'), {
                    tone: 'danger',
                });
            }
        });
    };

    return (
        <details className="group flex flex-col gap-3" data-testid="troubleshooting">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm heading-xs text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring) [&::-webkit-details-marker]:hidden">
                <AppIcon
                    name="chevronDown"
                    className="size-4 shrink-0 -rotate-90 text-secondary group-open:rotate-0 rtl:rotate-90 rtl:group-open:rotate-0"
                />
                <span>{t('supportS5H')}</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
                {error !== null && (
                    <Alert
                        color="danger"
                        variant="soft"
                        title={tNew('troubleshootingLoadError', 'The troubleshooting information could not be collected.')}
                        description={errorText(error)}
                    />
                )}
                <div className="relative" aria-busy={loading}>
                    <pre
                        ref={preRef}
                        dir="ltr"
                        data-testid="troubleshooting-text"
                        className="min-h-64 min-w-0 overflow-x-auto rounded-lg border border-subtle bg-surface-secondary p-3 pe-24 text-start font-mono text-xs leading-relaxed text-default whitespace-pre select-all"
                    >
                        {text}
                    </pre>
                    {loading && (
                        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-1" data-testid="troubleshooting-loading">
                            <Skeleton shape="text" lines={8} className="max-w-sm" />
                        </div>
                    )}
                    <div className="absolute end-2 top-2">
                        <Button color="secondary" variant="soft" size="sm" disabled={text === ''} onClick={onCopy}>
                            <AppIcon name="copy" className="size-4" />
                            {tNew('copyButton', 'Copy')}
                        </Button>
                    </div>
                </div>
            </div>
        </details>
    );
}

export function AboutPane() {
    const headingId = 'about-pane-heading';
    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-6" data-testid="about-pane">
            <div className="flex flex-col gap-1">
                <h2 id={headingId} className="heading-sm text-default">
                    <bdi dir="ltr" data-testid="about-name-version">
                        {aboutNameVersion()}
                    </bdi>
                </h2>
                <p className="text-sm text-secondary">
                    <bdi dir="ltr">{COPYRIGHT_LINE}</bdi>
                </p>
                {REDESIGN_LINES.map((line) => (
                    <p key={line} className="text-sm text-secondary">
                        <bdi dir="ltr">{line}</bdi>
                    </p>
                ))}
            </div>

            <ul className="flex flex-col gap-2 text-sm" data-testid="about-links">
                {TOP_LINKS.map((link) => (
                    <li key={link.key}>
                        <TextLink href={link.href}>{t(link.key)}</TextLink>
                    </li>
                ))}
            </ul>

            <div className="flex flex-col gap-2">
                <h3 className="heading-xs text-default">{aboutText('aboutContributors')}</h3>
                <ul className="flex flex-col gap-2 text-sm" data-testid="about-contributors">
                    {CONTRIBUTOR_LINKS.map((link) => (
                        <li key={link.key}>
                            <TextLink href={link.href}>{aboutText(link.key)}</TextLink>
                        </li>
                    ))}
                </ul>
            </div>

            <div className="flex flex-col gap-2">
                <h3 className="heading-xs text-default">{t('aboutDependencies')}</h3>
                <ul className="flex flex-col gap-2 text-sm" data-testid="about-credits">
                    {UPSTREAM_CREDITS.map((credit) => (
                        <CreditItem key={credit.work} credit={credit} />
                    ))}
                    {UI_CREDITS.map((credit) => (
                        <CreditItem key={credit.work} credit={credit} />
                    ))}
                </ul>
            </div>

            <hr className="border-subtle" />

            <TroubleshootingInfo />
        </section>
    );
}

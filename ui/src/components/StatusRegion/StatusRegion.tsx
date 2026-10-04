/**
 * StatusRegion — aria-live announcements for async results.
 *
 *
 *   // once per page, around the app:
 *   <StatusProvider>
 *       …
 *       <StatusRegion />                       // screen-reader only (popup: no layout shift)
 *       <StatusRegion visual dismissLabel={…} /> // or: also shows the library Alert
 *   </StatusProvider>
 *
 *   // anywhere below the provider:
 *   const announce = useAnnounce();
 *   announce(t('…applied…'), { tone: 'success' });             // polite
 *   announce(error.message, { tone: 'danger' });               // assertive (danger default)
 *
 * Render exactly ONE StatusRegion per provider: every region announces.
 *
 * Mechanics: two live regions are always in the DOM from first render
 * (role="status" aria-live="polite" and role="alert" aria-live="assertive",
 * both aria-atomic), so assistive tech has registered them before anything
 * is announced. Only the latest announcement is shown, in the region that
 * matches its politeness. Each announcement is a fresh, keyed node, so the
 * same text announced twice is spoken twice.
 *
 * `visual`: the announcement is rendered as the library Alert (inside the live
 * region). Without `visual` the regions are `sr-only`. The Alert's own
 * role="alert" (danger colour) is removed, because the surrounding region
 * already announces it (avoids double announcements).
 *
 * No inline styles and no runtime <style>: safe for the container window CSP.
 * All text arrives through props/arguments; the component renders no text of its own.
 */
import { Alert, type AlertProps } from '@openai/apps-sdk-ui/components/Alert';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { CheckCircle, Info, Warning } from '@openai/apps-sdk-ui/components/Icon';
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';

export type AnnouncePoliteness = 'polite' | 'assertive';
export type AnnounceTone = 'info' | 'success' | 'warning' | 'danger';

export interface AnnounceOptions {
    /** Visual colour of the Alert (visual variant). @default 'info' */
    tone?: AnnounceTone;
    /** @default 'assertive' for tone 'danger', else 'polite' */
    politeness?: AnnouncePoliteness;
    /** Secondary line (Alert description); announced after the message. */
    description?: string;
    /**
     * Language of the message when it differs from the page, e.g. 'en' for an English-only
     * tNew() fallback shown in another locale. The text is then rendered in
     * `<span lang=… dir=…>` so it is spoken with the right voice and keeps its word order
     * in RTL pages. @default the page language
     */
    lang?: string;
}

export interface Announcement {
    /** Increments on every announce(); used as React key. */
    id: number;
    message: string;
    description?: string;
    tone: AnnounceTone;
    politeness: AnnouncePoliteness;
    lang?: string;
}

export type AnnounceFn = (message: string, options?: AnnounceOptions) => void;

interface StatusContextValue {
    current: Announcement | null;
    announce: AnnounceFn;
    clear: () => void;
}

const StatusContext = createContext<StatusContextValue | null>(null);

export function StatusProvider({ children }: { children?: ReactNode }) {
    const [current, setCurrent] = useState<Announcement | null>(null);
    const nextId = useRef(1);

    const announce = useCallback<AnnounceFn>((message, options = {}) => {
        const tone = options.tone ?? 'info';
        const politeness = options.politeness ?? (tone === 'danger' ? 'assertive' : 'polite');
        const id = nextId.current++;
        setCurrent({ id, message, description: options.description, tone, politeness, lang: options.lang });
    }, []);

    const clear = useCallback(() => setCurrent(null), []);

    const value = useMemo(() => ({ current, announce, clear }), [current, announce, clear]);
    return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

function useStatusContext(hook: string): StatusContextValue {
    const context = useContext(StatusContext);
    if (context === null) {
        throw new Error(`${hook} must be used inside <StatusProvider>`);
    }
    return context;
}

/** Stable function that announces a message (polite by default, assertive for tone 'danger'). */
export function useAnnounce(): AnnounceFn {
    return useStatusContext('useAnnounce').announce;
}

/** Full access: the current announcement, announce() and clear(). */
export function useStatus(): StatusContextValue {
    return useStatusContext('useStatus');
}

const TONE_TO_ALERT_COLOR: Record<AnnounceTone, NonNullable<AlertProps['color']>> = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
};

// The library Alert sets role="alert" for danger and has no prop to turn it
// off; its rest props are spread last, so this overrides it.
const NO_ROLE = { role: undefined } as unknown as Partial<AlertProps>;

// The library's default indicator icons, but hidden from assistive technology (the
// library renders them as unnamed images; the text already carries the meaning).
const INDICATOR: Record<AnnounceTone, ReactNode> = {
    info: <Info aria-hidden="true" focusable="false" />,
    success: <CheckCircle aria-hidden="true" focusable="false" />,
    warning: <Warning aria-hidden="true" focusable="false" />,
    danger: <Warning aria-hidden="true" focusable="false" />,
};

// RTL scripts of the shipped locales (i18n.md §2.2); used only for `lang` overrides.
const RTL_LANG = /^(ar|he|fa|ps|ur)(-|_|$)/i;

/** The text in its own language/direction when it differs from the page (AnnounceOptions.lang). */
function inLang(text: string, lang: string | undefined): ReactNode {
    if (lang === undefined) return text;
    return (
        <span lang={lang} dir={RTL_LANG.test(lang) ? 'rtl' : 'ltr'}>
            {text}
        </span>
    );
}

export interface StatusRegionProps {
    /** Render the announcement as a visible library Alert. @default false */
    visual?: boolean;
    /** Visual only: label of a dismiss Button in the Alert (no Button when omitted). */
    dismissLabel?: string;
    /** Extra classes on the wrapper. */
    className?: string;
}

export function StatusRegion({ visual = false, dismissLabel, className }: StatusRegionProps) {
    const { current, clear } = useStatusContext('StatusRegion');

    const renderContent = (politeness: AnnouncePoliteness) => {
        if (current === null || current.politeness !== politeness) {
            return null;
        }
        if (!visual) {
            return (
                <span key={current.id}>
                    {inLang(current.message, current.lang)}
                    {current.description !== undefined ? <> {inLang(current.description, current.lang)}</> : null}
                </span>
            );
        }
        return (
            <Alert
                key={current.id}
                {...NO_ROLE}
                color={TONE_TO_ALERT_COLOR[current.tone]}
                variant="soft"
                indicator={INDICATOR[current.tone]}
                // The soft variant draws its text in the tone colour, which is below 4.5:1 in
                // dark mode (danger 3.78:1, warning 4.37:1). The text uses the default ink;
                // the tinted surface and the coloured icon keep the tone.
                title={<span className="text-default">{inLang(current.message, current.lang)}</span>}
                description={
                    current.description !== undefined ? (
                        <span className="text-default">{inLang(current.description, current.lang)}</span>
                    ) : undefined
                }
                actions={
                    dismissLabel !== undefined ? (
                        <Button color="secondary" variant="ghost" size="sm" onClick={clear}>
                            {dismissLabel}
                        </Button>
                    ) : undefined
                }
            />
        );
    };

    return (
        <div data-blocker-status="" className={[visual ? '' : 'sr-only', className].filter(Boolean).join(' ')}>
            <div role="status" aria-live="polite" aria-atomic="true" data-politeness="polite">
                {renderContent('polite')}
            </div>
            <div role="alert" aria-live="assertive" aria-atomic="true" data-politeness="assertive">
                {renderContent('assertive')}
            </div>
        </div>
    );
}

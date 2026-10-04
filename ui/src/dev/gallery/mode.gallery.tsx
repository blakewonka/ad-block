/**
 * Gallery section for the filtering-level control and the icon layer.
 * Dev only (harness gallery), never shipped.
 *
 *   import { ModeGallery } from './mode.gallery';
 *   <ModeGallery />
 *
 * Shows ModeSelector at popup width (340px) and settings size, LTR and RTL, with real
 * locale strings from PRISTINE/_locales (en, et = longest mode name "filtreerimine
 * puudub", ar = RTL) and a synthetic "2x English" set; the busy / read-only / disabled /
 * rejected states; LevelMeter in both tones; every semantic icon and IconButton.
 * Locale strings are copied verbatim here because the gallery must not depend on the
 * mock's i18n; English-only labels in this file are developer-facing.
 */
import { useState, type ReactNode } from 'react';
import { AppIcon, IconButton, icons, type IconName } from '@/components/icons';
import { LevelMeter } from '@/components/LevelMeter';
import { ModeSelector, type ModeSelectorProps } from '@/components/ModeSelector';

type Strings = {
    label: string;
    settingsLabel: string;
    names: Record<number, string>;
    descriptions: Record<number, string>;
};

const EN: Strings = {
    label: 'filtering mode',
    settingsLabel: 'Default filtering mode',
    names: { 0: 'no filtering', 1: 'basic', 2: 'optimal', 3: 'complete' },
    descriptions: {
        1: 'Basic network filtering from selected filter lists.\n\nDoes not require permission to read and modify data on websites.',
        2: 'Advanced network filtering plus specific extended filtering from selected filter lists.\n\nRequires broad permission to read and modify data on all websites.',
        3: 'Advanced network filtering plus specific and generic extended filtering from selected filter lists.\n\nRequires broad permission to read and modify data on all websites.\n\nGeneric extended filtering may cause higher web page resources usage.',
    },
};

const ET: Strings = {
    label: 'filtreerimisrežiim',
    settingsLabel: 'Tavaline filtreerimisrežiim',
    names: { 0: 'filtreerimine puudub', 1: 'põhiline', 2: 'optimaalne', 3: 'põhjalik' },
    descriptions: {
        1: 'Interneti üldine filtreerimine valitud filtreerimisloenditega.\n\nPole vaja veebilehtede andmete lugemise ja muutmise luba.',
        2: 'Interneti täpsem filtreerimine enda valitud filtreerimisloenditega.\n\nVajab veebilehtede andmete lugemise ja muutmise üldist luba.',
        3: 'Interneti põhjalikum filtreerimine ja enda valitud filtreerimisloenditega täpsem ning üldisem filtreerimine.\n\nVajab kõikide veebilehtede andmete lugemise ja muutmise üldist luba.\n\nÜldine ja põhjalikum filtreerimine võib koormata veebilehe ressursse tavapärasest rohkem.',
    },
};

const AR: Strings = {
    label: 'وضع التصفية',
    settingsLabel: 'وضع التصفية الافتراضي',
    names: { 0: 'لا تصفية', 1: 'أساسي', 2: 'الأمثل', 3: 'كامل' },
    descriptions: {
        1: 'تصفية الشبكة الأساسية من قوائم التصفية المحددة.\n\nلا يتطلب إذنًا لقراءة البيانات وتعديلها على مواقع الويب.',
        2: 'تصفية الشبكة المتقدمة بالإضافة إلى تصفية موسعة محددة من قوائم التصفية المحددة.\n\nيتطلب إذنًا واسعًا لقراءة البيانات وتعديلها على جميع مواقع الويب.',
        3: 'تصفية الشبكة المتقدمة بالإضافة إلى تصفية موسعة محددة وعامة من قوائم التصفية المحددة.\n\nيتطلب إذنًا واسعًا لقراءة البيانات وتعديلها على جميع مواقع الويب.\n\nقد تؤدي التصفية الموسعة العامة إلى زيادة استخدام موارد صفحة الويب.',
    },
};

/** Every English string doubled: the layout rule is "survive 2x English". */
const EN2X: Strings = {
    label: 'filtering mode filtering mode',
    settingsLabel: 'Default filtering mode Default filtering mode',
    names: {
        0: 'no filtering no filtering no filtering',
        1: 'basic basic',
        2: 'optimal optimal',
        3: 'complete complete complete',
    },
    descriptions: Object.fromEntries(
        Object.entries(EN.descriptions).map(([k, v]) => [k, `${v} ${v}`]),
    ) as Record<number, string>,
};

const LEVELS_POPUP = [0, 1, 2, 3] as const;
const LEVELS_SETTINGS = [1, 2, 3] as const;

type DemoProps = Omit<ModeSelectorProps, 'value' | 'onChange' | 'names' | 'label' | 'levels'> & {
    strings: Strings;
    initial: number;
    levels?: readonly number[];
    /** Simulated permission refusal: changes to these levels are shown, then reverted. */
    refuse?: readonly number[];
    /** Simulated commit time in ms (busy while it runs). */
    commitMs?: number;
};

/** Stateful demo wrapper: optimistic update, busy while "committing", snap back on refusal. */
function ModeDemo({ strings, initial, levels = LEVELS_POPUP, refuse = [], commitMs = 500, size, ...rest }: DemoProps) {
    const [value, setValue] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState('');
    const onChange = (level: number) => {
        const before = value;
        setValue(level);
        setBusy(true);
        setLog(`onChange(${level})`);
        window.setTimeout(() => {
            setBusy(false);
            if (refuse.includes(level)) {
                setValue(before);
                setLog(`onChange(${level}) refused, back to ${before}`);
            }
        }, commitMs);
    };
    return (
        <div className="flex flex-col gap-1">
            <ModeSelector
                {...rest}
                size={size}
                value={value}
                onChange={onChange}
                levels={levels}
                names={strings.names}
                descriptions={size === 'settings' ? strings.descriptions : rest.descriptions}
                label={size === 'settings' ? strings.settingsLabel : strings.label}
                busy={rest.busy ?? busy}
            />
            <code className="h-4 text-xs text-secondary" dir="ltr">
                {log}
            </code>
        </div>
    );
}

function Frame({ title, dir = 'ltr', width, children }: { title: string; dir?: 'ltr' | 'rtl'; width?: 'popup'; children: ReactNode }) {
    return (
        <figure className="flex flex-col gap-2">
            <figcaption className="text-xs font-medium text-secondary">{title}</figcaption>
            <div
                dir={dir}
                className={[
                    'rounded-lg border border-default bg-surface p-4',
                    width === 'popup' ? 'w-[340px]' : 'w-full max-w-xl',
                ].join(' ')}
            >
                {children}
            </div>
        </figure>
    );
}

function Heading({ children }: { children: ReactNode }) {
    return <h2 className="text-base font-semibold text-default">{children}</h2>;
}

export function ModeGallery() {
    return (
        <section className="flex flex-col gap-6" data-gallery="mode" aria-label="Filtering level control and icons">
            <Heading>ModeSelector — popup (340px)</Heading>
            <div className="flex flex-wrap gap-6">
                <Frame title="en, level 1 (clicks to 3 are refused)" width="popup">
                    <ModeDemo strings={EN} initial={1} size="popup" refuse={[3]} />
                </Frame>
                <Frame title="et (longest name), level 0" width="popup">
                    <ModeDemo strings={ET} initial={0} size="popup" />
                </Frame>
                <Frame title="2x English, level 3" width="popup">
                    <ModeDemo strings={EN2X} initial={3} size="popup" />
                </Frame>
                <Frame title="ar, RTL, level 2" dir="rtl" width="popup">
                    <ModeDemo strings={AR} initial={2} size="popup" dir="rtl" />
                </Frame>
                <Frame title="et, RTL, level 1 (mirroring check)" dir="rtl" width="popup">
                    <ModeDemo strings={ET} initial={1} size="popup" dir="rtl" />
                </Frame>
            </div>

            <Heading>ModeSelector — states</Heading>
            <div className="flex flex-wrap gap-6">
                <Frame title="busy" width="popup">
                    <ModeDemo strings={EN} initial={2} size="popup" busy />
                </Frame>
                <Frame title="read-only (admin policy)" width="popup">
                    <ModeDemo strings={EN} initial={1} size="popup" readOnly />
                </Frame>
                <Frame title="level 3 disabled" width="popup">
                    <ModeDemo strings={EN} initial={1} size="popup" disabledLevels={[3]} />
                </Frame>
            </div>

            <Heading>ModeSelector — settings (default filtering mode)</Heading>
            <div className="flex flex-wrap gap-6">
                <Frame title="en, default 2">
                    <ModeDemo strings={EN} initial={2} levels={LEVELS_SETTINGS} size="settings" />
                </Frame>
                <Frame title="et, default 3">
                    <ModeDemo strings={ET} initial={3} levels={LEVELS_SETTINGS} size="settings" />
                </Frame>
                <Frame title="ar, RTL, default 1" dir="rtl">
                    <ModeDemo strings={AR} initial={1} levels={LEVELS_SETTINGS} size="settings" dir="rtl" />
                </Frame>
                <Frame title="2x English, default 0 (no radio checked)">
                    <ModeDemo strings={EN2X} initial={0} levels={LEVELS_SETTINGS} size="settings" />
                </Frame>
            </div>

            <Heading>LevelMeter</Heading>
            <div className="flex flex-wrap items-end gap-6 text-secondary" data-gallery="level-meter">
                {([0, 1, 2, 3] as const).map((level) => (
                    <div key={level} className="flex flex-col items-center gap-1">
                        <div className="flex items-end gap-2">
                            <LevelMeter level={level} size="sm" />
                            <LevelMeter level={level} />
                            <LevelMeter level={level} size="lg" />
                            <LevelMeter level={level} size="lg" tone="mono" />
                        </div>
                        <span className="text-xs">{level}</span>
                    </div>
                ))}
            </div>

            <Heading>Icons (semantic map)</Heading>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-6" data-gallery="icons">
                {(Object.keys(icons) as IconName[]).map((name) => (
                    <li key={name} className="flex min-w-0 items-center gap-2 text-sm text-default">
                        <AppIcon name={name} className="size-5" />
                        <span className="truncate font-mono text-xs text-secondary">{name}</span>
                    </li>
                ))}
            </ul>

            <Heading>IconButton</Heading>
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-1">
                    <IconButton icon="zapper" label="Enter element zapper mode" />
                    <IconButton icon="picker" label="Enter element picker mode" />
                    <IconButton icon="unpicker" label="Show hidden elements" />
                    <IconButton icon="report" label="Report an issue on this website" />
                    <IconButton icon="dashboard" label="Open the dashboard" />
                    <IconButton icon="copy" label="Copy" size="sm" />
                    <IconButton icon="trash" label="Remove" color="danger" />
                    <IconButton icon="download" label="Export" disabled />
                    <IconButton icon="chevronRight" label="Next" />
                </div>
                <div dir="rtl" className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-secondary">RTL:</span>
                    <IconButton icon="chevronRight" label="التالي" />
                    <IconButton icon="arrowRight" label="التالي" />
                    <IconButton icon="externalLink" label="فتح" />
                </div>
            </div>
        </section>
    );
}

export default ModeGallery;

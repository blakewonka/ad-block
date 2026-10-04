/**
 * Gallery section for the layout building blocks and tokens.
 * Dev-only (src/dev is rejected from production bundles by vite.shared.ts noDevModules).
 * The gallery page itself (src/dev/gallery/main.tsx) is assembled by the gallery task:
 *
 *   import { LayoutGallery } from './layout.gallery';
 *   <LayoutGallery />
 *
 * The sample texts below are English on purpose: this is a developer page, not shipped UI.
 * Each block is shown in a light and a dark scope (nested data-theme), plus an RTL scope.
 */
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { SegmentedControl } from '@openai/apps-sdk-ui/components/SegmentedControl';
import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { useState, type ReactNode } from 'react';
import { Card, type CardPadding, type CardRadius, type CardVariant } from '@/components/Card';
import { PageShell, type PageShellWidth } from '@/components/PageShell';
import { Section, type SectionHeadingSize } from '@/components/Section';
import { SettingRow } from '@/components/SettingRow';
import { Skeleton } from '@/components/Skeleton';

const LEVELS = [
    { n: 0, name: 'none (gray)', solid: 'bg-level-0 text-level-0-on-solid', soft: 'bg-level-0-soft text-level-0-on-soft', text: 'text-level-0-on-soft' },
    { n: 1, name: 'basic (blue)', solid: 'bg-level-1 text-level-1-on-solid', soft: 'bg-level-1-soft text-level-1-on-soft', text: 'text-level-1-on-soft' },
    { n: 2, name: 'optimal (green)', solid: 'bg-level-2 text-level-2-on-solid', soft: 'bg-level-2-soft text-level-2-on-soft', text: 'text-level-2-on-soft' },
    { n: 3, name: 'complete (purple)', solid: 'bg-level-3 text-level-3-on-solid', soft: 'bg-level-3-soft text-level-3-on-soft', text: 'text-level-3-on-soft' },
] as const;

const CARD_VARIANTS: CardVariant[] = ['elevated', 'outline', 'subtle'];
const CARD_PADDINGS: CardPadding[] = ['none', 'sm', 'md', 'lg'];
const CARD_RADII: CardRadius[] = ['lg', 'xl', '2xl'];
const HEADING_SIZES: SectionHeadingSize[] = ['xs', 'sm', 'md', 'lg'];
const SHELL_WIDTHS: PageShellWidth[] = ['popup', 'narrow', 'page', 'wide', 'full'];

/** Renders `children` twice: in a light and in a dark theme scope. */
function Themed({ children, label }: { children: (theme: 'light' | 'dark') => ReactNode; label: string }) {
    return (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" data-gallery-block={label}>
            {(['light', 'dark'] as const).map((theme) => (
                <div
                    key={theme}
                    data-theme={theme}
                    className="flex min-w-0 flex-col gap-3 rounded-xl border border-subtle bg-surface p-4 text-default"
                >
                    <p className="text-xs text-secondary">
                        {label} — {theme}
                    </p>
                    {children(theme)}
                </div>
            ))}
        </div>
    );
}

function TokenSwatches() {
    return (
        <Themed label="Level tokens">
            {() => (
                <div className="flex flex-col gap-2">
                    {LEVELS.map((level) => (
                        <div key={level.n} className="flex flex-wrap items-center gap-2" data-level={level.n}>
                            <span className={`inline-flex h-8 min-w-24 items-center justify-center rounded-md px-2 text-sm font-medium ${level.solid}`}>
                                {level.n} solid
                            </span>
                            <span className={`inline-flex h-8 items-center rounded-md px-2 text-sm ${level.soft}`}>
                                {level.n} {level.name} on soft
                            </span>
                            <span className={`text-sm ${level.text}`}>text on surface</span>
                        </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-2" data-level="accent">
                        <span className="inline-flex h-8 min-w-24 items-center justify-center rounded-md bg-accent px-2 text-sm font-medium text-accent-on-solid">
                            accent
                        </span>
                        <span className="inline-flex h-8 items-center rounded-md bg-accent-soft px-2 text-sm text-accent-on-soft">
                            accent on soft
                        </span>
                        <span className="inline-block size-4 rounded-full border-2 border-accent" />
                    </div>
                </div>
            )}
        </Themed>
    );
}

function CardVariants() {
    return (
        <Themed label="Card">
            {() => (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {CARD_VARIANTS.map((variant) => (
                            <Card key={variant} variant={variant}>
                                <p className="text-sm font-medium">variant="{variant}"</p>
                                <p className="text-sm text-secondary">padding md, radius 2xl</p>
                            </Card>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-start gap-3">
                        {CARD_PADDINGS.map((padding) => (
                            <Card key={padding} padding={padding} radius="xl">
                                <span className="block bg-primary-soft-alpha text-xs">padding="{padding}"</span>
                            </Card>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-start gap-3">
                        {CARD_RADII.map((radius) => (
                            <Card key={radius} radius={radius} variant="outline" padding="sm">
                                <span className="text-xs">radius="{radius}"</span>
                            </Card>
                        ))}
                        <Card as="fieldset" variant="outline" padding="sm" radius="lg">
                            <legend className="px-1 text-xs text-secondary">as="fieldset"</legend>
                            <span className="text-xs">grouped controls</span>
                        </Card>
                    </div>
                </div>
            )}
        </Themed>
    );
}

function SectionVariants() {
    return (
        <Themed label="Section">
            {() => (
                <div className="flex flex-col gap-6">
                    {HEADING_SIZES.map((size) => (
                        <Section
                            key={size}
                            level={3}
                            size={size}
                            title={`Heading size "${size}" (h3)`}
                            description="Optional description in text-secondary, wrapping onto several lines when it is long enough to need it."
                            actions={
                                size === 'sm' ? (
                                    <Button color="secondary" variant="soft" size="sm">
                                        Action
                                    </Button>
                                ) : undefined
                            }
                        >
                            <Card variant="subtle" padding="sm">
                                <span className="text-sm">children</span>
                            </Card>
                        </Section>
                    ))}
                    <Section level={4} title="No description, gap lg (h4)" gap="lg">
                        <Skeleton className="h-6 w-full" />
                    </Section>
                </div>
            )}
        </Themed>
    );
}

function SettingRows({ dir }: { dir?: 'rtl' }) {
    const [a, setA] = useState(true);
    const [b, setB] = useState(false);
    const [mode, setMode] = useState('optimal');
    return (
        <Card padding="none" dir={dir}>
            <div className="divide-y divide-alpha/10">
                <SettingRow
                    inset
                    label="Switch with a description"
                    description="The label is a <label for> pointing at the switch; the description is its aria-describedby."
                    control={({ id, describedBy }) => (
                        <Switch id={id} aria-describedby={describedBy} checked={a} onCheckedChange={setA} />
                    )}
                />
                <SettingRow
                    inset
                    label="Label only"
                    control={({ id }) => <Switch id={id} checked={b} onCheckedChange={setB} />}
                />
                <SettingRow
                    inset
                    label="A very long label that a translation could easily make twice as long as the English text"
                    description="Long texts wrap; the control stays at the inline-end."
                    control={({ id, describedBy }) => <Switch id={id} aria-describedby={describedBy} />}
                />
                <SettingRow
                    inset
                    label="Wide control wraps"
                    description="When the control does not fit beside the text it moves to a second line."
                    control={({ labelId }) => (
                        <div role="group" aria-labelledby={labelId}>
                            <SegmentedControl aria-label="Wide control wraps" value={mode} onChange={setMode}>
                                <SegmentedControl.Option value="none">no filtering</SegmentedControl.Option>
                                <SegmentedControl.Option value="basic">basic</SegmentedControl.Option>
                                <SegmentedControl.Option value="optimal">optimal</SegmentedControl.Option>
                                <SegmentedControl.Option value="complete">complete</SegmentedControl.Option>
                            </SegmentedControl>
                        </div>
                    )}
                />
                <SettingRow
                    inset
                    stacked
                    label="Stacked"
                    description="stacked puts the control on its own line."
                    control={({ id, describedBy }) => (
                        <Input id={id} aria-describedby={describedBy} placeholder="example.com" />
                    )}
                />
                <SettingRow
                    inset
                    disabled
                    label="Disabled row"
                    description="Texts are dimmed; the control is disabled by the caller."
                    control={({ id, describedBy, disabled }) => (
                        <Switch id={id} aria-describedby={describedBy} disabled={disabled} />
                    )}
                />
                <SettingRow
                    inset
                    density="sm"
                    label="Dense row with extra content"
                    control={({ id }) => (
                        <Button id={id} color="secondary" variant="outline" size="sm">
                            Button
                        </Button>
                    )}
                >
                    <Badge color="warning" className="self-start">
                        children slot
                    </Badge>
                </SettingRow>
            </div>
        </Card>
    );
}

function SkeletonVariants() {
    return (
        <Themed label="Skeleton">
            {() => (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <Skeleton className="h-10 w-24" />
                        <Skeleton shape="circle" className="size-10" />
                        <Skeleton shape="pill" className="h-6 w-20" />
                        <Skeleton pulse className="h-10 w-24" />
                    </div>
                    <Skeleton shape="text" />
                    <Skeleton shape="text" lines={3} pulse />
                    <p className="text-xs text-secondary">The last block and the 3 lines pulse unless reduced motion is on.</p>
                </div>
            )}
        </Themed>
    );
}

function PopupSkeleton() {
    return (
        <PageShell
            landmarks={false}
            width="popup"
            padding="sm"
            fillViewport={false}
            className="w-fit max-w-full rounded-xl border border-subtle"
            aria-busy="true"
            header={
                <div className="flex items-center justify-between gap-2">
                    <Skeleton shape="text" className="w-40" />
                    <Skeleton shape="circle" className="size-7" />
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton shape="text" lines={2} />
                <div className="flex gap-2">
                    <Skeleton className="h-8 flex-1" />
                    <Skeleton className="h-8 flex-1" />
                    <Skeleton className="h-8 flex-1" />
                </div>
            </div>
        </PageShell>
    );
}

function PageShellVariants() {
    return (
        <Themed label="PageShell">
            {() => (
                <div className="flex flex-col gap-3">
                    <p className="text-xs text-secondary">
                        Previews use landmarks=false (a page may have only one main). Popup width = --blocker-popup-width.
                    </p>
                    <PopupSkeleton />
                    {SHELL_WIDTHS.filter((w) => w !== 'popup').map((width) => (
                        <PageShell
                            key={width}
                            landmarks={false}
                            width={width}
                            padding="sm"
                            fillViewport={false}
                            className="border border-dashed border-default"
                            header={<span className="text-xs font-medium">header slot — width="{width}"</span>}
                        >
                            <Skeleton className="h-6 w-full" />
                        </PageShell>
                    ))}
                </div>
            )}
        </Themed>
    );
}

export function LayoutGallery() {
    return (
        <section aria-labelledby="layout-gallery-title" className="flex min-w-0 flex-col gap-8" data-testid="layout-gallery">
            <h2 id="layout-gallery-title" className="heading-md text-default">
                Layout building blocks
            </h2>
            <TokenSwatches />
            <CardVariants />
            <SectionVariants />
            <Themed label="SettingRow">{() => <SettingRows />}</Themed>
            <Themed label="SettingRow, dir=rtl">{() => <SettingRows dir="rtl" />}</Themed>
            <SkeletonVariants />
            <PageShellVariants />
        </section>
    );
}

export default LayoutGallery;

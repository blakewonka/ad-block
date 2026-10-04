/**
 * Gallery section for the navigation and dialog building blocks:
 * Tabs, ConfirmDialog, StatusRegion.
 * Dev-only (src/dev is rejected from production bundles by vite.shared.ts noDevModules).
 * The gallery page itself (src/dev/gallery/main.tsx) is assembled by the gallery task:
 *
 *   import { NavGallery } from './nav.gallery';
 *   <NavGallery />
 *
 * The sample texts below are English on purpose: this is a developer page, not shipped UI.
 */
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusProvider, StatusRegion, useAnnounce } from '@/components/StatusRegion';
import { TabPanel, Tabs, type TabItem } from '@/components/Tabs';

const PANES: TabItem[] = [
    { id: 'settings', label: 'Settings' },
    { id: 'rulesets', label: 'Filter lists' },
    { id: 'develop', label: 'Develop', hidden: true },
    { id: 'custom', label: 'Custom filters' },
    { id: 'about', label: 'About' },
];

const LONG_PANES: TabItem[] = [
    { id: 'settings', label: 'Einstellungen und erweiterte Optionen' },
    { id: 'rulesets', label: 'Filterlisten (Regelsätze) verwalten' },
    { id: 'custom', label: 'Benutzerdefinierte Filter' },
    { id: 'about', label: 'Über diese Erweiterung' },
];

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-3" data-gallery-block={title}>
            <h3 className="heading-xs text-default">{title}</h3>
            {note !== undefined ? <p className="text-sm text-secondary">{note}</p> : null}
            <div className="min-w-0 rounded-xl border border-subtle bg-surface p-4">{children}</div>
        </section>
    );
}

function Pane({ id, children }: { id: string; children?: ReactNode }) {
    return (
        <div className="flex flex-col gap-2 text-sm">
            <p className="text-default">
                Panel <code>{id}</code>
            </p>
            {children}
        </div>
    );
}

function TabsDemo({
    orientation,
    activationMode,
    items = PANES,
    showDevelop = false,
    dir,
}: {
    orientation: 'horizontal' | 'vertical' | 'responsive';
    activationMode?: 'automatic' | 'manual';
    items?: TabItem[];
    showDevelop?: boolean;
    dir?: 'ltr' | 'rtl';
}) {
    const [value, setValue] = useState(items[0]?.id ?? '');
    const visible = items.map((item) => (item.id === 'develop' ? { ...item, hidden: !showDevelop } : item));
    return (
        <div dir={dir}>
            <Tabs
                label={`Dashboard sections (${orientation})`}
                items={visible}
                value={value}
                onValueChange={setValue}
                orientation={orientation}
                activationMode={activationMode}
                dir={dir}
                keepMounted={['custom']}
            >
                {visible.map((item) => (
                    <TabPanel key={item.id} value={item.id}>
                        <Pane id={item.id}>
                            {item.id === 'custom' ? (
                                <>
                                    <p className="text-secondary">
                                        Kept mounted: type something, switch tabs, come back — the text stays.
                                    </p>
                                    <Input aria-label="Kept-mounted field" placeholder="Type here" />
                                </>
                            ) : null}
                        </Pane>
                    </TabPanel>
                ))}
            </Tabs>
        </div>
    );
}

function TabsSection() {
    const [showDevelop, setShowDevelop] = useState(false);
    return (
        <div className="flex flex-col gap-6">
            <div>
                <Button color="secondary" variant="outline" size="sm" onClick={() => setShowDevelop((v) => !v)}>
                    {showDevelop ? 'Hide' : 'Show'} the hidden “Develop” tab
                </Button>
            </div>
            <Block title="Tabs — horizontal, automatic activation" note="Arrows select immediately; Home/End.">
                <TabsDemo orientation="horizontal" showDevelop={showDevelop} />
            </Block>
            <Block
                title="Tabs — responsive (row < 768px, sidebar ≥ 768px), manual activation"
                note="Arrows move focus only; Enter/Space selects. Resize the window to switch layout."
            >
                <TabsDemo orientation="responsive" activationMode="manual" showDevelop={showDevelop} />
            </Block>
            <Block title="Tabs — vertical, long labels (2x English)">
                <TabsDemo orientation="vertical" items={LONG_PANES} />
            </Block>
            <Block title="Tabs — RTL (dir=rtl)" note="Left arrow moves to the next tab.">
                <TabsDemo orientation="horizontal" dir="rtl" />
            </Block>
        </div>
    );
}

function wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function DialogSection() {
    const announce = useAnnounce();
    const [asyncOpen, setAsyncOpen] = useState(false);
    const [failOpen, setFailOpen] = useState(false);
    const asyncButton = useRef<HTMLButtonElement>(null);
    const failButton = useRef<HTMLButtonElement>(null);

    return (
        <div className="flex flex-wrap items-center gap-3">
            <ConfirmDialog
                trigger={
                    <Button color="danger" variant="outline">
                        Reset to default…
                    </Button>
                }
                title="Reset all settings?"
                description="Every setting returns to its default value. Your custom filters are kept."
                confirmLabel="Reset"
                cancelLabel="Cancel"
                danger
                onConfirm={() => announce('Settings were reset', { tone: 'success' })}
            />

            <Button ref={asyncButton} color="secondary" variant="soft" onClick={() => setAsyncOpen(true)}>
                Apply (async, 1.5 s)…
            </Button>
            <ConfirmDialog
                open={asyncOpen}
                onOpenChange={setAsyncOpen}
                returnFocusRef={asyncButton}
                title="Apply the selected filter lists?"
                description={
                    <>
                        <p>Blocker will reload its rulesets. This takes a moment.</p>
                        <p className="mt-2">The confirm button shows a busy state until it finishes.</p>
                    </>
                }
                confirmLabel="Apply"
                cancelLabel="Cancel"
                onConfirm={async () => {
                    await wait(1500);
                    announce('Filter lists applied', { tone: 'success', description: '3 lists enabled.' });
                }}
            />

            <Button ref={failButton} color="secondary" variant="soft" onClick={() => setFailOpen(true)}>
                Apply (fails)…
            </Button>
            <ConfirmDialog
                open={failOpen}
                onOpenChange={setFailOpen}
                returnFocusRef={failButton}
                title="Apply changes?"
                description="This one rejects after 1 s; the dialog stays open and the error is announced."
                confirmLabel="Apply"
                cancelLabel="Cancel"
                onConfirm={async () => {
                    await wait(1000);
                    throw new Error('The rule limit was reached.');
                }}
                onError={(error) =>
                    announce('Could not apply the changes', {
                        tone: 'danger',
                        description: error instanceof Error ? error.message : String(error),
                    })
                }
            />

            <ConfirmDialog
                trigger={
                    <Button color="secondary" variant="ghost">
                        Long-text dialog…
                    </Button>
                }
                title="Möchten Sie wirklich alle benutzerdefinierten Filter und Einstellungen zurücksetzen?"
                description="Alle Einstellungen werden auf ihre Standardwerte zurückgesetzt. Diese Aktion kann nicht rückgängig gemacht werden, und alle Änderungen gehen verloren."
                confirmLabel="Auf Standardeinstellungen zurücksetzen"
                cancelLabel="Abbrechen und nichts ändern"
                danger
                onConfirm={() => {}}
            />
        </div>
    );
}

function StatusButtons() {
    const announce = useAnnounce();
    return (
        <div className="flex flex-wrap gap-2">
            <Button color="secondary" variant="soft" size="sm" onClick={() => announce('Changes applied', { tone: 'success' })}>
                Announce success
            </Button>
            <Button color="secondary" variant="soft" size="sm" onClick={() => announce('Changes reverted')}>
                Announce info
            </Button>
            <Button
                color="secondary"
                variant="soft"
                size="sm"
                onClick={() =>
                    announce('Some lists could not be enabled', {
                        tone: 'warning',
                        description: 'The browser rule limit was reached.',
                    })
                }
            >
                Announce warning
            </Button>
            <Button
                color="secondary"
                variant="soft"
                size="sm"
                onClick={() => announce('Could not save settings', { tone: 'danger', description: 'No response.' })}
            >
                Announce error (assertive)
            </Button>
        </div>
    );
}

export function NavGallery() {
    return (
        <StatusProvider>
            <section className="flex min-w-0 flex-col gap-8" data-testid="nav-gallery" aria-labelledby="nav-gallery-heading">
                <h2 id="nav-gallery-heading" className="heading-md text-default">
                    Navigation, dialogs and status
                </h2>
                <TabsSection />
                <Block
                    title="ConfirmDialog"
                    note="Focus starts on Cancel, Tab is trapped, Escape cancels, focus returns to the opener."
                >
                    <DialogSection />
                </Block>
                <Block title="StatusRegion (visual)" note="Results of the dialogs above are announced here too.">
                    <div className="flex flex-col gap-3">
                        <StatusButtons />
                        <StatusRegion visual dismissLabel="Dismiss" />
                    </div>
                </Block>
            </section>
        </StatusProvider>
    );
}

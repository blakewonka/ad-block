/**
 * Dashboard "Settings" pane (docs/specs/settings.md).
 *
 *   <SettingsPane />     no props: loads its own data through the page-wide
 *                        options store (./store, one getOptionsPageData per page)
 *
 * Blocks, in upstream DOM order (§1): default filtering mode, behaviour
 * toggles, backup / restore / reset. Live sync comes from the store (§5).
 *
 * Presentation decisions that change no message:
 * - Mode options are cards with native radios (./ModeCards): the whole card
 *   selects, arrow keys select (and request the permission inside the key
 *   event), exactly as upstream's <label><input type=radio> (§1, §3.2).
 * - A mode change or a toggle shows the user's choice until the background
 *   answers, unless the store changes that field meanwhile (a broadcast wins:
 *   checklist 13); a watchdog gives up after settingsTiming.watchdogMs, shows
 *   the stored value again and announces the failure. A second mode change is
 *   ignored only while the first is still shown as pending (H15).
 * - On success the store takes the answer (H4 deviation: upstream waits for
 *   the echo); on failure the control reverts and the failure is announced
 *   (H12, §3.4).
 * - Feedback is announced through the (screen-reader) StatusRegion AND shown
 *   as an Alert right under the block that caused it, scrolled into view.
 * - Restore/reset: waits for an in-flight mode change first, then runs in a
 *   busy state (pane inert + dimmed, a centred status pill that takes focus);
 *   focus returns to the Restore / Reset button afterwards. Each successful
 *   write updates the store (H7 deviation, changes no message).
 * - Reset asks with an in-page ConfirmDialog (text `resetToDefaultConfirm`)
 *   instead of `window.confirm`.
 * - Admin `disabledFeatures` tokens hide blocks exactly as upstream (§2.4); an
 *   info note says that some settings are managed.
 */
import { Alert, type AlertProps } from '@openai/apps-sdk-ui/components/Alert';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';
import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Section } from '@/components/Section';
import { SettingRow } from '@/components/SettingRow';
import { Skeleton } from '@/components/Skeleton';
import { StatusProvider, StatusRegion, useAnnounce, type AnnounceOptions, type AnnounceTone } from '@/components/StatusRegion';
import {
    setAutoReload,
    setDefaultFilteringMode,
    setDeveloperMode,
    setPopupBlockMode,
    setShowBlockedCount,
    setStrictBlockMode,
} from '@/lib/bridge';
import { isSafari, requestOrigins } from '@/lib/ext';
import { T, t, tNew } from '@/lib/i18n';

import {
    adminFlags,
    BACKUP_FILE_NAME,
    backupDataURL,
    INVALID_FILE,
    parseRestoreFile,
    selectedLevel,
    TOGGLE_ORDER,
    toggleStates,
    withoutEllipsis,
    type OptionsData,
    type ToggleKey,
} from './model';
import { ModeCards, type CardLevel } from './ModeCards';
import { createBackupText, RestoreError, restoreFromObject } from './restore';
import {
    loadOptionsData,
    resetDevelopGate,
    runBeforeRestoreHooks,
    setDevelopGate,
    updateOptions,
    useOptionsStore,
} from './store';
import { settingsTiming } from './timing';

/* ------------------------------------------------------------------------ */
/* Strings                                                                   */
/* ------------------------------------------------------------------------ */

/** Strings upstream does not have (settings.md §10 last paragraph). All listed in the reports. */
export const NEW_STRINGS = {
    loadFailed: () => tNew('settingsLoadFailed', 'The settings could not be loaded.'),
    loadFailedHint: () => tNew('settingsLoadFailedHint', 'Reload the page to try again.'),
    managedNote: () => tNew('settingsManagedNote', 'Some settings are managed by your administrator and are not shown here.'),
    permissionDenied: () =>
        tNew('settingsPermissionDenied', 'Permission to read and change all websites was not granted. The default filtering mode was not changed.'),
    modeChangeFailed: () => tNew('settingsModeChangeFailed', 'The default filtering mode could not be changed.'),
    modeAdjusted: (mode: string) => tNew('settingsModeAdjusted', 'The default filtering mode is now {{mode}}.', { mode }),
    toggleFailed: (name: string) => tNew('settingsToggleFailed', 'This setting could not be changed: {{name}}', { name }),
    backupFailed: () => tNew('settingsBackupFailed', 'The backup file could not be created.'),
    busy: () => tNew('settingsBusy', 'Restoring settings…'),
    resetBusy: () => tNew('settingsResetBusy', 'Restoring default settings…'),
    restoreDone: () => tNew('settingsRestoreDone', 'Settings restored.'),
    resetDone: () => tNew('settingsResetDone', 'Default settings restored.'),
    restoreInvalidFile: () =>
        tNew('settingsRestoreInvalidFile', 'This file does not contain settings that can be restored. Nothing was changed.'),
    restoreReadFailed: () => tNew('settingsRestoreReadFailed', 'The file could not be read. Nothing was changed.'),
    restoreFailed: () => tNew('settingsRestoreFailed', 'Settings could not be restored. Nothing was changed.'),
    restorePartial: () => tNew('settingsRestorePartial', 'Settings were only partly restored.'),
    restoreSkippedRulesets: (lists: string) =>
        tNew(
            'settingsRestoreSkippedRulesets',
            'These filter lists from the file are not available in this version and were not enabled: {{lists}}',
            { lists },
        ),
    restorePartialHint: () =>
        tNew('settingsRestorePartialHint', 'The restore stopped before it finished. Some settings were already changed; check them before you try again.'),
    cancel: () => tNew('cancelButton', 'Cancel'),
} as const;

const TOGGLE_KEYS: Record<ToggleKey, { label: string; legend?: string }> = {
    autoReload: { label: 'autoReloadLabel' },
    showBlockedCount: { label: 'showBlockedCountLabel' },
    strictBlockMode: { label: 'enableStrictBlockLabel', legend: 'enableStrictBlockLegend' },
    popupBlockMode: { label: 'enablePopupBlockLabel', legend: 'enablePopupBlockLegend' },
    developerMode: { label: 'developerModeLabel', legend: 'developerModeLegend' },
};

/** Button label wraps instead of overflowing (long locales, 2x strings). Same recipe as ConfirmDialog. */
const WRAPPING_BUTTON = 'h-auto min-h-(--button-size) max-w-full whitespace-normal py-1 text-start leading-snug';

/** Sends one toggle message; resolves the value the store should hold afterwards. */
function sendToggle(key: ToggleKey, state: boolean): Promise<boolean> {
    switch (key) {
        case 'autoReload':
            return setAutoReload({ state }).then(() => state);
        case 'showBlockedCount':
            return setShowBlockedCount({ state }).then(() => state);
        case 'strictBlockMode':
            return setStrictBlockMode({ state }).then(() => state);
        case 'popupBlockMode':
            return setPopupBlockMode({ state }).then(() => state);
        case 'developerMode':
            return setDeveloperMode({ state });
    }
}

function logFailure(what: string, err: unknown): void {
    console.error(`[settings] ${what} failed`, err);
}

/* ------------------------------------------------------------------------ */
/* Inline feedback                                                           */
/* ------------------------------------------------------------------------ */

type FeedbackArea = 'mode' | 'toggles' | 'backup';

interface Feedback {
    id: number;
    area: FeedbackArea;
    tone: AnnounceTone;
    message: string;
    description?: string;
}

// The library Alert sets role="alert" for danger; the StatusRegion already
// announces, so the visible copy must not announce a second time.
const NO_ROLE = { role: undefined } as unknown as Partial<AlertProps>;

/*
 * The library's soft Alert colours its text with the tone (dark danger 3.80:1,
 * dark warning 4.39:1, light success 4.34:1: below 4.5). The visible feedback
 * keeps the tinted surface and the coloured icon, but its text uses the
 * default text colour (>= 4.5:1 on every soft surface).
 */
const FEEDBACK_ALERT_CLASSES: Record<AnnounceTone, string> = {
    info: '[--alert-text-color:var(--color-text)] [&>div:first-child]:text-(--color-text-info-surface)',
    success: '[--alert-text-color:var(--color-text)] [&>div:first-child]:text-(--color-text-success-surface)',
    warning: '[--alert-text-color:var(--color-text)] [&>div:first-child]:text-(--color-text-warning-surface)',
    danger: '[--alert-text-color:var(--color-text)] [&>div:first-child]:text-(--color-text-danger-surface)',
};

function InlineFeedback({ feedback, area }: { feedback: Feedback | null; area: FeedbackArea }) {
    const ref = useRef<HTMLDivElement>(null);
    const shown = feedback !== null && feedback.area === area ? feedback : null;
    const id = shown?.id;
    useEffect(() => {
        if (id === undefined) return;
        // Bring the result into view next to the control that caused it.
        ref.current?.scrollIntoView?.({ block: 'nearest' });
    }, [id]);
    if (shown === null) return null;
    return (
        <div ref={ref} data-testid={`settings-feedback-${area}`} data-tone={shown.tone}>
            <Alert
                key={shown.id}
                {...NO_ROLE}
                color={shown.tone}
                variant="soft"
                title={shown.message}
                description={shown.description}
                className={FEEDBACK_ALERT_CLASSES[shown.tone]}
            />
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Pane                                                                      */
/* ------------------------------------------------------------------------ */

export function SettingsPane() {
    return (
        <StatusProvider>
            <SettingsPaneBody />
        </StatusProvider>
    );
}

function SettingsPaneBody() {
    const options = useOptionsStore();

    useEffect(() => {
        // Idempotent: one getOptionsPageData per page, whoever asks first.
        loadOptionsData().catch(() => {});
    }, []);

    let content: ReactNode;
    if (options.status === 'ready') {
        content = <SettingsContent data={options.data} />;
    } else if (options.status === 'error') {
        content = (
            <Alert
                color="danger"
                variant="soft"
                title={NEW_STRINGS.loadFailed()}
                description={NEW_STRINGS.loadFailedHint()}
                className={FEEDBACK_ALERT_CLASSES.danger}
                data-testid="settings-load-error"
            />
        );
    } else {
        content = <SettingsSkeleton />;
    }

    return (
        <div className="min-w-0" data-testid="settings-pane" data-state={options.status}>
            {/* Screen-reader live regions (always in the DOM); visible feedback is inline. */}
            <StatusRegion />
            {content}
        </div>
    );
}

function SettingsSkeleton() {
    return (
        <div className="flex flex-col gap-8" aria-hidden="true" data-testid="settings-skeleton">
            {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-3">
                    <Skeleton shape="text" className="h-5 w-48" />
                    <Skeleton shape="text" lines={2} />
                    <Skeleton shape="rect" className="h-28 w-full rounded-2xl" />
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Content                                                                   */
/* ------------------------------------------------------------------------ */

interface ModeRun {
    id: number;
    requested: CardLevel;
    /** Stored defaultFilteringMode when the run started. */
    base: unknown;
    /** True once answered or given up (watchdog). */
    settled: boolean;
    /** Resolves when settled. */
    done: Promise<void>;
    finish: () => void;
    timer: ReturnType<typeof setTimeout> | undefined;
    /** `feedbackSeq` of the watchdog's failure message, when the watchdog reported one. */
    watchdogFeedback?: number;
}

interface PendingToggle {
    seq: number;
    value: boolean;
    /** Stored raw value when the toggle was changed. */
    base: unknown;
}

function SettingsContent({ data }: { data: OptionsData }) {
    const announce = useAnnounce();
    const platform = useMemo(() => (isSafari() ? 'safari' : 'other'), []);
    const admin = adminFlags(data.disabledFeatures);
    const states = toggleStates(data, platform);

    const [busy, setBusy] = useState<false | 'restore' | 'reset'>(false);

    /* ---------------- feedback ---------------- */

    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const feedbackSeq = useRef(0);
    const report = useCallback(
        (area: FeedbackArea, message: string, options: AnnounceOptions & { tone: AnnounceTone }) => {
            announce(message, options);
            feedbackSeq.current += 1;
            setFeedback({ id: feedbackSeq.current, area, tone: options.tone, message, description: options.description });
        },
        [announce],
    );
    const clearFeedback = () => setFeedback(null);

    /* ---------------- timers (watchdogs) ---------------- */

    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const later = useCallback((fn: () => void, ms: number) => {
        const timer = setTimeout(() => {
            timers.current.delete(timer);
            fn();
        }, ms);
        timers.current.add(timer);
        return timer;
    }, []);
    const cancel = (timer: ReturnType<typeof setTimeout> | undefined) => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timers.current.delete(timer);
    };
    useEffect(() => {
        const set = timers.current;
        return () => {
            for (const timer of set) clearTimeout(timer);
            set.clear();
        };
    }, []);

    /* ---------------- default filtering mode (§3) ---------------- */

    const [pendingMode, setPendingMode] = useState<{ id: number; requested: CardLevel; base: unknown } | null>(null);
    const modeRun = useRef<ModeRun | null>(null);
    const modeSeq = useRef(0);
    const modeHeadingId = `${useId()}-mode-heading`;
    const storedLevel = selectedLevel(data.defaultFilteringMode);
    // A store change of the mode while a change is pending (broadcast, restore)
    // is the background's truth and wins over the pending choice (checklist 13).
    const pendingShown = pendingMode !== null && Object.is(data.defaultFilteringMode, pendingMode.base) ? pendingMode : null;
    const shownLevel = pendingShown?.requested ?? storedLevel ?? 0;

    const startModeRun = (requested: CardLevel): ModeRun => {
        modeSeq.current += 1;
        const id = modeSeq.current;
        let resolveDone: () => void = () => {};
        const done = new Promise<void>((resolve) => {
            resolveDone = resolve;
        });
        const run: ModeRun = {
            id,
            requested,
            base: data.defaultFilteringMode,
            settled: false,
            done,
            finish: () => {
                if (run.settled) return;
                run.settled = true;
                cancel(run.timer);
                resolveDone();
            },
            timer: undefined,
        };
        run.timer = later(() => {
            if (run.settled) return;
            run.finish();
            setPendingMode((p) => (p?.id === id ? null : p));
            if (modeRun.current === run) {
                modeRun.current = null;
                logFailure('default filtering mode change (no answer)', new Error(`no answer within ${settingsTiming.watchdogMs} ms`));
                report('mode', NEW_STRINGS.modeChangeFailed(), { tone: 'danger' });
                run.watchdogFeedback = feedbackSeq.current;
            }
        }, settingsTiming.watchdogMs);
        modeRun.current = run;
        setPendingMode({ id, requested, base: run.base });
        return run;
    };

    const finishModeRun = (run: ModeRun, outcome: { level: number } | { denied: true } | { error: unknown }) => {
        const answeredInTime = !run.settled;
        run.finish();
        setPendingMode((p) => (p?.id === run.id ? null : p));
        const current = modeRun.current === run;
        if (current) modeRun.current = null;
        if ('level' in outcome) {
            // The answer is the background's truth, even when late (§3.4, checklist 13).
            const defaultFilteringMode = outcome.level as OptionsData['defaultFilteringMode'];
            updateOptions(run.requested === 1 ? { defaultFilteringMode } : { defaultFilteringMode, hasOmnipotence: true });
        }
        if (!answeredInTime) {
            // A level that arrives after the watchdog gave up (e.g. a permission prompt left open
            // longer than the watchdog, then granted): the store already moved; replace the
            // now-misleading "could not be changed" with the level in force, but only while that
            // failure is still the latest message and no newer change is running.
            if ('level' in outcome && modeRun.current === null && run.watchdogFeedback === feedbackSeq.current) {
                report('mode', NEW_STRINGS.modeAdjusted(t(`filteringMode${outcome.level}Name`)), { tone: 'info' });
            }
            return;
        }
        if (!current) return;
        if ('level' in outcome) {
            if (outcome.level !== run.requested) {
                report('mode', NEW_STRINGS.modeAdjusted(t(`filteringMode${outcome.level}Name`)), { tone: 'info' });
            }
        } else if ('denied' in outcome) {
            report('mode', NEW_STRINGS.permissionDenied(), { tone: 'warning' });
        } else {
            logFailure('default filtering mode change', outcome.error);
            report('mode', NEW_STRINGS.modeChangeFailed(), { tone: 'danger' });
        }
    };

    /**
     * Called synchronously from the radio's change event (pointer or keyboard).
     * For levels 2 and 3 the permission request is the first call made, before
     * any state update or await (§3.3, UI rule §6.6).
     */
    const onModeChange = (requested: CardLevel) => {
        if (pendingShown !== null) return; // one change at a time while it is shown as pending (H15)
        if (requested === 1) {
            const run = startModeRun(1);
            clearFeedback();
            setDefaultFilteringMode({ level: 1 }).then(
                (level) => finishModeRun(run, { level }),
                (error: unknown) => finishModeRun(run, { error }),
            );
            return;
        }
        const permission = requestOrigins(['<all_urls>']);
        const run = startModeRun(requested);
        clearFeedback();
        permission
            .then(async (granted) => {
                if (!granted) {
                    finishModeRun(run, { denied: true });
                    return;
                }
                const level = await setDefaultFilteringMode({ level: requested });
                finishModeRun(run, { level });
            })
            .catch((error: unknown) => finishModeRun(run, { error }));
    };

    // Once the store has changed the mode, the pending choice is dropped for
    // good (a later broadcast back to the old value must not revive it).
    useEffect(() => {
        if (pendingMode !== null && !Object.is(data.defaultFilteringMode, pendingMode.base)) {
            setPendingMode((p) => (p?.id === pendingMode.id ? null : p));
        }
    }, [data.defaultFilteringMode, pendingMode]);

    /* ---------------- toggles (§4) ---------------- */

    const [pendingToggles, setPendingToggles] = useState<Partial<Record<ToggleKey, PendingToggle>>>({});
    const toggleSeq = useRef<Partial<Record<ToggleKey, number>>>({});

    // Same for toggles: a store change of the field ends the pending display.
    useEffect(() => {
        const stale = (Object.keys(pendingToggles) as ToggleKey[]).filter((key) => !Object.is(data[key], pendingToggles[key]!.base));
        if (stale.length === 0) return;
        setPendingToggles((p) => {
            const next = { ...p };
            for (const key of stale) {
                if (next[key] !== undefined && !Object.is(data[key], next[key]!.base)) delete next[key];
            }
            return next;
        });
    }, [data, pendingToggles]);

    const onToggle = (key: ToggleKey, value: boolean) => {
        const seq = (toggleSeq.current[key] ?? 0) + 1;
        toggleSeq.current[key] = seq;
        // The message is sent synchronously inside the event (§4 common rules).
        const sent = sendToggle(key, value);
        setPendingToggles((p) => ({ ...p, [key]: { seq, value, base: data[key] } }));
        if (key === 'developerMode') setDevelopGate(value); // Develop tab flips immediately (§4.5).
        clearFeedback();
        let settled = false;
        /** Drops the pending value if this change is still the latest; returns whether it was. */
        const settle = () => {
            if (toggleSeq.current[key] !== seq) return false; // superseded by a newer change
            setPendingToggles((p) => {
                if (p[key]?.seq !== seq) return p;
                const next = { ...p };
                delete next[key];
                return next;
            });
            return true;
        };
        const fail = (error: unknown) => {
            logFailure(`toggle ${key}`, error);
            if (settle() && key === 'developerMode') resetDevelopGate();
            report('toggles', NEW_STRINGS.toggleFailed(t(TOGGLE_KEYS[key].label)), { tone: 'danger' });
        };
        const timer = later(() => {
            if (settled) return;
            settled = true;
            fail(new Error(`no answer within ${settingsTiming.watchdogMs} ms`));
        }, settingsTiming.watchdogMs);
        sent.then(
            (stored) => {
                const inTime = !settled;
                settled = true;
                cancel(timer);
                if (inTime) {
                    if (settle()) updateOptions({ [key]: stored } as Partial<OptionsData>);
                } else if (toggleSeq.current[key] === seq) {
                    // Late answer after the watchdog: still the background's truth.
                    updateOptions({ [key]: stored } as Partial<OptionsData>);
                }
            },
            (error: unknown) => {
                if (settled) return;
                settled = true;
                cancel(timer);
                fail(error);
            },
        );
    };

    /* ---------------- backup / restore / reset (§6-§9) ---------------- */

    const fileRef = useRef<HTMLInputElement>(null);
    const restoreButtonRef = useRef<HTMLButtonElement>(null);
    const resetButtonRef = useRef<HTMLButtonElement>(null);
    const busyPillRef = useRef<HTMLDivElement>(null);
    const focusAfterBusy = useRef<HTMLElement | null>(null);
    const [resetOpen, setResetOpen] = useState(false);

    // Busy: the pane is inert, so focus goes to the status pill; afterwards it
    // returns to the button that started the operation (no focus lost to body).
    // Deferred by one task: the reset dialog's focus scope releases focus (and
    // tries to give it back to its now-inert trigger) from a timer of its own,
    // scheduled while it unmounts, i.e. before this passive effect.
    useEffect(() => {
        const timer = setTimeout(() => {
            if (busy !== false) {
                busyPillRef.current?.focus({ preventScroll: true });
                return;
            }
            const target = focusAfterBusy.current;
            focusAfterBusy.current = null;
            if (target !== null && target.isConnected) target.focus({ preventScroll: true });
        }, 0);
        return () => clearTimeout(timer);
    }, [busy]);

    const onBackup = () => {
        clearFeedback();
        createBackupText(data).then(
            (text) => {
                // Detached anchor, never inserted in the document (settings.js:141-145).
                const a = document.createElement('a');
                a.href = backupDataURL(text);
                a.setAttribute('download', BACKUP_FILE_NAME);
                a.setAttribute('type', 'application/json');
                a.click();
            },
            (error: unknown) => {
                logFailure('backup', error);
                report('backup', NEW_STRINGS.backupFailed(), { tone: 'danger' });
            },
        );
    };

    const runRestore = async (target: object, kind: 'restore' | 'reset') => {
        announce(kind === 'reset' ? NEW_STRINGS.resetBusy() : NEW_STRINGS.busy(), { tone: 'info' });
        // A mode change still waiting for its permission prompt or answer lands
        // first, so it cannot overwrite the restored mode afterwards. Bounded by
        // the mode watchdog.
        const run = modeRun.current;
        if (run !== null && !run.settled) await run.done;
        try {
            await runBeforeRestoreHooks();
        } catch (error) {
            logFailure('before-restore hook', error);
            report('backup', NEW_STRINGS.restoreFailed(), { tone: 'danger' });
            return;
        }
        try {
            // Ids this build does not ship are left out of applyRulesets (restore.ts header).
            const knownRulesetIds = data.rulesetDetails.map((details) => details.id);
            const { skippedRulesets } = await restoreFromObject(target, { onApplied: updateOptions, knownRulesetIds });
            const done = kind === 'reset' ? NEW_STRINGS.resetDone() : NEW_STRINGS.restoreDone();
            if (skippedRulesets.length > 0) {
                const lists = skippedRulesets.map((id) => (id === '' ? '""' : id)).join(', ');
                report('backup', done, { tone: 'warning', description: NEW_STRINGS.restoreSkippedRulesets(lists) });
            } else {
                report('backup', done, { tone: 'success' });
            }
        } catch (error) {
            logFailure(kind, error);
            if (error instanceof RestoreError && error.applied) {
                report('backup', NEW_STRINGS.restorePartial(), { tone: 'danger', description: NEW_STRINGS.restorePartialHint() });
            } else {
                report('backup', NEW_STRINGS.restoreFailed(), { tone: 'danger' });
            }
        }
    };

    /** Restore button: opens the file picker synchronously inside the click (§7.1). */
    const onRestoreClick = () => {
        const input = fileRef.current;
        if (input === null) return;
        input.value = ''; // picking the same file again still fires `change`
        input.click();
    };

    const onFileChosen = (ev: ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        clearFeedback();
        focusAfterBusy.current = restoreButtonRef.current;
        setBusy('restore'); // busy is entered when a file is chosen (settings.js:152)
        const work = async () => {
            if (file === undefined || file.name === '') return;
            let text: string;
            try {
                text = await file.text();
            } catch (error) {
                logFailure('reading the restore file', error);
                report('backup', NEW_STRINGS.restoreReadFailed(), { tone: 'danger' });
                return;
            }
            const parsed = parseRestoreFile(text);
            if (parsed === INVALID_FILE) {
                report('backup', NEW_STRINGS.restoreInvalidFile(), { tone: 'warning' });
                return;
            }
            await runRestore(parsed, 'restore');
        };
        work().finally(() => setBusy(false));
    };

    const onResetConfirm = () => {
        clearFeedback();
        focusAfterBusy.current = resetButtonRef.current;
        setBusy('reset');
        runRestore({}, 'reset').finally(() => setBusy(false));
    };

    /* ---------------- render ---------------- */

    if (admin.hidePane) {
        // `dashboard` token: the pane is unreachable; the shell shows About (§2.4).
        return null;
    }

    const modeNames: Record<CardLevel, string> = {
        1: t('filteringMode1Name'),
        2: t('filteringMode2Name'),
        3: t('filteringMode3Name'),
    };
    const modeDescriptions: Record<CardLevel, ReactNode> = {
        1: <T k="basicFilteringModeDescription" />,
        2: <T k="optimalFilteringModeDescription" />,
        3: <T k="completeFilteringModeDescription" />,
    };
    const managed = admin.hideModeBlock || admin.hideDeveloperRow;
    const resetLabel = withoutEllipsis(t('resetToDefaultButton'));

    return (
        <div className="relative min-w-0" aria-busy={busy !== false || undefined} data-busy={busy !== false ? '' : undefined}>
            <div className="flex min-w-0 flex-col gap-8" inert={busy !== false}>
                {managed ? (
                    <Alert color="info" variant="soft" description={NEW_STRINGS.managedNote()} data-testid="settings-managed-note" />
                ) : null}

                {admin.hideModeBlock ? null : (
                    <Section
                        level={2}
                        headingId={modeHeadingId}
                        title={t('defaultFilteringModeSectionLabel')}
                        description={<T k="defaultFilteringModeDescription" />}
                        data-testid="settings-mode"
                    >
                        <ModeCards
                            value={shownLevel}
                            pendingLevel={pendingShown?.requested ?? null}
                            names={modeNames}
                            descriptions={modeDescriptions}
                            labelledBy={modeHeadingId}
                            onChange={onModeChange}
                        />
                        <InlineFeedback feedback={feedback} area="mode" />
                    </Section>
                )}

                <Section level={2} title={t('behaviorSectionLabel')} data-testid="settings-behavior">
                    <Card variant="outline" padding="none">
                        {TOGGLE_ORDER.map((key) => {
                            const state = states[key];
                            if (!state.shown) return null;
                            const strings = TOGGLE_KEYS[key];
                            const pending = pendingToggles[key];
                            // A store change of this field meanwhile (echo, broadcast) wins over the pending value.
                            const checked = pending !== undefined && Object.is(data[key], pending.base) ? pending.value : state.checked;
                            return (
                                <SettingRow
                                    key={key}
                                    inset
                                    className="border-t border-subtle first:border-t-0"
                                    data-setting={key}
                                    label={t(strings.label)}
                                    description={strings.legend !== undefined ? <T k={strings.legend} /> : undefined}
                                    disabled={!state.enabled}
                                    control={({ id, describedBy }) => (
                                        <Switch
                                            id={id}
                                            checked={checked}
                                            disabled={!state.enabled}
                                            onCheckedChange={(next) => onToggle(key, next)}
                                            {...{ 'aria-describedby': describedBy, 'data-testid': `settings-toggle-${key}` }}
                                        />
                                    )}
                                />
                            );
                        })}
                    </Card>
                    <InlineFeedback feedback={feedback} area="toggles" />
                </Section>

                <Section
                    level={2}
                    title={t('settingsBackupRestoreLabel')}
                    description={<T k="settingsBackupRestoreSummary" />}
                    data-testid="settings-backup"
                >
                    <Card variant="outline" padding="md">
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                            <Button
                                color="secondary"
                                variant="soft"
                                onClick={onBackup}
                                className={WRAPPING_BUTTON}
                                data-testid="settings-backup-button"
                            >
                                {t('backupButton')}
                            </Button>
                            <Button
                                ref={restoreButtonRef}
                                color="secondary"
                                variant="soft"
                                onClick={onRestoreClick}
                                className={WRAPPING_BUTTON}
                                data-testid="settings-restore-button"
                            >
                                {t('restoreButton')}
                            </Button>
                            <input
                                ref={fileRef}
                                type="file"
                                accept="application/json"
                                hidden
                                tabIndex={-1}
                                onChange={onFileChosen}
                                data-testid="settings-restore-input"
                            />
                            <div className="flex min-w-0 max-w-full ms-auto">
                                <ConfirmDialog
                                    open={resetOpen}
                                    onOpenChange={setResetOpen}
                                    trigger={
                                        <Button
                                            ref={resetButtonRef}
                                            color="secondary"
                                            variant="outline"
                                            className={WRAPPING_BUTTON}
                                            data-testid="settings-reset-button"
                                        >
                                            {t('resetToDefaultButton')}
                                        </Button>
                                    }
                                    title={resetLabel}
                                    description={t('resetToDefaultConfirm')}
                                    confirmLabel={resetLabel}
                                    cancelLabel={NEW_STRINGS.cancel()}
                                    danger
                                    onConfirm={onResetConfirm}
                                />
                            </div>
                        </div>
                    </Card>
                    <InlineFeedback feedback={feedback} area="backup" />
                </Section>
            </div>

            {busy !== false ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center" data-testid="settings-busy">
                    <div className="absolute inset-0 bg-surface opacity-80" aria-hidden="true" />
                    {/* Sticky at the middle of the scrollport, clamped to the pane. */}
                    <div className="sticky top-1/2 my-6 -translate-y-1/2 px-4">
                        <div
                            ref={busyPillRef}
                            tabIndex={-1}
                            className="flex items-center gap-3 rounded-full border border-subtle bg-surface-elevated px-4 py-2 text-sm text-default shadow-md focus:outline-none"
                            data-testid="settings-busy-status"
                        >
                            <LoadingIndicator size={18} aria-hidden="true" />
                            <span>{busy === 'reset' ? NEW_STRINGS.resetBusy() : NEW_STRINGS.busy()}</span>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

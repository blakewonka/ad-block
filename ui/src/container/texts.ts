/**
 * Texts of the container-app window, verbatim from the Xcode template the
 * converter generates (docs/specs/container.md §6.3; ’ = U+2019, … = U+2026).
 *
 * The page is not an extension page: there is no browser.i18n, no _locales,
 * so UI rule §6.7 (t()/tNew) cannot apply here (spec §6.4). English only.
 */
import type { ContainerState } from './native';

export const PRODUCT_NAME = 'Blocker';
/** Written by the converter next to Script.js (Resources/Icon.png = PRISTINE/img/icon_512.png). */
export const ICON_SRC = '../Icon.png';
export const ICON_ALT = 'Blocker Icon';
export const ICON_SIZE = 128;

export type StatusKind = 'unknown' | 'on' | 'off';
export type Wording = 'preferences' | 'settings';

export const TEXTS: Readonly<Record<Wording, Readonly<Record<StatusKind | 'button', string>>>> = Object.freeze({
    // Initial wording (Main.html:13-17 of the template).
    preferences: Object.freeze({
        unknown: 'You can turn on Blocker’s extension in Safari Extensions preferences.',
        on: 'Blocker’s extension is currently on. You can turn it off in Safari Extensions preferences.',
        off: 'Blocker’s extension is currently off. You can turn it on in Safari Extensions preferences.',
        button: 'Quit and Open Safari Extensions Preferences…',
    }),
    // macOS 13+ wording, selected by show(_, true) (Script.js:2-7 of the template).
    settings: Object.freeze({
        unknown: 'You can turn on Blocker’s extension in the Extensions section of Safari Settings.',
        on: 'Blocker’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.',
        off: 'Blocker’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.',
        button: 'Quit and Open Safari Settings…',
    }),
});

export function statusKind(enabled: boolean | undefined): StatusKind {
    if (enabled === true) return 'on';
    if (enabled === false) return 'off';
    return 'unknown';
}

export type ViewModel = Readonly<{ kind: StatusKind; status: string; button: string }>;

/** What the page shows for a store state. */
export function viewModel(state: ContainerState): ViewModel {
    const kind = statusKind(state.enabled);
    const texts = TEXTS[state.useSettings ? 'settings' : 'preferences'];
    return { kind, status: texts[kind], button: texts.button };
}

/**
 * Layout classes shared by the React page (App.tsx) and the plain-DOM fallback
 * (fallback.ts), so both look the same. Complete static strings: Tailwind only
 * generates classes it finds verbatim under src/.
 *
 * Rhythm: icon, then the title + status sentence as one tight group, then more
 * room before the only action. The sentence uses the secondary text colour
 * (>= 4.5:1 on the surface in both themes) and `text-balance`, so its two lines
 * come out about the same length. No max-width: px-8 already sets the measure.
 */
export const LAYOUT = Object.freeze({
    main: 'flex min-h-screen flex-col items-center justify-center gap-3 px-8 py-5 text-center text-default',
    icon: 'size-32 shrink-0',
    group: 'flex max-w-full flex-col items-center gap-1.5',
    heading: 'heading-md text-default',
    status: 'max-w-full',
    sentence: 'text-sm text-balance text-secondary',
    /**
     * Extra classes on the library Button (its CSS lives in @layer components,
     * these utilities win). The library Button is `white-space: nowrap` with a
     * fixed height; a label longer than the window would overflow both edges.
     * These let it wrap inside the window and grow in height instead, while a
     * one-line label keeps the library size (min-height = --button-size).
     */
    button: 'mt-2 h-auto min-h-(--button-size) max-w-full whitespace-normal py-2 text-balance leading-snug',
    /**
     * The fallback's own <button> (no library CSS module): same size and colours
     * as the library primary solid lg Button, token hover/pressed fills and the
     * library focus ring colour (--color-ring) instead of the UA focus colour.
     */
    fallbackButton:
        'mt-2 inline-flex min-h-9 max-w-full items-center justify-center rounded-full bg-primary-solid px-4 py-2 text-sm leading-snug font-medium text-balance whitespace-normal text-primary-solid hover:bg-primary-solid-hover active:bg-primary-solid-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
});

/*
 * Legacy token mapping (docs/specs/legacy-tokens.md section 4.2).
 * Consumed by src/styles/legacy/generate.mjs.
 *
 * One entry per non-palette legacy variable, in the order of spec section 4.2.
 * (The 113 raw palette names are copied verbatim from upstream default.css by
 * the generator; they are listed in PALETTE_NAMES below.)
 *
 * Entry forms:
 *   KEPT                       value(s) copied from upstream default.css:
 *                              light = `:root` (or `:root:not(.dark):not(.colorBlind)`),
 *                              dark  = `:root.dark` (or `:root.dark:not(.colorBlind)`),
 *                              emitted as a dark override only when it differs from light.
 *   lib(token, opts)           literal resolved from the installed library CSS.
 *     opts.dark    true  -> also emit a dark override (resolved in the dark theme)
 *                  false -> light only (the spec's "-" column)
 *     opts.lightToken / opts.darkToken  use another token for one theme
 *     opts.format  'color' (default: hex, or rgb(R G B / p%) for translucent),
 *                  'triplet' (R G B, opaque colours only),
 *                  'raw' (whitespace-normalised substitution result),
 *                  { alpha: N } (rgb(R G B / N%) of an opaque colour)
 *
 * If the library changes a value, the generated file follows it, and the C13
 * check (scripts/check-legacy-css.mjs, compares with spec section 4.2) fails
 * until the spec is updated too. That is intentional.
 */

export const KEPT = Object.freeze({ kind: 'kept' });

function lib(token, opts = {}) {
    return Object.freeze({
        kind: 'lib',
        lightToken: opts.lightToken ?? token,
        darkToken: opts.darkToken ?? token,
        dark: opts.dark ?? true,
        format: opts.format ?? 'color',
    });
}

const TRIPLET = { format: 'triplet' };
const LIGHT_ONLY = { dark: false };

/** @type {Array<[string, object]>} */
export const MAPPING = [
    ['--font-size', KEPT],
    ['--font-size-smaller', KEPT],
    ['--font-size-xsmall', KEPT],
    ['--font-size-larger', KEPT],
    ['--font-family', lib('--font-sans', { dark: false, format: 'raw' })],
    ['--monospace-size', KEPT],
    ['--surface-0-rgb', lib('--gray-0', TRIPLET)],
    ['--surface-1', lib('--color-surface')],
    ['--surface-2', lib('--color-background-primary-soft')],
    ['--surface-3', lib('--color-background-primary-soft-active')],
    ['--ubo-red', KEPT],
    ['--elevation-up-surface', lib('--alpha-base')],
    ['--elevation-up1-opacity', KEPT],
    ['--elevation-up2-opacity', KEPT],
    ['--elevation-down-surface', lib('--color-text-inverse')],
    ['--elevation-down1-opacity', KEPT],
    ['--elevation-down2-opacity', KEPT],
    ['--ink-rgb', lib('--color-text', TRIPLET)],
    ['--ink-0', lib('--color-text')],
    ['--ink-100', lib('--color-text-inverse')],
    ['--border-1', lib('--color-border')],
    ['--border-2', lib('--color-border-strong')],
    ['--border-3', lib('--color-border-primary-outline')],
    ['--border-4', lib('--color-border-primary-outline-hover')],
    ['--accent-ink-3', KEPT],
    // = --blocker-accent (src/styles/blocker-tokens.css): blue-500 light, blue-300 dark.
    ['--accent-surface-1', lib('--blue-300', { lightToken: '--blue-500' })],
    ['--link-ink', lib('--link-primary-text-color')],
    // Dark: contrast fix (spec 4.3), --link-primary-text-color-hover is 4.45:1 on #212121.
    ['--link-hover-ink', lib('--color-text-info', { lightToken: '--link-primary-text-color-hover' })],
    ['--button-surface-rgb', lib('--color-background-secondary-soft', TRIPLET)],
    ['--dashboard-tab-active-ink-rgb', lib('--color-text', TRIPLET)],
    ['--dashboard-tab-focus-surface-rgb', lib('--color-background-primary-soft', TRIPLET)],
    ['--dashboard-highlight-surface-rgb', lib('--color-background-primary-soft', TRIPLET)],
    ['--dashboard-happy-green', lib('--color-text-success')],
    ['--popup-cell-cname-ink', KEPT],
    ['--popup-cell-label-mixed-surface', KEPT],
    ['--popup-icon-x-ink', KEPT],
    ['--popup-power-ink-rgb', lib('--color-text', TRIPLET)],
    ['--hr-ink', KEPT],
    ['--cloud-total-used-surface', lib('--purple-a75', LIGHT_ONLY)],
    ['--cloud-used-surface', lib('--color-background-discovery-solid', LIGHT_ONLY)],
    ['--error-surface', lib('--color-background-danger-solid', LIGHT_ONLY)],
    // Light: contrast fix (spec 4.3), the 4% tint takes develop.css's hard-coded
    // syntax colours and --sf-value-ink below 4.5:1; 2% keeps them >= 4.52.
    ['--cm-active-line', lib('--color-background-primary-outline-active', { lightToken: '--color-background-primary-outline-hover' })],
    ['--cm-cursor', lib('--color-text')],
    ['--cm-foldmarker-ink', lib('--color-text-info')],
    ['--cm-gutter-border', lib('--color-border-subtle')],
    ['--cm-gutter-ink', lib('--color-text-secondary')],
    ['--cm-gutter-surface', lib('--color-surface-secondary')],
    ['--cm-matchingbracket', lib('--color-background-success-soft-alpha-hover', LIGHT_ONLY)],
    ['--cm-merge-copy-ink', lib('--color-text-info')],
    ['--cm-merge-chunk-border', KEPT],
    ['--cm-merge-chunk-surface', KEPT],
    ['--cm-negative', lib('--color-text-danger-soft')],
    ['--cm-positive', lib('--color-text-success')],
    ['--cm-selection-surface', lib('--color-background-primary-soft-alpha-active')],
    ['--cm-selection-focused-surface', lib('--color-background-info-soft-alpha-hover', LIGHT_ONLY)],
    ['--cm-searching-ink', lib('--color-text')],
    ['--cm-searching-surface', lib('--yellow-a200', LIGHT_ONLY)],
    ['--cm-search-match-surface', lib('--color-background-caution-soft-alpha-hover', LIGHT_ONLY)],
    ['--sf-comment-ink', lib('--color-text-secondary')],
    // Light: contrast fix (spec 4.3), --codeblock-syntax-1 is 4.08:1 on #ffffff.
    ['--sf-def-ink', lib('--codeblock-syntax-1', { lightToken: '--orange-600' })],
    ['--sf-directive-ink', lib('--color-text')],
    ['--sf-error-ink', lib('--color-text-danger-soft')],
    ['--sf-error-surface', lib('--color-background-danger-soft-alpha', LIGHT_ONLY)],
    ['--sf-keyword-ink', lib('--codeblock-syntax-2')],
    ['--sf-notice-ink', lib('--color-text-tertiary', LIGHT_ONLY)],
    ['--sf-readonly-ink', lib('--color-text-secondary')],
    // Light: contrast fix (spec 4.3), --codeblock-syntax-4 is 3.74:1 on #ffffff.
    ['--sf-tag-ink', lib('--codeblock-syntax-4', { lightToken: '--pink-600' })],
    ['--sf-unicode-ink', lib('--color-text')],
    ['--sf-value-ink', lib('--codeblock-syntax-3')],
    ['--sf-variable-ink', lib('--color-text')],
    ['--sf-warning-ink', lib('--color-text-caution')],
    ['--sf-warning-surface', lib('--color-background-caution-soft-alpha', LIGHT_ONLY)],
    ['--df-allow-ink', KEPT],
    ['--df-block-ink', KEPT],
    ['--df-noop-ink', lib('--color-text-secondary')],
    ['--logger-modified-surface', KEPT],
    ['--logger-modified-em-surface', KEPT],
    ['--logger-redirected-surface', KEPT],
    ['--logger-scriptlet-surface', KEPT],
    ['--high-em', KEPT],
    ['--medium-em', KEPT],
    ['--low-em', KEPT],
    // Light: the field/hover surface must differ from the white page (spec 4.3).
    // The Develop editor keeps --gray-0 through --surface-0-rgb (B7).
    ['--surface-0', lib('--gray-0', { lightToken: '--color-surface-secondary' })],
    ['--ink-1', lib('--color-text')],
    // No library token for 87% text: --color-text at upstream's --high-em alpha.
    ['--ink-2', lib('--color-text', { format: { alpha: 87 } })],
    ['--ink-3', lib('--color-text-secondary')],
    ['--ink-4', lib('--color-text-tertiary', LIGHT_ONLY)],
    // Ink on the accent = --blocker-accent-on-solid; no longer var(--surface-0) (spec 4.3).
    ['--accent-ink-1', lib('--color-text-inverse')],
    ['--subtil-ink', KEPT],
    ['--fieldset-header-surface', KEPT],
    ['--fieldset-header-ink', KEPT],
    ['--native-control-opacity', KEPT],
    ['--button-ink', lib('--color-text')],
    ['--button-surface', lib('--color-background-secondary-soft')],
    ['--button-border-size', KEPT],
    ['--button-border-radius', lib('--radius-full', { dark: false, format: 'raw' })],
    ['--button-preferred-ink', lib('--color-text-primary-solid')],
    ['--button-preferred-surface', lib('--color-background-primary-solid')],
    ['--button-disabled-surface', KEPT],
    ['--button-disabled-filter', KEPT],
    ['--checkbox-size', KEPT],
    ['--checkbox-ink', lib('--color-text-secondary')],
    ['--checkbox-checked-ink', KEPT],
    ['--checkbox-disabled-filter', KEPT],
    ['--checkbox-margin-end', KEPT],
    ['--notice-ink', KEPT],
    ['--notice-surface', KEPT],
    ['--notice-surface-shadow', lib('--shadow-300', { format: 'raw' })],
    ['--dashboard-tab-ink', lib('--color-text-secondary')],
    ['--dashboard-tab-active-ink', KEPT],
    ['--dashboard-tab-active-surface', KEPT],
    ['--dashboard-tab-focus-surface', KEPT],
    ['--dashboard-tab-hover-surface', KEPT],
    ['--dashboard-tab-hover-border', KEPT],
    ['--info0-ink-rgb', lib('--color-text-secondary', TRIPLET)],
    ['--info1-ink-rgb', lib('--color-text-info', TRIPLET)],
    ['--info2-ink-rgb', lib('--color-text-warning-soft', TRIPLET)],
    ['--info3-ink-rgb', lib('--color-text-danger-soft', { ...TRIPLET, darkToken: '--red-200' })],
    ['--info0-ink', lib('--color-text-secondary')],
    ['--info1-ink', lib('--color-text-info')],
    ['--info2-ink', lib('--color-text-warning-soft')],
    // Dark: contrast fix (spec 4.3), #fa423e is 3.41:1 on the Develop summary band.
    ['--info3-ink', lib('--color-text-danger-soft', { darkToken: '--red-200' })],
    ['--popup-cell-surface', KEPT],
    ['--popup-cell-label-filter', KEPT],
    ['--popup-cell-allow-own-surface', KEPT],
    ['--popup-cell-allow-surface', KEPT],
    ['--popup-cell-noop-own-surface', KEPT],
    ['--popup-cell-noop-surface', KEPT],
    ['--popup-cell-block-own-surface', KEPT],
    ['--popup-cell-block-surface', KEPT],
    ['--popup-power-ink', KEPT],
    ['--popup-toolbar-surface', lib('--color-background-primary-soft-alpha')],
    ['--popup-toolbar-surface-hover', lib('--color-background-primary-soft-alpha-hover')],
    ['--popup-ruleset-tool-ink', KEPT],
    ['--popup-ruleset-tool-surface', lib('--color-background-primary-soft-alpha')],
    ['--popup-ruleset-tool-surface-hover', lib('--color-background-primary-soft-alpha-hover')],
    ['--popup-ruleset-tool-shadow', KEPT],
    ['--popup-cell-allow-own-surface-rgb', KEPT],
    ['--popup-cell-allow-surface-rgb', KEPT],
    ['--popup-cell-block-own-surface-rgb', KEPT],
    ['--popup-cell-block-surface-rgb', KEPT],
    ['--popup-cell-noop-own-surface-rgb', KEPT],
    ['--popup-cell-noop-surface-rgb', KEPT],
];

/** The 113 raw palette names (spec 4.2), emitted verbatim from upstream. */
export const PALETTE_NAMES = [
    ...['5', '10', '20', '30', '40', '50', '60', '70', '80', '90'].map(n => `--blue-${n}`),
    ...['10', '20', '30', '40', '50', '60', '70', '80', '90'].map(n => `--dark-gray-${n}`),
    ...['30', '40', '50', '60', '65', '70', '80'].map(n => `--green-${n}`),
    '--ink-10', '--ink-80',
    ...['10', '20', '30', '40', '50', '60', '70', '80', '90'].map(n => `--light-gray-${n}`),
    ...['5', '10', '20', '30', '40', '50', '60', '70', '80', '90'].map(n => `--orange-${n}`),
    ...['5', '10', '20', '30', '40', '50', '60', '70', '80', '90'].map(n => `--purple-${n}`),
    ...['20', '30', '40', '50', '60', '70'].map(n => `--red-${n}`),
    ...['5', '10', '20', '30', '40', '50', '60', '70', '80', '90'].map(n => `--violet-${n}`),
    ...['5', '10', '20', '30', '40', '50', '60', '70', '80', '90'].map(n => `--yellow-${n}`),
    ...['5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80', '85', '90', '95'].map(n => `--gray-${n}`),
    ...['5', '10', '20', '30', '40', '50', '60', '70', '80', '90', '95'].map(n => `--primary-${n}`),
];

/** Legacy names that collide with library primitives (spec section 3). */
export const COLLIDING_NAMES = [
    '--blue-50', '--green-50', '--orange-50', '--purple-50', '--red-50',
    '--yellow-50', '--gray-25', '--gray-50', '--gray-75',
];

/** `*-rgb` names defined upstream by reference to a triplet (spec C5). */
export const TRIPLET_BY_REFERENCE = [
    '--ink-rgb', '--button-surface-rgb', '--dashboard-tab-active-ink-rgb',
    '--dashboard-tab-focus-surface-rgb', '--dashboard-highlight-surface-rgb',
];

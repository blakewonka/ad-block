# Spec: legacy tokens (re-colouring the vanilla pages through `css/default.css`)

Written 2026-10-04 against the upstream tree in `upstream` and the built
extension in `build/pristine/safari` (PRISTINE). Library: `@openai/apps-sdk-ui`
0.2.2 as installed in `ui/node_modules/@openai/apps-sdk-ui/dist/es/styles/`.
Audited the same day by an independent pass (Appendix B).

This spec is the source of truth for `npm run build:legacy-css`
(`ui/scripts/build-legacy-css.mjs` -> `ui/dist/legacy/default.css`, copied
by `scripts/stage.mjs` over `STAGE/css/default.css`). Implementers follow this
file instead of reading upstream code. It describes behaviour and data, not
visual design.

Citation conventions:

- `default.css:N` = `src/css/themes/default.css` line N (byte-identical to
  `PRISTINE/css/default.css`, see 1.1).
- `common.css`, `fa-icons.css` = `src/css/…` (= PRISTINE `css/…`). Every other
  `*.css` = `platform/mv3/extension/css/…` (= PRISTINE `css/…`).
- `*.html`, `js/*.js` = `platform/mv3/extension/…` (= PRISTINE, byte-identical,
  verified with `diff -q`).
- `cm6:N` = `platform/mv3/extension/lib/codemirror/codemirror-ubol/dist/cm6.bundle.ubol.js`
  line N (readable build of the shipped bundle, see 1.5).
- `v-primitive.css`, `v-semantic.css`, `v-components.css` = the library's
  `dist/es/styles/variables-*.css`.

Statements marked **UNKNOWN** could not be determined. Statements marked
**DECISION** are choices made by this spec (not upstream behaviour); they are
binding for the generator.

---

## 0. Summary

1. `css/default.css` defines **256** custom properties and nothing else except
   one `color-scheme` declaration (`default.css:384-386`). Only **63** are
   referenced by any other shipped file, 59 are referenced only from inside
   default.css, 134 are referenced nowhere (section 2).
2. Upstream dark mode is **class-driven**: everything is keyed on `:root.dark`
   (set once by `js/theme.js`), except the four surface variables, which are
   keyed on both `@media (prefers-color-scheme)` and `:root.light/.dark`
   (section 1.4). Before `theme.js` runs, a dark-mode page shows dark surfaces
   with light-theme ink (verified in Chrome, section 1.4).
3. Exactly **9** names collide with library variables:
   `--blue-50 --green-50 --orange-50 --purple-50 --red-50 --yellow-50 --gray-25
   --gray-50 --gray-75` (section 3). They must keep upstream "R G B" triplet
   values.
4. The generated file is plain CSS, self-contained, no at-rules except two
   `@media`, no `url()`, no `color-scheme`, no `background` on html/body, and
   keys dark on **both** `@media (prefers-color-scheme: dark)` and `:root.dark`
   for **every** variable (section 5).
5. CodeMirror 6 does **not** read any `--cm-*` variable; its chrome is coloured by
   CodeMirror's own runtime theme (light base theme or One Dark). The generated
   file re-skins it with a small rule block that gives the `--cm-*` variables
   consumers again (section 4.4).
6. When the parent sets the marker attribute `data-blocker-embed` on the
   frame's `<html>`, the classic dashboard hides its header/nav and its
   Settings, Filter lists, About and busy panes (section 6). The marker name
   and the two rules are the same as `dashboard-shell.md` E-4 (R-17, R-18);
   the two specs must not diverge.
7. A script can verify the generated file with checks C1-C13 (section 7.1);
   section 7.2 is the parity checklist. A prototype generated from this spec
   passed the checks and was rendered in headless Chrome (section 9).
8. **[SAFARI]** On Safari the Custom filters "sandbox" editor is never shown
   or even created (1.5), so the only CodeMirror editor a Safari user sees is
   the Develop pane's. The `--sf-*` variables must still be defined.

---

## 1. Facts about upstream

### 1.1 Where `css/default.css` comes from

- `tools/make-mv3.sh:79` copies `src/css/themes/default.css` to `css/default.css`.
  `diff src/css/themes/default.css build/pristine/safari/css/default.css`
  reports no difference.
- `tools/make-mv3.sh:80-82` copy `src/css/common.css`, `dashboard-common.css`,
  `fa-icons.css`; then `tools/make-mv3.sh:106` copies
  `platform/mv3/extension/css/*` over them. Result in PRISTINE:
  `common.css` and `fa-icons.css` are the `src/css` files;
  **`dashboard-common.css` is the MV3 one** (`platform/mv3/extension/css/dashboard-common.css`,
  73 lines), not `src/css/dashboard-common.css` (55 lines, different content, not
  shipped). All other css files equal `platform/mv3/extension/css/*` (verified
  with `diff -q`, every file).
- Safari: `tools/make-mv3.sh:192-195` runs only
  `platform/mv3/safari/patch-extension.js`, which rewrites `_locales/*/messages.json`
  (`extShortDesc`, lines 49-75) and the manifest version (lines 81-94).
  Before that, `tools/make-mv3.sh:108-111` copy the Safari versions of
  `ext-compat.js`, `ext-offscreen.js` (into `js/`) and `css-api.js`,
  `css-user.js` (into `js/scripting/`); PRISTINE `js/ext-offscreen.js` and
  `js/ext-compat.js` are byte-identical to `platform/mv3/safari/*`. None of
  them contains CSS or theme code (`css-api.js`/`css-user.js` are
  content-script cosmetic-filtering helpers), but `ext-offscreen.js` has one
  visible UI consequence: `export const supportsOffscreenDocument = false;`
  (`platform/mv3/safari/ext-offscreen.js:25`) hides and never creates the
  Custom filters sandbox editor (1.5). Minimum Safari is 18.6
  (`PRISTINE/manifest.json:14-17`, `browser_specific_settings.safari.strict_min_version`).

### 1.2 Pages that load it

Every page links `css/default.css` as its **first** stylesheet, so every
later stylesheet wins specificity ties against it.

| Page in PRISTINE | Name in STAGE | Link line | Other stylesheets (in order) |
|---|---|---|---|
| `popup.html` | `popup-classic.html` | `popup.html:8` `<link rel="stylesheet" href="css/default.css">` | common, fa-icons, filtering-mode, popup (`:9-12`) |
| `dashboard.html` | `dashboard-classic.html` | `dashboard.html:8` `<link rel="stylesheet" href="css/default.css">` | common, fa-icons, dashboard, dashboard-common, filtering-mode, settings, filter-editor, develop (`:9-17`) |
| `matched-rules.html` | same | `matched-rules.html:8` `<link rel="stylesheet" href="css/default.css">` | common, fa-icons, matched-rules (`:9-11`) |
| `report.html` | same | `report.html:9` `<link rel="stylesheet" href="css/default.css">` | common, dashboard-common, fa-icons, report (`:10-13`) |
| `strictblock.html` | same | `strictblock.html:8` `<link rel="stylesheet" href="css/default.css">` | common, fa-icons, strictblock (`:9-11`) |
| `picker-ui.html` | same | `picker-ui.html:8` `<link rel="stylesheet" href="/css/default.css">` | /css/common, fa-icons, tool-overlay-ui, picker-ui (`:9-12`) |
| `unpicker-ui.html` | same | `unpicker-ui.html:8` `<link rel="stylesheet" href="/css/default.css">` | /css/common, fa-icons, tool-overlay-ui, unpicker-ui (`:9-12`) |
| `zapper-ui.html` | same | `zapper-ui.html:8` `<link rel="stylesheet" href="/css/default.css">` | /css/tool-overlay-ui, zapper-ui (`:9-10`) — **no common.css** |

All eight pages also carry `<meta name="color-scheme" content="light dark">`
(`popup.html:7`, `dashboard.html:6`, `matched-rules.html:6`, `report.html:6`,
`strictblock.html:6`, `picker-ui.html:6`, `unpicker-ui.html:6`, `zapper-ui.html:6`)
and load `js/theme.js` as a module script at the end of `<body>`
(`popup.html:60`, `dashboard.html:292`, `matched-rules.html:28`,
`report.html:63`, `strictblock.html:45`, `picker-ui.html:50`,
`unpicker-ui.html:34`, `zapper-ui.html:27`). The React pages (`popup.html`,
`dashboard.html` of the new UI) never load `css/default.css`, and the classic
pages never load library CSS; the generated file must keep it that way (it
must not `@import` anything).

### 1.3 Classes set at runtime on `<html>` (`js/theme.js`, whole file)

`js/theme.js:26-33`:

```js
const mql = self.matchMedia('(prefers-color-scheme: dark)');
const theme = mql instanceof Object && mql.matches === true ? 'dark' : 'light';
dom.cl.toggle(dom.html, 'dark', theme === 'dark');
dom.cl.toggle(dom.html, 'light', theme !== 'dark');
```

`js/theme.js:35-40` toggles `mobile` when `(hover: hover)` does not match, else
`desktop`.

- Runs **once**, as a deferred module (after parsing, before
  `DOMContentLoaded`). There is **no** `change` listener: a page keeps the
  scheme it had at load.
- **No accent is applied.** MV3 `theme.js` has no accent code. The uBO classic
  `src/js/theme.js` (accent via `:root.accented`, `setAccentColor` at lines
  55-112) is not copied by
  `tools/make-mv3.sh` (only the files listed at `:84-94` are copied from
  `src/js`; `theme.js` comes from `platform/mv3/extension/js` via `:107`).
- No shipped JS sets `colorBlind`, `classic`, `hidpi` or `accented`
  (`grep` over `PRISTINE/js/*.js` and `*.html`: no hit). Rules that require
  them (`default.css:500-525`, `common.css:372-379`) are dead in MV3; the
  `:not(.colorBlind)` rules (`default.css:476-492`) always apply.
- Safari: identical (`theme.js` is byte-identical in PRISTINE; no Safari
  override).

### 1.4 How upstream switches light/dark (exact)

| Variables | Light source | Dark source |
|---|---|---|
| `--surface-0-rgb`, `--surface-1`, `--surface-2`, `--surface-3` | `@media (prefers-color-scheme: light) { :root }` (`default.css:173-180`) **and** `:root.light` (`:190-195`) | `@media (prefers-color-scheme: dark) { :root }` (`:181-188`) **and** `:root.dark` (`:197-202`) |
| everything else that changes | `:root` (`:14-162`, `:208-306`, `:391-464`), `:root:not(.dark):not(.colorBlind)` (`:476-483`) | `:root.dark` (`:309-382`), `:root.dark:not(.colorBlind)` (`:485-492`) |
| `color-scheme` | — | `:root.dark { color-scheme: dark light; }` (`:384-386`) |

Consequences (verified in headless Chrome with the upstream file, section 9):

- Before `theme.js` runs in dark mode, only the surfaces are dark; ink stays
  light-theme (`body` computed `background rgb(27,27,35)`, `color rgb(32,18,58)`).
- After `theme.js`, classes decide; `:root.light`/`:root.dark` (specificity
  0,2,0) beat the media rules (0,1,0), so a live OS switch changes nothing
  (verified: loaded light, switched OS to dark, page stayed fully light).
- `--surface-*` are **never defined** at top-level `:root`; the popup-cell
  `*-rgb` variables are only defined under `:not()` selectors (`:476-492`).

### 1.5 CodeMirror (Custom filters and Develop panes)

- The editor is CodeMirror 6, loaded as a classic script
  (`dashboard.html:291` `lib/codemirror/cm6.bundle.ubol.min.js`). The shipped
  file is copied from `codemirror-ubol/dist/cm6.bundle.ubol.min.js`
  (`tools/make-mv3.sh:121-122`; byte-identical, `diff -q`). This spec cites the
  readable `cm6.bundle.ubol.js` in the same folder; that it is the same build
  as the `.min.js` is an assumption, spot-checked by finding the same colour
  constants (`#6699ff0b`, `#cceeff44`, `#d7d4f0`, `#f5f5f5`) in both.
- Theme choice is made **once, at editor creation**, from the `.dark` class:
  `develop.js:73` and `filter-editor.js:278` pass
  `oneDark: dom.cl.has(':root', 'dark')`; `cm6:25583-25585` pushes the One Dark
  extension when true. Light mode uses CodeMirror's base light theme
  (`cm6:12444-12705`), dark mode One Dark (`cm6:25417-25523`).
- **No `--cm-*` variable is read anywhere** in MV3 (section 2: all `--cm-*`
  are UNUSED except `--cm-negative`, used by `develop.css:70`, and
  `--cm-positive`, used only by `--df-allow-ink`). They are leftovers of uBO
  classic (CodeMirror 5).
- Enabled view extensions (`cm6:25549-25559`): `highlightActiveLineGutter`,
  `highlightSpecialChars`, history, `drawSelection`, `bracketMatching`,
  `highlightActiveLine`, `highlightSelectionMatches`; plus `lineNumbers`,
  optional fold gutter, panels, line/span error marks, autocompletion and hover
  tooltips depending on options (`cm6:25561-25650`). The merge view
  (`createMergeView`, `cm6:25838`; class `MergeView`, `cm6:23743`) is never
  used by MV3 JS (the only `cm6.*` calls in `js/*.js` are `createEditorView`,
  `createViewPanel`, `findAll`, `foldAll`, `lineErrorAdd/Clear`,
  `spanErrorAdd/Clear`, `resetUndoRedo`, `toggleComment`, `toggleReadOnly`,
  `undo`, `redo`, `undoDepth`, `redoDepth`).
- Two editors exist in upstream code: the Develop editor (`develop.js:70-102`,
  `self.cm6.createEditorView` at `:100`) and the Custom filters sandbox editor
  (`filter-manager-ui.js:587-601`, class `FilterEditor`, `cm6.createEditorView` at
  `filter-editor.js:287`). The sandbox editor is created lazily by
  `dom.onFirstShown(startsSandboxEditor, aside#sandboxEditor)`
  (`filter-manager-ui.js:630`; `dom.js:160-168`, an IntersectionObserver).
  **[SAFARI]** `aside#sandboxEditor` is `display: none` unless
  `body[data-supports~="compiled-filters"]` (`settings.css:403-405`);
  `settings.js:338-341` adds that token only when `supportsCompiledFilters`,
  which the background sets from `supportsOffscreenDocument`
  (`background.js:439`), which is `false` on Safari
  (`safari/ext-offscreen.js:25`). So on Safari the sandbox editor is never
  displayed and never constructed, and the `.sfp_*` classes /
  `--sf-*` variables are never painted. On Safari the Develop pane is the
  only CodeMirror surface.
- CodeMirror injects its CSS at runtime: in a document with a `<head>` it
  inserts one `<style>` element **as the first child of `<head>`**
  (`cm6:5755-5803`, `target.insertBefore(this.styleTag, target.firstChild)` at
  `:5800-5802`), i.e. **before** `css/default.css`. Theme selectors are
  `.<generated-class> <selector>`; examples and specificities:
  base light `.ͼ2 .cm-gutters` (0,2,0); One Dark `.ͼX .cm-gutters` (0,2,0),
  `.ͼX .cm-panels.cm-panels-top` (0,3,0),
  `.ͼX.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`
  (0,5,0). The generated block (4.4) uses strictly higher specificity anyway.
- Editor background and text colour are **not** CodeMirror's: `develop.css:31-34`
  sets `.cm-container .cm-editor { background-color: var(--surface-0) }` and
  `develop.css:41-46` sets `color: var(--ink-1)` (`:root.dark`: `var(--ink-2)`),
  both 0,2,0+ and winning over the theme's `&` rule (0,1,0).
- Syntax colours come from classes, not from CodeMirror themes:
  `filter-editor.css:12-60` (`.sfp_*` -> `--sf-*-ink`) for the Custom filters
  sandbox (not shown on Safari, see above), and **hard-coded** hex colours in
  `develop.css:47-63` (`.ubol-comment/.ubol-keyword/.ubol-literal`, each with
  a `:root.dark` variant) for the Develop pane.
- Tooltips are rendered inside the editor element (`cm6:15626-15634`,
  container = `view.dom` when no parent is configured; none is).
- Safari: CodeMirror takes the same `<style>` path in Safari (it only uses
  `adoptedStyleSheets` when the root has no `head`, `cm6:5758`).

### 1.6 Overlay iframes (picker, unpicker, zapper)

- Content scripts create a full-viewport `<iframe>` for `/picker-ui.html`,
  `/unpicker-ui.html`, `/zapper-ui.html` (`js/scripting/picker.js:309`,
  `unpicker.js:50`, `zapper.js:131`, via `js/scripting/tool-overlay.js:309-313`).
  The iframe element itself is styled from the host page with
  `background: transparent !important` and `color-scheme: light dark !important`
  (`js/scripting/tool-overlay.js:48-75`, lines 49 and 53).
- Inside the frame the transparency rule is `css/tool-overlay-ui.css:10-18`:

  ```css
  :root,
  :root > body {
      background: transparent;
      ...
  }
  ```

  Specificities: `:root` = 0,1,0; `:root > body` = 0,1,1. `common.css:44-45`
  (`body { background-color: var(--surface-1) }`, 0,0,1) loses to it. Any rule
  in the generated file that sets a background on `:root` with specificity
  >= 0,1,0 placed later, or > 0,1,0 anywhere (e.g. `:root.dark`), would make the
  overlay opaque and hide the web page. Hence constraint K2.
- The overlay highlight colours are `--ubol-overlay-canvas/-border/-fill`,
  defined in `tool-overlay-ui.css:1-5`, `picker-ui.css:1-4`,
  `unpicker-ui.css:1-4`, `zapper-ui.css:1-5` (after default.css, same or higher
  specificity). They are **not** legacy tokens and are out of scope: leave them.
- The overlay *panels* (`aside`) use legacy tokens: `picker-ui.css:11-12`,
  `unpicker-ui.css:11-12` (`--surface-1`, `--border-2`), `zapper-ui.css:15,19,25`
  (`--surface-1`, `--ink-1`, `--surface-2`), `tool-overlay-ui.css:68,74,98`
  (`--border-1`, `--ink-1`, `--surface-2`), selection highlights
  `picker-ui.css:105-106,140-141`, `unpicker-ui.css:46-47`
  (`--accent-surface-1`, `--accent-ink-1`). These are covered by the mapping.
- `tool-overlay-ui.css:6-8` sets `color-scheme: dark` on `:root.dark aside`
  (native widgets inside the panel). Unaffected by this spec.

---

## 2. Inventory of the 256 custom properties defined in `default.css`

How it was produced: all custom-property declarations parsed from
`default.css` with postcss (comments ignored; the commented-out block at
`default.css:527-534` is not a definition). Usage = every `var(--name` in
every shipped `.css` (comments stripped), `.js` and `.html` file under
PRISTINE (excluding `rulesets/`, `_locales/`, `img/`, `fonts/`). No shipped JS
reads or writes any of these names (`setProperty`/`getPropertyValue` calls
only touch `left/right/top/bottom/height/overflow/position`).

"Upstream light/dark" = value after `theme.js` has set `.light`/`.dark`
(desktop, not colour-blind, default contrast), fully resolved; `rgb(r g b)`
shown as hex.

Status: **USED** = referenced by a file other than default.css (63);
**INTERNAL** = referenced only inside default.css (59); **UNUSED** = never
referenced (134). Total 256.

Notes on the inventory:

- `--font-size` is defined twice at `:root` (`:130`, `:209`, both `14px`);
  `--accent-ink-3` twice (`:230`, `:404`, both `var(--ink-1)`).
- `fa-icons.css:17-26` references `--button-disabled-ink` and
  `--button-disabled-filter` inside a **comment**; `--button-disabled-ink` is
  defined nowhere. Not a live reference; do not define it for that reason.
- Variables referenced by other legacy CSS but defined outside default.css
  (out of scope, leave alone): `--default-gap-*`, `--button-font-size`
  (`common.css:33-40`), `--margin-end` (`common.css:230`),
  `--filtering-mode-*` (`filtering-mode.css:2-4`, `settings.css:11`),
  `--popup-gap*`, `--popup-min-width` (`popup.css:16-26`),
  `--ubol-overlay-*` (1.6), `--quit-button-size` (`zapper-ui.css:2`).
- `--notice-*` are referenced by `common.css:160-166` (`section.notice`) but no
  MV3 page or script creates `section.notice` (grep). Mapped anyway.

| # | Name | Defined at (default.css line: selector) | Upstream light | Upstream dark | Used outside default.css (count: file:lines) | Refs inside default.css (lines) | Status |
|---|---|---|---|---|---|---|---|
| 1 | `--blue-5` | 15: :root | `170 242 255` | same | 0 | - | UNUSED |
| 2 | `--blue-10` | 16: :root | `128 235 255` | same | 0 | - | UNUSED |
| 3 | `--blue-20` | 17: :root | `0 221 255` | same | 0 | 354 | INTERNAL |
| 4 | `--blue-30` | 18: :root | `0 179 244` | same | 0 | 353 | INTERNAL |
| 5 | `--blue-40` | 19: :root | `0 144 237` | same | 0 | 264 | INTERNAL |
| 6 | `--blue-50` | 20: :root | `0 96 223` | same | 0 | 269 | INTERNAL |
| 7 | `--blue-60` | 21: :root | `2 80 187` | same | 0 | - | UNUSED |
| 8 | `--blue-70` | 22: :root | `5 64 150` | same | 0 | - | UNUSED |
| 9 | `--blue-80` | 23: :root | `7 48 114` | same | 0 | - | UNUSED |
| 10 | `--blue-90` | 24: :root | `9 32 77` | same | 0 | - | UNUSED |
| 11 | `--dark-gray-10` | 25: :root | `82 82 94` | same | 0 | 299 | INTERNAL |
| 12 | `--dark-gray-20` | 26: :root | `74 74 85` | same | 0 | - | UNUSED |
| 13 | `--dark-gray-30` | 27: :root | `66 65 77` | same | 0 | - | UNUSED |
| 14 | `--dark-gray-40` | 28: :root | `58 57 68` | same | 0 | - | UNUSED |
| 15 | `--dark-gray-50` | 29: :root | `50 49 60` | same | 0 | - | UNUSED |
| 16 | `--dark-gray-60` | 30: :root | `43 42 51` | same | 0 | - | UNUSED |
| 17 | `--dark-gray-70` | 31: :root | `35 34 43` | same | 0 | - | UNUSED |
| 18 | `--dark-gray-80` | 32: :root | `28 27 34` | same | 0 | - | UNUSED |
| 19 | `--dark-gray-90` | 33: :root | `21 20 26` | same | 0 | - | UNUSED |
| 20 | `--green-30` | 34: :root | `136 255 209` | same | 0 | 268,355 | INTERNAL |
| 21 | `--green-40` | 35: :root | `84 255 189` | same | 0 | - | UNUSED |
| 22 | `--green-50` | 36: :root | `63 225 176` | same | 0 | - | UNUSED |
| 23 | `--green-60` | 37: :root | `42 195 162` | same | 0 | - | UNUSED |
| 24 | `--green-65` | 38: :root | `21 165 149` | same | 0 | 243 | INTERNAL |
| 25 | `--green-70` | 39: :root | `0 135 135` | same | 0 | - | UNUSED |
| 26 | `--green-80` | 40: :root | `0 94 94` | same | 0 | - | UNUSED |
| 27 | `--ink-10` | 41: :root | `57 52 115` | same | 0 | - | UNUSED |
| 28 | `--ink-80` | 42: :root | `32 18 58` | same | 0 | 221,518 | INTERNAL |
| 29 | `--light-gray-10` | 43: :root | `249 249 251` | same | 0 | - | UNUSED |
| 30 | `--light-gray-20` | 44: :root | `240 240 244` | same | 0 | - | UNUSED |
| 31 | `--light-gray-30` | 45: :root | `224 224 230` | same | 0 | - | UNUSED |
| 32 | `--light-gray-40` | 46: :root | `207 207 216` | same | 0 | - | UNUSED |
| 33 | `--light-gray-50` | 47: :root | `191 191 201` | same | 0 | - | UNUSED |
| 34 | `--light-gray-60` | 48: :root | `175 175 186` | same | 0 | - | UNUSED |
| 35 | `--light-gray-70` | 49: :root | `159 159 173` | same | 0 | - | UNUSED |
| 36 | `--light-gray-80` | 50: :root | `143 143 158` | same | 0 | - | UNUSED |
| 37 | `--light-gray-90` | 51: :root | `128 128 143` | same | 0 | - | UNUSED |
| 38 | `--orange-5` | 52: :root | `255 244 222` | same | 0 | - | UNUSED |
| 39 | `--orange-10` | 53: :root | `255 213 178` | same | 0 | - | UNUSED |
| 40 | `--orange-20` | 54: :root | `255 181 135` | same | 0 | - | UNUSED |
| 41 | `--orange-30` | 55: :root | `255 162 102` | same | 0 | - | UNUSED |
| 42 | `--orange-40` | 56: :root | `255 138 80` | same | 0 | - | UNUSED |
| 43 | `--orange-50` | 57: :root | `255 113 57` | same | 0 | - | UNUSED |
| 44 | `--orange-60` | 58: :root | `226 89 32` | same | 0 | - | UNUSED |
| 45 | `--orange-70` | 59: :root | `204 61 0` | same | 0 | - | UNUSED |
| 46 | `--orange-80` | 60: :root | `158 40 11` | same | 0 | - | UNUSED |
| 47 | `--orange-90` | 61: :root | `124 21 4` | same | 0 | - | UNUSED |
| 48 | `--purple-5` | 62: :root | `247 226 255` | same | 0 | - | UNUSED |
| 49 | `--purple-10` | 63: :root | `246 184 255` | same | 0 | - | UNUSED |
| 50 | `--purple-20` | 64: :root | `246 143 255` | same | 0 | - | UNUSED |
| 51 | `--purple-30` | 65: :root | `247 112 255` | same | 0 | - | UNUSED |
| 52 | `--purple-40` | 66: :root | `215 76 240` | same | 0 | - | UNUSED |
| 53 | `--purple-50` | 67: :root | `184 51 225` | same | 0 | - | UNUSED |
| 54 | `--purple-60` | 68: :root | `149 43 185` | same | 0 | - | UNUSED |
| 55 | `--purple-70` | 69: :root | `114 34 145` | same | 0 | - | UNUSED |
| 56 | `--purple-80` | 70: :root | `78 26 105` | same | 0 | - | UNUSED |
| 57 | `--purple-90` | 71: :root | `43 17 65` | same | 0 | - | UNUSED |
| 58 | `--red-20` | 72: :root | `255 154 162` | same | 0 | - | UNUSED |
| 59 | `--red-30` | 73: :root | `255 132 139` | same | 0 | - | UNUSED |
| 60 | `--red-40` | 74: :root | `255 106 117` | same | 0 | - | UNUSED |
| 61 | `--red-50` | 75: :root | `255 79 94` | same | 0 | 341 | INTERNAL |
| 62 | `--red-60` | 76: :root | `226 40 80` | same | 0 | 248 | INTERNAL |
| 63 | `--red-70` | 77: :root | `197 0 66` | same | 0 | - | UNUSED |
| 64 | `--violet-5` | 78: :root | `231 223 255` | same | 0 | - | UNUSED |
| 65 | `--violet-10` | 79: :root | `217 191 255` | same | 0 | - | UNUSED |
| 66 | `--violet-20` | 80: :root | `203 158 255` | same | 0 | 345,346 | INTERNAL |
| 67 | `--violet-30` | 81: :root | `198 137 255` | same | 0 | - | UNUSED |
| 68 | `--violet-40` | 82: :root | `171 113 255` | same | 0 | - | UNUSED |
| 69 | `--violet-50` | 83: :root | `144 89 255` | same | 0 | - | UNUSED |
| 70 | `--violet-60` | 84: :root | `117 66 229` | same | 0 | 255,256 | INTERNAL |
| 71 | `--violet-70` | 85: :root | `89 42 203` | same | 0 | - | UNUSED |
| 72 | `--violet-80` | 86: :root | `69 39 141` | same | 0 | - | UNUSED |
| 73 | `--violet-90` | 87: :root | `50 28 100` | same | 0 | - | UNUSED |
| 74 | `--yellow-5` | 88: :root | `255 255 204` | same | 0 | 304,380,519,522,523 | INTERNAL |
| 75 | `--yellow-10` | 89: :root | `255 255 152` | same | 0 | - | UNUSED |
| 76 | `--yellow-20` | 90: :root | `255 234 128` | same | 0 | - | UNUSED |
| 77 | `--yellow-30` | 91: :root | `255 213 103` | same | 0 | 305,381 | INTERNAL |
| 78 | `--yellow-40` | 92: :root | `255 189 79` | same | 0 | 278 | INTERNAL |
| 79 | `--yellow-50` | 93: :root | `255 164 54` | same | 0 | - | UNUSED |
| 80 | `--yellow-60` | 94: :root | `226 127 46` | same | 0 | - | UNUSED |
| 81 | `--yellow-70` | 95: :root | `196 90 39` | same | 0 | - | UNUSED |
| 82 | `--yellow-80` | 96: :root | `167 52 31` | same | 0 | - | UNUSED |
| 83 | `--yellow-90` | 97: :root | `150 14 24` | same | 0 | - | UNUSED |
| 84 | `--gray-5` | 104: :root | `16 16 22` | same | 0 | - | UNUSED |
| 85 | `--gray-10` | 105: :root | `27 27 35` | same | 0 | 184,199 | INTERNAL |
| 86 | `--gray-15` | 106: :root | `37 37 47` | same | 0 | - | UNUSED |
| 87 | `--gray-20` | 107: :root | `47 47 59` | same | 0 | 185,200,352 | INTERNAL |
| 88 | `--gray-25` | 108: :root | `58 58 72` | same | 0 | - | UNUSED |
| 89 | `--gray-30` | 109: :root | `69 69 85` | same | 0 | 186,201,332 | INTERNAL |
| 90 | `--gray-35` | 110: :root | `81 81 98` | same | 0 | 321 | INTERNAL |
| 91 | `--gray-40` | 111: :root | `93 93 110` | same | 0 | 322,358 | INTERNAL |
| 92 | `--gray-45` | 112: :root | `105 105 121` | same | 0 | 323 | INTERNAL |
| 93 | `--gray-50` | 113: :root | `118 118 133` | same | 0 | 324 | INTERNAL |
| 94 | `--gray-55` | 114: :root | `131 131 145` | same | 0 | - | UNUSED |
| 95 | `--gray-60` | 115: :root | `144 144 156` | same | 0 | 228 | INTERNAL |
| 96 | `--gray-65` | 116: :root | `157 157 168` | same | 0 | 227 | INTERNAL |
| 97 | `--gray-70` | 117: :root | `170 170 180` | same | 0 | 226 | INTERNAL |
| 98 | `--gray-75` | 118: :root | `184 184 192` | same | 0 | 225 | INTERNAL |
| 99 | `--gray-80` | 119: :root | `198 198 204` | same | 0 | 178,194,237,274 | INTERNAL |
| 100 | `--gray-85` | 120: :root | `212 212 217` | same | 0 | 524 | INTERNAL |
| 101 | `--gray-90` | 121: :root | `226 226 229` | same | 0 | 177,193,262,317 | INTERNAL |
| 102 | `--gray-95` | 122: :root | `240 240 242` | same | 0 | 176,192 | INTERNAL |
| 103 | `--font-size` | 130: :root; 139: :root.mobile; 209: :root | `14px` | same | 16: common.css:40,51,92,230,307,321,339,341,342; dashboard.css:24; develop.css:78,132; popup.css:24,85,155; settings.css:333 | 131,132,422,426 | USED |
| 104 | `--font-size-smaller` | 131: :root; 140: :root.mobile | `calc(14px - 1px)` | same | 4: picker-ui.css:115; settings.css:28,93; strictblock.css:53 | - | USED |
| 105 | `--font-size-xsmall` | 132: :root | `calc(14px - 3px)` | same | 0 | - | UNUSED |
| 106 | `--font-size-larger` | 133: :root | `15px` | same | 0 | - | UNUSED |
| 107 | `--font-family` | 134: :root | `Inter, sans-serif` | same | 2: common.css:50; dashboard.css:23 | - | USED |
| 108 | `--monospace-size` | 135: :root; 141: :root.mobile | `12px` | same | 5: common.css:67; develop.css:25; picker-ui.css:41,53,79 | - | USED |
| 109 | `--primary-5` | 151: :root | `3 16 40` | same | 0 | - | UNUSED |
| 110 | `--primary-10` | 152: :root | `5 27 59` | same | 0 | - | UNUSED |
| 111 | `--primary-20` | 153: :root | `14 47 95` | same | 0 | 335,336 | INTERNAL |
| 112 | `--primary-30` | 154: :root | `24 69 134` | same | 0 | 234 | INTERNAL |
| 113 | `--primary-40` | 155: :root | `34 93 176` | same | 0 | 231,233,239,359 | INTERNAL |
| 114 | `--primary-50` | 156: :root | `45 117 219` | same | 0 | 249 | INTERNAL |
| 115 | `--primary-60` | 157: :root | `86 143 244` | same | 0 | 342 | INTERNAL |
| 116 | `--primary-70` | 158: :root | `137 170 247` | same | 0 | 326,328,334 | INTERNAL |
| 117 | `--primary-80` | 159: :root | `179 198 250` | same | 0 | 275,329,458,459,461,462 | INTERNAL |
| 118 | `--primary-90` | 160: :root | `218 226 252` | same | 0 | 240,241 | INTERNAL |
| 119 | `--primary-95` | 161: :root | `236 240 254` | same | 0 | - | UNUSED |
| 120 | `--surface-0-rgb` | 175: @media light; 183: @media dark; 191: :root.light; 198: :root.dark | `255 255 255` | `0 0 0` | 0 | 270,271,396 | INTERNAL |
| 121 | `--surface-1` | 176: @media light; 184: @media dark; 192: :root.light; 199: :root.dark | `#f0f0f2` | `#1b1b23` | 13: common.css:45,217,224; dashboard.css:2; develop.css:102; filtering-mode.css:18; picker-ui.css:11; popup.css:53; settings.css:69,379; strictblock.css:113; unpicker-ui.css:11; zapper-ui.css:15 | 265 | USED |
| 122 | `--surface-2` | 177: @media light; 185: @media dark; 193: :root.light; 200: :root.dark | `#e2e2e5` | `#2f2f3b` | 13: common.css:65,72,166,189; picker-ui.css:98,136; popup.css:143; settings.css:92,314; strictblock.css:114; tool-overlay-ui.css:98; unpicker-ui.css:38; zapper-ui.css:25 | 252,267,436,449 | USED |
| 123 | `--surface-3` | 178: @media light; 186: @media dark; 194: :root.light; 201: :root.dark | `#c6c6cc` | `#454555` | 5: common.css:266; filtering-mode.css:4; popup.css:66; settings.css:63,428 | 419,437 | USED |
| 124 | `--ubo-red` | 211: :root | `#800000` | same | 0 | - | UNUSED |
| 125 | `--elevation-up-surface` | 213: :root; 313: :root.dark | `black` | `white` | 1: common.css:103 | - | USED |
| 126 | `--elevation-up1-opacity` | 214: :root; 314: :root.dark | `4%` | `12%` | 1: common.css:115 | - | USED |
| 127 | `--elevation-up2-opacity` | 215: :root; 315: :root.dark | `8%` | `24%` | 1: common.css:118 | - | USED |
| 128 | `--elevation-down-surface` | 216: :root; 310: :root.dark | `white` | `black` | 1: common.css:136 | - | USED |
| 129 | `--elevation-down1-opacity` | 217: :root; 311: :root.dark | `16%` | same | 1: common.css:137 | - | USED |
| 130 | `--elevation-down2-opacity` | 218: :root; 312: :root.dark | `32%` | same | 0 | - | UNUSED |
| 131 | `--ink-rgb` | 221: :root; 317: :root.dark | `32 18 58` | `226 226 229` | 0 | 398,399,400,401 | INTERNAL |
| 132 | `--ink-0` | 222: :root; 318: :root.dark | `black` | `white` | 0 | 263 | INTERNAL |
| 133 | `--ink-100` | 223: :root; 319: :root.dark | `white` | `black` | 0 | - | UNUSED |
| 134 | `--border-1` | 225: :root; 321: :root.dark | `#b8b8c0` | `#515162` | 5: dashboard.css:9; settings.css:296,342,380; tool-overlay-ui.css:68 | - | USED |
| 135 | `--border-2` | 226: :root; 322: :root.dark | `#aaaab4` | `#5d5d6e` | 2: picker-ui.css:12; unpicker-ui.css:12 | - | USED |
| 136 | `--border-3` | 227: :root; 323: :root.dark | `#9d9da8` | `#696979` | 0 | - | UNUSED |
| 137 | `--border-4` | 228: :root; 324: :root.dark | `#90909c` | `#767685` | 0 | - | UNUSED |
| 138 | `--accent-ink-3` | 230: :root; 404: :root | `#20123a` | `#e2e2e5` | 0 | - | UNUSED |
| 139 | `--accent-surface-1` | 231: :root; 326: :root.dark | `#225db0` | `#89aaf7` | 10: filtering-mode.css:27,28,46; picker-ui.css:105,141; popup.css:118; settings.css:119; strictblock.css:57,58; unpicker-ui.css:46 | 406,418,424,429 | USED |
| 140 | `--link-ink` | 233: :root; 328: :root.dark | `#225db0` | `#89aaf7` | 2: common.css:57,58 | - | USED |
| 141 | `--link-hover-ink` | 234: :root; 329: :root.dark | `#184586` | `#b3c6fa` | 2: common.css:61,62 | - | USED |
| 142 | `--button-surface-rgb` | 237: :root; 332: :root.dark | `198 198 204` | `69 69 85` | 0 | 414 | INTERNAL |
| 143 | `--dashboard-tab-active-ink-rgb` | 239: :root; 334: :root.dark | `34 93 176` | `137 170 247` | 0 | 433 | INTERNAL |
| 144 | `--dashboard-tab-focus-surface-rgb` | 240: :root; 335: :root.dark | `218 226 252` | `14 47 95` | 0 | 435 | INTERNAL |
| 145 | `--dashboard-highlight-surface-rgb` | 241: :root; 336: :root.dark | `218 226 252` | `14 47 95` | 0 | - | UNUSED |
| 146 | `--dashboard-happy-green` | 243: :root | `#15a595` | same | 0 | - | UNUSED |
| 147 | `--popup-cell-cname-ink` | 246: :root; 339: :root.dark | `#0054d7` | `#93a6ff` | 0 | - | UNUSED |
| 148 | `--popup-cell-label-mixed-surface` | 247: :root; 340: :root.dark; 504: :root.colorBlind | `#c29100` | `hsla(45, 100%, 38%, 1)` | 0 | - | UNUSED |
| 149 | `--popup-icon-x-ink` | 248: :root; 341: :root.dark | `#e22850` | `#ff4f5e` | 0 | - | UNUSED |
| 150 | `--popup-power-ink-rgb` | 249: :root; 342: :root.dark; 520: :root.classic:not(.dark) | `45 117 219` | `86 143 244` | 0 | 457 | INTERNAL |
| 151 | `--hr-ink` | 252: :root | `#e2e2e5` | `#2f2f3b` | 0 | - | UNUSED |
| 152 | `--cloud-total-used-surface` | 255: :root; 345: :root.dark | `rgb(117 66 229 / 25%)` | `rgb(203 158 255 / 25%)` | 0 | - | UNUSED |
| 153 | `--cloud-used-surface` | 256: :root; 346: :root.dark | `#7542e5` | `#cb9eff` | 0 | - | UNUSED |
| 154 | `--error-surface` | 259: :root; 349: :root.dark | `#c00004` | `#ff5354` | 0 | - | UNUSED |
| 155 | `--cm-active-line` | 262: :root; 352: :root.dark | `#e2e2e5` | `#2f2f3b` | 0 | - | UNUSED |
| 156 | `--cm-cursor` | 263: :root | `black` | `white` | 0 | - | UNUSED |
| 157 | `--cm-foldmarker-ink` | 264: :root; 354: :root.dark | `#0090ed` | `#00ddff` | 0 | - | UNUSED |
| 158 | `--cm-gutter-border` | 265: :root | `#f0f0f2` | `#1b1b23` | 0 | - | UNUSED |
| 159 | `--cm-gutter-ink` | 266: :root | `rgb(32 18 58 / 60%)` | `rgb(226 226 229 / 60%)` | 0 | - | UNUSED |
| 160 | `--cm-gutter-surface` | 267: :root | `#e2e2e5` | `#2f2f3b` | 0 | - | UNUSED |
| 161 | `--cm-matchingbracket` | 268: :root; 355: :root.dark | `#88ffd1` | `rgb(136 255 209 / 50%)` | 0 | - | UNUSED |
| 162 | `--cm-merge-copy-ink` | 269: :root; 353: :root.dark | `#0060df` | `#00b3f4` | 0 | - | UNUSED |
| 163 | `--cm-merge-chunk-border` | 270: :root | `rgb(255 255 255 / 40%)` | `rgb(0 0 0 / 40%)` | 0 | - | UNUSED |
| 164 | `--cm-merge-chunk-surface` | 271: :root | `rgb(255 255 255 / 40%)` | `rgb(0 0 0 / 40%)` | 0 | - | UNUSED |
| 165 | `--cm-negative` | 272: :root; 356: :root.dark | `#e32f00` | `#ff8982` | 1: develop.css:70 | 298 | USED |
| 166 | `--cm-positive` | 273: :root; 357: :root.dark | `#008a21` | `#00c634` | 0 | 297 | INTERNAL |
| 167 | `--cm-selection-surface` | 274: :root; 358: :root.dark | `#c6c6cc` | `#5d5d6e` | 0 | - | UNUSED |
| 168 | `--cm-selection-focused-surface` | 275: :root; 359: :root.dark | `#b3c6fa` | `#225db0` | 0 | - | UNUSED |
| 169 | `--cm-searching-ink` | 276: :root; 360: :root.dark | `black` | same | 0 | - | UNUSED |
| 170 | `--cm-searching-surface` | 277: :root; 361: :root.dark | `#fee300cc` | same | 0 | - | UNUSED |
| 171 | `--cm-search-match-surface` | 278: :root | `rgb(255 189 79 / 50%)` | same | 0 | - | UNUSED |
| 172 | `--sf-comment-ink` | 281: :root; 364: :root.dark | `rgb(32 18 58 / 60%)` | `rgb(226 226 229 / 60%)` | 1: filter-editor.css:13 | - | USED |
| 173 | `--sf-def-ink` | 282: :root; 365: :root.dark | `#3c3aff` | `#a2a2ff` | 1: filter-editor.css:16 | - | USED |
| 174 | `--sf-directive-ink` | 283: :root | `#20123a` | `#e2e2e5` | 1: filter-editor.css:19 | - | USED |
| 175 | `--sf-error-ink` | 284: :root; 366: :root.dark | `#ff8981` | same | 0 | - | UNUSED |
| 176 | `--sf-error-surface` | 285: :root; 367: :root.dark | `#ff898133` | `#ff898166` | 0 | - | UNUSED |
| 177 | `--sf-keyword-ink` | 286: :root; 368: :root.dark | `#9b00ca` | `#d78dff` | 1: filter-editor.css:32 | - | USED |
| 178 | `--sf-notice-ink` | 287: :root | `rgb(32 18 58 / 38%)` | `rgb(226 226 229 / 38%)` | 1: filter-editor.css:40 | - | USED |
| 179 | `--sf-readonly-ink` | 288: :root | `rgb(32 18 58 / 60%)` | `rgb(226 226 229 / 60%)` | 0 | - | UNUSED |
| 180 | `--sf-tag-ink` | 289: :root; 369: :root.dark | `#006e2e` | `#00c559` | 1: filter-editor.css:48 | - | USED |
| 181 | `--sf-unicode-ink` | 290: :root | `#20123a` | `#e2e2e5` | 1: filter-editor.css:51 | - | USED |
| 182 | `--sf-value-ink` | 291: :root; 370: :root.dark | `#974900` | `#ff8d48` | 1: filter-editor.css:56 | - | USED |
| 183 | `--sf-variable-ink` | 292: :root; 371: :root.dark | `#20123a` | `#e2e2e5` | 1: filter-editor.css:59 | - | USED |
| 184 | `--sf-warning-ink` | 293: :root; 372: :root.dark | `#ffbb03` | `#e49d00` | 0 | - | UNUSED |
| 185 | `--sf-warning-surface` | 294: :root; 373: :root.dark | `#e49d0033` | `#e49d0066` | 0 | - | UNUSED |
| 186 | `--df-allow-ink` | 297: :root | `#008a21` | `#00c634` | 0 | - | UNUSED |
| 187 | `--df-block-ink` | 298: :root | `#e32f00` | `#ff8982` | 0 | - | UNUSED |
| 188 | `--df-noop-ink` | 299: :root; 376: :root.dark | `#52525e` | `rgb(226 226 229 / 60%)` | 0 | - | UNUSED |
| 189 | `--logger-modified-surface` | 302: :root; 379: :root.dark | `#0000c010` | `#663efd60` | 0 | - | UNUSED |
| 190 | `--logger-modified-em-surface` | 303: :root | `#0000c028` | same | 0 | - | UNUSED |
| 191 | `--logger-redirected-surface` | 304: :root; 380: :root.dark | `rgb(255 255 204 / 50%)` | `rgb(255 255 204 / 40%)` | 0 | - | UNUSED |
| 192 | `--logger-scriptlet-surface` | 305: :root; 381: :root.dark | `rgb(255 213 103 / 50%)` | `rgb(255 213 103 / 40%)` | 0 | - | UNUSED |
| 193 | `--high-em` | 392: :root | `87%` | same | 0 | 399 | INTERNAL |
| 194 | `--medium-em` | 393: :root | `60%` | same | 0 | 400 | INTERNAL |
| 195 | `--low-em` | 394: :root | `38%` | same | 0 | 401 | INTERNAL |
| 196 | `--surface-0` | 396: :root | `#ffffff` | `#000000` | 6: develop.css:32; settings.css:69,72,329,364,387 | 403 | USED |
| 197 | `--ink-1` | 398: :root | `#20123a` | `#e2e2e5` | 13: common.css:48,49,83; develop.css:42; picker-ui.css:108; popup.css:33,34,165,166,197,198; tool-overlay-ui.css:74; zapper-ui.css:19 | 230,283,290,292,371,404,413,432,460,521 | USED |
| 198 | `--ink-2` | 399: :root | `rgb(32 18 58 / 87%)` | `rgb(226 226 229 / 87%)` | 8: develop.css:45; picker-ui.css:50,112; popup.css:154; settings.css:275,376; strictblock.css:67; unpicker-ui.css:26 | 409 | USED |
| 199 | `--ink-3` | 400: :root | `rgb(32 18 58 / 60%)` | `rgb(226 226 229 / 60%)` | 4: popup.css:112; settings.css:153; strictblock.css:89,90 | 266,281,288,364,376,423 | USED |
| 200 | `--ink-4` | 401: :root | `rgb(32 18 58 / 38%)` | `rgb(226 226 229 / 38%)` | 2: common.css:284,285 | 287 | USED |
| 201 | `--accent-ink-1` | 403: :root | `#ffffff` | `#000000` | 3: picker-ui.css:106,140; unpicker-ui.css:47 | 417,428 | USED |
| 202 | `--subtil-ink` | 406: :root | `#225db0` | `#89aaf7` | 1: common.css:302 | - | USED |
| 203 | `--fieldset-header-surface` | 408: :root | `transparent` | same | 0 | - | UNUSED |
| 204 | `--fieldset-header-ink` | 409: :root | `rgb(32 18 58 / 87%)` | `rgb(226 226 229 / 87%)` | 1: common.css:310 | - | USED |
| 205 | `--native-control-opacity` | 411: :root; 468: @media contrast-more | `0` | same | 4: common.css:196,207,246,254 | - | USED |
| 206 | `--button-ink` | 413: :root | `#20123a` | `#e2e2e5` | 4: common.css:86,88,125,126 | - | USED |
| 207 | `--button-surface` | 414: :root | `#c6c6cc` | `#454555` | 1: common.css:85 | - | USED |
| 208 | `--button-border-size` | 415: :root; 469: @media contrast-more | `0` | same | 1: common.css:83 | - | USED |
| 209 | `--button-border-radius` | 416: :root | `5px` | same | 2: common.css:84,104 | - | USED |
| 210 | `--button-preferred-ink` | 417: :root | `#ffffff` | `#000000` | 2: common.css:132,133 | - | USED |
| 211 | `--button-preferred-surface` | 418: :root | `#225db0` | `#89aaf7` | 1: common.css:131 | - | USED |
| 212 | `--button-disabled-surface` | 419: :root | `#c6c6cc` | `#454555` | 1: common.css:124 | - | USED |
| 213 | `--button-disabled-filter` | 420: :root | `opacity(50%)` | same | 1: common.css:127 | - | USED |
| 214 | `--checkbox-size` | 422: :root | `calc(14px + 2px)` | same | 7: common.css:181,186,195,234,239,245; settings.css:162 | - | USED |
| 215 | `--checkbox-ink` | 423: :root | `rgb(32 18 58 / 60%)` | `rgb(226 226 229 / 60%)` | 2: common.css:202,260 | - | USED |
| 216 | `--checkbox-checked-ink` | 424: :root | `#225db0` | `#89aaf7` | 5: common.css:215,216,225,226,270 | - | USED |
| 217 | `--checkbox-disabled-filter` | 425: :root | `opacity(50%)` | same | 3: common.css:221; settings.css:54,198 | - | USED |
| 218 | `--checkbox-margin-end` | 426: :root | `calc(14px * 0.75)` | same | 2: common.css:183,184 | - | USED |
| 219 | `--notice-ink` | 428: :root; 518: :root.classic:not(.dark) | `#ffffff` | `#000000` | 1: common.css:163 | - | USED |
| 220 | `--notice-surface` | 429: :root; 519: :root.classic:not(.dark) | `#225db0` | `#89aaf7` | 1: common.css:161 | - | USED |
| 221 | `--notice-surface-shadow` | 430: :root | `#000 0 2px 8px` | same | 1: common.css:162 | - | USED |
| 222 | `--dashboard-tab-ink` | 432: :root | `#20123a` | `#e2e2e5` | 2: dashboard.css:21,22 | - | USED |
| 223 | `--dashboard-tab-active-ink` | 433: :root | `#225db0` | `#89aaf7` | 3: dashboard.css:43,44,45 | - | USED |
| 224 | `--dashboard-tab-active-surface` | 434: :root | `transparent` | same | 1: dashboard.css:42 | - | USED |
| 225 | `--dashboard-tab-focus-surface` | 435: :root | `#dae2fc` | `#0e2f5f` | 0 | - | UNUSED |
| 226 | `--dashboard-tab-hover-surface` | 436: :root | `#e2e2e5` | `#2f2f3b` | 1: dashboard.css:33 | - | USED |
| 227 | `--dashboard-tab-hover-border` | 437: :root | `#c6c6cc` | `#454555` | 1: dashboard.css:34 | - | USED |
| 228 | `--info0-ink-rgb` | 440: :root | `119 119 119` | same | 0 | 444 | INTERNAL |
| 229 | `--info1-ink-rgb` | 441: :root | `72 143 255` | same | 0 | 445 | INTERNAL |
| 230 | `--info2-ink-rgb` | 442: :root | `208 125 0` | same | 0 | 446 | INTERNAL |
| 231 | `--info3-ink-rgb` | 443: :root | `255 82 94` | same | 0 | 447 | INTERNAL |
| 232 | `--info0-ink` | 444: :root | `#777777` | same | 6: common.css:359,360; dashboard-common.css:29,30; settings.css:202,203 | - | USED |
| 233 | `--info1-ink` | 445: :root | `#488fff` | same | 1: develop.css:149 | - | USED |
| 234 | `--info2-ink` | 446: :root | `#d07d00` | same | 3: dashboard-common.css:37,38; report.css:2 | - | USED |
| 235 | `--info3-ink` | 447: :root | `#ff525e` | same | 8: dashboard-common.css:41,42; develop.css:66,98,157,168; settings.css:122,402 | - | USED |
| 236 | `--popup-cell-surface` | 449: :root | `#e2e2e5` | `#2f2f3b` | 0 | - | UNUSED |
| 237 | `--popup-cell-label-filter` | 450: :root | `opacity(40%)` | same | 0 | - | UNUSED |
| 238 | `--popup-cell-allow-own-surface` | 451: :root | `#007f00` | `#009900` | 0 | - | UNUSED |
| 239 | `--popup-cell-allow-surface` | 452: :root | `#81ca81` | `#497549` | 0 | - | UNUSED |
| 240 | `--popup-cell-noop-own-surface` | 453: :root | `#6b6b6b` | `#848484` | 0 | - | UNUSED |
| 241 | `--popup-cell-noop-surface` | 454: :root | `#b9b9b9` | `#5e5e5e` | 0 | - | UNUSED |
| 242 | `--popup-cell-block-own-surface` | 455: :root | `#d80000` | `#ff2828` | 0 | - | UNUSED |
| 243 | `--popup-cell-block-surface` | 456: :root | `#e0acac` | `#af4a4a` | 0 | - | UNUSED |
| 244 | `--popup-power-ink` | 457: :root | `#2d75db` | `#568ff4` | 0 | - | UNUSED |
| 245 | `--popup-toolbar-surface` | 458: :root | `rgb(179 198 250 / 15%)` | same | 2: popup.css:82,180 | - | USED |
| 246 | `--popup-toolbar-surface-hover` | 459: :root | `rgb(179 198 250 / 30%)` | same | 1: popup.css:231 | - | USED |
| 247 | `--popup-ruleset-tool-ink` | 460: :root; 521: :root.classic:not(.dark) | `#20123a` | `#e2e2e5` | 0 | - | UNUSED |
| 248 | `--popup-ruleset-tool-surface` | 461: :root; 522: :root.classic:not(.dark) | `rgb(179 198 250 / 15%)` | same | 0 | - | UNUSED |
| 249 | `--popup-ruleset-tool-surface-hover` | 462: :root; 523: :root.classic:not(.dark) | `rgb(179 198 250 / 20%)` | same | 0 | - | UNUSED |
| 250 | `--popup-ruleset-tool-shadow` | 463: :root; 524: :root.classic:not(.dark) | `transparent` | same | 0 | - | UNUSED |
| 251 | `--popup-cell-allow-own-surface-rgb` | 477: :root:not(.dark):not(.colorBlind); 486: :root.dark:not(.colorBlind); 501: :root.colorBlind | `0 127 0` | `0 153 0` | 0 | 451 | INTERNAL |
| 252 | `--popup-cell-allow-surface-rgb` | 478: :root:not(.dark):not(.colorBlind); 487: :root.dark:not(.colorBlind); 507: :root.colorBlind:not(.dark); 512: :root.dark.colorBlind | `129 202 129` | `73 117 73` | 0 | 452 | INTERNAL |
| 253 | `--popup-cell-block-own-surface-rgb` | 479: :root:not(.dark):not(.colorBlind); 488: :root.dark:not(.colorBlind); 502: :root.colorBlind | `216 0 0` | `255 40 40` | 0 | 455 | INTERNAL |
| 254 | `--popup-cell-block-surface-rgb` | 480: :root:not(.dark):not(.colorBlind); 489: :root.dark:not(.colorBlind); 508: :root.colorBlind:not(.dark); 513: :root.dark.colorBlind | `224 172 172` | `175 74 74` | 0 | 456 | INTERNAL |
| 255 | `--popup-cell-noop-own-surface-rgb` | 481: :root:not(.dark):not(.colorBlind); 490: :root.dark:not(.colorBlind); 503: :root.colorBlind | `107 107 107` | `132 132 132` | 0 | 453 | INTERNAL |
| 256 | `--popup-cell-noop-surface-rgb` | 482: :root:not(.dark):not(.colorBlind); 491: :root.dark:not(.colorBlind); 509: :root.colorBlind:not(.dark); 514: :root.dark.colorBlind | `185 185 185` | `94 94 94` | 0 | 454 | INTERNAL |

---

## 3. Names that collide with the library

Scanned: every `--name:` declared in every library CSS file under
`dist/es/` (1012 distinct names, `katex.min.css` excluded) against the 256
names above. Exact collisions: **9**.

| Legacy name | Legacy value (format) | Library definition | Library value light / dark | Referenced in default.css |
|---|---|---|---|---|
| `--blue-50` | `0 96 223` (triplet, `default.css:19`) | `v-primitive.css:185` | `#e5f3ff` / same | `:269` `--cm-merge-copy-ink: rgb(var(--blue-50))` |
| `--green-50` | `63 225 176` (`:36`) | `v-primitive.css:41` | `#d9f4e4` / same | — |
| `--orange-50` | `255 113 57` (`:57`) | `v-primitive.css:113` | `#ffe7d9` / same | — |
| `--purple-50` | `184 51 225` (`:67`) | `v-primitive.css:161` | `#efe5fe` / same | — |
| `--red-50` | `255 79 94` (`:75`) | `v-primitive.css:65` | `#ffd9d9` / same | `:341` `--popup-icon-x-ink: rgb(var(--red-50))` (dark) |
| `--yellow-50` | `255 164 54` (`:93`) | `v-primitive.css:137` | `#fff6d9` / same | — |
| `--gray-25` | `58 58 72` (`:108`) | `v-primitive.css:218` / `:245` | `#fcfcfc` / `#101010` | — |
| `--gray-50` | `118 118 133` (`:113`) | `v-primitive.css:219` / `:246` | `#f9f9f9` / `#131313` | `:324` `--border-4: rgb(var(--gray-50))` (dark) |
| `--gray-75` | `184 184 192` (`:118`) | `v-primitive.css:220` / `:247` | `#f3f3f3` / `#161616` | `:225` `--border-1: rgb(var(--gray-75))` (light) |

Why they must **not** be redefined with library semantics:

1. **Format.** Legacy palette values are space-separated `R G B` triplets
   consumed as `rgb(var(--x))` or `rgb(var(--x) / a)`. A library value is a hex
   colour; `rgb(#f3f3f3)` is invalid, so every consumer becomes
   invalid-at-computed-value-time and silently falls back to the inherited or
   initial value (e.g. a border becomes `currentColor`).
2. **Meaning.** Legacy `--gray-N` is a fixed lightness (`N` = HSLuv L, gray-5
   darkest … gray-95 lightest, identical in both themes, `default.css:99-122`).
   Library `--gray-N` is a theme-relative step that **inverts** in dark mode
   (`v-primitive.css:216-269`: light `--gray-75 #f3f3f3`, dark `#161616`).
   Legacy `--gray-75` (rgb 184 184 192) is unrelated to either. The hue scales
   differ the same way (legacy `--red-50` rgb 255 79 94 vs library `#ffd9d9`).
3. **Order dependence.** If both definitions were ever present in one document
   (library CSS linked into a classic page, or library primitives pasted into
   the generated file), whichever comes later would silently break the other
   side's consumers.

Rule (DECISION, checked by C3/C5): the generated file defines these 9 names
with their upstream triplets, never declares any other library primitive name,
and uses library values only as **literals**.

Near miss outside default.css (informative): `--button-font-size` is defined
by `common.css:40` and also, element-scoped, by the library's
`components/Button/Button.module.css`. No conflict while library CSS never
loads in classic pages.

---

## 4. Mapping: legacy variable -> library token -> literal

### 4.1 Rules for building the values

- Library values are resolved to **literals** (the generated file contains no
  library variable names). `color-mix(in oklab, C p%, transparent)` (how the
  library defines every `--alpha-*` and `--<hue>-aNN`) is written as
  `rgb(R G B / p%)`; the two are identical (premultiplied interpolation with a
  fully transparent colour keeps the colour and sets alpha = p).
- Light literals come from the `:where(:root), :where([data-theme="light"])`
  blocks (`v-primitive.css:216`, `v-semantic.css:486`, `v-components.css:187`)
  plus the theme-independent blocks (`:where([data-theme])` at
  `v-primitive.css:3`, `v-semantic.css:56`, `v-components.css:3`; `@theme static`
  at `v-semantic.css:4-52`; `:root, :where([data-theme])` at
  `v-primitive.css:279`); dark literals from the same theme-independent blocks
  overridden by `:where([data-theme="dark"])` (`v-primitive.css:243`,
  `v-semantic.css:573`, `v-components.css:214`). The `@media (resolution …)`
  hairline blocks are ignored (no table row uses them).
  Every literal in 4.2 was checked by a script that resolves the library files
  (section 9); source lines are in Appendix A.
- `*-rgb` variables (and every name whose upstream value is a triplet) stay
  triplets.
- Upstream structure is kept where a variable is defined by reference
  (`--checkbox-checked-ink: var(--accent-surface-1)` etc.): those are "kept from
  upstream" and follow the remapped variable automatically.
- Sizes, opacities, filters and spacing are kept (layout must not change).
- UNUSED/INTERNAL variables that have no obvious library counterpart are kept
  verbatim (skipping them is allowed; they must still be defined,
  C3). INTERNAL ones that feed a remapped variable no longer matter because the
  consumer now holds a literal.

### 4.2 Table

Column "Emit in `:root`" is the exact value to write in the top-level `:root`
block. Column "Emit in both dark blocks" is the exact value to write in
**both** `@media (prefers-color-scheme: dark) { :root:not(.light) { … } }` and
`:root.dark { … }`; `—` means no dark override. "Upstream status" is from
section 2 (the CodeMirror block in 4.4 gives several UNUSED `--cm-*` names new
consumers).

The 113 raw palette names are not repeated in the table: emit each with its
upstream value verbatim (whitespace inside the triplet may be normalised to
single spaces), in the top-level `:root` block only, no dark override:

`--blue-5` `--blue-10` `--blue-20` `--blue-30` `--blue-40` `--blue-50` `--blue-60` `--blue-70` `--blue-80` `--blue-90` `--dark-gray-10` `--dark-gray-20` `--dark-gray-30` `--dark-gray-40` `--dark-gray-50` `--dark-gray-60` `--dark-gray-70` `--dark-gray-80` `--dark-gray-90` `--green-30` `--green-40` `--green-50` `--green-60` `--green-65` `--green-70` `--green-80` `--ink-10` `--ink-80` `--light-gray-10` `--light-gray-20` `--light-gray-30` `--light-gray-40` `--light-gray-50` `--light-gray-60` `--light-gray-70` `--light-gray-80` `--light-gray-90` `--orange-5` `--orange-10` `--orange-20` `--orange-30` `--orange-40` `--orange-50` `--orange-60` `--orange-70` `--orange-80` `--orange-90` `--purple-5` `--purple-10` `--purple-20` `--purple-30` `--purple-40` `--purple-50` `--purple-60` `--purple-70` `--purple-80` `--purple-90` `--red-20` `--red-30` `--red-40` `--red-50` `--red-60` `--red-70` `--violet-5` `--violet-10` `--violet-20` `--violet-30` `--violet-40` `--violet-50` `--violet-60` `--violet-70` `--violet-80` `--violet-90` `--yellow-5` `--yellow-10` `--yellow-20` `--yellow-30` `--yellow-40` `--yellow-50` `--yellow-60` `--yellow-70` `--yellow-80` `--yellow-90` `--gray-5` `--gray-10` `--gray-15` `--gray-20` `--gray-25` `--gray-30` `--gray-35` `--gray-40` `--gray-45` `--gray-50` `--gray-55` `--gray-60` `--gray-65` `--gray-70` `--gray-75` `--gray-80` `--gray-85` `--gray-90` `--gray-95` `--primary-5` `--primary-10` `--primary-20` `--primary-30` `--primary-40` `--primary-50` `--primary-60` `--primary-70` `--primary-80` `--primary-90` `--primary-95`

(their values are at `default.css:15-97` (hue palettes, including `--ink-10`
`:41` and `--ink-80` `:42`), `:104-122` (gray) and `:151-161` (primary), and in
Table A.)

| Name | Status | Library token (source of the literal) | Emit in `:root` (light) | Emit in both dark blocks | Note |
|---|---|---|---|---|---|
| `--font-size` | USED | kept from upstream | `14px` | — |  |
| `--font-size-smaller` | USED | kept from upstream | `calc(var(--font-size) - 1px)` | — |  |
| `--font-size-xsmall` | UNUSED | kept from upstream | `calc(var(--font-size) - 3px)` | — |  |
| `--font-size-larger` | UNUSED | kept from upstream | `15px` | — |  |
| `--font-family` | USED | --font-sans | `ui-sans-serif, -apple-system, system-ui, "Segoe UI", "Noto Sans", "Helvetica", "Arial", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif` | — | Inter webfont replaced by the library system stack |
| `--monospace-size` | USED | kept from upstream | `12px` | — |  |
| `--surface-0-rgb` | INTERNAL | --gray-0 (triplet) | `255 255 255` | `13 13 13` | stays a triplet |
| `--surface-1` | USED | --color-surface | `#ffffff` | `#212121` | page background |
| `--surface-2` | USED | --color-background-primary-soft | `#ededed` | `#303030` |  |
| `--surface-3` | USED | --color-background-primary-soft-active | `#cdcdcd` | `#414141` |  |
| `--ubo-red` | UNUSED | kept from upstream | `#800000` | — |  |
| `--elevation-up-surface` | USED | --alpha-base | `#0d0d0d` | `#ffffff` |  |
| `--elevation-up1-opacity` | USED | kept from upstream | `4%` | `12%` |  |
| `--elevation-up2-opacity` | USED | kept from upstream | `8%` | `24%` |  |
| `--elevation-down-surface` | USED | --color-text-inverse | `#ffffff` | `#0d0d0d` |  |
| `--elevation-down1-opacity` | USED | kept from upstream | `16%` | — |  |
| `--elevation-down2-opacity` | UNUSED | kept from upstream | `32%` | — |  |
| `--ink-rgb` | INTERNAL | --color-text (triplet) | `13 13 13` | `255 255 255` | stays a triplet |
| `--ink-0` | INTERNAL | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--ink-100` | UNUSED | --color-text-inverse | `#ffffff` | `#0d0d0d` |  |
| `--border-1` | USED | --color-border | `rgb(13 13 13 / 10%)` | `rgb(255 255 255 / 12%)` |  |
| `--border-2` | USED | --color-border-strong | `rgb(13 13 13 / 15%)` | `rgb(255 255 255 / 20%)` |  |
| `--border-3` | UNUSED | --color-border-primary-outline | `rgb(13 13 13 / 16%)` | `rgb(255 255 255 / 25%)` |  |
| `--border-4` | UNUSED | --color-border-primary-outline-hover | `rgb(13 13 13 / 20%)` | `rgb(255 255 255 / 30%)` |  |
| `--accent-ink-3` | UNUSED | kept from upstream | `var(--ink-1)` | — |  |
| `--accent-surface-1` | USED | --blue-300 (light: --blue-500) | `#0169cc` | `#339cff` | = `--blocker-accent` (`blocker-tokens.css:57,83,106`), see 4.3 |
| `--link-ink` | USED | --link-primary-text-color | `#0169cc` | `#339cff` |  |
| `--link-hover-ink` | USED | --color-text-info (light: --link-primary-text-color-hover) | `#013566` | `#66b5ff` | dark: contrast fix (4.3) |
| `--button-surface-rgb` | INTERNAL | --color-background-secondary-soft (triplet) | `237 237 237` | `48 48 48` |  |
| `--dashboard-tab-active-ink-rgb` | INTERNAL | --color-text (triplet) | `13 13 13` | `255 255 255` |  |
| `--dashboard-tab-focus-surface-rgb` | INTERNAL | --color-background-primary-soft (triplet) | `237 237 237` | `48 48 48` |  |
| `--dashboard-highlight-surface-rgb` | UNUSED | --color-background-primary-soft (triplet) | `237 237 237` | `48 48 48` |  |
| `--dashboard-happy-green` | UNUSED | --color-text-success | `#00692a` | `#04b84c` |  |
| `--popup-cell-cname-ink` | UNUSED | kept from upstream | `#0054d7` | `#93a6ff` |  |
| `--popup-cell-label-mixed-surface` | UNUSED | kept from upstream | `#c29100` | `hsla(45, 100%, 38%, 1)` |  |
| `--popup-icon-x-ink` | UNUSED | kept from upstream | `rgb(var(--red-60))` | `rgb(var(--red-50))` |  |
| `--popup-power-ink-rgb` | INTERNAL | --color-text (triplet) | `13 13 13` | `255 255 255` |  |
| `--hr-ink` | UNUSED | kept from upstream | `var(--surface-2)` | — |  |
| `--cloud-total-used-surface` | UNUSED | --purple-a75 | `rgb(146 79 247 / 28%)` | — |  |
| `--cloud-used-surface` | UNUSED | --color-background-discovery-solid | `#924ff7` | — |  |
| `--error-surface` | UNUSED | --color-background-danger-solid | `#e02e2a` | — |  |
| `--cm-active-line` | UNUSED | --color-background-primary-outline-active (light: --color-background-primary-outline-hover) | `rgb(13 13 13 / 2%)` | `rgb(255 255 255 / 6%)` | translucent on purpose; light: contrast fix (4.3) |
| `--cm-cursor` | UNUSED | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--cm-foldmarker-ink` | UNUSED | --color-text-info | `#0169cc` | `#66b5ff` |  |
| `--cm-gutter-border` | UNUSED | --color-border-subtle | `rgb(13 13 13 / 5%)` | `rgb(255 255 255 / 6%)` |  |
| `--cm-gutter-ink` | UNUSED | --color-text-secondary | `#5d5d5d` | `#afafaf` |  |
| `--cm-gutter-surface` | UNUSED | --color-surface-secondary | `#f9f9f9` | `#181818` |  |
| `--cm-matchingbracket` | UNUSED | --color-background-success-soft-alpha-hover | `rgb(4 184 76 / 29%)` | — |  |
| `--cm-merge-copy-ink` | UNUSED | --color-text-info | `#0169cc` | `#66b5ff` |  |
| `--cm-merge-chunk-border` | UNUSED | kept from upstream | `rgb(var(--surface-0-rgb) / 40%)` | — |  |
| `--cm-merge-chunk-surface` | UNUSED | kept from upstream | `rgb(var(--surface-0-rgb) / 40%)` | — |  |
| `--cm-negative` | USED | --color-text-danger-soft | `#ba2623` | `#fa423e` |  |
| `--cm-positive` | INTERNAL | --color-text-success | `#00692a` | `#04b84c` |  |
| `--cm-selection-surface` | UNUSED | --color-background-primary-soft-alpha-active | `rgb(13 13 13 / 16%)` | `rgb(255 255 255 / 20%)` |  |
| `--cm-selection-focused-surface` | UNUSED | --color-background-info-soft-alpha-hover | `rgb(2 133 255 / 25%)` | — |  |
| `--cm-searching-ink` | UNUSED | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--cm-searching-surface` | UNUSED | --yellow-a200 | `rgb(255 195 0 / 59%)` | — |  |
| `--cm-search-match-surface` | UNUSED | --color-background-caution-soft-alpha-hover | `rgb(255 195 0 / 27%)` | — |  |
| `--sf-comment-ink` | USED | --color-text-secondary | `#5d5d5d` | `#afafaf` |  |
| `--sf-def-ink` | USED | --codeblock-syntax-1 (light: --orange-600) | `#b9480d` | `#ffe48c` |  |
| `--sf-directive-ink` | USED | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--sf-error-ink` | UNUSED | --color-text-danger-soft | `#ba2623` | `#fa423e` |  |
| `--sf-error-surface` | UNUSED | --color-background-danger-soft-alpha | `rgb(250 66 62 / 16%)` | — |  |
| `--sf-keyword-ink` | USED | --codeblock-syntax-2 | `#0169cc` | `#66b5ff` |  |
| `--sf-notice-ink` | USED | --color-text-tertiary | `#8f8f8f` | — |  |
| `--sf-readonly-ink` | UNUSED | --color-text-secondary | `#5d5d5d` | `#afafaf` |  |
| `--sf-tag-ink` | USED | --codeblock-syntax-4 (light: --pink-600) | `#ba437a` | `#e04c91` |  |
| `--sf-unicode-ink` | USED | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--sf-value-ink` | USED | --codeblock-syntax-3 | `#008635` | `#40c977` |  |
| `--sf-variable-ink` | USED | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--sf-warning-ink` | UNUSED | --color-text-caution | `#916f00` | `#e0ac00` |  |
| `--sf-warning-surface` | UNUSED | --color-background-caution-soft-alpha | `rgb(255 195 0 / 15%)` | — |  |
| `--df-allow-ink` | UNUSED | kept from upstream | `var(--cm-positive)` | — |  |
| `--df-block-ink` | UNUSED | kept from upstream | `var(--cm-negative)` | — |  |
| `--df-noop-ink` | UNUSED | --color-text-secondary | `#5d5d5d` | `#afafaf` |  |
| `--logger-modified-surface` | UNUSED | kept from upstream | `#0000c010` | `#663efd60` |  |
| `--logger-modified-em-surface` | UNUSED | kept from upstream | `#0000c028` | — |  |
| `--logger-redirected-surface` | UNUSED | kept from upstream | `rgb(var(--yellow-5) / 50%)` | `rgb(var(--yellow-5) / 40%)` |  |
| `--logger-scriptlet-surface` | UNUSED | kept from upstream | `rgb(var(--yellow-30) / 50%)` | `rgb(var(--yellow-30) / 40%)` |  |
| `--high-em` | INTERNAL | kept from upstream | `87%` | — |  |
| `--medium-em` | INTERNAL | kept from upstream | `60%` | — |  |
| `--low-em` | INTERNAL | kept from upstream | `38%` | — |  |
| `--surface-0` | USED | --gray-0 (light: --color-surface-secondary) | `#f9f9f9` | `#0d0d0d` | field/hover surface; light differs from the white page (4.3) |
| `--ink-1` | USED | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--ink-2` | USED | --color-text @ 87% (no library token) | `rgb(13 13 13 / 87%)` | `rgb(255 255 255 / 87%)` |  |
| `--ink-3` | USED | --color-text-secondary | `#5d5d5d` | `#afafaf` | solid, was 60% alpha |
| `--ink-4` | USED | --color-text-tertiary | `#8f8f8f` | — | solid, was 38% alpha |
| `--accent-ink-1` | USED | --color-text-inverse (upstream: var(--surface-0)) | `#ffffff` | `#0d0d0d` | = `--blocker-accent-on-solid` (4.3) |
| `--subtil-ink` | USED | kept from upstream | `var(--accent-surface-1)` | — |  |
| `--fieldset-header-surface` | UNUSED | kept from upstream | `transparent` | — |  |
| `--fieldset-header-ink` | USED | kept from upstream | `var(--ink-2)` | — |  |
| `--native-control-opacity` | USED | kept from upstream | `0` | — |  |
| `--button-ink` | USED | --color-text | `#0d0d0d` | `#ffffff` |  |
| `--button-surface` | USED | --color-background-secondary-soft | `#ededed` | `#303030` |  |
| `--button-border-size` | USED | kept from upstream | `0` | — |  |
| `--button-border-radius` | USED | --radius-full | `9999px` | — | library Button default is pill |
| `--button-preferred-ink` | USED | --color-text-primary-solid | `#ffffff` | `#0d0d0d` |  |
| `--button-preferred-surface` | USED | --color-background-primary-solid | `#181818` | `#f3f3f3` |  |
| `--button-disabled-surface` | USED | kept from upstream | `var(--surface-3)` | — |  |
| `--button-disabled-filter` | USED | kept from upstream | `opacity(50%)` | — |  |
| `--checkbox-size` | USED | kept from upstream | `calc(var(--font-size) + 2px)` | — |  |
| `--checkbox-ink` | USED | --color-text-secondary | `#5d5d5d` | `#afafaf` |  |
| `--checkbox-checked-ink` | USED | kept from upstream | `var(--accent-surface-1)` | — |  |
| `--checkbox-disabled-filter` | USED | kept from upstream | `opacity(50%)` | — |  |
| `--checkbox-margin-end` | USED | kept from upstream | `calc(var(--font-size) * 0.75)` | — |  |
| `--notice-ink` | USED | kept from upstream | `var(--accent-ink-1)` | — |  |
| `--notice-surface` | USED | kept from upstream | `var(--accent-surface-1)` | — |  |
| `--notice-surface-shadow` | USED | --shadow-300 | `0 4px 8px -2px rgb(0 0 0 / 0.1)` | `0 4px 8px -2px rgb(0 0 0 / 0.36)` |  |
| `--dashboard-tab-ink` | USED | --color-text-secondary | `#5d5d5d` | `#afafaf` |  |
| `--dashboard-tab-active-ink` | USED | kept from upstream | `rgb(var(--dashboard-tab-active-ink-rgb))` | — |  |
| `--dashboard-tab-active-surface` | USED | kept from upstream | `transparent` | — |  |
| `--dashboard-tab-focus-surface` | UNUSED | kept from upstream | `rgb(var(--dashboard-tab-focus-surface-rgb))` | — |  |
| `--dashboard-tab-hover-surface` | USED | kept from upstream | `var(--surface-2)` | — |  |
| `--dashboard-tab-hover-border` | USED | kept from upstream | `var(--surface-3)` | — |  |
| `--info0-ink-rgb` | INTERNAL | --color-text-secondary (triplet) | `93 93 93` | `175 175 175` |  |
| `--info1-ink-rgb` | INTERNAL | --color-text-info (triplet) | `1 105 204` | `102 181 255` |  |
| `--info2-ink-rgb` | INTERNAL | --color-text-warning-soft (triplet) | `146 59 15` | `251 106 34` |  |
| `--info3-ink-rgb` | INTERNAL | --color-text-danger-soft (dark: --red-200) (triplet) | `186 38 35` | `255 133 131` | follows `--info3-ink` (4.3) |
| `--info0-ink` | USED | --color-text-secondary | `#5d5d5d` | `#afafaf` |  |
| `--info1-ink` | USED | --color-text-info | `#0169cc` | `#66b5ff` |  |
| `--info2-ink` | USED | --color-text-warning-soft | `#923b0f` | `#fb6a22` |  |
| `--info3-ink` | USED | --color-text-danger-soft (dark: --red-200) | `#ba2623` | `#ff8583` | dark: contrast fix on the Develop summary band (4.3) |
| `--popup-cell-surface` | UNUSED | kept from upstream | `var(--surface-2)` | — |  |
| `--popup-cell-label-filter` | UNUSED | kept from upstream | `opacity(40%)` | — |  |
| `--popup-cell-allow-own-surface` | UNUSED | kept from upstream | `rgb(var(--popup-cell-allow-own-surface-rgb))` | — |  |
| `--popup-cell-allow-surface` | UNUSED | kept from upstream | `rgb(var(--popup-cell-allow-surface-rgb))` | — |  |
| `--popup-cell-noop-own-surface` | UNUSED | kept from upstream | `rgb(var(--popup-cell-noop-own-surface-rgb))` | — |  |
| `--popup-cell-noop-surface` | UNUSED | kept from upstream | `rgb(var(--popup-cell-noop-surface-rgb))` | — |  |
| `--popup-cell-block-own-surface` | UNUSED | kept from upstream | `rgb(var(--popup-cell-block-own-surface-rgb))` | — |  |
| `--popup-cell-block-surface` | UNUSED | kept from upstream | `rgb(var(--popup-cell-block-surface-rgb))` | — |  |
| `--popup-power-ink` | UNUSED | kept from upstream | `rgb(var(--popup-power-ink-rgb))` | — |  |
| `--popup-toolbar-surface` | USED | --color-background-primary-soft-alpha | `rgb(13 13 13 / 8%)` | `rgb(255 255 255 / 12%)` |  |
| `--popup-toolbar-surface-hover` | USED | --color-background-primary-soft-alpha-hover | `rgb(13 13 13 / 12%)` | `rgb(255 255 255 / 16%)` |  |
| `--popup-ruleset-tool-ink` | UNUSED | kept from upstream | `var(--ink-1)` | — |  |
| `--popup-ruleset-tool-surface` | UNUSED | --color-background-primary-soft-alpha | `rgb(13 13 13 / 8%)` | `rgb(255 255 255 / 12%)` |  |
| `--popup-ruleset-tool-surface-hover` | UNUSED | --color-background-primary-soft-alpha-hover | `rgb(13 13 13 / 12%)` | `rgb(255 255 255 / 16%)` |  |
| `--popup-ruleset-tool-shadow` | UNUSED | kept from upstream | `transparent` | — |  |
| `--popup-cell-allow-own-surface-rgb` | INTERNAL | kept from upstream | `0 127   0` | `0 153   0` |  |
| `--popup-cell-allow-surface-rgb` | INTERNAL | kept from upstream | `129 202 129` | `73 117  73` |  |
| `--popup-cell-block-own-surface-rgb` | INTERNAL | kept from upstream | `216   0   0` | `255  40  40` |  |
| `--popup-cell-block-surface-rgb` | INTERNAL | kept from upstream | `224 172 172` | `175  74  74` |  |
| `--popup-cell-noop-own-surface-rgb` | INTERNAL | kept from upstream | `107 107 107` | `132 132 132` |  |
| `--popup-cell-noop-surface-rgb` | INTERNAL | kept from upstream | `185 185 185` | `94  94  94` |  |

### 4.3 Choices worth knowing (DECISION, with reasons)

- **Surfaces.** `--surface-1` (page background, `common.css:45`) =
  `--color-surface`, so an embedded classic pane matches the React shell
  (`bg-surface`). `--surface-0` is the "extreme" surface (editor background
  `develop.css:32`, focused inputs `settings.css:329,387`, hover
  `settings.css:364`, selected filtering-mode card `settings.css:72`, and, before the
  review fixes, ink on accent via `--accent-ink-1`):
  light `--color-surface-secondary` `#f9f9f9`, dark `--gray-0` `#0d0d0d`.
  REVISED (after review): the first version used `--gray-0`
  in both schemes, so in light mode `--surface-0` == `--surface-1` (`#ffffff`)
  and every field/hover surface vanished on the white page (Custom filters
  hostname bar and selector-row hover, contenteditable and import-textarea
  focus, Develop editor edge). Light `--surface-0` is now a library grey that
  differs from the page; dark keeps the darker-than-page `#0d0d0d`.
  The Develop editor keeps the extreme surface (`#ffffff` / `#0d0d0d`, so the
  syntax colours keep their contrast): B7 paints `.cm-container .cm-editor`
  with `rgb(var(--surface-0-rgb))` (`--surface-0-rgb` is still `--gray-0`)
  and gives it a 1px `--border-1` edge (4.4). The Settings-pane hover tint
  `settings.css:69` (`color-mix(... var(--surface-1) 75%, var(--surface-0) 25%)`)
  stays nearly invisible in light mode; that pane is replaced by the new UI.
- **Ink.** `--ink-1` = `--color-text`; `--ink-3`/`--ink-4` become the solid
  `--color-text-secondary`/`--color-text-tertiary` instead of 60%/38% alpha;
  `--ink-2` keeps upstream's 87% alpha of `--color-text` (no library token).
- **Accent.** The library has no brand accent (its checked Checkbox is
  `--gray-900`, `components/Checkbox/Checkbox.module.css:56-58`). Blocker
  defines one in `ui/src/styles/blocker-tokens.css`:
  `--blocker-accent` = `--blocker-level-1` = `--blue-500` `#0169cc` (light,
  `:57`) / `--blue-300` `#339cff` (dark, `:83`), alias at `:106`, ink on it
  `--blocker-accent-on-solid` = `#ffffff` / `#0d0d0d` (`:58`, `:84`, `:107`).
  As this spec required, `--accent-surface-1` uses the same literals
  (`#0169cc` / `#339cff`; an earlier draft used `--gray-900` `#181818` /
  `#ededed`). `--accent-ink-1` = `--color-text-inverse` (`#ffffff` /
  `#0d0d0d`, a literal since the review fixes; upstream defined it as
  `var(--surface-0)`, which is no longer white in light mode) equals
  `--blocker-accent-on-solid`: 5.39:1 light, 6.79:1 dark.
  Consumers that follow automatically: `--subtil-ink`, `--checkbox-checked-ink`,
  `--notice-surface` (kept references), so legacy checkboxes, the selected
  filtering-mode card, picker/unpicker selection highlights
  (`picker-ui.css:105-106,140-141`, `unpicker-ui.css:46-47`) and the
  strict-block icon (`strictblock.css:57-58`) are blue, like upstream.
  As text: `#0169cc` on `#ffffff` 5.39, `#339cff` on `#212121` 5.63.
  Preferred buttons are **not** accent-coloured: they use
  `--color-background-primary-solid` (`#181818` / `#f3f3f3`) with
  `--color-text-primary-solid` (= text-inverse), like the library's primary
  Button. If `blocker-tokens.css` changes its accent, update this row and
  4.2 together.
- **Buttons** become pills (`--button-border-radius: 9999px`): the library
  Button defaults to `pill = true` (`components/Button/Button.js`, default
  props). Heights are not changed (`common.css:91` `min-height: 36px`).
- **Contrast fixes** (ARCHITECTURE 6.10, >= 4.5:1 for text): measured against the
  editor background (`#ffffff` light, `#0d0d0d` dark).

  | Variable | Library token value | Ratio | Used instead | Ratio |
  |---|---|---|---|---|
  | `--sf-def-ink` light | `--codeblock-syntax-1` `#c0660d` | 4.08 | `--orange-600` `#b9480d` | 5.26 |
  | `--sf-tag-ink` light | `--codeblock-syntax-4` `#e04c91` | 3.74 | `--pink-600` `#ba437a` | 5.03 |
  | `--sf-comment-ink` | CodeBlock comment `color-mix(--color-text 50%)` | ~3.6 | `--color-text-secondary` | 6.58 / 8.86 |
  | `--info3-ink` dark (on `#212121`) | `--color-text-danger` `#e02e2a` | 3.52 | `--color-text-danger-soft` `#fa423e` | 4.53 |
  | `--info2-ink` dark (on `#212121`) | `--color-text-warning` `#e25507` | 4.25 | `--color-text-warning-soft` `#fb6a22` | 5.51 |
  | `--link-hover-ink` dark (on `#212121`, `common.css:60-63` `a:hover`) | `--link-primary-text-color-hover` `#0285ff` | 4.45 | `--color-text-info` `#66b5ff` | 7.38 |
  | `--info3-ink` dark on the Develop summary band (`develop.css:97-98,148-150`: 15% `--info1-ink` over `#212121`) | `--color-text-danger-soft` `#fa423e` | 3.41 | `--red-200` `#ff8583` | 5.15 (6.85 on `#212121`, 5.26 on the feedback band) |
  | `--cm-active-line` light under `develop.css:47-63` syntax colours and `--sf-value-ink` | `--color-background-primary-outline-active` 4% | 4.33-4.48 | `--color-background-primary-outline-hover` 2% | 4.52-4.68 |

  The two last rows were added after review; the unit
  test checks the band composites, not only flat backgrounds.

  The dark link-hover fix also restores upstream's direction (upstream dark
  hover `#b3c6fa` is lighter than dark link `#89aaf7`). Links in light mode:
  `#0169cc` 5.39, hover `#013566` 12.34 on `#ffffff`; dark link `#339cff` 5.63
  on `#212121`.

  Remaining syntax colours: `#0169cc` 5.39, `#008635` 4.71 (light);
  `#ffe48c` 15.48, `#66b5ff` 8.90, `#40c977` 9.11, `#e04c91` 5.19 (dark).
  Hard-coded Develop-pane colours (`develop.css:48-63`) stay as they are:
  4.86-4.87 on `#ffffff`, 6.81-6.83 on `#0d0d0d`.
- **Fonts.** `--font-family` (used by `common.css:50` body and
  `dashboard.css:23` tabs) = the library `--font-sans` stack (system font, no
  webfont). The `@font-face` rules in `common.css:3-26` (Inter `:3-14`,
  Metropolis `:15-26`) remain but are no longer used, so the font files are
  not loaded (Metropolis files do not exist in PRISTINE `css/fonts/`; its
  only users are the dead `:root.hidpi` rules `common.css:372-379`). There is
  **no** monospace variable: monospace is hard-coded (`common.css:66`,
  `matched-rules.css:5`, `picker-ui.css:78`, `unpicker-ui.css:31`, CodeMirror
  `cm6:12465`) and is not changed by this spec; the Develop search panel uses
  a hard-coded `font-family: sans-serif` (`develop.css:77`). `--font-size` stays 14px (= library `--font-text-sm-size`),
  `--monospace-size` 12px, `:root.mobile` overrides kept.

### 4.4 CodeMirror chrome block (part of the generated file)

Purpose: replace the light base theme / One Dark chrome colours with library
colours through the legacy `--cm-*` variables. Every selector is prefixed with
`:root` so its specificity is strictly higher than the CodeMirror rule it
overrides (they would already win ties, 1.5). Only colours, borders and
outlines are set, plus one 2px editor margin (below). Emit exactly:

```css
:root .cm-editor .cm-gutters {
    background-color: var(--cm-gutter-surface);
    border: 0;
    border-inline-end: 1px solid var(--cm-gutter-border);
    color: var(--cm-gutter-ink);
}
:root .cm-editor .cm-activeLineGutter,
:root .cm-editor .cm-activeLine {
    background-color: var(--cm-active-line);
}
:root .cm-editor .cm-selectionBackground {
    background: var(--cm-selection-surface);
}
:root .cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground {
    background: var(--cm-selection-focused-surface);
}
:root .cm-editor .cm-cursor,
:root .cm-editor .cm-dropCursor {
    border-left-color: var(--cm-cursor);
}
:root .cm-editor .cm-panels {
    background-color: var(--surface-1);
    color: var(--ink-1);
}
:root .cm-editor .cm-panels.cm-panels-top {
    border-bottom: 1px solid var(--border-1);
}
:root .cm-editor .cm-panels.cm-panels-bottom {
    border-top: 1px solid var(--border-1);
}
:root .cm-editor .cm-searchMatch {
    background-color: var(--cm-search-match-surface);
}
:root .cm-editor .cm-searchMatch.cm-searchMatch-selected {
    background-color: var(--cm-searching-surface);
}
:root .cm-editor.cm-focused .cm-matchingBracket {
    background-color: var(--cm-matchingbracket);
}
:root .cm-editor .cm-tooltip {
    background-color: var(--surface-1);
    border: 1px solid var(--border-1);
    color: var(--ink-1);
}
:root .cm-editor .cm-foldPlaceholder {
    color: var(--cm-foldmarker-ink);
}
:root .cm-container .cm-editor {
    background-color: rgb(var(--surface-0-rgb));
    margin: 2px;
    outline: 1px solid var(--border-1);
    outline-offset: 0;
}
:root .cm-container .cm-editor.cm-focused {
    outline: 2px solid var(--accent-surface-1);
    outline-offset: 0;
}
```

Added after review:
- Gutter separator is `border-inline-end` (after `border: 0`): in RTL the
  gutter sits on the right and the line must be on its text side, not on the
  outer edge. LTR is unchanged (right border).
- `.cm-container .cm-editor` (`develop.css:31-34` sets
  `background-color: var(--surface-0)`, 0,2,0 -> ours 0,3,0): the editor keeps
  `--gray-0` through `--surface-0-rgb` (4.3) and gets a 1px `--border-1`
  edge. It is an outline outside the editor box: CodeMirror's sticky gutter
  (z-index 200) would paint over an inset one, and `margin: 2px` (the only
  layout declaration in B7; the editor becomes 4px narrower and shorter) keeps
  the outline inside `section[data-pane="develop"] > div`, which clips with
  `overflow: hidden` (`develop.css:10-15`).
- Keyboard focus: CodeMirror's base theme draws `outline: 1px dotted #212121`
  on `.cm-editor.cm-focused` (0,2,0), invisible on the dark page (about
  1.1:1). Ours (0,4,0) is a 2px `--accent-surface-1` ring (5.39:1 on
  `#ffffff`, 6.79:1 on `#0d0d0d`, 5.63:1 on the `#212121` page), outside the
  box like the edge. The text area
  `.cm-content` is excluded from B8 so the ring is not drawn twice.

Specificity table (CodeMirror rule -> ours): gutters 0,2,0 -> 0,3,0;
active line / active-line gutter 0,2,0 -> 0,3,0; unfocused selection 0,2,0 ->
0,3,0; focused selection 0,5,0 -> 0,6,0; cursor 0,2,0 -> 0,3,0; panels 0,2,0 ->
0,3,0; panel borders (One Dark) 0,3,0 -> 0,4,0; search match 0,2,0 -> 0,3,0;
selected match (One Dark) 0,3,0 -> 0,4,0; matching bracket 0,3,0 -> 0,4,0;
tooltip 0,2,0 -> 0,3,0; fold placeholder 0,2,0 -> 0,3,0; editor surface
`develop.css:31` 0,2,0 -> 0,3,0; focused editor outline 0,2,0 -> 0,4,0.

Not covered (left to CodeMirror): `.cm-selectionMatch`, `.cm-nonmatchingBracket`,
autocomplete list selection, `.cm-specialChar`, `.cm-placeholder`. One Dark's
own highlight style (`cm6:25483-25521`) only colours standard tags; the
`sfp_*`/`ubol-*` classes are custom tags and are not affected by it.

Live-switch caveat: One Dark is chosen at editor creation (1.5). If the
classes on a running page change, the variables switch but CodeMirror's own
rules do not. The generated file never causes that (5, behaviour matrix); the
React dashboard does it on purpose for the embedded frame (6.4,
`dashboard-shell.md` R-26). Everything this block covers follows the class;
only the "Not covered" rules above keep the creation-time theme.

### 4.5 Keyboard focus block (B8, added by the review fixes)

Upstream removes focus outlines on several pages (`tool-overlay-ui.css:23-25`
`:root :focus { outline: none }` 0,2,0; `popup.css:37-39` `:focus { outline: 0 }`;
`dashboard.css:29-31` `nav > .tabButton:focus`) and draws checkboxes and
radios as an `svg` over a native input with `opacity: 0`
(`common.css:191-207,230-250`), so keyboard focus was invisible on the
picker buttons and slider, the classic popup and every legacy checkbox
(ARCHITECTURE 6.10 "visible focus"). Emit exactly:

```css
:root:root :focus-visible:not(.cm-content) {
    outline: 2px solid var(--accent-surface-1);
    outline-offset: 2px;
}
:root:root .checkbox:has(> input:focus-visible) > svg,
:root:root .radio:has(> input:focus-visible) > svg {
    outline: 2px solid var(--accent-surface-1);
    outline-offset: 2px;
}
```

- Specificity 0,4,0 and 0,5,0: above every upstream focus rule; only
  `outline`/`outline-offset` are set, so layout and the overlay frame
  transparency (L-5) do not change. `:focus-visible` keeps mouse clicks
  ring-free (text fields always match it, as in the library).
- Overlay frames: the content script focuses the frame window
  (`tool-overlay.js:342`), not an element, so nothing is ringed at start-up
  (L-16).
- Not fixed here (not CSS): the zapper and unpicker have no control reachable
  with Tab, and the unpicker ignores Escape (upstream behaviour).

---

## 5. The generated file

### 5.1 Structure (in this order)

```
/* comment: generated, do not edit (no URLs in comments) */
:root { <all 256 names, light values from 4.2 + palette> }                     (B1)
@media (prefers-color-scheme: dark) { :root:not(.light) { <dark overrides> } } (B2)
:root.dark { <the same dark overrides, same values> }                          (B3)
:root.mobile { --font-size: 16px; --font-size-smaller: 14px; --monospace-size: 13px; }  (B4, = default.css:138-142)
@media (prefers-contrast: more) { :root { --native-control-opacity: 1; --button-border-size: 1px; } }  (B5, = default.css:466-471)
<CodeMirror block, 4.4>                                                        (B7)
<keyboard focus block, 4.5>                                                    (B8)
<embedded layout block, 6.5>                                                   (B9)
<the two embed-marker rules of 6.2, verbatim, last in the file>                (B6)
```

B6 is placed **last** because `dashboard-shell.md` R-18 says the generated
file "must end with" those two rules. (Order does not change their effect:
both are `!important`.)

The prototype had 256 names in B1 and 82 overrides in B2/B3; since the
review fixes there are 83 (`--accent-ink-1` gained a dark value).

### 5.2 Dark keying (DECISION; differs from upstream on purpose)

Every variable that has a dark value is overridden in **both** B2 and B3 with
identical values. Specificities: B1 0,1,0; B2 `:root:not(.light)` 0,2,0; B3
`:root.dark` 0,2,0; B4 0,2,0; B5 0,1,0 (after B1, so it wins).

Behaviour matrix (verified in Chrome, section 9):

| Situation | Upstream | Generated |
|---|---|---|
| OS light, any time | light | light |
| OS dark, before `theme.js` runs (no class yet) | dark surfaces + light-theme ink (half state) | fully dark (B2) |
| OS dark, after `theme.js` (`.dark`) | dark | dark (B3; B2 also applies, same values) |
| Loaded light, OS switches to dark (`.light` stays) | stays light | stays light (`:not(.light)` blocks B2) |
| Loaded dark, OS switches to light (`.dark` stays) | stays dark | stays dark (B3) |

So after `theme.js` the page and CodeMirror always agree, as upstream; the only
change is the removed half-dark flash before `theme.js`.

`:root.mobile` (B4) only changes sizes. Dead variant blocks
(`:root.colorBlind…`, `:root.classic…`, `default.css:500-525`) are omitted;
their names are already defined in B1/B2/B3.

### 5.3 Constraints (K1-K8)

- **K1 Plain, self-contained CSS.** No `@import`, `@layer`, `@theme`, `@apply`,
  `@utility`, `@custom-variant`, `@tailwind`, `@source`, `@plugin`, `@config`,
  `@font-face`, `@charset`; the only at-rules are the two `@media` of 5.1. No
  library variable names, no `var()` fallbacks, no `!important` on custom
  properties.
- **K2 No background, no `color-scheme` on html/body/:root.** Overlay frames
  depend on `tool-overlay-ui.css:10-18` (1.6). The only non-custom-property
  declarations allowed are the two B6 rules (`display: none !important`),
  the B7 colour/border/outline declarations (and its editor margin), the B8 outlines and the two B9
  layout declarations (marker-scoped `align-items` on `body`, `width` on
  `body > *`).
- **K3 No `color-scheme` at all.** Upstream's `:root.dark { color-scheme: dark
  light; }` (`default.css:384-386`) is dropped: every page already declares
  `<meta name="color-scheme" content="light dark">` (1.2), which gives the same
  used scheme in both modes (the CSS rule only re-ordered the same two
  schemes). For overlay frames this also keeps the frame's scheme equal to the
  iframe element's `color-scheme: light dark !important`
  (`tool-overlay.js:53`). Chromium paints an opaque backdrop behind a frame
  whose used scheme differs from the embedder's; whether Safari does the same
  is **UNKNOWN**; not declaring `color-scheme` avoids the question.
- **K4 Dark keyed on both** `@media (prefers-color-scheme: dark)` (with
  `:not(.light)`) and `:root.dark`, identical values (5.2).
- **K5 `prefers-contrast: more`** handled exactly as upstream (B5). Effect
  (`common.css:83,196,207,246,254`): native checkboxes/radios shown, 1px button
  borders.
- **K6 Font variables**: `--font-family`, `--font-size`, `--font-size-smaller`,
  `--font-size-xsmall`, `--font-size-larger`, `--monospace-size` all defined
  (4.2) and the `:root.mobile` block kept.
- **K7 No remote anything**: no `url(` at all, no `http:`/`https:` substrings
  (also not in comments, so the stage gate can grep without parsing).
- **K8 Triplets stay triplets** (section 3 and every `*-rgb`).

---

## 6. Hiding the classic dashboard's header/nav and foreign panes when embedded

Ownership: this section owns the **CSS** (rules B6 in the generated file).
The parent-side sequence (creating the frame, setting the marker, choosing
and guarding the pane, revealing the frame) is owned by `dashboard-shell.md`
§5 (E-1 … E-12); 6.3 only restates what the CSS depends on. If the two specs
ever disagree on the marker name or the rules, that is a bug in both: fix
both together.

### 6.1 What is there

`dashboard.html:25-41` (`dashboard-classic.html` in STAGE):

```html
<header>
    <nav id="dashboard-nav"> logo + 5 .tabButton (settings, rulesets, filters, develop, about) </nav>
    <div data-pane-related="rulesets"> #commit-spinner, #listsOfBlockedHostsPrompt, #dnrError, #findInLists </div>
</header>
```

`dashboard.css:1-6` makes it `position: sticky; top: 0`. The `rulesets`
block is already hidden on other panes (`dashboard.css:50-52`). Panes are
`body > section[data-pane]` (`dashboard.html:43,116,130,150,168,201`:
settings, rulesets, filters, develop, about, busy), shown by
`body[data-pane]:not(.busy) > section[data-pane=…]` and
`body.busy[data-pane] > section[data-pane="busy"]` (`dashboard.css:64-71`,
specificity 0,3,2). The whole body starts `class="loading"`
(`dashboard.html:22`) and is `visibility: hidden` while it has that class
(`settings.css:14-16`); `settings.js:348` removes it only after
`getOptionsPageData` resolved with data (`settings.js:329-351`; if the
response is empty the class is never removed and the page stays blank).

### 6.2 The rules (in the generated file, B6)

Emit exactly these two rules (identical to `dashboard-shell.md` R-18), as the
last rules of the file:

```css
:root[data-blocker-embed] body > header {
    display: none !important;
}
:root[data-blocker-embed] body > section:is([data-pane="settings"], [data-pane="rulesets"], [data-pane="about"], [data-pane="busy"]) {
    display: none !important;
}
```

- Marker: attribute `data-blocker-embed` on the frame's `<html>`; presence
  activates it, the value is not tested (the shell sets
  `"classic-dashboard"`). The name is not used anywhere in PRISTINE `js/`,
  `css/` or `*.html` (grep), and upstream only toggles classes on `<html>`
  (`theme.js:31-39`), never attributes, so the marker survives.
- Rule 1, specificity 0,2,2: hides logo, nav (all five tab buttons, also
  removing them from the tab order) and the Filter-lists header block. No
  other shipped rule sets `display` on `header`.
- Rule 2, specificity 0,3,2 (`:is()` takes its most specific argument):
  hides Settings, Filter lists, About and busy even when `body[data-pane]`
  names them. It ties with `dashboard.css:64-69` (0,3,2), which is loaded
  later (`dashboard.html:11` vs `:8`), so **`!important` is required**, not
  just defensive. A `display: none` section never intersects, so its
  `onFirstShown`/IntersectionObserver initialisation never runs.
- `filters` and `develop` are deliberately not in the list. Their visibility
  still depends on upstream: `body[data-pane]` plus `:not(.busy)`
  (`dashboard.css:66-67`), and `body[data-forbid~="dashboard"]` hides
  `section[data-pane="filters"]` (`settings.css:32-39`). The Develop section
  does not depend on `body[data-develop]` (`dashboard.css:47-49` hides only
  the tab button).
- Without the marker (e.g. `dashboard-classic.html` opened top-level, or any
  other page that loads `css/default.css`) both rules match nothing.

### 6.3 What the CSS relies on from the parent (normative order is `dashboard-shell.md` E-11)

1. The `<iframe>` is laid out but invisible (`visibility: hidden` on the
   iframe element, not `display: none`) from creation until step 3, so the
   classic header never flashes.
2. In the iframe's `load` handler:
   `iframe.contentDocument.documentElement.setAttribute('data-blocker-embed', 'classic-dashboard')`.
   `css/default.css` is the render-blocking first stylesheet
   (`dashboard.html:8`), so B6 applies as soon as the attribute exists.
3. Reveal the iframe only after the frame `body` has lost the `loading`
   class (6.1): before that the frame paints nothing anyway.

Upstream facts that constrain pane selection (handled by the shell,
`dashboard-shell.md` E-3, E-5, E-6): `dashboard.js:52-55` reads
`browser.storage.local` key `dashboard.activePane` asynchronously and then
sets `document.body.dataset.pane`, which can overwrite a pane the parent set
earlier; `dashboard.js:42-50` writes/removes that key on tab clicks
(impossible while the nav is hidden). `localRead(key)` =
`browser.storage.local.get(key)` → `bin[key]`, errors swallowed
(`js/ext.js:59-67`).

### 6.4 Theme while embedded

The frame's `theme.js` runs once (1.3); the React shell's `theme-init.js`
follows live OS changes. Upstream, after an OS switch a page keeps its
load-time scheme (5.2) and CodeMirror keeps its theme (1.5).

**Embedded, the frame follows the shell live** (DECISION,
2026-10-04, closing review finding V4 of the legacy CSS; supersedes the earlier "upstream
parity" wording here and in `dashboard-shell.md` P-32). The parent, not this
file, does it (`dashboard-shell.md` R-26): on every shell theme change, at
setup and at `load`, it sets class `dark` xor `light` on the frame's `<html>`
exactly as `theme.js` would, plus an inline `color-scheme: dark|light` for
native controls. It never reloads or re-`src`s the frame (R-21: the frame
holds unsaved editor state). The generated file needs no change for this:
B3 (`:root.dark`) and the `:not(.light)` guard of B2 (5.2) already switch
every variable with the class, and B7 (4.4) routes CodeMirror's chrome
(gutter, active line, cursor, selection, panels, tooltip, editor surface)
through `--cm-*`/surface variables, so it follows too. Verified in Chrome
(`tests/e2e/classic-frame.theme.mjs`, light->dark and dark->light): after the
switch the frame body, ink, editor background and ink, gutter, active line,
bad-line background, `ubol-*` token inks and the native `<select>` equal a
frame loaded in the new scheme. Residual mixed state (accepted): the
CodeMirror rules B7 does not cover (4.4 "Not covered", plus One Dark's
search-match outline and fold-placeholder background) keep the theme the
editor was created with until the dashboard is reopened.

This applies only to the embedded frame. A top-level page that loads this
file (classic popup, report, overlays, the classic dashboard opened by URL)
still keeps its load-time scheme, as in the 5.2 matrix and L-7.

Layout note: `dashboard-common.css:1-9` limits `body > *` to
`min(640px, 100%)` wide, centred. Inside the React dashboard B9 (6.5) changes
that, only with the marker.

### 6.5 Embedded layout (B9, added by the review fixes)

Without it the classic column was centred and 640px wide while the React
panes start at the inline start with `max-w-3xl` (48rem,
`DashboardShell.tsx` `PANE_WIDTH`): revealing the frame moved the content
sideways and switching tabs made the column jump. Emit exactly:

```css
:root[data-blocker-embed] body {
    align-items: flex-start;
}
:root[data-blocker-embed] body > * {
    width: min(48rem, 100%);
}
```

- 0,2,1 beats `dashboard-common.css:1-9` (0,0,1 / 0,0,1). `align-items` on the
  column-flex body follows the writing direction, so RTL aligns to the right.
- Marker-scoped like B6: a top-level `dashboard-classic.html` and every other
  page keep the upstream centred column.
- The shell's warming skeleton (`ClassicFrame.tsx` `ClassicFrameSkeleton`)
  uses the same start-aligned `max-w-3xl` column (`dashboard-shell.md` E-9).

---

## 7. Acceptance checks and parity checklist

### 7.1 File checks (script-runnable on the generated file)

Inputs: the generated file `G` and upstream `src/css/themes/default.css` `U`.
Parse both with a CSS parser (postcss is present in `ui/node_modules`
as a transitive dependency; do not add a dependency).

| ID | Check |
|---|---|
| C1 | The only at-rules in `G` are `@media (prefers-color-scheme: dark)` and `@media (prefers-contrast: more)` (one each). |
| C2 | `G` contains no `url(` and no `http:`/`https:` (case-insensitive, raw text, comments included). |
| C3 | Every custom-property name declared anywhere in `U` (256) is declared in the **top-level** `:root` rule of `G`. |
| C4 | Every `var(--x)` in `G` names a property declared in `G`; no `var()` has a fallback. |
| C5 | 130 names resolve to an `R G B` triplet in `G`, in light (B1) and in dark (B1 + B3): the 125 names whose declared value in `U` is a literal triplet (113 palette names, `--surface-0-rgb`, `--info0..3-ink-rgb`, the six `--popup-cell-*-rgb`, `--popup-power-ink-rgb`) plus the 5 `*-rgb` names that `U` defines by reference to a triplet (`--ink-rgb`, `--button-surface-rgb`, `--dashboard-tab-active-ink-rgb`, `--dashboard-tab-focus-surface-rgb`, `--dashboard-highlight-surface-rgb`). |
| C6 | `G` has no `color-scheme` declaration; every non-custom-property declaration is either `display: none !important` in one of the two B6 rules (selectors exactly as in 6.2), a colour/border/background/outline declaration (or the one `margin` of 4.4) in a rule whose every selector starts with `:root ` and contains `.cm-editor` (B7), an `outline`/`outline-offset` declaration in a rule whose every selector starts with `:root:root ` and contains `:focus-visible` (B8), or `align-items` in `:root[data-blocker-embed] body` / `width` in `:root[data-blocker-embed] body > *` (B9); none of them `!important` except B6. |
| C7 | A `:root.dark` block exists; the set of (name, value) in it equals the set in `@media (prefers-color-scheme: dark) { :root:not(.light) }`. |
| C8 | B5 sets exactly `--native-control-opacity: 1` and `--button-border-size: 1px`; `:root.mobile` sets exactly `--font-size: 16px`, `--font-size-smaller: 14px`, `--monospace-size: 13px`. |
| C9 | Resolving every name in light (B1) and dark (B1 + B3) terminates (no cycle) and never hits an undefined name. |
| C10 | No custom property is `!important`. |
| C11 | Both B6 rules exist, each with exactly `display: none !important`, and they are the last two rules of `G`. |
| C12 | The 9 names of section 3 equal their upstream triplets (subset of C5, stated for clarity). |
| C13 | (Value check) For every row of 4.2, the declared light value (B1) and dark value (B3, `—` = not declared in B2/B3) equal the table; every palette name equals `U` with whitespace normalised; B2/B3 declare no name that has `—`. |
| C14 | (Verbatim check, added by the review fixes) The rules of B7, B8, B9 and B6 in `G` equal the css code blocks of 4.4, 4.5, 6.5 and 6.2 (selectors and declarations, whitespace normalised, same order). Order of the parts (5.1, including B7 < B8 < B9 < B6) is checked by the build as S1. |

Upstream `default.css` itself fails C1, C2, C3 (10 names: the four surface
names and the six `--popup-cell-*-rgb`), C6, C7 and C11, which is the
expected baseline.

### 7.2 Parity checklist (each line is a pass/fail test)

Browser lines use headless Chrome via `playwright-core` (ARCHITECTURE §3) over
a copy of PRISTINE with `G` as `css/default.css`, served from a local
`http://127.0.0.1:<random port>`; run each in a light and a dark
`colorScheme` context unless stated. Nothing in this list can be run in
Safari by the build; Safari lines are marked **[SAFARI, manual]**.

- [ ] L-1 C1-C13 pass.
- [ ] L-2 Every page of 1.2 loads `G` with no CSS parse warning and no console
  error that is absent with `U`.
- [ ] L-3 For all 256 names, `getComputedStyle(document.documentElement).getPropertyValue(n)`
  is non-empty on `dashboard.html` and `popup.html`.
- [ ] L-4 No colour-valued name is invalid at computed-value time: a probe
  `<span style="color: var(n)">` inside a parent with `color: rgb(1, 2, 3)`
  never computes to `rgb(1, 2, 3)`.
- [ ] L-5 `picker-ui.html`, `unpicker-ui.html`, `zapper-ui.html`: computed
  `background-color` of `html` and `body` is `rgba(0, 0, 0, 0)` in both
  schemes, and `getComputedStyle(html).colorScheme` is `normal`.
- [ ] L-6 `dashboard.html` light (after `theme.js`): `body` background
  `rgb(255, 255, 255)`, colour `rgb(13, 13, 13)`; dark: `rgb(33, 33, 33)` /
  `rgb(255, 255, 255)`.
- [ ] L-7 Behaviour matrix of 5.2, row by row: (a) with JavaScript disabled
  and OS dark, `body` background `rgb(33, 33, 33)` and colour
  `rgb(255, 255, 255)`; (b) loaded light, then `emulateMedia({colorScheme:'dark'})`:
  `body` stays `rgb(255, 255, 255)`; (c) loaded dark, then light: stays
  `rgb(33, 33, 33)`.
- [ ] L-8 `prefers-contrast: more` (emulated): `--button-border-size` is `1px`
  and `--native-control-opacity` is `1`; without it `0` and `0`.
- [ ] L-9 `dashboard.html` without the marker: `body > header` and
  `section[data-pane="settings"]` compute `display: block` (settings is the
  default pane). After `setAttribute('data-blocker-embed', 'classic-dashboard')`:
  `body > header` and all four of `section[data-pane="settings"|"rulesets"|"about"|"busy"]`
  compute `display: none`, also after setting `body.dataset.pane` to each of
  them; `body.dataset.pane = 'filters'` / `'develop'` makes that section
  `display: block`.
- [ ] L-10 No request is made for any font file (`css/fonts/**`) on any page
  of 1.2 (Inter is no longer referenced by `--font-family`).
- [ ] L-11 Develop editor (`dashboard.html`, Develop pane shown, editor
  created by upstream `develop.js`), light: `.cm-editor` background
  `rgb(255, 255, 255)`, `.cm-gutters` background `rgb(249, 249, 249)` and
  colour `rgb(93, 93, 93)`, `.cm-activeLine` background
  `rgba(13, 13, 13, 0.02)` (read with the caret on a line, before any
  selection; the active-line gutter equals it); dark: `.cm-editor` background
  `rgb(13, 13, 13)`, `.cm-gutters` `rgb(24, 24, 24)` / `rgb(175, 175, 175)`.
- [ ] L-12 With the editor focused and text selected, the focused selection
  background is `rgba(2, 133, 255, 0.25)` in both schemes.
- [ ] L-13 Pages never load library CSS and the React pages never load `G`
  (no `<link>` to `css/default.css` in our `popup.html`/`dashboard.html`;
  `G` contains no `@import`).
- [ ] L-14 **[SAFARI, manual]** Picker, unpicker and zapper overlays over a
  normal web page, light and dark OS: the page behind the overlay stays
  visible (no opaque backdrop). This settles the K3 UNKNOWN.
- [ ] L-15 **[SAFARI, manual]** Dashboard → Develop pane in dark OS: editor
  background matches `--surface-0` dark (`#0d0d0d`) and the gutter is
  `#181818`, i.e. B7 wins over One Dark in WebKit too.
- [ ] L-16 (added by the review fixes) Keyboard focus is visible: after Tab,
  a picker button, a report/strictblock checkbox (its `svg`) and a classic
  popup control draw a 2px `--accent-surface-1` outline in both schemes; the
  focused Develop editor draws a 2px `--accent-surface-1` outline; in the
  three overlay frames no element matches `:focus-visible` right after
  start-up.
- [ ] L-17 (added by the review fixes) Inside the React dashboard (harness
  shell + upstream frame + `G`), the Custom filters and Develop content start
  at the same inline position as the React Settings pane (within 4px) and
  are at most 48rem wide; in RTL they start at the right.

---

## 8. Not re-colourable through `css/default.css` (informative)

Hard-coded colours in files we do not touch (they keep upstream values):
`develop.css:47-63` (Develop syntax), `matched-rules.css:17,20,24`
(`lightgray` zebra rows in light, `#444` zebra rows under `html.dark` at
`:19-21`, `black` dotted border), `settings.css:223,345,357` (`red`, `red`, `gray`),
`unpicker-ui.css:53` (`red`), `zapper-ui.css:16` (`rgba(0,0,0,0.5)` border),
the `--ubol-overlay-*` highlight colours (1.6), and CodeMirror rules not in 4.4.
The CSS-in-JS from CodeMirror and the One Dark highlight style are runtime and
cannot be removed from CSS.

---

## 9. What was verified, and how

- Provenance and identity: `diff` of default.css, `diff -q` of every css/html
  file and of `theme.js`, `tool-overlay.js`, the CodeMirror bundle (1.1, 1.5).
- Inventory (section 2) and collisions (section 3): scripts over PRISTINE and
  the installed library (postcss parsing, comment stripping).
- Library literals (4.2): a script resolved every library token named in the
  table (light and dark blocks, `color-mix` with `transparent` -> `rgb(/ p%)`)
  and compared it with the table: all equal except the documented deliberate
  deviations (`--ink-2` derived alpha, light `--sf-def-ink`, light
  `--sf-tag-ink`, `--accent-ink-1` reference; after the audit also dark
  `--link-hover-ink` and `--accent-surface-1`, both encoded in the token
  column as `X (light: Y)`).
- Contrast numbers (4.3): WCAG 2 relative-luminance formula.
- A prototype `G` was generated from these tables and passed C1-C11 (C12/C13
  were added later; the audit's regeneration passes C1-C13, see Appendix B). It was
  rendered in headless Google Chrome (system Chrome via `playwright-core`) over
  a local copy of PRISTINE:
  - light: body `rgb(255,255,255)` / text `rgb(13,13,13)`, nav border
    `rgba(13,13,13,0.1)`, preferred button `rgb(24,24,24)` on
    `rgb(255,255,255)` radius 9999px, link `rgb(1,105,204)`; CodeMirror editor
    bg `#fff`, gutter `rgb(249,249,249)` / `rgb(93,93,93)`, active line
    `rgba(13,13,13,0.04)`, cursor `rgb(13,13,13)`.
  - dark: body `rgb(33,33,33)` / `rgb(255,255,255)`, editor bg `rgb(13,13,13)`,
    editor text `rgba(255,255,255,0.87)`, gutter `rgb(24,24,24)` /
    `rgb(175,175,175)`, cursor white (One Dark's `#528bff` overridden).
  - all 256 names non-empty, no colour variable invalid at computed-value time;
    picker overlay `html`/`body` transparent in both schemes; header
    `display: none` only with the marker (the prototype used the earlier
    marker name `data-blocker-embedded` and only the header rule; superseded
    by 6.2, re-verified by the audit below).
  - no JS: dark OS gives fully dark page (upstream: half state); light->dark
    live switch keeps light (same as upstream); `prefers-contrast: more` sets
    `--button-border-size: 1px`, `--native-control-opacity: 1`.

## 10. UNKNOWN / not verified

- Safari (WebKit) rendering was **not** tested; all rendering checks used
  Chrome. In particular UNKNOWN: whether Safari paints an opaque backdrop for
  an iframe whose used colour scheme differs from its embedder (K3 sidesteps
  it).
- That `cm6.bundle.ubol.js` is the exact source of the shipped `.min.js`
  (assumed; spot-checked by constants).
- CodeMirror UI states not rendered in the test (search panel, tooltips,
  autocomplete, fold placeholders, matching brackets): the selectors and
  specificities in 4.4 were derived from the source, not observed.
- Whether WebKit's `prefers-color-scheme` inside the embedded
  `dashboard-classic.html` frame follows the OS or the embedding iframe's
  used `color-scheme` (the React shell sets `color-scheme: light|dark` from
  `[data-theme]`, library `globals.css:16-22`). Both follow the OS in
  practice, so B2/B3 and the shell agree either way; not observed on Safari.
- Parity lines L-14 and L-15 (Safari) are manual and were not run.

## Appendix A. Library sources of the literals

| Token | Defined at (light, dark) |
|---|---|
| `--blue-300` | v-primitive.css:189 (theme-independent) |
| `--blue-500` | v-primitive.css:191 (theme-independent) |
| `--red-200` | v-primitive.css:68 (theme-independent; used for dark only) |
| `--alpha-base` | v-primitive.css:241, v-primitive.css:268 |
| `--codeblock-syntax-1` | v-components.css:194, v-components.css:221 |
| `--codeblock-syntax-2` | v-components.css:195, v-components.css:222 |
| `--codeblock-syntax-3` | v-components.css:196, v-components.css:223 |
| `--codeblock-syntax-4` | v-components.css:108 |
| `--color-background-caution-soft-alpha` | v-semantic.css:196 |
| `--color-background-caution-soft-alpha-hover` | v-semantic.css:197 |
| `--color-background-danger-soft-alpha` | v-semantic.css:232 |
| `--color-background-danger-solid` | v-semantic.css:237 |
| `--color-background-discovery-solid` | v-semantic.css:304 |
| `--color-background-info-soft-alpha-hover` | v-semantic.css:126 |
| `--color-background-primary-outline-active` | v-semantic.css:502, v-semantic.css:589 |
| `--color-background-primary-outline-hover` | v-semantic.css:501 (light, `--alpha-02`) |
| `--color-background-primary-soft` | v-semantic.css:490, v-semantic.css:577 |
| `--color-background-primary-soft-active` | v-semantic.css:492, v-semantic.css:579 |
| `--color-background-primary-soft-alpha` | v-semantic.css:493, v-semantic.css:580 |
| `--color-background-primary-soft-alpha-active` | v-semantic.css:495, v-semantic.css:582 |
| `--color-background-primary-soft-alpha-hover` | v-semantic.css:494, v-semantic.css:581 |
| `--color-background-primary-solid` | v-semantic.css:498, v-semantic.css:585 |
| `--color-background-secondary-soft` | v-semantic.css:507, v-semantic.css:594 |
| `--color-background-success-soft-alpha-hover` | v-semantic.css:269 |
| `--color-border` | v-semantic.css:563, v-semantic.css:650 |
| `--color-border-primary-outline` | v-semantic.css:503, v-semantic.css:590 |
| `--color-border-primary-outline-hover` | v-semantic.css:504, v-semantic.css:591 |
| `--color-border-strong` | v-semantic.css:564, v-semantic.css:651 |
| `--color-border-subtle` | v-semantic.css:562, v-semantic.css:649 |
| `--color-surface` | v-semantic.css:567, v-semantic.css:654 |
| `--color-surface-secondary` | v-semantic.css:568, v-semantic.css:655 |
| `--color-text` | v-semantic.css:60 |
| `--color-text-caution` | v-semantic.css:534, v-semantic.css:621 |
| `--color-text-danger-soft` | v-semantic.css:540, v-semantic.css:627 |
| `--color-text-info` | v-semantic.css:522, v-semantic.css:609 |
| `--color-text-inverse` | v-semantic.css:61 |
| `--color-text-primary-solid` | v-semantic.css:80 |
| `--color-text-secondary` | v-semantic.css:487, v-semantic.css:574 |
| `--color-text-success` | v-semantic.css:544, v-semantic.css:631 |
| `--color-text-tertiary` | v-semantic.css:488, v-semantic.css:575 |
| `--color-text-warning-soft` | v-semantic.css:530, v-semantic.css:617 |
| `--font-sans` | v-semantic.css:19 |
| `--gray-0` | v-primitive.css:217, v-primitive.css:244 |
| `--gray-900` | v-primitive.css:236, v-primitive.css:263 |
| `--link-primary-text-color` | v-components.css:191, v-components.css:218 |
| `--link-primary-text-color-hover` | v-components.css:192, v-components.css:219 |
| `--orange-600` | v-primitive.css:120 |
| `--pink-600` | v-primitive.css:96 |
| `--purple-a75` | v-primitive.css:176 |
| `--radius-full` | v-semantic.css:46 |
| `--shadow-300` | v-semantic.css:470 |
| `--yellow-a200` | v-primitive.css:154 |

`--color-text` (= `--gray-1000`), `--color-text-inverse` (= `--gray-0`) and
`--color-text-primary-solid` (= `--color-text-inverse`) are theme-independent
references; their values come from `--gray-1000`/`--gray-0` at
`v-primitive.css:240`/`:267` and `:217`/`:244`. Hue steps used as literals:
`--orange-600` `v-primitive.css:120`, `--pink-600` `:96`, `--pink-500` `:95`,
`--blue-500/-400/-300/-200/-800` `:191/:190/:189/:188/:194`,
`--green-600/-400/-300/-700` `:48/:46/:45/:49`, `--red-600/-400/-500`
`:72/:70/:71`, `--orange-700/-400` `:121/:118`, `--yellow-700/-500/-400`
`:145/:143/:142`, `--purple-400` `:166`, `--gray-900` `:236/:263`,
`--gray-950` dark `:265`.

## Appendix B. Independent re-check (2026-10-04)

Method: every number, line citation, selector and value in sections 1-8 and
Appendix A was re-derived with independent scripts over
PRISTINE, upstream source and the installed library; then a fresh `G` was
generated mechanically from this file's tables (4.2, palette list, 4.4, 6.2,
5.1) and run through C1-C13 and the Chrome parity lines L-2…L-13.

Confirmed unchanged: the 256/63/59/134 inventory (every row of the section 2
table: definition lines, resolved light/dark values, usage file:line lists,
internal refs, status; a mutation test proved the comparison detects a one-
digit change); the 9 collisions and their library lines; every 4.2 literal
against the library (the only intentional deviations are the documented
ones); every Appendix A line; page/link/script lines of 1.2; `theme.js`,
`tool-overlay.js`, CodeMirror line citations (style tag at `cm6:5800-5802`,
One Dark `cm6:25423-25523`, base theme `cm6:12444-12705`, extensions
`cm6:25549-25559`, oneDark push `cm6:25583-25585`); contrast ratios.

Regenerated `G` results (Chrome headless, light and dark): C1-C13 pass;
L-3/L-4 all 256 names non-empty and valid on `dashboard.html`, `popup.html`,
`report.html`, `matched-rules.html`, `strictblock.html`; L-5 overlay
`html`/`body` `rgba(0, 0, 0, 0)` and `colorScheme` `normal` on all three
overlay pages; L-6 and L-7 as stated (no-JS dark `rgb(33, 33, 33)` /
`rgb(255, 255, 255)`; light→dark and dark→light live switches keep the load
scheme); L-8 `1px 1`; L-9 as stated (busy pane also hidden with the marker);
L-10 zero font requests; L-11/L-12 as stated, plus cursor `rgb(13, 13, 13)` /
`rgb(255, 255, 255)` (One Dark `#528bff` overridden) and active-line gutter
equal to the active line; no CSS console errors.

## Appendix C. Changes after review (2026-10-04)

Three reviews (parity, accessibility/localisation, visual) of the first
generated file led to these changes; each is covered by a unit or e2e test.
- 4.2: `--surface-0` light `#f9f9f9`, `--accent-ink-1` literal
  `#ffffff`/`#0d0d0d`, `--cm-active-line` light 2%, `--info3-ink` (and its
  `-rgb`) dark `--red-200` (4.3).
- 4.4 (B7): RTL-correct gutter separator; editor surface, edge and keyboard
  focus ring.
- 4.5 (B8): keyboard focus ring for the vanilla pages.
- 6.5 (B9): embedded column aligned with the React panes.
- 7.1: C6 widened to B8/B9, C14 added; 7.2: L-11 active-line value,
  L-16, L-17.


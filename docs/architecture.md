# Architecture

Blocker is uBlock Origin Lite with new user-interface pages. This document explains how
the new pages are put on top of the unmodified upstream extension, how the build proves
nothing else changed, and how the pages talk to upstream's background code.

## The idea in one paragraph

The upstream source is a pinned git submodule that is never edited. Each build compiles
upstream as it is, renames it to "Blocker", and keeps that result as the reference
(**pristine**). The new pages are built separately and copied over a fresh copy of
pristine (the **stage**). A safety gate then compares the stage with pristine, file by
file, and fails the build if anything outside an explicit allow-list differs. Only a
stage that passes is packaged.

## Build pipeline

```text
                                  upstream/  (gorhill/uBlock, pinned commit, never edited)
                                      │  make dist/build/uBOLite.<platform>      step 1
                                      ▼
                       upstream/dist/build/uBOLite.<platform>   (original uBlock Origin Lite)
                                      │  make-pristine: extName / short_name = "Blocker"   step 2
                                      │  (Firefox: own add-on id, localized name)
                                      ▼
 ui/  ──vite──▶ ui/dist/      build/pristine/<platform>  ◀─────────────────┐
     extension/  popup.html,          │                                     │ compared
                 dashboard.html, ui/**│ stage.mjs: copy pristine,   step 4  │ byte by byte
     legacy/     default.css  ────────┤ rename the original pages to        │
     container/  app window           │ *-classic.html, add the new pages,  │
                   │                  │ the generated css/default.css and   │
                   │                  │ the icons, delete log.txt           │
                   │                  ▼                                     │
                   │          build/stage/<platform>  ── verify-stage.mjs ──┘   step 5
                   │                  │  (pass)
                   │                  ▼                                          step 6
                   │   chromium/edge: build/package/<target> ──▶ dist/*.zip
                   │   firefox:       build/stage/firefox     ──▶ dist/*.xpi
                   └──▶ safari:       safari-web-extension-converter ──▶ Xcode project
                                      + app window, bundle ids, signing, icons
                                      ──▶ xcodebuild ──▶ Blocker.app ──▶ dist/*.zip
```

`<platform>` is `chromium`, `edge`, `firefox` or `safari`. Both Safari targets (macOS and
iOS) package the same `build/stage/safari`. All steps are run by `scripts/build.sh`; see
[building.md](building.md).

## What is new and what is upstream

| Part | Source | In the extension |
|---|---|---|
| Toolbar popup | `ui/src/popup/` (React) | `popup.html` + `ui/*` |
| Dashboard shell, Settings, Filter lists, About | `ui/src/dashboard/` (React) | `dashboard.html` + `ui/*` |
| Dashboard Custom filters and Develop | upstream's `dashboard.html` (CodeMirror editors) | `dashboard-classic.html`, shown in a frame inside the new dashboard |
| Original popup | upstream | `popup-classic.html`, opened automatically if the React popup fails to start |
| Picker, zapper, unpicker, report, matched rules, strict-block page | upstream | unchanged; re-coloured by the generated `css/default.css` |
| Safari app window (macOS) | `ui/src/container/` (React, one classic script) | the app's `Main.html`, `Script.js`, `Style.css` |
| iOS app screen | `platforms/safari/ios-container/` (static HTML) | the iOS app's `Main.html`, `Style.css` |
| Background, content scripts, rulesets, manifest, locales | upstream | byte-identical to pristine |

The re-colouring of upstream pages works without touching them: upstream's pages already
read their colours from CSS variables in `css/default.css`. `ui/scripts/build-legacy-css.mjs`
generates a replacement file that maps those variables to the new design tokens
([specs/legacy-tokens.md](specs/legacy-tokens.md)).

## The safety gate

`scripts/verify-stage.mjs --platform <p>` runs on every build (exit 0 pass, 1 violation).
It checks:

1. **Every file outside the allow-list is byte-identical to pristine** (sha256), and no
   pristine file is missing. The allow-list: `popup.html`, `dashboard.html`,
   `popup-classic.html`, `dashboard-classic.html`, `ui/**`, `css/default.css`, the removed
   `log.txt`, and `img/<name>` only when it equals `assets/icons/extension/<name>`.
2. **The classic pages equal upstream's pages**, and **`manifest.json` is unchanged**.
3. **Pristine itself only differs from upstream's output by the rename**: `short_name`,
   and on Firefox the add-on id and the localized `name`.
4. **No remote code in the new pages**: no remote script or font URL, no
   `cdn.openai.com`, no `eval(` or `new Function(`; no inline scripts, inline event
   handlers or `style=""` in the HTML. Every relative reference must resolve.

`node scripts/selftest-verify-stage.mjs --platform <p>` proves the gate works: it tampers
with copies of the stage (a changed ruleset, an inline script, a remote URL, a wrong
icon, …) and expects each to be caught.

Each package step adds its own checks: the Chromium packager re-checks every file against
the gated stage and allows only the two release changes (no debug rulesets, no feedback
permission); the Firefox packager checks the archive lists exactly the stage; the Safari
packager compares the extension inside the built app with the stage.

## How the pages talk to the extension

The new pages use the same channel as upstream's pages: `runtime.sendMessage({ what, … })`
to upstream's background script, plus the `BroadcastChannel('uBOL')` the background uses to
announce changes. Nothing in the background was added or changed for Blocker.

```text
 React page ──▶ ui/src/lib/bridge.ts ──▶ ui/src/lib/ext.ts ──▶ runtime.sendMessage ──▶ upstream js/background.js
   (popup,       one typed function       browser ?? chrome                                   │
    dashboard)   per message                                                                  │
      ▲                                                                                        │
      └──────────────── BroadcastChannel('uBOL') ◀─────────────────────────────────────────────┘
```

- `ui/src/lib/ext.ts` is the only place that touches the browser API
  (`globalThis.browser ?? globalThis.chrome`). It also tells the platforms apart the way
  upstream does (by the extension URL scheme).
- `ui/src/lib/bridge.ts` has one function per message. It builds each payload field by
  field, validates arguments before sending (a malformed level would silently reset a
  site), calls `sendMessage` synchronously so permission prompts stay inside the user's
  click, and, unlike upstream, reports failures so the UI can show them.
- **Parity.** For every user action, the new pages send the same messages, in the same
  order, with the same payloads, and make the same browser-API calls as upstream's pages.
  The expected behaviour is written down, with `file:line` citations into upstream, in
  [docs/specs/](specs/README.md) ([messaging.md](specs/messaging.md) lists every
  message). The parity tests in `ui/tests/e2e/*.parity.mjs` record the calls the pages
  make against a mock extension and compare them with those specs.
- Features follow the capabilities the background reports (`supportsCompiledFilters`,
  `supportsUserScripts`, `isSideloaded`, …), not the browser name. The one exception is
  copied from upstream: strict blocking is hidden on Safari.

The macOS app window is not an extension page. It talks to the app's Swift code through
`webkit.messageHandlers` exactly as Apple's template page does
([specs/container.md](specs/container.md)).

## Development without a browser extension

The pages can run in an ordinary browser tab: the **test harness** (`ui/harness/`) loads a
mock extension API (`ui/src/dev/mock-ext.ts`) that answers every message like upstream's
background, with switches for platform, language, theme, errors and slow answers. All UI
tests use it. The production build fails if it would include any of it. See
[mock-harness.md](mock-harness.md).

## Directory map

```text
upstream/                       uBlock Origin (submodule). Read only.
ui/
  popup.html, dashboard.html    Vite entries of the extension pages
  container/Main.html           macOS app window entry
  public/ui/theme-init.js       sets light/dark before the first paint
  src/popup/  src/dashboard/  src/container/    the pages
  src/components/               shared building blocks (Card, Tabs, ConfirmDialog, …)
  src/lib/                      ext.ts, bridge.ts, i18n, theme, storage, pointer, model/
  src/styles/                   Tailwind + library CSS, tokens, legacy CSS generator
  src/dev/                      mock API, fixtures, galleries (never shipped)
  harness/                      harness pages that load the mock
  scripts/                      legacy CSS build and check
  tests/unit/, tests/e2e/       vitest; Node test runner + playwright-core on headless Chrome
assets/icons/                   extension/, app/, app-window/ icons (editable)
scripts/
  build.sh                      the one entry point
  upstream-build.sh             step 1
  make-pristine.mjs             step 2
  stage.mjs                     step 4
  verify-stage.mjs              step 5, the safety gate
  selftest-verify-stage.mjs     proves the gate catches tampering
  bootstrap.sh                  submodules + npm ci
  lib/common.mjs                shared paths and helpers
platforms/
  chromium/                     package.sh (Chrome + Edge), store checks, smoke and engine tests
  firefox/                      package.sh, add-on id, web-ext lint
  safari/                       package.sh, signing, Xcode project patch, app window install, iOS screen
docs/                           this documentation, specs/, screenshots/
build/                          intermediate output (ignored): pristine/, stage/, package/, xcode/, logs/
dist/                           packages (ignored)
```

## Design decisions

| Decision | Why |
|---|---|
| Overlay on the built extension, never a patch of upstream source | Upstream updates stay a submodule bump. The blocking engine is exactly the audited upstream one. |
| A byte-level gate instead of trust | A UI change cannot silently alter rules, permissions or background code; reviewers only need to read `ui/`. |
| Keep upstream's pages as `*-classic.html` | The CodeMirror editors (Custom filters, Develop) are reused as they are, and the popup has a working fallback. |
| Same messages as upstream, documented in specs | The background is unchanged, so the UI must speak its protocol exactly; the specs make that reviewable. |
| One UI build for every browser | Behaviour follows reported capabilities, as upstream does, so there are no per-browser forks of the UI. |
| Release profile for Chromium packages | Matches upstream's store builds: no 50 MB of debug rulesets, no feedback permission. |
| Placeholder ids (`org.example.blocker`, `blocker@example.org`) | A fresh clone never builds under someone else's identity; personal values stay in the ignored `signing.local.json`. |
| Dependencies pinned exactly, install scripts disabled | Reproducible builds and no code runs at `npm ci` time. |
| No remote resources at run time | Required by the stores and by the extension CSP; the gate enforces it. |
| Tests in headless Chrome against a mock | Fast and repeatable in CI. Safari and Firefox specifics are checked by hand (see [CONTRIBUTING.md](../CONTRIBUTING.md)). |

## Known limitations

- The automated UI tests run in Chrome. Safari's permission prompts, popover sizing and
  Firefox for Android's popup sheet are checked by hand.
- The React popup loads more code than upstream's (about 146 KB against 42 KB gzip,
  mostly React). Everything is local.
- A few new strings (errors, import, removal) are English only; everything else uses
  upstream's 71 translations.
- Every rebuild without a filter-list cache downloads fresh lists, so the rulesets
  change between builds made on different days.

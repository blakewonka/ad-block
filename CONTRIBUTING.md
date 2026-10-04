# Contributing to Blocker

Thank you for helping. This page covers the development setup, the day-to-day loop, the
tests, and the rules that keep Blocker safe to ship. Please also read the
[Code of Conduct](CODE_OF_CONDUCT.md).

## What belongs here, and what does not

| Change | Where |
|---|---|
| Blocker's pages (popup, dashboard, Safari app window), build scripts, packaging, docs | here: open an issue or a pull request |
| Blocking engine, background code, filter syntax, rulesets | upstream: [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home/issues). Blocker does not modify them, and the build refuses a modified copy. |
| A site that is broken or an ad that is not blocked | the filter lists: [uAssets](https://github.com/uBlockOrigin/uAssets/issues), after checking that the official uBlock Origin Lite behaves the same |

Never edit files inside `upstream/`. To move to a newer upstream version, see
[docs/updating-upstream.md](docs/updating-upstream.md).

## Setup

You need Git, Node.js 22.12 or later with npm, and Google Chrome for the browser tests
(they drive the installed Chrome headlessly; nothing is downloaded). Building packages
has more requirements: see [docs/building.md](docs/building.md#prerequisites).

```sh
git clone --recursive https://github.com/<you>/blocker.git
cd blocker
npm --prefix ui ci
```

All commands below run from the repository root. Inside `ui/` you can drop
`--prefix ui`.

## The development loop: the harness

You do not need a browser extension to work on the UI. The **harness** serves the real
pages in an ordinary browser tab with a mock extension API that answers like upstream's
background:

```sh
npm --prefix ui run dev
```

Vite prints the address (for example `http://127.0.0.1:5173/`). Open
`popup.html`, `dashboard.html`, `container.html` (the macOS app window) or `gallery.html`
(components) under it. Changes reload instantly. Query switches change what the mock
does, for example:

```text
popup.html?theme=dark
popup.html?lang=ar
dashboard.html?platform=chromium
popup.html?scenario=slow
dashboard.html?scenario=admin-locked
```

In the browser console, `__blockerCalls` lists every API call and message the page made,
and `__blockerMock.state()` shows the mock background. Every switch is documented in
[docs/mock-harness.md](docs/mock-harness.md).

When the page looks right in the harness, check it in a real build:

```sh
./scripts/build.sh chromium --skip-upstream     # after one full build of that target
```

and reload the unpacked extension (see [docs/building.md](docs/building.md)).

## Tests

| Command | What it checks | Time |
|---|---|---|
| `npm --prefix ui run typecheck` | TypeScript (strict) for sources and tests | seconds |
| `npm --prefix ui run typecheck:configs` | the Vite and Vitest config files | seconds |
| `npm --prefix ui test` | about 1,200 unit tests (Vitest, happy-dom): models, bridge, components, i18n | under a minute |
| `npm --prefix ui run build` | the production build of the pages; fails if it would bundle the mock | seconds |
| `npm --prefix ui run build:harness` then `npm --prefix ui run e2e` | about 190 browser tests in headless Chrome: layout, parity with upstream's messages, themes, right-to-left, touch layouts | about 10 minutes |
| `./scripts/build.sh <target> --ui-only` | build, stage and the safety gate for one platform | under a minute after the first build |
| `node scripts/selftest-verify-stage.mjs --platform safari` | the safety gate still catches every kind of tampering (needs a stage) | seconds |

Run at least `typecheck`, `test` and `./scripts/build.sh <target> --ui-only` before a pull
request, and `e2e` when you change behaviour or layout. The browser tests write
screenshots to `build/screenshots/`; look at the ones for the pages you touched.

One timing-based test in `settings.parity.mjs` can fail on a heavily loaded machine; run
it again on an idle one before you investigate.

Maintainers: CI, release tags and the `BLOCKER_GECKO_ID` repository variable are described
in [docs/building.md](docs/building.md#ci-and-releases).

For changes to packaging there are extra checks per platform, for example
`node platforms/chromium/smoke-test.mjs` (loads the package into a throw-away headless
Chrome). See each platform's README.

## Adding or changing a UI feature safely

1. **Find upstream's behaviour first.** Every page has a spec in
   [docs/specs/](docs/specs/README.md) that cites upstream's code. If your feature
   exists in upstream's page, read the cited lines: Blocker must send the same messages,
   with the same payloads, in the same order.
2. **Talk to the extension only through `ui/src/lib/bridge.ts`** (one function per
   message) and `ui/src/lib/ext.ts` (browser APIs). If you need a message the bridge does
   not have, add it there with its payload validation and a unit test, citing the spec.
   Do not add messages that upstream's background does not handle: the background is
   never changed.
3. **Follow the capabilities the background reports** (`supportsCompiledFilters`,
   `supportsUserScripts`, …), not the browser name.
4. **Text:** reuse upstream's translated strings through `t('key')`. A string upstream
   does not have uses `tNew('key', 'English text')` and stays English-only. Layouts must
   survive text twice as long as English and right-to-left languages: use logical CSS
   properties (`ms-*`, `pe-*`, `start`, `end`).
5. **Content Security Policy:** no inline scripts, no `eval`, no `new Function`, no
   remote URLs (fonts, images, scripts, analytics). The safety gate fails the build
   otherwise.
6. **Accessibility:** real semantics (buttons, tabs, radio groups, labels), a visible
   focus ring, full keyboard use, at least 4.5:1 text contrast, and touch targets of
   44 px on touch screens.
7. **Test it:** unit tests for the logic (keep it in `ui/src/lib/model/` or the pane's
   `model.ts`, without DOM or browser API), and an e2e test that records the calls in the
   harness for anything that sends messages.
8. **Run the gate:** `./scripts/build.sh <target> --ui-only` must print
   `verify-stage: PASS`.

Only these files may differ from upstream's extension: `popup.html`, `dashboard.html`,
`popup-classic.html`, `dashboard-classic.html` (copies of upstream's pages), `ui/**`,
`css/default.css` (generated), the removed `log.txt`, and icons from
`assets/icons/extension/`. This is the allow-list of
[the safety gate](docs/architecture.md#the-safety-gate). If your change needs anything
else, open an issue first.

## Code style

- TypeScript in strict mode, React function components and hooks.
- Formatting follows `.editorconfig`: UTF-8, LF, 4 spaces (2 in JSON and YAML), final
  newline. Single quotes and semicolons in TypeScript, as in the existing code.
- Import the component library by subpath
  (`@openai/apps-sdk-ui/components/Button`), never from its root.
- Styling with Tailwind utility classes and the library's design tokens; new tokens go in
  `ui/src/styles/blocker-tokens.css`.
- Comments explain *why*. When code reproduces an upstream quirk, cite the spec section.
- Dependencies are pinned to exact versions and install scripts are disabled
  (`ui/.npmrc`). Adding a dependency needs a good reason; the build fails if a shipped
  package has no licence notice.

## Pull requests

- One topic per pull request, with a description of what and why, and screenshots for
  visual changes (light and dark).
- Say which checks you ran, and on which browsers you tried it.
- Do not commit build output (`build/`, `dist/`, `ui/dist/`), `signing.local.json`, or
  anything personal: no home-directory paths, team ids or e-mail addresses in files.
- Update `CHANGELOG.md` under "Unreleased" for user-visible changes.
- By contributing, you agree that your contribution is licensed under the GNU General
  Public License v3.0 or later, like the rest of the project.

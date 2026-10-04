# Dashboard shell, About pane and embedded classic dashboard: behaviour spec

Status: source of truth for the React dashboard frame (`dashboard.html`), its
About pane, and the embedding of the upstream dashboard
(`dashboard-classic.html`) for the "Custom filters" and "Develop" panes.
Implementers follow this document instead of reading upstream code.

Related specs (not repeated here): `messaging.md` (§8 About/troubleshooting
messages, §9.1 what the classic document does by itself, §12 storage keys),
`settings.md` (Settings pane, developer-mode toggle, `getOptionsPageData`),
`filter-lists.md` (Filter lists pane and its header block), `i18n.md`
(string lengths, RTL).

## 0. Conventions and sources

| Abbreviation | Path |
|---|---|
| ROOT | `upstream` |
| EXT | `ROOT/platform/mv3/extension` |
| SAFARI | `ROOT/platform/mv3/safari` |
| SRC | `ROOT/src` (shared uBO files: `js/dom.js`, `js/i18n.js`, `css/common.css`, `css/themes/default.css`) |
| PRISTINE | `build/pristine/safari` (built Safari extension, the baseline) |

Every citation is `file:line`. I checked with `diff` that these PRISTINE files
are byte-identical to their sources, so the line numbers are valid in both:
`dashboard.html`, `js/dashboard.js`, `js/troubleshooting.js`, `js/develop.js`,
`js/settings.js`, `js/ext.js`, `js/filter-manager-ui.js`, `js/filter-editor.js`,
`js/filter-lists.js`, `js/mode-editor.js`, `js/rw-dnr-editor.js`, `js/popup.js`,
`js/background.js`, `js/theme.js`, `css/dashboard.css`,
`css/dashboard-common.css`, `css/settings.css`, `css/develop.css`
(EXT ↔ PRISTINE); `js/dom.js`, `js/i18n.js`, `css/common.css`,
`css/default.css` (SRC ↔ PRISTINE); `js/ext-compat.js`, `js/ext-offscreen.js`
(SAFARI ↔ PRISTINE).

Markers:
- **[SAFARI]** behaviour that is specific to the Safari build.
- **[H]** observed in a headless-Chrome harness (section 9). The harness ran the
  PRISTINE files under a mocked `browser` object. It confirms what the code
  does in Blink/Chrome. It does not prove Safari/WebKit behaviour.
- **[H2]** observed in the second harness of section 9.1 (same method: PRISTINE
  copy, mock `browser` injected into every frame, Safari UA, system Chrome
  headless; the mock's `getDefaultConfig` uses the real defaults of
  `EXT/js/config.js:30-39`). Every `[H]` claim that matters for an R-n was
  re-run under [H2].
- **UNKNOWN** means I could not determine it. Do not guess.
- **R-n** is a requirement for the React implementation. **D-n** is a
  deliberate deviation from upstream (collected in section 6).

---

## 1. The upstream dashboard document

### 1.1 Head

| Item | Value | Source |
|---|---|---|
| Viewport | `width=device-width, initial-scale=1, minimum-scale=1` | `EXT/dashboard.html:5` |
| Color scheme | `<meta name="color-scheme" content="light dark">` | `EXT/dashboard.html:6` |
| Title | `<title data-i18n="dashboardName">`. `i18n.render()` fills every `[data-i18n]` element, `<title>` included (`SRC/js/i18n.js:189-193`, `:346`). English value: `uBO Lite — Dashboard` (`PRISTINE/_locales/en/messages.json`, key `dashboardName`) [H] | `EXT/dashboard.html:7` |
| Favicon | `img/icon_64.png` | `EXT/dashboard.html:19` |
| Stylesheets, in order | `css/default.css`, `common.css`, `fa-icons.css`, `dashboard.css`, `dashboard-common.css`, `filtering-mode.css`, `settings.css`, `filter-editor.css`, `develop.css` | `EXT/dashboard.html:8-17` |
| Scripts, in order (all `type="module"` except the first) | `lib/codemirror/cm6.bundle.ubol.min.js` (classic), `js/theme.js`, `js/fa-icons.js`, `js/i18n.js`, `js/dashboard.js`, `js/settings.js`, `js/filter-manager-ui.js`, `js/develop.js` | `EXT/dashboard.html:291-298` |
| `<html>` | no `lang` and no `dir` attribute | `EXT/dashboard.html:2` |

The extension's options page is `dashboard.html` (`SAFARI/manifest.json:40-42`;
`PRISTINE/manifest.json:297-299`). The popup opens it with
`runtime.openOptionsPage()` after a trusted primary click on `#gotoDashboard`
(`EXT/js/popup.js:249-253`). It is never opened with a hash or a query string.
No upstream code builds a `dashboard.html#…` or `dashboard.html?…` URL. A grep
of `PRISTINE/js/*.js` for `dashboard.html`, `location.hash`, `hashchange` and
`openOptionsPage` finds only `popup.js:252`, plus `strictblock.js:56`, which is
an unrelated page.

### 1.2 State held on `<body>` and `<html>`

| Attribute / class | Values | Set by | Read by (CSS) |
|---|---|---|---|
| `body[data-pane]` | `settings` (markup default), `rulesets`, `filters`, `develop`, `about`; any string read from storage | markup `EXT/dashboard.html:22`; nav click `EXT/js/dashboard.js:42-44`; stored value at load `:52-55`; forced `about` `EXT/js/settings.js:33-35` | `EXT/css/dashboard.css:37-46`, `:50-52`, `:64-71`; `EXT/css/develop.css:1-3` |
| `body[data-platform]` | `webextFlavor`: `safari` / `firefox` / `chromium` from the `runtime.getURL('')` scheme (`EXT/js/ext.js:30-34`) | `EXT/js/dashboard.js:33` | `EXT/css/settings.css:104-106` |
| `body[data-develop]` | `"true"` / `"false"` | `EXT/js/settings.js:72-77` (effective state), `:224-228` (on toggle) | `EXT/css/dashboard.css:47-49` |
| `body[data-forbid]` | space-separated `disabledFeatures`. Set only when the list is non-empty | `EXT/js/settings.js:29-36` | `EXT/css/settings.css:32-50` |
| `body[data-supports]` | `user-scripts`, `compiled-filters` | `EXT/js/settings.js:334-341` | `EXT/css/settings.css:267-270`, `:278-280`, `:404-406` |
| `body.loading` | present in the markup, removed after `getOptionsPageData` | markup `EXT/dashboard.html:22`; `EXT/js/settings.js:347-349` | `EXT/css/settings.css:14-16`: `visibility: hidden` for the whole body |
| `body.busy` | set during restore and reset | `EXT/js/settings.js:152`, `:182`, `:188`, `:191` | `EXT/css/dashboard.css:64-71`: hides every pane and shows `section[data-pane="busy"]` (spinner, `EXT/dashboard.html:201-205`, `EXT/css/settings.css:421-430`) |
| `body.firstRun` | when `data.firstRun`. In practice never: the background sets `process.firstRun = false` *before* it builds the `getOptionsPageData` response, so `firstRun` is always `false` (`EXT/js/background.js:422`, `:435`) | `EXT/js/settings.js:42-44` | none found |
| `body.committing`, `body.readonly` | Custom filters pane, during a commit | `EXT/js/filter-manager-ui.js:224-225`, `:281`, `:296` | pane-internal |
| `html.dark` / `html.light` | from `prefers-color-scheme`, computed **once** at load. No change listener | `EXT/js/theme.js:26-33` | `SRC/css/themes/default.css` (dark rules) |
| `html.mobile` / `html.desktop` | `mobile` when `(hover: hover)` does not match | `EXT/js/theme.js:35-40` | `EXT/css/dashboard.css:79-86`, `EXT/css/dashboard-common.css:68-73` |
| `body[dir]` | `rtl` if `@@ui_locale` is one of `ar he fa ps ur`, otherwise `ltr` | `SRC/js/i18n.js:34-45` | — |

Failure mode: `settings.js` returns early when `getOptionsPageData` resolves
falsy (`EXT/js/settings.js:332`). Upstream `sendMessage` turns every send
failure into `undefined` (`EXT/js/ext.js:51-55`). In that case `body.loading` is
never removed and the whole dashboard stays invisible, with no message
(`EXT/css/settings.css:14-16`).

---

## 2. Panes

### 2.1 List, order and i18n keys

Nav order is the markup order (`EXT/dashboard.html:28-32`).

| # | Pane id (`data-pane`) | Tab label key | English | Section | Initialised when |
|---|---|---|---|---|---|
| 1 | `settings` | `settingsPageName` | Settings | `EXT/dashboard.html:43-113` | at load (`EXT/js/settings.js:327-353`) |
| 2 | `rulesets` | `aboutFilterLists` (this key is shared with an About-pane link) | Filter lists | `EXT/dashboard.html:116-127`, plus header block `:35-39` | first time `section[data-pane="rulesets"]` intersects (`EXT/js/filter-lists.js:565`) |
| 3 | `filters` | `customFiltersPageName` | Custom filters | `EXT/dashboard.html:130-147` | first time `section[data-pane="filters"]` intersects (`EXT/js/filter-manager-ui.js:636`) |
| 4 | `develop` | `developPageName` | Develop | `EXT/dashboard.html:150-165` | first time `section[data-pane="develop"]` intersects (`EXT/js/develop.js:628`) |
| 5 | `about` | `aboutPageName` | About | `EXT/dashboard.html:168-198` | static. The troubleshooting text loads each time its `<pre>` becomes visible (§4.4) |
| — | `busy` | — (no tab) | — | `EXT/dashboard.html:201-205` | shown only by `body.busy` |

"Intersects" means an `IntersectionObserver` callback reported
`isIntersecting` for the element. The observer then disconnects
(`SRC/js/dom.js:160-168`). An element inside a `display: none` subtree never
intersects, so a pane that is never displayed is never initialised.

### 2.2 How the visible pane is chosen (exact code)

```js
// EXT/js/dashboard.js:42-55
dom.on('#dashboard-nav', 'click', '.tabButton', ev => {
    const { pane } = ev.target.dataset;
    dom.body.dataset.pane = pane;
    if ( pane === 'settings' ) {
        localRemove('dashboard.activePane');
    } else {
        localWrite('dashboard.activePane', pane);
    }
});

localRead('dashboard.activePane').then(pane => {
    if ( typeof pane !== 'string' ) { return; }
    dom.body.dataset.pane = pane;
});
```

- Storage: `browser.storage.local`, key `dashboard.activePane`.
  `localWrite(k, v)` is `storage.local.set({ [k]: v })` and `localRemove(k)` is
  `storage.local.remove(k)` (`EXT/js/ext.js:69-77`). `localRead` returns
  `bin[key] ?? undefined` and swallows errors (`EXT/js/ext.js:59-67`).
- The click handler does not await the write. No value is validated: any
  stored string becomes `body[data-pane]`.
- Selecting Settings **removes** the key. "Absent" means Settings. The value
  `settings` is never written.
- The read happens once per document load. Its result arrives asynchronously
  and overwrites whatever `body[data-pane]` holds at that moment. That includes
  the markup default `settings`. The page is still invisible then because of
  `body.loading`.
- No URL hash, query parameter, `hashchange` or `popstate` handling exists
  (`EXT/js/dashboard.js`, whole file).
- Visibility is pure CSS: a section shows only when `body[data-pane]` equals
  its id and the body is not `.busy` (`EXT/css/dashboard.css:54-59`, `:64-71`).
  The active tab is styled through the same attribute (`:37-46`). No script
  reacts to a change of `body[data-pane]`. Lazy initialisation follows from
  the CSS display change through the IntersectionObserver (§2.1).
- Forced pane: when `disabledFeatures` contains `dashboard`, `settings.js` sets
  `body.dataset.pane = 'about'` once, after `getOptionsPageData` arrives. It
  does not write storage (`EXT/js/settings.js:29-36`, called at `:343`).
  Nothing orders this against the stored-pane read of `dashboard.js:52-55`:
  whichever resolves last wins (`settings.md` §2.4 HAZARD). Usually the storage
  read lands first, so About wins [H2: stored `develop`, final pane `about`].
- The forced pane does not lock navigation. The Develop tab is not among the
  tabs hidden by `dashboard` (§2.3), so with effective developer mode on, the
  user can still click Develop, which shows the Develop section and writes
  `dashboard.activePane = 'develop'` [H2].

Upstream quirks, which follow from the code above:
- Q1. Stored value `develop` with developer mode off: the Develop section is
  shown, because `EXT/css/dashboard.css:67` does not check `data-develop`. The
  Develop tab is hidden (`:47-49`), so no tab is highlighted.
- Q2. Stored value `filters` while `disabledFeatures` contains `picker` (or
  `dashboard`, before the forced switch): the section is hidden by
  `EXT/css/settings.css:36-37` / `:44-47`. The page body is then empty and no
  tab is highlighted.
- Q3. An unknown stored string shows no pane at all.
- Q4. Turning developer mode off while the Develop pane is shown hides only the
  tab. This happens through another window's broadcast
  (`EXT/js/settings.js:298-303` → `renderWidgets()`), or through restore or
  reset. The section stays visible and the stored key stays `develop`.

### 2.3 Which tabs are hidden when

| Tab | Hidden when | Source |
|---|---|---|
| Settings | `disabledFeatures` contains `dashboard` | `EXT/css/settings.css:32-33` |
| Filter lists | `disabledFeatures` contains `dashboard` | `EXT/css/settings.css:34-35` |
| Custom filters | `disabledFeatures` contains `dashboard` or `picker` | `EXT/css/settings.css:36-37`, `:44-45` |
| Develop | `body[data-develop]` is not `"true"`, which means effective developer mode is off. Effective = `Boolean(developerMode) && disabledFeatures?.includes('develop') !== true` (`EXT/js/settings.js:72-76`). Also hidden before `getOptionsPageData` arrives, because the attribute is absent, and stays hidden if `renderAdminRules` throws (a non-array `disabledFeatures` that has a `length`, e.g. a string), because the shared `try` then skips `renderWidgets` (`EXT/js/settings.js:342-349`; `settings.md` §2.3 step 6). After a toggle the tab follows the checkbox immediately, without waiting for the background (`EXT/js/settings.js:224-228`). **Not** hidden by `dashboard` in `disabledFeatures`: `EXT/css/settings.css:32-39` lists only the settings, rulesets and filters tabs [H2: `disabledFeatures: ['dashboard']` + developer mode on → Develop tab `display: flex`] | `EXT/css/dashboard.css:47-49` |
| About | never | — |

**[SAFARI]** No tab is hidden because of the platform. On Safari the platform
and support flags hide only pieces inside panes:
- the strict-block row (`EXT/dashboard.html:100` `data-platform-exclude="safari"`;
  `EXT/css/settings.css:104-106`);
- the Custom-filters "sandbox" CodeMirror editor and the Filter-lists import
  aside and "imported" group. These need `data-supports~="compiled-filters"`
  (`EXT/css/settings.css:404-406`, `:267-270`), and
  `supportsCompiledFilters = supportsOffscreenDocument = false` on Safari
  (`SAFARI/ext-offscreen.js:22-25`; `EXT/js/background.js:439`).
- The `.userScriptsInfo` notes are hidden when `user-scripts` is supported
  (`EXT/css/settings.css:278-280`). On Safari this has no visible effect either
  way: the only two notes are inside the Filter-lists import `aside`
  (`EXT/dashboard.html:118-119`) and inside `aside#sandboxEditor` (`:142-144`),
  and both containers are already `display: none` without `compiled-filters`
  (`EXT/css/settings.css:267`, `:404-406`). `supportsUserScripts` is computed
  in the background (`EXT/js/background.js:440`, `EXT/js/ext.js:40-44`); the
  manifest declares no `userScripts` permission (`PRISTINE/manifest.json:303-312`),
  so `false` is expected, but this has not been confirmed on a device (U-5).

`html.mobile` (touch-only devices) lets the nav scroll horizontally and hides
the logo (`EXT/css/dashboard.css:79-86`). On macOS Safari `(hover: hover)`
matches, so this does not apply (`EXT/js/theme.js:35-40`).

### 2.4 React shell requirements (pane selection)

- R-1. The pane ids and tab order are those of §2.1 rows 1-5. Labels come from
  `t()` with exactly these keys: `settingsPageName`, `aboutFilterLists`,
  `customFiltersPageName`, `developPageName`, `aboutPageName`. No new strings.
- R-2. Persistence must match upstream byte for byte. On a user tab selection:
  set the active pane first, then call `storage.local.remove('dashboard.activePane')`
  for `settings`, or `storage.local.set({ 'dashboard.activePane': <id> })`
  for any other id. The UI does not wait for the write. The one exception is
  E-3. Use the same key, because the classic frame reads it (§5).
  The original plan suggested that the React shell use its own
  key. That conflicts with ARCHITECTURE §6.6 and with E-3. This spec wins.
- R-3. At startup, read `dashboard.activePane` once. A string becomes the
  requested pane. Anything else means `settings`.
- R-4. Visible tabs follow §2.3, computed from `getOptionsPageData`
  (`developerMode`, `disabledFeatures`). They update live from the
  `BroadcastChannel('uBOL')` `developerMode` message, as `settings.md`
  describes. Upstream opens that channel only after a successful
  `getOptionsPageData` (`EXT/js/settings.js:350`); `disabledFeatures` is never
  broadcast, so the `dashboard`/`picker` hiding is fixed for the life of the
  document (`settings.md` §2.4). Until the options data has arrived, the shell
  renders a skeleton rather than a pane. This is the counterpart of upstream
  `body.loading`.
- R-5. `disabledFeatures` contains `dashboard`: once the data arrives, show
  About without writing storage (`EXT/js/settings.js:33-35`). Decide this only
  after both the stored-pane read (R-3) and `getOptionsPageData` have
  resolved, so the forced About wins whatever the order (`settings.md` §2.4
  HAZARD). The forced pane is a start-up choice only: the Develop tab stays
  available when effective developer mode is on (§2.2, §2.3), and selecting it
  follows R-2 (it writes `dashboard.activePane = 'develop'`) and E-1..E-11.
- D-1 (deviation, a11y rule 10). The requested pane may be hidden by §2.3 (Q1,
  Q2) or may be an unknown string (Q3). In that case show Settings and do not
  write storage. Upstream would show an orphan or blank pane.
- D-2 (deviation). Developer mode may be turned off while Develop is shown (Q4).
  In that case switch the visible pane to Settings and do not write storage.
  Keep the classic frame alive (E-8), so unsaved Develop text survives if the
  user turns developer mode back on.
- R-6. Do not read or write a URL hash or query for pane state (upstream has
  none).
- R-7. `document.title` = `t('dashboardName')`, which is
  "uBO Lite — Dashboard" in `en`. The title was not part of the "Blocker"
  rename: only `extName` and `short_name` were changed. Keeping it is parity.
  Changing it needs a new string and a deliberate decision.

---

## 3. Header

| Element | Upstream | Source |
|---|---|---|
| Container | `<header>` sticky at the top, `z-index: 100`, background `--surface-1` | `EXT/css/dashboard.css:1-6` |
| Logo | `<span class="logo"><img data-i18n-title="extName" src="img/ublock.svg" alt="uBO Lite"></span>`. Not a link and not focusable. `i18n.render` sets `title` to `extName` ("Blocker") (`SRC/js/i18n.js:245-249`). `alt` is hard-coded `uBO Lite` [H] | `EXT/dashboard.html:27` |
| Product name text | none. The header shows no visible name. The name appears only in the logo tooltip, the document title and the About pane | `EXT/dashboard.html:25-40` |
| Nav | `<nav id="dashboard-nav">` with five `<button class="tabButton" type="button" data-pane=… tabindex="0">`. There is no ARIA tab semantics, and `:focus` has `outline: 0` (`EXT/css/dashboard.css:29-31`) | `EXT/dashboard.html:26-33` |
| Filter-lists header block | `div[data-pane-related="rulesets"]` (spinner, `#listsOfBlockedHostsPrompt`, `#dnrError`, `#findInLists`), shown only on the Filter lists pane (`EXT/css/dashboard.css:50-52`). Owned by `filter-lists.md` | `EXT/dashboard.html:35-39` |

- R-8. The React header shows the logo `img/ublock.svg` (the file exists in
  PRISTINE `img/`; the path is relative to `dashboard.html`) and exposes
  `extName` as its accessible name or tooltip.
- D-3 (deviation). Use `t('extName')` ("Blocker") for `alt`, not the stale
  hard-coded `uBO Lite`.
- R-9. Tabs must use real tablist/tab/tabpanel semantics with a visible focus
  ring (ARCHITECTURE §6.10). This differs on purpose from upstream
  `outline: 0`.

---

## 4. About pane

### 4.1 Content, in document order (`EXT/dashboard.html:168-198`)

| # | Markup | Text | Link target |
|---|---|---|---|
| 1 | `div#aboutNameVer.li` | `${manifest.name} ${manifest.version}` from `runtime.getManifest()` (`EXT/js/dashboard.js:35-38`) | — |
| 2 | nested (`.liul > .li`) | `Copyright (c) Raymond Hill 2014-present` (hard-coded, not translated) | — |
| 3 | link | `aboutPrivacyPolicy` (Privacy policy) | `https://github.com/uBlockOrigin/uBOL-home/wiki/Privacy-policy` |
| 4 | link | `aboutDocumentation` (Documentation) | `https://github.com/uBlockOrigin/uBOL-home/wiki` |
| 5 | link | `aboutChangelog` (Changelog) | `https://github.com/uBlockOrigin/uBOL-home/releases` |
| 6 | link | `aboutCode` (Source code (GPLv3)) | `https://github.com/gorhill/uBlock` |
| 7 | heading (span) | `aboutContributors` (Contributors) | — |
| 7a | nested link | `aboutSourceCode` (Source code) | `https://github.com/gorhill/uBlock/graphs/contributors` |
| 7b | nested link | `aboutTranslations` (Translations) | `https://crowdin.com/project/ublock` |
| 7c | nested link | `aboutFilterLists` (Filter lists) | `https://github.com/uBlockOrigin/uAssets/graphs/contributors` |
| 8 | heading (span) | `aboutDependencies` (External dependencies (GPLv3-compatible):) | — |
| 8a-f | nested, hard-coded English `"<work> by <author>"`, two links each | see 4.2 | — |
| 9 | `<hr>` | — | — |
| 10 | `<details>` (closed) `<summary data-i18n="supportS5H">` (Troubleshooting information) + `<pre style="user-select:all; -webkit-user-select:all; direction:ltr;">` | troubleshooting text, §4.4 | — |

Lines: 1 `:170`; 2 `:171-173`; 3-6 `:174-177`; 7 `:178-183`; 8 `:184-192`;
9 `:193`; 10 `:194-196`.

### 4.2 Dependency credits, verbatim (`EXT/dashboard.html:186-191`)

| Work (link) | Author (link) |
|---|---|
| `Inter font family` → `https://github.com/rsms/inter` | `Rasmus Andersson` → `https://github.com/rsms` |
| `FontAwesome font family` → `https://fontawesome.com/` | `Dave Gandy` → `https://github.com/davegandy` |
| `Punycode.js` → `https://github.com/mathiasbynens/punycode.js` | `Mathias Bynens` → `https://github.com/mathiasbynens` |
| `Flags of the World` → `https://flagpedia.net/` | `David Krmela` → `https://www.davidkrmela.com/` |
| `CodeMirror 6` → `https://codemirror.net/` | `Marijn Haverbeke` → `https://github.com/marijnh` |
| `google-ima3-dai` → `https://github.com/AdguardTeam/Scriptlets/blob/master/src/redirects/google-ima3-dai.ts` | `Adam Wróblewski` → `https://github.com/AdamWr` |

The joining word ` by ` is hard-coded English. Keep these credits verbatim even
though the React pages use the system font. The fonts, the flags and CodeMirror
still ship and are used by the classic pages (`PRISTINE/css/common.css:3-26`
declares Inter and Metropolis).

### 4.3 Links

`dom.attr('a', 'target', '_blank')` runs once at load on every anchor in the
document (`EXT/js/dashboard.js:40`). Every About link therefore opens in a new
tab [H]. No `rel` is set. Links are styled without underline
(`EXT/css/dashboard-common.css:21-23`).
- R-10. Every About link uses `target="_blank"`. Adding
  `rel="noopener noreferrer"` is allowed: it has no visible effect.

### 4.4 Version string and troubleshooting text

Version line: `` `${manifest.name} ${manifest.version}` `` (`EXT/js/dashboard.js:36-37`).
- **[SAFARI]** `manifest.version` has three components. The Safari packaging
  folds month and day: `YYYY.M.D.N` → `YYYY.(M*100+D).N`
  (`SAFARI/patch-extension.js:79-94`). PRISTINE has `2026.1003.1243`.
- `manifest.name` is `"__MSG_extName__"` in the manifest
  (`SAFARI/manifest.json:39`). Whether Safari's `runtime.getManifest()` returns
  it localised ("Blocker") or raw is **UNKNOWN** (same as `messaging.md` §8.1
  and `i18n.md` U4). The harness mock returned "Blocker".
- R-11. Use `runtime.getManifest()` exactly. If the name starts with `__MSG_`,
  D-4 allows substituting `t('extName')` **in this header line only** (a
  documented deviation). The troubleshooting text's `name:` line keeps the raw
  `manifest.name` (`EXT/js/troubleshooting.js:110`), because R-12 requires
  byte-identical text.

Troubleshooting text (`EXT/js/dashboard.js:57-66`):
- Trigger: an `IntersectionObserver` on the `<pre>` that is **never
  disconnected**. Each time the `<pre>` becomes intersecting, it calls
  `getTroubleshootingInfo()` with no argument and replaces
  `pre.textContent`. The `<pre>` sits inside a closed `<details>`, so the
  first fetch happens when the user opens the disclosure. Closing and
  reopening fetches again [H: two `getConsoleOutput` sends after one
  close/reopen; re-run under H2: 10 calls on first open, the same set again
  after close/reopen]. Scrolling it back into view, or returning to the About pane
  while it is open, also refetches. The observer root is the viewport: if the
  opened `<pre>` lies below the visible area (small window), nothing is fetched
  until it is scrolled into view. Each trigger also re-runs the dynamic
  `import('./troubleshooting.js')` (cached after the first time).
  Out-of-order responses: the last one to resolve wins. There is no `catch`
  (`EXT/js/dashboard.js:60-64`): on failure the promise rejects unhandled and
  the `<pre>` keeps its previous content (empty at first). Failure cases
  (undefined responses, an enabled id missing from the details map) are listed
  in `messaging.md` §8.2.
- Requests: sent in one `Promise.all` (`EXT/js/troubleshooting.js:65-76`),
  exact payloads:
  `runtime.getPlatformInfo()`,
  `{ what: 'getDefaultConfig' }`,
  `{ what: 'getCurrentConfig' }`,
  `{ what: 'getEnabledRulesets' }`,
  `{ what: 'getRulesetDetails' }`,
  `{ what: 'getDefaultFilteringMode' }`,
  `{ what: 'getEffectiveUserRules' }`,
  `{ what: 'getConsoleOutput' }`,
  `{ what: 'getRegisteredContentScripts' }`,
  `{ what: 'hasBroadHostPermissions' }` [H, same order].
- Output: `details` is undefined here, so there is no `filtering.site`, no
  `badge`, and the whole `console` list. Keys appear in this order: `name`,
  `version`, `browser`, `filtering.default`, `permission`, optional
  `strictblock` and `popupblock` (only when they differ from the default),
  optional `user rules` (count), `rules` (sum of `rules.total` over enabled
  rulesets), `rulesets` (with `+`/`-` prefixes, sorted with the default string
  sort), optional `scripting`, optional `console`
  (`EXT/js/troubleshooting.js:103-155`).
  Rendering: `renderData`, one space of indent per depth, arrays one item per
  line (`EXT/js/troubleshooting.js:26-48`). Full field semantics are in
  `messaging.md` §8.2.
- **[SAFARI]** `browser` is `Safari <Version/x.y from the UA, or ?> (<platformInfo.os>)`,
  chosen because the extension URL starts with `safari-web-extension:`
  (`EXT/js/troubleshooting.js:84-87`, `:100`). `console` never appears on
  Safari (`messaging.md` §8.2).
- `strictblock` / `popupblock` print the *current* value when it differs from
  the default. Real defaults (`EXT/js/config.js:30-39`, returned by
  `getDefaultConfig`, `EXT/js/background.js:390-400`): `popupBlockMode: true`;
  `strictBlockMode: false` on Safari (`webextFlavor !== 'safari'`). So on
  Safari the possible lines are `popupblock: false` (the user turned popup
  blocking off) and `strictblock: true` (only through an admin policy, since
  the strict-block row is hidden on Safari). `popupblock: true` cannot appear
  with real defaults. The earlier `[H]` example showed it because its mock had
  the wrong default; corrected here.
- Example produced by the upstream code [H2]. Inputs: Safari 26.0 UA;
  `getPlatformInfo` → `{ os: 'mac' }`; Optimal default (`getDefaultFilteringMode`
  → 2); `hasBroadHostPermissions` → true; real `getDefaultConfig` defaults with
  `rulesets: ['ublock-filters','easylist','easyprivacy']`; `getCurrentConfig`
  with `popupBlockMode: false`; `getEnabledRulesets` →
  `['ublock-filters','easylist','adguard-mobile']` with `rules.total` 20, 10, 5;
  `getEffectiveUserRules`, `getConsoleOutput` → `[]`;
  `getRegisteredContentScripts` → `['css-specific.1','scriptlets.1']`.
  Byte-exact text (no trailing newline):

```
name: Blocker
version: 2026.1003.1243
browser: Safari 26.0 (mac)
filtering:
 default: optimal
permission: all
popupblock: false
rules: 35
rulesets:
 +adguard-mobile
 -easyprivacy
 easylist
 ublock-filters
scripting:
 css-specific.1
 scriptlets.1
```

- R-12. Send the same ten calls through `bridge.ts` (no swallowing; on failure
  show an `Alert` in place of the text) and produce byte-identical text.
  Transcribe `renderData` and the config builder as pure functions
  (`src/lib/model`), unit-tested against the example above and against
  `messaging.md` §8.2. Note that upstream mutates the `getEnabledRulesets`
  array in place (`EXT/js/troubleshooting.js:138-147`).
- R-13. Refetch on the same occasions as upstream. An IntersectionObserver
  (viewport root, never disconnected, ignoring callbacks where every entry has
  `isIntersecting === false`) on the text element gives exact parity: each
  open of the disclosure while the text is in view, each scroll back into
  view, and each return to the About pane while it is open. Do not fetch on
  mount or while the disclosure is closed.

Copy action: upstream has **no copy button**. The `<pre>` has
`user-select: all` (`EXT/dashboard.html:195`), so one click selects the whole
text and the user copies with ⌘C or the context menu. The text is forced LTR
by the same inline style.
- R-14. Keep the behaviour: a single click selects the whole text, and the text
  is LTR (`dir="ltr"`) inside an RTL page. A copy button is optional. No key or
  English value in `PRISTINE/_locales/en/messages.json` contains "copy"
  (re-checked by the audit, case-insensitive), so a button
  needs `tNew` and an `aria-live` confirmation.

---

## 5. Embedding contract: `dashboard-classic.html` inside the React dashboard

`dashboard-classic.html` is PRISTINE `dashboard.html`, renamed and
byte-identical (ARCHITECTURE §5). It is the whole upstream dashboard, not just
the two panes. Every controller runs in it (`messaging.md` §9.1). We may not
edit it. We control only `css/default.css`, which is regenerated, and our own
parent-side JavaScript. Parent and frame are same-origin, so the parent may
read and write `iframe.contentDocument`.

### E-1. One frame, one URL
- Use a single `<iframe src="dashboard-classic.html">` (relative to our
  `dashboard.html`) for both Custom filters and Develop. Switch between them
  inside the frame (E-5). Two frames would mean two full copies of every
  controller, two `getOptionsPageData`, two BroadcastChannel listeners and two
  CodeMirror instances.
- Never add a hash or query. The page ignores them (§2.2). Never change `src`
  after creation, and never reload the frame (E-8).

### E-2. When to create
- Create the frame the first time a frame pane (`filters` / `develop`) becomes
  the active pane. Before that, two conditions must hold: `getOptionsPageData`
  has arrived in the shell, and the pane is allowed by §2.3. Do not create it
  eagerly. Creating it costs one extra `getOptionsPageData` and the storage
  reads of `messaging.md` §9.1 / `settings.md` §2.1, plus the 390 KB CodeMirror
  bundle.
- **[SAFARI]** The frame also runs the Safari `ext-compat.js` module
  (`windows.onFocusChanged` ruleset-reload workaround,
  `SAFARI/ext-compat.js:28-64`), like any upstream page, because every
  upstream module imports it through `EXT/js/ext.js:22`. At module load it
  reads session `safari.seenRealms` (`SAFARI/ext-compat.js:40-43`) [H2: first
  storage call of the frame]. On a window-focus change for a realm not yet
  seen, the *page itself* writes session `safari.seenRealms` and calls
  `declarativeNetRequest.updateEnabledRulesets` with the current ids disabled
  and re-enabled (`SAFARI/ext-compat.js:45-62`). The background runs the same
  module too (`EXT/js/background.js:135`). The React pages do not load
  upstream modules, so they do not register this listener (deviation D-5).
  The shell must not replicate it.

### E-3. The frame's own start-up pane must already be right
The frame reads `dashboard.activePane` once at load, asynchronously, and applies
whatever string it finds (§2.2). That read can land after the parent's own
switch. [H]: with a slow read, the frame ended on `rulesets` although the parent
had set `filters`.
- R-15. On the click that first creates the frame, **await** the
  `storage.local.set({ 'dashboard.activePane': <filters|develop> })` of R-2
  before setting the iframe `src`. When the shell starts with a stored
  `filters`/`develop`, the value is already right and no write is needed.
  If the user selects another tab while that write is pending, the later
  selection's own R-2 write is issued after it (calls are issued in order;
  upstream relies on the same ordering, since it never awaits its writes). After the await, the frame is still created (hidden if the active pane
  is now a React pane), and its `desired` pane is the *last* frame pane the
  user selected.
- R-16. Also install the guard of E-6, because storage can be written
  concurrently, for example by another dashboard tab.

### E-4. Marker and CSS: hiding the frame's own header and foreign panes

Can a rule in `css/default.css` alone do it safely? **No.**
`css/default.css` is loaded by every upstream page: `popup.html`,
`dashboard.html`, `picker-ui.html`, `zapper-ui.html`, `unpicker-ui.html`,
`report.html`, `matched-rules.html`, `strictblock.html` (checked by grep). The
classic dashboard might also be opened top-level, as a fallback or by URL.
Unscoped rules such as `#dashboard-nav { display: none }` would break that page.
CSS cannot detect "I am in an iframe". So a second mechanism is needed: a
**marker attribute that the parent sets** on the frame's root element. The
generated `css/default.css` then contains rules scoped to that marker. The
marker name `data-blocker-embed` is not used anywhere in PRISTINE `js/` or
`css/` (checked by grep). Upstream only toggles classes on `<html>`
(`EXT/js/theme.js:31-39`), never attributes, so the marker survives.

- R-17. Parent sets
  `iframe.contentDocument.documentElement.setAttribute('data-blocker-embed', 'classic-dashboard')`,
  applies the desired pane (R-19) and installs the guard (R-20) **at the first
  moment the classic document exists**, not only at `load`:
  - from the moment `src` is set, check on every animation frame
    (`requestAnimationFrame` in the parent) whether `iframe.contentDocument`
    is the classic document (`contentDocument.location.pathname` ends with
    `/dashboard-classic.html`; the initial `about:blank` document does not)
    and has a `body`; when it does, run the setup once and stop polling;
  - on the iframe `load` event, run the same setup if it has not run yet
    (fallback). The setup must be idempotent (one marker, one guard).
  Why `load` alone is not enough: the frame reads the stored pane and renders
  long before `load`, which waits for every subresource. Until the marker
  exists, a stale `rulesets`/`about` value written concurrently (R-16) is
  displayed and its IntersectionObserver can initialise that pane (§2.1),
  which starts the classic Filter-lists pane (E-7). In Chrome this did not
  happen [H2: stored `rulesets`, 0 ms read, no awaited write, setup at `load`
  only → the pane was already `rulesets` at `load` but no `getEnabledRulesets`
  was sent], but nothing in the code orders it. With the polling setup [H2]
  the marker was set while the frame was still `readyState === 'loading'`
  (pane `settings`), and the guard reverted the later stored `rulesets` to
  `filters` before any rendering of it.
- R-18. The generated `css/default.css` must end with exactly these rules
  (`npm run build:legacy-css` emits them). `!important` is required:
  `EXT/css/dashboard.css:64-69` has the same specificity (0,3,2) and is loaded
  later (`EXT/dashboard.html:8` vs `:11`), so without `!important` upstream
  wins [H2: with the rules re-inserted without `!important`, a frame forced
  to `data-pane="settings"` showed the Settings section as `block`; with
  `!important` it was `none`].

```css
:root[data-blocker-embed] body > header {
    display: none !important;
}
:root[data-blocker-embed] body > section:is([data-pane="settings"], [data-pane="rulesets"], [data-pane="about"], [data-pane="busy"]) {
    display: none !important;
}
```

  The first rule hides the logo, the nav (all five tab buttons) and the
  Filter-lists header block (`EXT/dashboard.html:25-40`). `display: none`
  also takes the hidden buttons out of the tab order. The second rule makes
  Settings, Filter lists and About unreachable even if `body[data-pane]`
  changes. A `display: none` section never intersects, so its lazy
  initialisation never runs (§2.1). [H]: header `display: none`,
  `section[data-pane="settings"]` `display: none`, with the marker set. Without
  the marker (classic page top-level), both are `block`.
- These rules have no effect on any document without the marker, so the
  overlays, the report page and the popup are untouched.

### E-5. Switching the pane from the parent (verified)
- R-19. Switch with `iframe.contentDocument.body.dataset.pane = 'filters' | 'develop'`.
  This is exactly what the frame's own nav click does (`EXT/js/dashboard.js:44`),
  minus the storage write. The parent does that write itself (R-2). Nothing in
  `dashboard.js` or any other module listens for the change. CSS shows the
  section (`EXT/css/dashboard.css:66-67`). If this is the first display, the
  section's IntersectionObserver fires and the pane initialises:
  - Custom filters (`EXT/js/filter-manager-ui.js:607-631`): `getAllCustomFilters`,
    then a `browser.storage.local.onChanged` listener (`:620-628`). The sandbox
    editor's observer is registered but never fires on Safari (§2.3).
  - Develop (`EXT/js/develop.js:42-111`, `:616-628`): three dynamic module
    imports, `getRulesetDetails`, local read `dashboard.develop.editor`, then
    the selected editor's loader. The selected editor is the stored one when it
    is a valid option, else `modes` (`:159-162`): `modes` → `getFilteringModeDetails`
    (`EXT/js/mode-editor.js:56-59`) and it opens its own
    `BroadcastChannel('uBOL')` (`:37-48`); `dnr.rw.user` → local reads
    `userDnrRules` and `userDnrRuleCount` plus a `browser.storage.onChanged`
    listener (`EXT/js/rw-dnr-editor.js:43-58`); `dnr.ro.dynamic` /
    `dnr.ro.session` / `dnr.ro.<rulesetId>` → `getAllDynamicRules` /
    `getAllSessionRules` / `{ what: 'getRulesetRules', id }`
    (`EXT/js/ro-dnr-editor.js:32-58`).
  [H, H2, attribute-only switch, no stored editor: `getRulesetDetails` →
  local get `dashboard.develop.editor` → `getFilteringModeDetails`.]
- Do not drive the frame through `postMessage`: the page has no message
  listener. Do not call `.click()` on its hidden `.tabButton`. That works
  (event delegation, `EXT/js/dashboard.js:42`), but it writes storage a
  second time.

### E-6. Guard against the frame changing its own pane
Two upstream writers can change `body[data-pane]` after the parent set it: the
start-up storage read (`EXT/js/dashboard.js:52-55`) and the forced `about`
(`EXT/js/settings.js:33-35`, when `dashboard` is a disabled feature). The
second one does occur: with `dashboard` disabled, the Settings, Filter lists
and Custom filters tabs are hidden, but the Develop tab is not (§2.3), so the
shell can show the frame for Develop, and the frame's own `settings.js` then
forces `about` once its `getOptionsPageData` arrives. The guard must revert it.
- R-20. At the same moment as the marker (R-17: first poll hit, or `load` at
  the latest), observe the frame body with a
  `MutationObserver` (`attributes: true, attributeFilter: ['data-pane']`).
  Whenever the value differs from the parent's desired frame pane, set it
  back. Mutation callbacks run before the next rendering step, so the wrong
  pane is never laid out. Its observer therefore cannot fire. [H]: with the
  guard, a stale stored `rulesets` was reverted to `filters` and the frame
  sent no `getEnabledRulesets`. Without the guard, the frame stayed on
  `rulesets`, a blank pane because of E-4. [H2: same two results with a
  300 ms stored-pane read; also a parent-forced `rulesets` on a live frame was
  reverted to `develop`.]

### E-7. What must never be shown in the frame, and why

| Never shown | Why |
|---|---|
| Classic header / nav / logo / Filter-lists header block | duplicate navigation; its tab buttons would switch to panes we forbid, and they write `dashboard.activePane` |
| Classic **Settings** pane | second, independent writer of the same settings; its Reset/Restore set `body.busy` and its own state |
| Classic **Filter lists** pane | Its `beforeunload` commit is armed at **module load**, in every case: `applyEnabledRulesets` is an IIFE evaluated when `filter-lists.js` loads (`EXT/js/filter-lists.js:425-486`, listener `:466-471`), and `settings.js` imports that module statically (`EXT/js/settings.js:25`). On unload it runs `apply(true)` (`:426-462`), which sends `applyRulesets` (with `toRemove`) only if the checked leaves of ITS list DOM differ from ITS last render (`visuallyEnabledRulesets`), or if an entry is marked for removal. While the pane has never been displayed, both sides are empty and nothing is sent [H2: no `applyRulesets` in any run]. If it is ever displayed, it initialises (`:565`, `:120-130`), sends `getEnabledRulesets` + `getRulesetDetails`, sets `renderFilterLists.visible = true`, and from then on re-renders on every `enabledRulesets`/changed `adminRulesets` broadcast (`EXT/js/settings.js:305-322`). From that point its unload can send `applyRulesets` with **its own** view of the list: always when admin `+id` tokens exist, and whenever a broadcast was missed (`messaging.md` §9.1). That can silently undo changes made in the React Filter lists pane. Before it is displayed, broadcast re-renders return early (`EXT/js/filter-lists.js:121`). |
| Classic **About** pane | duplicate; its troubleshooting observer would send ten messages |
| Busy pane | only Settings actions trigger it |

Both E-4 (CSS, primary) and E-6 (guard) are required, and both must be in
place from the first poll hit of R-17.

### E-8. Unsaved state when switching
In upstream, switching panes only toggles CSS. Every pane keeps its DOM, so no
text is ever lost by switching (`EXT/js/dashboard.js:42-50`). Unsaved state that
lives in the frame:

| State | Where | Saved when | Lost when |
|---|---|---|---|
| Develop editor text | CodeMirror view. `lastSavedText` is the reference; `#developSave` / `#developRevert` are enabled while the text differs (`EXT/js/develop.js:138-141`, `:212-216`) | Save button or the editor's save shortcut (`saveListener`, `EXT/js/develop.js:75`, `:413-420`) | (a) the user picks another editor in `#editors`. `selectEditor` replaces the text with no prompt (`EXT/js/develop.js:143-148`, `:616-625`); (b) in the `modes` editor, a `filteringModeDetails` broadcast overwrites the text and marks it saved (`EXT/js/mode-editor.js:37-48`, upstream "TODO: merge with ongoing edits?"); (c) the document unloads. There is no `beforeunload` guard: the only `beforeunload` in PRISTINE `js/` is in `filter-lists.js:466` |
| Custom filters inline edit (contenteditable hostname/selector) | DOM text | on `focusout` or Enter (`EXT/js/filter-manager-ui.js:358-381`, `:610-612`). Each commit sends `removeAllCustomFilters`/`removeCustomFilters` + `addCustomFilters` (`:281-296`, `:312-327`) | unload before blur |
| Custom filters import textarea | `.importFromText textarea` | only when "Add" is clicked (`EXT/js/filter-manager-ui.js:616`) | unload |
| Sandbox editor | `#sandboxEditor` | — | **[SAFARI]** never shown (`EXT/css/settings.css:404-406`) |

Stale-text hazard (same as upstream, keep it): the `dnr.rw.user` editor reads
`userDnrRules` once when selected and listens only for `userDnrRuleCount`
changes (`EXT/js/rw-dnr-editor.js:43-58`). If the React Settings pane restores
or resets settings (which rewrites or removes `userDnrRules`, `messaging.md`
§12.1) while that editor is open, the frame keeps showing the old text, and a
later Save there writes it back (`EXT/js/rw-dnr-editor.js:285-290`). Upstream
behaves the same inside one page. Do not "fix" this by reloading the frame
(R-21).

Requirements:
- R-21. **Never unmount, reload or re-`src` the frame** once it exists. It
  lives as long as the React dashboard document. When a React pane (Settings,
  Filter lists, About) is active, hide the frame's container with
  `hidden`/`display: none`. Do not remove it. [H]: typed Develop text and the
  enabled Save button survived Develop → Settings → Develop, and the editor
  height was the same before and after.
- R-22. Do not add prompts or `beforeunload` handlers. Upstream has none for
  these panes. The parent may read `#developSave:not([disabled])` if it ever
  needs to know about unsaved Develop text, but this spec requires no use of
  it.
- Focus: when the user clicks a React tab while a contenteditable in the frame
  has focus, focus leaves the frame, `focusout` fires inside, and the edit is
  committed before the frame is hidden. [H, H2 T8, Chrome]: `removeAllCustomFilters`
  then `addCustomFilters` were sent. **UNKNOWN on Safari/WebKit** whether the inner `focusout` fires
  when focus moves to the parent document. Check this on the device (parity
  checklist item P-24).

### E-9. Height and scrolling
- Develop needs a definite frame height. `body[data-pane="develop"] { height: 100vh }`
  (`EXT/css/develop.css:1-3`) inside a column-flex body
  (`EXT/css/dashboard-common.css:1-6`), and `.cm-container` grows to fill it
  (`EXT/css/develop.css:5-34`). Inside a frame, `100vh` is the frame's own
  height. The editor fills the frame and scrolls internally [H: body height =
  frame height 652, editor 540, document not scrollable]. A frame that sizes
  itself to its content would be circular for Develop.
- Custom filters is normal flow. Its document grows and scrolls inside the
  frame.
- R-23. Give the iframe a fixed height equal to the space left below the React
  header: the content area fills the viewport, and the iframe has
  `width: 100%` and `height: 100%`, with no border. While a frame pane is
  active, the parent's content area must not scroll. Only the frame scrolls,
  which avoids double scrollbars.
- The frame content limits itself to `min(640px, 100%)` wide and centres
  itself (`EXT/css/dashboard-common.css:1-9`). Inside the dashboard the
  generated `css/default.css` changes that, only with the E-4 marker, to a
  start-aligned `min(48rem, 100%)` column, the React panes' `max-w-3xl`
  (`legacy-tokens.md` 6.5, B9, added after review). Do not narrow the
  iframe to achieve that; the warming skeleton uses the same column.
- While the frame is warming up (E-11), keep it laid out but invisible
  (`visibility: hidden` on the iframe), not `display: none`. The frame body is
  itself `visibility: hidden` until its own `getOptionsPageData` arrives
  (`EXT/css/settings.css:14-16`).

### E-10. Title and accessibility of the frame
- R-24. The iframe sits inside the React `tabpanel`. Its `title` attribute is
  the active pane's tab label: `t('customFiltersPageName')` or
  `t('developPageName')`. Update it on every switch. No new strings. The frame
  document's own `<title>` ("uBO Lite — Dashboard") is not a useful name.
- Switching tabs leaves focus on the React tab. Do not move focus into the
  frame. Tab moves from the tab panel into the frame. The hidden classic nav is
  `display: none` (E-4), so it is not in the tab order. CodeMirror does not
  trap Tab: `indentWithTab` is absent from
  `PRISTINE/lib/codemirror/cm6.bundle.ubol.min.js` (re-checked by grep; the only
  `"Tab"` string there is the key-name table).
- The frame can move focus into itself without the parent asking:
  `setEditorText` calls `view.focus()` (`EXT/js/develop.js:120-132`). That
  happens after a Save in the `modes` editor (`EXT/js/mode-editor.js:61-67`)
  and when a `filteringModeDetails` broadcast arrives while `modes` is
  selected (`:40-47`). So if the user has just keyboard-switched to the
  Develop tab and a popup changes a site's mode, focus jumps into the editor.
  Upstream does the same inside its own page. Accept it; do not fight it from
  the parent. While the frame's container is `display: none`, `focus()` on its
  content has no effect.
- Language and direction: the frame sets `body[dir]` itself
  (`SRC/js/i18n.js:34-45`) and has no `lang` (`EXT/dashboard.html:2`). The
  parent MAY set `documentElement.lang` to the shell's language on `load`.
  Whether the frame and the shell agree on RTL on Safari is UNKNOWN
  (`i18n.md` §2.2 item 8).
- Theme: upstream computes the frame's `html.dark`/`html.light` once at frame
  load (`EXT/js/theme.js:26-33`) and the CodeMirror dark theme once at editor
  creation (`oneDark: dom.cl.has(':root','dark')`, `EXT/js/develop.js:73`,
  `EXT/js/filter-editor.js:278`). Upstream therefore keeps the old theme after
  a live system switch. **The embedded frame does not: it follows the shell's
  theme live** (DECISION, 2026-10-04, closing review
  finding V4 of the legacy CSS; this deliberately differs from upstream, because a wrong-scheme
  slab inside the re-themed React dashboard is worse than upstream's
  whole-page consistency).
- R-26. The parent mirrors the shell's theme (`html[data-theme]`, set by
  `ui/theme-init.js`) onto the frame's `<html>` **exactly the way upstream
  `theme.js` marks it**: class `dark` when dark, class `light` otherwise, the
  other class removed; `mobile`/`desktop` and the R-17 marker untouched; no
  `data-theme` (nothing in the frame keys on it). It also sets the inline
  `color-scheme` of the frame's `<html>` to `dark`/`light`, so native
  controls (the Develop `<select>`, checkboxes, scrollbars) follow too; this
  wins over the frame's `<meta name="color-scheme" content="light dark">`.
  When: at setup (E-11 step 3), at `load`, on every shell theme change, and
  whenever the frame itself writes a different class on `<html>` (its own
  `theme.js` is a deferred module that runs after step 3 and answers from its
  own `matchMedia`; a MutationObserver on the frame's `<html>` puts the
  shell's theme back, writing only what differs). Never by reloading or
  re-`src`-ing the frame (R-21): unsaved editor text survives. Implemented by
  `applyThemeToDocument` / `ClassicFrameController`
  (`src/dashboard/panes/Classic/classic-frame-controller.ts`).
  What follows and what does not (Chrome, verified by
  `tests/e2e/classic-frame.theme.mjs`): every colour that comes from
  `css/default.css` variables follows, and after a switch the frame matches a
  frame *loaded* in the new scheme: page background and ink, the editor's
  background, ink, gutter, active line, error lines and `ubol-*` token inks
  (the generated B7 block overrides CodeMirror's chrome through `--cm-*`,
  `legacy-tokens.md` 4.4). CodeMirror's own One Dark / light rules that B7
  does not override stay as they were when the editor was created until the
  dashboard is reopened (`legacy-tokens.md` 4.4 "Not covered": selection
  match, non-matching bracket, autocomplete selection, search-match outline,
  fold placeholder background). A top-level classic page (not embedded) is
  unchanged: it keeps its load-time scheme, as upstream.
  `css/default.css` must therefore support `:root.dark` / `:root.light` as well
  as `prefers-color-scheme`. Upstream does both
  (`SRC/css/themes/default.css:173-203`: `@media (prefers-color-scheme: …)`
  blocks at `:173`, `:181`, then `:root.light` at `:190` and `:root.dark` at
  `:197`; further `:root.dark` rules at `:309`, `:384`, `:485`, `:511`).

### E-11. Ready sequence (normative order)
1. User selects `filters`/`develop` and no frame exists yet: set `desired` and
   await the storage write (R-15).
2. Create the iframe, invisible (E-9), start the R-17 poll, then set
   `src = 'dashboard-classic.html'`.
3. At the first poll hit (or on `load` if the poll has not hit): set the
   marker (R-17), apply `desired` to `body.dataset.pane` (R-19), install the
   guard (R-20), mirror the shell's theme and start following it (R-26).
   Run this once.
4. When the frame `body` no longer has class `loading` (observe its `class`
   attribute), make the iframe visible.
5. Later switches between `filters` and `develop`: R-19 only. Switches to a
   React pane: hide the container (R-21). Persistence is R-2 in all cases.
- R-25. If the frame `body` still has `loading` after a reasonable timeout,
  show an `Alert` in the panel. This means its `getOptionsPageData` failed:
  upstream would stay blank forever (§1.2). The timeout value is the
  implementer's choice. The text needs `tNew`. Do not reload the frame
  automatically.

### E-12. Messages and side effects caused by the frame (for message-parity tests)
Parity tests must attribute every call to its document (shell or frame). The
frame's calls are upstream behaviour and are not counted against the React
pages (`settings.md` §2.3 ownership note, `messaging.md` §9.1).

At frame creation, in this order [H2]:
1. session read `safari.seenRealms` (`SAFARI/ext-compat.js:40`);
2. local read `dashboard.activePane` (`EXT/js/dashboard.js:52`);
3. local read `hideUnusedFilterLists` (`EXT/js/filter-lists.js:380`);
4. `{ what: 'getOptionsPageData' }` (`EXT/js/settings.js:329-331`); on success
   the frame opens its own `BroadcastChannel('uBOL')` (`:244-247`, `:350`);
5. the lazy calls of the first frame pane shown (E-5).

Later, only on user action inside the frame (never caused by the shell):
- Custom filters: `addCustomFilters`, `removeCustomFilters`,
  `removeAllCustomFilters` (`EXT/js/filter-manager-ui.js:101`, `:116`, `:284`,
  `:291`, `:315`, `:322`, `:513`); clipboard write on a copy icon (`:429-430`);
  `data:` download on Export (`:574-578`); file picker on Import (`:538-555`).
- Develop: local write `dashboard.develop.editor` on an editor switch
  (`EXT/js/develop.js:624`) followed by that editor's loader (E-5);
  `setFilteringModeDetails` on a `modes` Save (`EXT/js/mode-editor.js:64`);
  local write or remove `userDnrRules` then `updateUserDnrRules` on a
  `dnr.rw.user` Save (`EXT/js/rw-dnr-editor.js:285-291`); file picker / `data:`
  download on Import / Export (`EXT/js/develop.js:523-555`).

Never, while E-4 and E-6 hold: any write of `dashboard.activePane` (its nav is
hidden), `hideUnusedFilterLists` writes, `getEnabledRulesets`, `applyRulesets`,
`importFilterList`, any Settings-pane message (`setDefaultFilteringMode`,
`set*Mode`, `setDeveloperMode`, …), `permissions.request`, and the ten
troubleshooting calls of §4.4 [H2: none of these appeared in any run].

[H] and [H2] sequence (no stored Develop editor): shell
`local.set dashboard.activePane=filters` → frame `session.get safari.seenRealms`
→ frame `local.get dashboard.activePane` → frame `local.get hideUnusedFilterLists`
→ frame `getOptionsPageData` → frame `getAllCustomFilters` → frame
`local.onChanged.addListener` → shell `local.set …=develop` → frame
`getRulesetDetails` → frame `local.get dashboard.develop.editor` → frame
`getFilteringModeDetails`.

---

## 6. Deviations summary

| Id | Deviation | Reason |
|---|---|---|
| D-1 | requested pane hidden or unknown → show Settings, no storage write | a11y: no orphan tabpanel |
| D-2 | Develop shown and developer mode turned off → show Settings, no storage write | same |
| D-3 | logo `alt` = `t('extName')` instead of hard-coded `uBO Lite` | rename consistency |
| D-4 | `__MSG_`-prefixed manifest name → `t('extName')`, About header line only (not the troubleshooting `name:` line) | only if Safari returns the raw placeholder (UNKNOWN) |
| D-5 | the React dashboard document does not register the Safari `windows.onFocusChanged` ruleset-reload listener that every upstream page gets from `ext-compat.js` (E-2); the background and the classic frame (once created) still do | React pages do not load upstream modules (ARCHITECTURE §6.4) |
| — | tabs get ARIA semantics and a visible focus ring | ARCHITECTURE §6.10 |
| — | failures are shown (`Alert`) instead of a silently blank page or `<pre>` | ARCHITECTURE §6.5 |

Disagreements with research. Upstream code wins in each case:
- The original plan proposed a separate React key for the active
  tab and a `classic-embed.css` injected into the classic page. Both are
  rejected. Parity requires the same key (R-2, E-3). The classic page must stay
  byte-identical (ARCHITECTURE §5), so the hiding rules go into the generated
  `css/default.css`, scoped by a parent-set marker (E-4).

---

## 7. UNKNOWN

- U-1. Whether Safari's `runtime.getManifest().name` is localised or
  `__MSG_extName__` (§4.4).
- U-2. Whether WebKit fires `focusout` inside a same-origin iframe when focus
  moves to the parent document (E-8).
- U-3. Whether CodeMirror re-measures correctly in WebKit after its frame
  container goes from `display: none` back to visible. It did in Chrome [H].
- U-4. Whether WebKit's IntersectionObserver fires for elements inside a
  same-origin iframe that is `visibility: hidden` in the parent. This affects
  only whether a pane initialises during warm-up or right after reveal, not
  correctness.
- U-5. Whether Safari reports `userScripts` support (§2.3). Expected `false`
  (no `userScripts` permission in `PRISTINE/manifest.json:303-312`). It has no
  visible effect on Safari, because both `.userScriptsInfo` notes are inside
  containers already hidden without `compiled-filters` (§2.3).
- U-6. Whether Safari applies any frame-related policy to extension pages that
  embed extension pages. There is no `content_security_policy` in
  `PRISTINE/manifest.json`, and the frame is same-origin. No problem is
  expected, but it has not been tried on Safari.
- U-7. Whether these upstream actions work from inside the same-origin frame
  on Safari: `navigator.clipboard.write` on a Custom-filters copy icon
  (`EXT/js/filter-manager-ui.js:429-430`), `data:`-URL downloads through
  `a.click()` on Export (`:574-578`; `EXT/js/develop.js:546-555`), and file
  pickers opened with `input.click()` on Import (`EXT/js/filter-manager-ui.js:538-555`;
  `EXT/js/develop.js:523-544`). Same-origin frames inherit the page's
  permissions in the specs, but none of this was tried on Safari, top-level or
  framed.
- U-8. Whether the classic frame's pane can render and initialise before the
  R-17 poll hits in WebKit. In Chrome the poll hit while the frame was still
  `loading` [H2].

---

## 8. Parity checklist (shell and About)

Shell
- [ ] P-1 Five tabs in order Settings, Filter lists, Custom filters, Develop, About, labelled with `settingsPageName`, `aboutFilterLists`, `customFiltersPageName`, `developPageName`, `aboutPageName`.
- [ ] P-2 Selecting Settings calls `storage.local.remove('dashboard.activePane')`. Selecting any other tab calls `storage.local.set({'dashboard.activePane': id})`. Nothing else is written.
- [ ] P-3 Reopening the dashboard shows the stored pane. Absent or non-string means Settings. No URL hash or query is used.
- [ ] P-4 The Develop tab is visible only when `Boolean(developerMode) && disabledFeatures?.includes('develop') !== true` (absent `disabledFeatures` counts as empty). It appears or disappears immediately on the toggle (before the background answers) and on a `{ developerMode }` broadcast received after start-up.
- [ ] P-5 `disabledFeatures` with `dashboard` hides the Settings, Filter lists and Custom filters tabs and, once both the stored-pane read and `getOptionsPageData` have resolved, shows About without writing storage, whatever the order in which they resolved (test both orders). The Develop tab is still shown when effective developer mode is on, and selecting it writes `dashboard.activePane = 'develop'` and shows the frame on Develop (the frame's own forced `about` is reverted by the guard). With `picker`, only the Custom filters tab is hidden.
- [ ] P-6 Hidden or unknown stored pane → Settings (D-1). Developer mode turned off on Develop → Settings (D-2).
- [ ] P-7 [SAFARI] No tab is hidden because of the platform.
- [ ] P-8 `document.title` = `t('dashboardName')`. Favicon `img/icon_64.png`. Header logo `img/ublock.svg` named by `extName`.
- [ ] P-9 Nothing is shown before `getOptionsPageData` arrives (skeleton). A failure shows an `Alert`.
- [ ] P-10 Tabs are a real tablist with visible focus and full keyboard operation.

About
- [ ] P-11 The first line is `${getManifest().name} ${getManifest().version}`, e.g. `Blocker 2026.1003.1243`, with LTR isolation. With a mock `getManifest().name` of `__MSG_extName__` the line shows `t('extName')` (D-4) while the troubleshooting `name:` line still shows `__MSG_extName__`.
- [ ] P-12 `Copyright (c) Raymond Hill 2014-present` is present and untranslated.
- [ ] P-13 The four top links and the three contributor links have the exact keys and URLs of §4.1. All open in a new tab.
- [ ] P-14 The six dependency credits are verbatim, with both links each (§4.2).
- [ ] P-15 There is a "Troubleshooting information" (`supportS5H`) disclosure, closed by default.
- [ ] P-16 Nothing is sent on mount or while the disclosure is closed. Opening it (text in view) sends exactly the ten calls of §4.4, all started before any is awaited. Closing and reopening sends them again; so does leaving the About pane and returning with the disclosure open.
- [ ] P-17 The text is byte-identical to upstream `getTroubleshootingInfo()` for the same responses: unit test with the §4.4 example (`popupblock: false`, no trailing newline) and with `messaging.md` §21.6 item 35; the `getEnabledRulesets` array the bridge returns to other callers is not mutated.
- [ ] P-18 One click selects the whole text. The text is LTR in an RTL locale.

Embedded classic panes
- [ ] P-19 There is exactly one iframe, `src="dashboard-classic.html"`, created lazily, never reloaded or unmounted.
- [ ] P-20 The marker `data-blocker-embed="classic-dashboard"` is set at the first R-17 poll hit (before `load` in Chrome; `load` is only a fallback). The generated `css/default.css` ends with the two R-18 rules, `!important` included. Inside the frame, no classic header or nav is visible, and forcing `body.dataset.pane` to `settings`, `rulesets`, `about` or `busy` never yields a displayed section (computed `display: none`).
- [ ] P-21 Custom filters ↔ Develop switching is done via `contentDocument.body.dataset.pane`, with the MutationObserver guard installed together with the marker. A stale stored `rulesets` (300 ms read, and 0 ms read) ends with the frame on the desired pane and no `getEnabledRulesets` from the frame.
- [ ] P-22 A first visit to the frame pane is preceded by an awaited write of `dashboard.activePane`.
- [ ] P-23 Unsaved Develop text survives Develop → Settings → Develop.
- [ ] P-24 [SAFARI, device] Editing a custom-filter hostname and then clicking a React tab commits the edit (`addCustomFilters` is sent).
- [ ] P-25 The frame fills the remaining height. The Develop editor fills the frame. There is no double scrollbar.
- [ ] P-26 The iframe `title` follows the active pane label.
- [ ] P-27 Over a whole session (create frame, switch both panes, broadcasts of `enabledRulesets`, close the dashboard tab), the frame sends none of the "Never" items of E-12: no `getEnabledRulesets`, no `applyRulesets`, no `dashboard.activePane` or `hideUnusedFilterLists` write, no troubleshooting batch.
- [ ] P-28 Every rule appended to `css/default.css` starts with `:root[data-blocker-embed]`; on `popup-classic.html`, `dashboard-classic.html` opened top-level, `picker-ui.html`, `zapper-ui.html`, `unpicker-ui.html`, `report.html`, `matched-rules.html` and `strictblock.html` (no marker) the computed `display` of the header and of every `body > section` equals that obtained with PRISTINE `css/default.css`.
- [ ] P-29 The frame's start-up calls are exactly the E-12 list, in that order, and they are attributed to the frame, not to the React pages.
- [ ] P-30 Selecting a frame pane, then a React tab, while the first-creation write is still pending: the final stored value is the last selection, and the frame (created after the await) shows the last frame pane selected.
- [ ] P-31 [SAFARI, device] Inside the frame: copy icon puts text on the clipboard, Export downloads a file, Import opens a file picker (U-7).
- [ ] P-32 With the system theme switched while the dashboard is open (light->dark and dark->light), the frame follows the shell live (R-26): its `<html>` gets `dark` xor `light` and `color-scheme` of the new scheme, and its body, editor background/ink/gutter/token colours and native `<select>` equal those of a frame loaded in the new scheme; the frame is not reloaded (a window sentinel and unsaved Develop text survive). Deliberately differs from upstream, which keeps the load-time theme. Test: `tests/e2e/classic-frame.theme.mjs`.

---

## 9. Harness evidence [H]

A temporary folder holding a copy of PRISTINE (no
rulesets), plus `dashboard-classic.html`, `css/default.css` with the R-18
rules appended, a parent page implementing E-1..E-11, `mock.js` (the `browser`
API backed by the en messages), and `run.mjs` / `about.mjs` (playwright-core,
system Chrome, headless, random port). Results:
- Frame `filters`: header `display: none`; settings section `display: none`;
  filters section `block`; 2 hostname rows rendered; sandbox editor
  `display: none` (`data-supports` without `compiled-filters`);
  `body[data-platform="safari"]`.
- Inline edit followed by a click on a parent tab: `addCustomFilters` sent.
- Develop: CodeMirror created; body height = frame height = 652; editor 540;
  the document does not scroll.
- Unsaved text and enabled Save survived a Develop → Settings → Develop cycle
  with the container hidden in between.
- Race test (stored `rulesets`, slow read, no awaited write): without the
  guard, the final pane was `rulesets` (blank, and no Filter-lists messages,
  thanks to the CSS). With the guard, the final pane was `filters`.
- The top-level classic page without the marker shows its header and the
  Settings section as normal.
- About (classic page, Safari UA): title "uBO Lite — Dashboard"; name/version
  "Blocker 2026.1003.1243"; logo `title` "Blocker", `alt` "uBO Lite"; all 19
  anchors have `target=_blank`; the troubleshooting text matches the §4.4
  example; it was fetched again after close/reopen.

The results that an R-n depends on were re-run under 9.1.

### 9.1 Second harness [H2]

A temporary folder with `site/` (PRISTINE copy without
`rulesets/` and non-`en` locales, plus `dashboard-classic.html`, the R-18
rules appended to `css/default.css`, and `parent.html`/`parent.js`, a minimal
non-React parent that follows E-1..E-11 with switches for awaited write, guard
and early (polling) setup) and `run.mjs` (mock `browser` installed with
`addInitScript` in every frame, storage shared through `window.top`, Safari 26.0
UA, playwright-core with system Chrome, headless, random port). Output in
`out.json`. Results:
- T1, top-level classic page: title `uBO Lite — Dashboard`; header and
  Settings section `block`; `#aboutNameVer` `Blocker 2026.1003.1243`; 19
  anchors, 19 with `target=_blank`; logo `title` `Blocker`, `alt` `uBO Lite`;
  `data-platform="safari"`, `data-supports=""`, no `firstRun` class. Opening
  the troubleshooting disclosure: `getPlatformInfo` then the nine messages in
  §4.4 order; the text equals the §4.4 example byte for byte; close and reopen
  sent the nine messages again.
- T2, top-level classic page with `disabledFeatures: ['dashboard']`, developer
  mode on, stored `develop`: final pane `about`; Settings tab `none`; Develop
  and About tabs `flex`. Clicking Develop showed the Develop section and wrote
  `dashboard.activePane = 'develop'`.
- T3, parent + frame (awaited write, guard): frame `filters`: marker set,
  header/settings/rulesets/develop/about `none`, filters `block`, editor-free
  document not scrollable. Frame `develop`: one `.cm-editor`, body height =
  frame height = 652. Forcing `rulesets` on the live frame was reverted to
  `develop` by the guard. Call sequence as in E-12.
- T4, R-18 without `!important`: with the marker and `data-pane="settings"`
  the Settings section computed `block`. With `!important` it computed `none`.
- T5, stored `rulesets`, 0 ms read, no awaited write, guard on. Setup at `load`
  only: at `load` the frame already had `data-pane="rulesets"`, readyState
  `complete`. No `getEnabledRulesets` was sent, final pane `filters`. With
  polling setup: the marker was set while the frame was `loading` with pane
  `settings`, and the guard reverted the stored `rulesets` to `filters`.
- T6, stored `rulesets`, 300 ms read, no awaited write: guard on → final
  `filters`; guard off → final `rulesets` with a blank frame. In both cases the
  frame sent only `getOptionsPageData` and `getAllCustomFilters`.
- T7, typed text in the Develop editor, then Settings (container
  `hidden`), then Develop: Save still enabled, editor height 540 before and
  after.
- T8, Custom filters frame: click into the `example.com` hostname, type one
  character, click the parent's Settings tab: the frame sent
  `removeAllCustomFilters`, `addCustomFilters`, `getAllCustomFilters`
  (Chrome; Safari is U-2).

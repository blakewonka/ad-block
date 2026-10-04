# Popup spec — the toolbar popup (`popup.html`)

Status: behaviour spec, transcribed from upstream source and checked by running the
upstream popup against a recording mock (Appendix A). Implementers follow this file
INSTEAD of reading upstream code. Nothing here is a visual-design proposal.
Audited on 2026-10-04 (Appendix A.2): every payload, condition and timer was re-read against the cited
lines and the key scenarios were re-run.

Companion specs: message shapes and background handlers are in
`docs/specs/messaging.md` §4 ("Popup"); string tables are in `docs/specs/i18n.md` §3.1.
Where those files and this one disagree, re-read the cited upstream lines.

## 0. Conventions

- `ROOT` = `upstream`.
- A path without prefix (`js/popup.js:60`, `popup.html:19`, `css/popup.css:76`) is relative
  to `ROOT/platform/mv3/extension/`. `bg:N` is short for `js/background.js:N`.
- `safari/…` = `ROOT/platform/mv3/safari/…`. `PRISTINE/…` = `build/pristine/safari/…`.
- Files that exist only in the built extension are cited as `PRISTINE/js/dom.js`,
  `PRISTINE/js/i18n.js`, `PRISTINE/js/punycode.js`, `PRISTINE/js/fa-icons.js`,
  `PRISTINE/css/default.css`, `PRISTINE/css/common.css` (their sources are `ROOT/src/js/dom.js`,
  `ROOT/src/js/i18n.js`, `ROOT/src/lib/punycode.js`, `ROOT/src/js/fa-icons.js`,
  `ROOT/src/css/themes/default.css`, `ROOT/src/css/common.css`; byte-identical, checked with `cmp`).
- Line numbers were checked against PRISTINE: `popup.html`, `js/popup.js`, `css/popup.css`,
  `css/filtering-mode.css`, `js/background.js`, `js/ext.js`, `js/ext-utils.js`, `js/mode-manager.js`,
  `js/debug.js`, `js/admin.js`, `js/filter-manager.js`, `js/config.js`, `js/theme.js`, `js/utils.js`,
  `js/report.js`, `js/matched-rules.js`, `js/scripting/{tool-overlay,zapper,picker,unpicker,css-procedural-api}.js`
  are byte-identical between `ROOT/platform/mv3/extension` and PRISTINE. `PRISTINE/js/ext-compat.js`
  is `safari/ext-compat.js`.
- "UNKNOWN" = could not be determined from source or from the mock run; nobody may assume a value.
- "Upstream quirk" = behaviour that looks like a defect but is what upstream does.
- `[V]` after a statement = also observed at run time (Appendix A). The mock run used headless
  Chrome, not Safari: it proves what upstream `popup.js` does with given API answers, not what
  Safari's APIs answer.
- Shorthand used below: `TAB` = `currentTab.id`; `HOST` = `tabURL.hostname`; `URL` = `tabURL.href`;
  `EXT` = the extension origin returned by `runtime.getURL('/')`.

Research disagreement (upstream wins): an earlier research note said the
matched-rules button can never be enabled on this build. `PRISTINE/manifest.json:311` DOES list
`declarativeNetRequestFeedback` (added for local builds by `ROOT/tools/make-mv3.sh:169-174`), so
`isSideloaded` is `true` in PRISTINE (js/debug.js:37-40) and the button appears when developer
mode is on (§7.1).

---

## 1. Files, load order, static structure

The popup is the manifest's `action.default_popup` (safari/manifest.json:2-5; `PRISTINE/manifest.json:2-5`).
After staging, the upstream page is kept as `popup-classic.html` (ARCHITECTURE §5).

Stylesheets, in order: `css/default.css`, `css/common.css`, `css/fa-icons.css`, `css/filtering-mode.css`,
`css/popup.css` (popup.html:8-12). Module scripts, in order: `js/theme.js`, `js/fa-icons.js`, `js/i18n.js`,
`js/popup.js` (popup.html:60-63). They are `type="module"`, so they run in that order after parsing.

| Script | What it does to the popup | Source |
|---|---|---|
| `js/theme.js` | sets `html.dark` or `html.light` from `prefers-color-scheme` once at load (no change listener); sets `html.mobile` when `(hover: hover)` does not match, otherwise `html.desktop` | js/theme.js:26-33, 35-40 `[V]` |
| `js/fa-icons.js` | replaces the text of every `.fa-icon` element (an icon name) with an inline SVG | PRISTINE/js/fa-icons.js:90-131 |
| `js/i18n.js` | sets `body[dir]` to `rtl` for UI locales `ar`, `he`, `fa`, `ps`, `ur`, else `ltr`; fills `[data-i18n]` text, `[data-i18n-title]` → `title`, and replaces every `aria-label` value (a key) by its message | PRISTINE/js/i18n.js:39-44, 193-199, 245-249, 251-255, 346 `[V]` |
| `js/popup.js` | binds all handlers at module top level, then runs `tryInit()` | js/popup.js:178-294, 362 |
| `js/ext.js` → `js/ext-compat.js` (imported by `js/popup.js`) | on Safari, loading the module runs `safari/ext-compat.js` top level in the popup: `browser.storage.session.get('safari.seenRealms')` and `browser.windows.onFocusChanged.addListener(forceEnableRulesets)`. On a later window-focus change the handler may call `windows.get`, `storage.session.set({ 'safari.seenRealms': … })`, `declarativeNetRequest.getEnabledRulesets()` and `declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ids, enableRulesetIds: ids })` — see §12 item 5 | js/popup.js:22; js/ext.js:22; safari/ext-compat.js:24, 34-64 `[V]` (the two load-time calls) |
| `js/dom.js`, `js/punycode.js` (imported by `js/popup.js`) | DOM helpers (`dom.on` delegation, `dom.cl.toggle`, `dom.text`); IDN decoding for display. No side effect at load | js/popup.js:23, 25; PRISTINE/js/dom.js:24-51, 184-190 |

Static markup (popup.html:16-58):

| Element | Markup facts | Source |
|---|---|---|
| `<html id="uBO-popup-panel" class="desktop">` | `desktop` is the static default, corrected by `theme.js` | popup.html:2 |
| `<body class="loading busy">` | both classes present before any script runs | popup.html:16 |
| `#hostname` | two empty `<span>`s separated by a soft hyphen | popup.html:19 |
| `.filteringModeSlider.needData` | one thumb `div.filteringModeButton` and four stops `span[data-level="0".."3"]`, each with `aria-label="filteringMode<N>Name"` (a key, localised at load). No `role`, no `tabindex` | popup.html:21-27 `[V]` |
| `#filteringModeText.needData` | `<label data-i18n="popupFilteringModeLabel">`, `<br>`, span 1 (placeholder text `_`), span 2 (empty) | popup.html:29 |
| `.toolMenu.localTools.needHTTP` | `<label data-i18n="popupLocalToolsLabel">` then, in this order, `#gotoZapper.tool.enabled`, `#gotoPicker.tool.enabled`, `#gotoUnpicker.tool` (NOT `enabled`), `#gotoReport.tool.enabled`; each is a `<span tabindex="0">` with an icon and a `[data-i18n]` label | popup.html:31-49 |
| `.toolRibbon.globalTools` | `#gotoMatchedRules.fa-icon.tool` (NOT `enabled`; hard-coded English `title="Show matched rules"` and caption), then `#gotoDashboard.fa-icon.tool.enabled` (`data-i18n-title="popupTipDashboard"`, caption `data-i18n="popupTipDashboard"`); both `tabindex="0"` | popup.html:51-54 |
| `<aside>` | busy overlay holding a `spinner` icon | popup.html:56-58 |

Icon names used upstream (identification only): `bolt` zapper, `eye-slash` picker, `eye-open` unpicker,
`comment-alt` report, `list-alt` matched rules, `cogs` dashboard, `spinner` busy (popup.html:34, 38, 42, 46, 52, 53, 57).

---

## 2. State model

Upstream keeps state in three module objects and in DOM classes/attributes. A re-implementation
needs the same pieces of state, whatever it calls them.

| State | Upstream location | Meaning | Source |
|---|---|---|---|
| `currentTab` | module object, filled by `Object.assign(currentTab, tab)` | the active tab; only `id` and `url` are read | js/popup.js:30, 304 |
| `tabURL` | `URL` object, initial value `new URL(runtime.getURL('/'))` | the page URL the popup acts on (the unwrapped URL on a strict-block page) | js/popup.js:31, 308-313 |
| `popupPanelData` | module object, filled by `Object.assign(popupPanelData, response)` once | the background's answer; NEVER refreshed while the popup is open | js/popup.js:29, 326 |
| current level | `.filteringModeSlider[data-level]` | the level the control shows (optimistic during a commit) | js/popup.js:46-47 |
| level before | `.filteringModeSlider[data-level-before]` | the level shown when the user started the current change | js/popup.js:165, 187 |
| `loading` | `body.loading` | whole popup invisible | popup.html:16; css/popup.css:29-31; js/popup.js:358 |
| `busy` | `body.busy` | input blocked; overlay after 1 s | css/popup.css:46-48, 70-74; js/popup.js:55-57, 358 |
| `nodata` | `body.nodata` | "not a website" state | js/popup.js:353; css/popup.css:76-78 |
| `isHTTP` | `html.isHTTP` | local tools section exists | js/popup.js:341-342; css/popup.css:149-151 |
| forbid tokens | `body[data-forbid]` (space-separated) | admin-disabled features | js/popup.js:35-39; css/popup.css:97-109 |
| `moving` | `.filteringModeSlider.moving` | a thumb drag is in progress | js/popup.js:146, 171 |
| `mobile` / `desktop` | `html.mobile` / `html.desktop` | no-hover device / hover device | js/theme.js:35-40 |

`js/popup.js` itself reads and writes NO storage and has NO `BroadcastChannel` or `runtime.onMessage`
listener (js/popup.js, whole file): a change made elsewhere while the popup is open is not reflected. The
background does broadcast after a level change (`BroadcastChannel('uBOL')` message
`{ defaultFilteringMode, hasOmnipotence, filteringModeDetails }`, js/mode-manager.js:304-322), but the popup
does not listen. The only storage access in the upstream popup PAGE comes from the imported Safari compat
module (`storage.session` key `safari.seenRealms`, safari/ext-compat.js:40-43, 55) — §1 table, §12 item 5;
that access is not a parity target (§13).

Complete list of `what` values the popup ever sends: `popupPanelData`, `setPendingFilteringMode`,
`setFilteringMode`, `gotoURL`, `showMatchedRules` (js/popup.js:69, 94, 222, 242, 321). Complete list of
browser-API calls made by `js/popup.js`: `tabs.query`, `permissions.request`, `tabs.reload`, `tabs.update`,
`scripting.executeScript`, `runtime.openOptionsPage`, `runtime.getURL`, `runtime.sendMessage`,
`i18n.getMessage`, plus `self.close()` (js/popup.js:31, 79, 105, 107, 237, 252, 259, 263, 270, 278, 285, 293, 299, 308; js/ext.js:52).
Made by the imported modules at load: `i18n.getMessage('@@ui_locale')` and the other `i18n.getMessage` calls of
`js/i18n.js` (PRISTINE/js/i18n.js:39-44, 193-255), `storage.session.get('safari.seenRealms')` and
`windows.onFocusChanged.addListener` (safari/ext-compat.js:40, 64) `[V]`.

Every message the popup sends goes through the background's `onMessage`, which first awaits
`isFullyInitialized` (bg:343) and then rejects senders whose `sender.origin` is not the extension origin
(bg:376-378; the popup passes). While the background is still starting (first run, wake-up, ruleset
loading) the popup's `popupPanelData` request is held until start-up finishes, so the upstream popup stays
blank (`body.loading`) for that time (§3.1 "no timeout").

---

## 3. Initial data load

### 3.1 Sequence (`init()`, js/popup.js:298-347; wrapper `tryInit()`, js/popup.js:349-360)

1. `const [ tab ] = await browser.tabs.query({ active: true, currentWindow: true })` (js/popup.js:299-302) `[V]`.
2. If `tab` is not an object → outcome NO-WEBSITE (js/popup.js:303) `[V]`.
3. `currentTab` := `tab` (js/popup.js:304).
4. Inside one `try` (js/popup.js:307-315):
   a. `strictBlockURL = runtime.getURL('/strictblock.')` (js/popup.js:308);
   b. `url = new URL(currentTab.url)` (js/popup.js:309);
   c. if `url.href.startsWith(strictBlockURL)` → `url = new URL(url.hash.slice(1))` (js/popup.js:310-312).
      The strict-block page carries the blocked URL, unencoded, after `#`
      (js/ruleset-manager.js:301; js/strictblock.js:55-56);
   d. `tabURL.href = url.href || ''` (js/popup.js:313).
   Any exception is swallowed (js/popup.js:314-315). If 4b throws, `url` stays `undefined`. If 4c throws
   (empty or percent-encoded hash), `url` stays the strict-block URL and `tabURL` keeps its initial value.
5. Outcome NO-WEBSITE if `url === undefined`, or `url.hostname === ''`, or `url.protocol` does not match
   `/^https?:/` (js/popup.js:316-318) `[V]`.
6. `response = await sendMessage({ what: 'popupPanelData', origin: url.origin, hostname: tabURL.hostname })`
   (js/popup.js:320-324) `[V]`.
7. If `response` is not an object (`undefined`, `null`, a failed send — js/ext.js:51-55) → outcome NO-WEBSITE
   (js/popup.js:325) `[V]`.
8. `popupPanelData` := `response` (js/popup.js:326), then in this order: apply admin tokens (js/popup.js:328);
   show `response.level` (js/popup.js:330); show the hostname (js/popup.js:332); decide the matched-rules
   button (js/popup.js:334-339); set `html.isHTTP` (js/popup.js:341-342); decide the unpicker button
   (js/popup.js:344). Outcome READY (js/popup.js:346).
9. Always, last: remove `body.loading` and `body.busy` (js/popup.js:357-359) `[V]`.

Outcomes:

| Outcome | Condition | What the user sees | Source |
|---|---|---|---|
| READY | step 8 reached | hostname, level control at `response.level`, local tools, ribbon | js/popup.js:326-346 `[V]` |
| NO-WEBSITE | `init()` returned `false` (steps 2, 5, 7) | `body.nodata`; `#hostname` text = `i18n popupNoWebsite`; see §8.3 | js/popup.js:351-355 `[V]` |
| INIT-THREW | `init()` threw (e.g. `tabs.query` rejects; or `disabledFeatures` is `null` → `forbid.length` throws at js/popup.js:37, because the `= []` default replaces only `undefined`; or `disabledFeatures` is a non-array with a non-zero `length`, e.g. the string `'zapper'` → `forbid.join` throws at js/popup.js:38) | neither `nodata` nor data: empty hostname, level control visible without a level, caption shows `_`, no local tools, dashboard button visible. The level control is NOT disabled: it is operable and commits (see below). Upstream quirk | js/popup.js:356 (empty `catch`) `[V]` |

What a level click does in INIT-THREW (upstream, all `[V]` in the audit run, Appendix A.2):

- After `tabs.query` rejected: `tabURL` still holds its initial value `runtime.getURL('/')` (js/popup.js:31), so
  `targetHostname` is the EXTENSION's own host (on Safari the `safari-web-extension://` UUID; `127.0.0.1` in the
  harness), not `''`, and the guard of js/popup.js:61 does not stop it. Click level 0 → MSG
  `{ what: 'setFilteringMode', hostname: <extension host>, level: 0 }`; click level 2 → `permissions.request({ origins: [ '*://*.<extension host>/*' ] })`
  then that MSG with `level: 2`. No pending message (level-before is the string `"undefined"` → `NaN`, and
  `NaN <= 1` is false, js/popup.js:65-67). No reload (`popupPanelData.autoReload` is `undefined`).
- After a `disabledFeatures` throw: `tabURL`, `currentTab` and `popupPanelData` are already filled
  (js/popup.js:304-326), so the click uses the REAL hostname, but level-before is `NaN`: a change to 2 or 3
  sends NO `setPendingFilteringMode`, then `permissions.request`, then `setFilteringMode`; every change
  reloads the tab after 437 ms when `autoReload` is on (`actual !== NaN` is always true, js/popup.js:101).
- A `disabledFeatures` value with `length === 0` that is not an array (e.g. `''`) does NOT throw and leaves
  `body[data-forbid]` unset (js/popup.js:36-37) `[V]`.

There is no timeout: if `tabs.query` or the message never settles, `body.loading` is never removed and the
popup stays blank (js/popup.js:349-360; js/ext.js:51-55). Upstream quirk.

Tab URLs that give NO-WEBSITE `[V]`: `about:blank`, `file:///…` (empty hostname, js/popup.js:317);
`ftp://…`, `safari-web-extension://…/dashboard.html` (protocol, js/popup.js:318); empty or missing
`tab.url` (`new URL` throws, js/popup.js:309, 316); a strict-block page whose hash is empty or
percent-encoded (js/popup.js:311, 318); no active tab (js/popup.js:303).

### 3.2 Request (exact payload, js/popup.js:320-324)

```js
{ what: 'popupPanelData', origin: url.origin, hostname: tabURL.hostname }
```

Example `[V]`: tab `https://www.example.com/path?x=1` →
`{ what: 'popupPanelData', origin: 'https://www.example.com', hostname: 'www.example.com' }`.

- `hostname` is the URL parser's ASCII serialisation: lower-case, punycode for IDN, no port, IPv6 in
  brackets (js/popup.js:313, 323) `[V]`: `https://bücher.example/` → `xn--bcher-kva.example`;
  `http://user:pw@Sub.Example.COM:8080/` → `sub.example.com`; `http://[::1]:8080/` → `[::1]`;
  `https://EXAMPLE.com./` → `example.com.`.
- `origin` includes a non-default port (`http://sub.example.com:8080`) `[V]`. The handler never reads
  `origin` (bg:492-508 uses only `request.hostname`).
- On a strict-block page both fields describe the blocked page, not the extension page (js/popup.js:310-313) `[V]`.

### 3.3 Response (bg:492-508) and what each field drives

```js
{ hasOmnipotence, level, autoReload, isSideloaded, developerMode, disabledFeatures, hasCustomFilters }
```

| Field | Type and origin | Effect in the popup | Source |
|---|---|---|---|
| `hasOmnipotence` | boolean: `permissions.getAll()` contains `<all_urls>` or `*://*/*` (js/ext-utils.js:33-38; bg:494, 500) | NONE. The popup never reads it; it does not skip the permission request | js/popup.js (no reference) |
| `level` | number 0..3: effective mode for `hostname` — exact or ancestor match in the order none, basic, optimal, complete, else the default mode (js/mode-manager.js:123-149, 346-349; bg:495, 501) | initial value of the level control and caption (js/popup.js:330, 45-53); `mode` parameter of the report URL, read from this field at click time and therefore always the level at popup open (js/popup.js:240) `[V]` | |
| `autoReload` | boolean `rulesetConfig.autoReload`, default `true` (bg:502; js/config.js:33) | whether the tab is reloaded after a level change (js/popup.js:101) | |
| `isSideloaded` | boolean: manifest `permissions` includes `declarativeNetRequestFeedback` (js/debug.js:37-40; bg:503). `true` in PRISTINE (`PRISTINE/manifest.json:311`) | one of the conditions of the matched-rules button (js/popup.js:335) | |
| `developerMode` | boolean `rulesetConfig.developerMode`, default `false`, always a boolean (bg:265, 504; js/config.js:37) | one of the conditions of the matched-rules button (js/popup.js:336). The condition is passed as the `force` argument of `classList.toggle` (PRISTINE/js/dom.js:184-190): if the field were MISSING while `isSideloaded === true`, the expression is `undefined`, `toggle` ignores an `undefined` force and FLIPS the class, so the button would be ENABLED `[V]`. Not reachable with the PRISTINE background | |
| `disabledFeatures` | `string[]` or `undefined`: cached managed-storage value (bg:496, 505; js/admin.js:209-230; schema `PRISTINE/managed_storage.json:10-15`) | `undefined` or `[]` → nothing; otherwise `body.dataset.forbid = forbid.join(' ')` (js/popup.js:35-39) `[V]`; see §8.4 | |
| `hasCustomFilters` | NUMBER, not boolean: count of custom selectors stored for `hostname` and every parent domain (`site.<hn>` keys, down to the bare TLD) (js/filter-manager.js:69-95; bg:497, 506). Always a number from the PRISTINE background (`?? 0`, js/filter-manager.js:94) | unpicker button gets `enabled` when truthy (js/popup.js:344) `[V]`. Passed raw as the `force` argument of `classList.toggle` (PRISTINE/js/dom.js:184-190): `0`/`null` → off, any non-zero number → on, a MISSING field (`undefined`) → the class is flipped from its static "off" to ON `[V]` | |

Side effects of the request in the background: none on user state (bg:492-508 only reads user state). It may
write caches: `adminReadEx('disabledFeatures')` re-reads managed storage and writes
`admin.disabledFeatures` to session and local storage (js/admin.js:209-230), and the mode lookup may build
and store the session cache `filteringModeDetails` (js/mode-manager.js:241-300). The UI never reads or
writes these keys.

---

## 4. Hostname display

- READY: `#hostname` text := `punycode.toUnicode(tabURL.hostname)` (js/popup.js:332). `dom.text` assigns
  `textContent`, which removes the two static spans, so the hostname is ONE plain text node; the
  "second span is bold" rule (css/popup.css:93-95) never applies (PRISTINE/js/dom.js:96-104) `[V]`.
- The FULL hostname is shown: no `www.` stripping, no reduction to the registrable domain, no port
  (js/popup.js:332) `[V]` (`www.example.com`, `sub.example.com`, `[::1]`, `example.com.`).
- Punycode: each dot-separated label that starts with lower-case `xn--` is decoded; other labels are left
  as they are; the separators `.`, `。`, `．`, `｡` are normalised to `.`
  (PRISTINE/js/punycode.js:24, 26, 82-96, 438-444). Example `[V]`: `xn--bcher-kva.example` is shown as
  `bücher.example`.
- Only the DISPLAY is decoded. Every message payload and the permission pattern use the ASCII
  `tabURL.hostname` (js/popup.js:62, 72, 80, 95, 323) `[V]`.
- NO-WEBSITE: text := `i18n popupNoWebsite` (js/popup.js:354) `[V]`.
- The text wraps anywhere (`word-break: break-all`, css/popup.css:88, 91) and is centred (css/popup.css:84, 87).

---

## 5. The filtering-mode control

### 5.1 Levels

| Level | Constant | Name key | Meaning | Source |
|---|---|---|---|---|
| 0 | `MODE_NONE` | `filteringMode0Name` | no filtering on the site (an allow rule is installed for the hostname) | js/mode-manager.js:48-53; js/ruleset-manager.js:412-436; safari/ext-compat.js:189-215 |
| 1 | `MODE_BASIC` | `filteringMode1Name` | network filtering only; needs no host permission | js/mode-manager.js:54; `PRISTINE/_locales/en/messages.json:246-249` |
| 2 | `MODE_OPTIMAL` | `filteringMode2Name` | adds specific extended (cosmetic/scriptlet) filtering; needs host permission | js/mode-manager.js:55; js/scripting-manager.js:187-191; `PRISTINE/_locales/en/messages.json:250-253` |
| 3 | `MODE_COMPLETE` | `filteringMode3Name` | adds generic cosmetic filtering on top of level 2 | js/mode-manager.js:56; js/scripting-manager.js:110-112; `PRISTINE/_locales/en/messages.json:254-257` |

The only thing the popup itself derives from the number is the permission rule "level > 1" (js/popup.js:66).
`BLOCKING_MODE_MAX = 3` (js/popup.js:43).

### 5.2 How the current level is shown; the default level

- The control is a 4-stop track with stops in DOM order 0, 1, 2, 3 (popup.html:23-26); in RTL the
  order is mirrored, stop 0 at the right (css/filtering-mode.css:74-92) `[V]`.
- The current level is the attribute `data-level` on the track (js/popup.js:46-47). CSS derives from it:
  the thumb sits on the stop of that level (css/filtering-mode.css:61-72), and the stops are coloured —
  level 0: all four neutral and the thumb neutral too; level 1: stop 0 accent, stops 1-3 neutral;
  level 2: stops 0-1 accent, stops 2-3 neutral; level 3: all four accent
  (css/filtering-mode.css:40-43, 45-46, 95-108) `[V]`.
- The thumb covers the current stop completely, so the stop of the current level cannot be clicked
  (css/filtering-mode.css:17-24, 45-52) `[V]`.
- The level name is the text of caption span 1: `i18n filteringMode<level>Name` (js/popup.js:49-52, 89-92) `[V]`.
  The whole caption is rendered lower-case by CSS (css/popup.css:115) `[V]`. Line 1 of the caption is the
  label `popupFilteringModeLabel` (popup.html:29).
- The DEFAULT level is NOT shown anywhere in the popup: the response has no default-mode field (bg:499-507)
  and `js/popup.js` contains no reference to it. Choosing the level that equals the default simply removes
  the per-site entry in the background (js/mode-manager.js:191-208); the popup cannot tell the difference.

### 5.3 Hover preview (hover devices only)

Registered only when `html` does not have class `mobile` at script start (js/popup.js:194).

- Pointer enters a stop → caption span 2 := `i18n filteringMode<thatLevel>Name` (js/popup.js:195-205) `[V]`.
- Pointer leaves the stop → span 2 := `''` (js/popup.js:207-213) `[V]`.
- Span 2 is displayed only when non-empty, prefixed by CSS with EN SPACE + `→` + EN SPACE; in RTL the
  arrow is `←` (css/popup.css:120-131) `[V]`. Resulting caption, e.g.: `basic → complete`.
- No message and no API call is made by hovering (js/popup.js:195-213) `[V]`.
- The preview is driven by pointer position only: it is not cleared by a commit or by a revert
  (js/popup.js:84-87 do not touch span 2) `[V]`.

### 5.4 Change by clicking a stop (js/popup.js:181-192)

Any `click` event whose target is a stop is accepted: there is no `isTrusted` and no `button` test
(js/popup.js:185-191) `[V]`. Steps:

1. level-before := current level (js/popup.js:187).
2. `setFilteringMode(L, true)` (js/popup.js:190): current level := L; caption span 1 := name of L —
   both immediately, before anything is sent (js/popup.js:46-53) `[V]`.
3. `body.busy` on (js/popup.js:55).
4. `await commitFilteringMode()` (js/popup.js:56) — §5.6.
5. `body.busy` off (js/popup.js:57). The 437 ms reload timer of §5.6 step 7 is NOT awaited.

### 5.5 Change by dragging the thumb (js/popup.js:113-179)

- `mousedown` with button 0 on the thumb: level-before := current level; class `moving` on; window-level
  capture listeners for `mousemove` and `mouseup` (js/popup.js:159-176).
- `mousemove` (throttled with `requestAnimationFrame`, js/popup.js:136-140): the pointer offset is turned
  into a level 0..3, mirrored (`3 - level`) when `body[dir="rtl"]` (js/popup.js:120-126) `[V]`. If it differs
  from the current level: caption span 2 := name of that level; current level := that level; span 1 is NOT
  changed while `moving` (js/popup.js:128-133, 48-53) `[V]`. The caption therefore reads
  `<name before> → <name under the thumb>`; after dragging back to the start it reads e.g. `basic → basic` `[V]`.
- `mouseup` with button 0: `moving` off; listeners removed; span 2 := `''`; then `commitFilteringMode()` is
  called DIRECTLY (js/popup.js:142-157). Differences from the click path: `body.busy` is never set, and
  span 1 keeps the old name until step 4 of §5.6 `[V]`.
- A press and release of the thumb without movement is a commit of the current level (after = before)
  (js/popup.js:150, 165) `[V]` — see §5.6 "after = before".
- While `moving` is set, the four stops ignore the pointer (`pointer-events: none`), so no stop `click`,
  `mouseenter` or `mouseleave` fires during a drag (css/filtering-mode.css:57-59) `[V]`.
- Mouse only: there are no touch, pointer or keyboard handlers (js/popup.js:147-148, 172-173, 178).
- The pixel-to-level mapping (js/popup.js:122-123, 166-170) depends on the 60 px thumb and 243 px track
  (css/filtering-mode.css:2-3); it is a property of the upstream widget, not a contract.

### 5.6 `commitFilteringMode()` — exact order (js/popup.js:60-111)

Inputs: `after` = current level, `before` = level-before (js/popup.js:63-65, parsed with `parseInt`, so
both are numbers).

1. If `tabURL.hostname === ''` → stop (js/popup.js:61). This guard practically never fires: `tabURL` starts
   as `new URL(runtime.getURL('/'))` (js/popup.js:31), whose hostname is the extension's own host. In
   NO-WEBSITE only CSS (`visibility: hidden` on `.needData`, css/popup.css:76-78) keeps the user from
   committing; in INIT-THREW nothing does (§3.1). The new popup must not offer the control outside READY (§13).
2. If `after > 1` (js/popup.js:66):
   1. If `before <= 1`: send, WITHOUT awaiting (js/popup.js:67-76) `[V]`:
      ```js
      { what: 'setPendingFilteringMode', tabId: currentTab.id, url: tabURL.href,
        hostname: targetHostname, beforeLevel, afterLevel }
      ```
      Example `[V]`: `{ what: 'setPendingFilteringMode', tabId: 42, url: 'https://www.example.com/path?x=1', hostname: 'www.example.com', beforeLevel: 1, afterLevel: 2 }`.
   2. `granted = await browser.permissions.request({ origins: [ '*://*.' + HOST + '/*' ] })` inside
      `try/catch`; a throw or rejection counts as not granted (js/popup.js:77-83) `[V]`.
      Example `[V]`: `{ origins: [ '*://*.www.example.com/*' ] }`.
      For an IPv6 host the pattern is `*://*.[::1]/*` `[V]`, which is not a valid match pattern; if the
      browser rejects it, the catch turns that into "not granted" and the level reverts, so levels 2-3 can
      never be set from the popup on such a host (behaviour of Safari's `permissions.request` for IP-literal
      hosts is UNKNOWN, §15 item 12).
   3. If `granted !== true` → revert: current level := `before`, caption span 1 := name of `before`; stop.
      Nothing else is sent; the pending message of 2.1 is NOT withdrawn (js/popup.js:84-87) `[V]`.
3. (`after <= 1`: steps 2.1-2.3 are skipped entirely — no permission request, no pending message, js/popup.js:66) `[V]`.
4. Caption span 1 := name of `after` (js/popup.js:89-92).
5. `actual = await sendMessage(…)` with exactly (js/popup.js:93-97) `[V]`:
   ```js
   { what: 'setFilteringMode', hostname: targetHostname, level: afterLevel }
   ```
   `level` is a number. The response is the level actually in force for the hostname (bg:517-523): the
   handler answers the current level unchanged when `request.level === beforeLevel` (strict compare,
   bg:518-519); otherwise it sets the mode, re-registers content scripts and user scripts, and answers the
   resulting level (bg:520-522). A `level` sent as a string (e.g. `'2'`) matches no `case` in
   `setFilteringMode` and is NOT applied: in a run of the upstream functions the answer was the default
   level (js/mode-manager.js:191-236; modecheck in Appendix A) `[V]`.
6. If `actual !== after`: current level := `actual`, caption span 1 := name of `actual` (js/popup.js:98-100) `[V]`.
7. If `actual !== before && popupPanelData.autoReload` (js/popup.js:101): evaluate
   `justReload = (tabURL.href === currentTab.url)` now (js/popup.js:102), then after `setTimeout(…, 437)`
   (js/popup.js:103-109) `[V]`:
   - `justReload` → `browser.tabs.reload(currentTab.id)`;
   - otherwise → `browser.tabs.update(currentTab.id, { url: tabURL.href })`.

Ordering facts that MUST be kept (ARCHITECTURE §6.6):

- Steps 1, 2.1 and the CALL of 2.2 run synchronously inside the user's event handler: nothing is awaited
  between the click/mouse-up event and `permissions.request` (js/popup.js:181-192 → 45-56 → 60-81;
  142-150 → 60-81). The pending message is SENT first but never awaited `[V]` (same timestamp in the run).
- `permissions.request` is made for EVERY commit whose `after` is 2 or 3 — also 2→3, 3→2, after = before,
  and when the extension already has broad permission (js/popup.js:66, 77-81) `[V]`.
- The pending message is sent only when crossing from {0, 1} to {2, 3} (js/popup.js:66-67) `[V]`. Sending
  it in any other case would leave extra stale state in the background (§5.7).
- `setFilteringMode` is sent only after a granted request (or directly for `after <= 1`) (js/popup.js:84-97) `[V]`.

Case table (H = `www.example.com`, tab 42, `autoReload` true) — all `[V]`:

| Before → after | Permission answer | Calls, in order |
|---|---|---|
| 1 → 0, 2 → 0, 3 → 1, 0 → 1 | not asked | MSG `setFilteringMode{H, level}` → after 437 ms `tabs.reload(42)` |
| 1 → 2, 1 → 3, 0 → 3 | `true` | MSG `setPendingFilteringMode{…}` → `permissions.request` → MSG `setFilteringMode{H, level}` → 437 ms → `tabs.reload(42)` |
| 1 → 2, 0 → 3 | `false` or throws | MSG `setPendingFilteringMode{…}` → `permissions.request`; level shown = before; nothing else |
| 2 → 3, 3 → 2 | `true` | `permissions.request` → MSG `setFilteringMode{H, level}` → 437 ms → `tabs.reload(42)` |
| 2 → 3, 3 → 2 | `false` or throws | `permissions.request`; level shown = before; nothing else (js/popup.js:66-87) |
| after = before, level 0 or 1 (thumb press) | not asked | MSG `setFilteringMode{H, level}`; response = before → no reload |
| after = before, level 2 or 3 (thumb press) | `true` | `permissions.request` → MSG `setFilteringMode{H, level}`; no pending message; no reload |

Response handling:

| Response `actual` | Level shown | Reload |
|---|---|---|
| `=== after` | after | yes if `after !== before` and `autoReload` (js/popup.js:98-110) `[V]` |
| a different number, `!== before` (e.g. asked 2, got 0) | actual | yes if `autoReload` (js/popup.js:98-110) `[V]` |
| `=== before` (change refused) | before | no (js/popup.js:101) `[V]` |
| `undefined` (send failed; js/ext.js:51-55) | Upstream quirk: `data-level="undefined"`, empty name; tab IS reloaded when `autoReload` because `undefined !== before` (js/popup.js:98-110) `[V]` | — |

Follow-on of the `undefined` row (upstream, `[V]` in the audit run): the slider keeps `data-level="undefined"`.
- A later press-and-release of the thumb commits `after = parseInt("undefined") = NaN` and sends
  `{ what: 'setFilteringMode', hostname: H, level: NaN }` (`NaN > 1` is false, so no permission request),
  then reloads the tab after 437 ms (js/popup.js:64, 66, 93-110). In the background a non-integer `level`
  matches no `case` and the site falls back to the DEFAULT mode (js/mode-manager.js:191-236; messaging.md
  §1.6 item 5). How `NaN` survives `runtime.sendMessage` on Safari (as `NaN` or `null`) is UNKNOWN; both
  have that effect.
- A later click on a stop sends a correct integer `level`, but `beforeLevel` is `NaN`: a change to 2 or 3
  sends NO `setPendingFilteringMode` and the tab is always reloaded (js/popup.js:65-67, 101).
- The same two effects follow when `popupPanelData.level` itself is missing (§14 item 16) `[V]`.
The bridge must throw instead (§13), so the new popup never stores a non-integer level.

`actual` can legitimately differ from the request, because the lookup order is none, basic, optimal,
complete and only the set of the previous level is pruned (js/mode-manager.js:123-149, 191-236). Example,
obtained by running those upstream functions on the table `{ basic: ['all-urls'], optimal: ['example.com'],
complete: ['www.example.com'] }`: `www.example.com` is at 2 (inherited); requesting 1 answers 3.

`autoReload` is the value from the popup-open response; a change of the setting while the popup is open
is not seen (js/popup.js:101, 326).

When `tabs.update` is used instead of `tabs.reload` `[V]`: the tab shows the strict-block page (reload
would re-show the block page; update navigates to the blocked URL, js/popup.js:310-313, 102-108); or the
tab's `url` string is not identical to the parser-normalised URL (js/popup.js:102).
UNKNOWN: whether Safari reports `tab.url` already normalised (punycode host, percent-encoding); if not,
`tabs.update` is what runs.

### 5.7 What the background does with the pending message

- `setPendingFilteringMode` stores the whole request in one module variable and answers `undefined`
  (bg:145, 525-527).
- The next `permissions.onAdded` event takes and clears it (bg:210-217) and runs
  `onPermissionGrantedThruExtension(details, origins)` (bg:169-183): persist host permissions; stop if the
  DEFAULT mode is ≥ 2; stop unless the granted origins cover `details.hostname`; stop if the site is already
  at `details.afterLevel`; otherwise set the site to `afterLevel`, re-register content scripts and, when
  `autoReload` is on, after 437 ms call `browser.tabs.update(details.tabId, { url: details.url })`
  (bg:155-166, 181-182). It also stops, without reloading, when the level actually set differs from
  `afterLevel` (bg:178). Permission events are handled only after the background is fully initialised
  (bg:871-881, 227). Each handler also awaits the handler promises already pushed to
  `onPermissionsChanged.pending` (bg:228-233), but a promise is pushed only after that wait, so two events
  that both arrive before either handler has started are NOT serialised against each other; the
  `pending` array is never emptied (bg:226-235). This is background behaviour; the popup cannot influence it.
- Purpose: finish the change when the permission prompt destroys the popup (bg:209, uBOL-home issue 280).
- Fields read by the background: `hostname`, `afterLevel`, `tabId`, `url`. `beforeLevel` is not read (bg:169-183).
- Upstream quirks: (a) the slot is not cleared on denial or when no `onAdded` event fires (bg:145,
  210-212); the next permission grant of any kind is then treated as "through the extension" and, if it
  does not cover that hostname, is ignored (bg:175) instead of being handled by
  `onPermissionGrantedThruBrowser` (bg:186-207, 214-216). (b) If the popup survives the prompt, popup and
  background race: both may set the level and both may reload the tab (js/popup.js:93-110; bg:176-182).
  (c) The slot is plain module state and is lost if the background page is unloaded first (bg:145); the
  Safari background is non-persistent (`"persistent": false`, safari/manifest.json:7-11).
  (d) The popup does not wait for the background's half: it awaits `permissions.request` and then sends
  `setFilteringMode` itself (js/popup.js:79-97), so with a surviving popup the level is applied by the popup's
  message even when the background ignored the grant.

### 5.8 Blocking of input while a commit runs

- Click path only: `body.busy` makes `<main>` ignore pointer input (css/popup.css:46-48) `[V]`, so a second
  selection cannot start until the commit has finished; exactly one `setFilteringMode` is sent per accepted
  click `[V]`.
- `busy` lasts while the permission prompt is open and while the message is pending, and ends on every
  path including the revert (js/popup.js:55-57, 84-87) `[V]`.
- Drag path: no `busy` (js/popup.js:150).

---

## 6. Local tool buttons ("On this website")

The section `.localTools` exists only in READY (`html.isHTTP`, css/popup.css:149-151; js/popup.js:341-342)
and is removed when `zapper`, `picker` and `report` are all forbidden (css/popup.css:104). A tool row
without class `enabled` is `display: none` (css/popup.css:168-170).

| Button | Shown when | Hidden by admin token | Click checks | Effect, in order | Closes popup | Source |
|---|---|---|---|---|---|---|
| Zapper `#gotoZapper` (`zapperTipEnter`) | always in READY (static `enabled`) | `zapper` | none (no `isTrusted`, no `button` test) | if `browser.scripting === undefined` → nothing at all; else call A, then `self.close()` | yes, `self.close()` | popup.html:33-36; css/popup.css:100; js/popup.js:257-264 `[V]` |
| Picker `#gotoPicker` (`pickerTipEnter`) | always in READY | `picker` | none | same guard; call B, then `self.close()` | yes | popup.html:37-40; css/popup.css:101; js/popup.js:268-279 `[V]` |
| Unpicker `#gotoUnpicker` (`unpickerTipEnter`) | READY and `hasCustomFilters` truthy (count > 0) | `picker` (same token) | none | same guard; call C, then `self.close()` | yes | popup.html:41-44; css/popup.css:102; js/popup.js:283-294, 344 `[V]` |
| Report `#gotoReport` (`popupTipReport`) | always in READY | `report` | `ev.isTrusted === true`; no `button` test | if `new URL(currentTab.url)` throws → nothing; else MSG D | NO `self.close()` call | popup.html:45-48; css/popup.css:103; js/popup.js:229-245 `[V]` |

Exact calls (none is awaited; none has `.catch`; no `frameIds`, `allFrames`, `world` or
`injectImmediately` key is passed):

```js
// A — zapper (js/popup.js:259-262)
browser.scripting.executeScript({
    files: [ '/js/scripting/tool-overlay.js', '/js/scripting/zapper.js' ],
    target: { tabId: currentTab.id },
});
// B — picker (js/popup.js:270-277)
browser.scripting.executeScript({
    files: [
        '/js/scripting/css-procedural-api.js',
        '/js/scripting/tool-overlay.js',
        '/js/scripting/picker.js',
    ],
    target: { tabId: currentTab.id },
});
// C — unpicker (js/popup.js:285-292)
browser.scripting.executeScript({
    files: [
        '/js/scripting/css-procedural-api.js',
        '/js/scripting/tool-overlay.js',
        '/js/scripting/unpicker.js',
    ],
    target: { tabId: currentTab.id },
});
```

File order inside `files` is significant: the last script uses objects defined by the earlier ones
(js/scripting/zapper.js:26-27, 131; js/scripting/picker.js:26-27, 309; js/scripting/unpicker.js:26-27, 50). If
the same tool's overlay is already open in the page, the injected script returns without doing anything
(js/scripting/zapper.js:28; js/scripting/picker.js:28; js/scripting/unpicker.js:28); the popup still closes. The
injected script then opens its own overlay (`/zapper-ui.html`, `/picker-ui.html`, `/unpicker-ui.html`;
same lines) — outside the popup's scope.

`self.close()` is called immediately after the `executeScript` CALL, not after its result
(js/popup.js:263, 278, 293) `[V]`.

```js
// D — report (js/popup.js:237-244)
const reportURL = new URL(runtime.getURL('/report.html'));
reportURL.searchParams.set('tabid', currentTab.id);
reportURL.searchParams.set('url', tabURL.href);
reportURL.searchParams.set('mode', popupPanelData.level);
sendMessage({ what: 'gotoURL', url: `${reportURL.pathname}${reportURL.search}` });
```

Example payload `[V]`:
`{ what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1' }`.

- Parameter order is `tabid`, `url`, `mode`; the value is path + query only, no origin (js/popup.js:238-243) `[V]`.
- `url` is `tabURL.href` (the blocked URL on a strict-block page), including userinfo and fragment when
  present (js/popup.js:239) `[V]`.
- `mode` is `popupPanelData.level`, i.e. the level when the popup was OPENED, even after the user changed
  it in the same popup. Upstream quirk (js/popup.js:240, 326) `[V]`.
- The background resolves the path against the extension root, focuses an existing normal-window tab with
  exactly that URL, otherwise creates an active tab (bg:514-515; js/ext-utils.js:42-68). The report page
  reads `url`, `mode`, `tabid` (js/report.js:28-59).

Keyboard commands `enter-zapper-mode` and `enter-picker-mode` run calls A and B from the background without
the popup (safari/manifest.json:17-24; bg:677-702); there is no command for the unpicker.

---

## 7. Ribbon buttons

`.globalTools` is not tied to `isHTTP` or `nodata`: it is present in READY, NO-WEBSITE and INIT-THREW. It
is removed as a whole by admin token `dashboard` (css/popup.css:107-109). A ribbon button without class
`enabled` is `visibility: hidden` — invisible, not clickable, but still occupying its place
(css/popup.css:187-202) `[V]`. Matched rules is first, dashboard last (popup.html:52-53; css/popup.css:183).

### 7.1 Matched rules `#gotoMatchedRules`

- Enabled only in READY and only when ALL hold: `popupPanelData.isSideloaded === true`,
  `popupPanelData.developerMode` truthy, `typeof currentTab.id === 'number'`, `isNaN(currentTab.id) === false`
  (js/popup.js:334-339) `[V]`. Never enabled in NO-WEBSITE (the line is not reached).
- Click checks: `ev.isTrusted === true` and `ev.button === 0` (js/popup.js:219-220) `[V]`.
- Effect: MSG `{ what: 'showMatchedRules', tabId: currentTab.id }` (js/popup.js:221-224) `[V]`. No
  `self.close()` call.
- Background: `browser.windows.create({ type: 'popup', url: '/matched-rules.html?tab=' + tabId })`, not
  awaited, answer `undefined` (bg:559-564). That page sends `getMatchedRules` (js/matched-rules.js:27-33).
- Text: hard-coded English `Show matched rules` for both tooltip and caption; no i18n key exists (popup.html:52).
- PRISTINE: `isSideloaded` is `true` (§0), so the button appears whenever developer mode is on.
  `developerMode` is forced off by the background when admin token `develop` is set (bg:807-814).

### 7.2 Dashboard `#gotoDashboard`

- Always `enabled` (static class, popup.html:53); works in every outcome `[V]`.
- Click checks: `ev.isTrusted === true` and `ev.button === 0` (js/popup.js:250-251) `[V]`.
- Effect: `runtime.openOptionsPage()` — no message, no `self.close()` call (js/popup.js:252) `[V]`. The options
  page is `dashboard.html` (safari/manifest.json:40-42; `PRISTINE/manifest.json:297-299`).
- Tooltip (`title`) and caption both use `popupTipDashboard` (popup.html:53). Captions are displayed only
  on `html.mobile` (css/popup.css:214-216) `[V]`.

---

## 8. States

### 8.1 Loading

`body.loading` → `visibility: hidden` on the whole body, overlay included (popup.html:16; css/popup.css:29-31) `[V]`.
Nothing is visible, not even the spinner, until `tryInit()` finishes (js/popup.js:357-359). Layout is still
computed while hidden: before data arrives the document has the NO-WEBSITE height, and it grows when the
tools section appears (§10) `[V]`.

### 8.2 Busy (spinner)

- `body.busy` → `<main>` gets `pointer-events: none` at once (css/popup.css:46-48) `[V]`.
- `<aside>` covers the whole popup (`position: absolute`, all four edges 0, `z-index: 1000`, background
  = page surface) and is `display: block` while busy, at opacity 0; a 0-second animation delayed by 1 s
  switches it to 90 % opacity and it stays there (css/popup.css:5-7, 52-63, 70-74). Observed `[V]`: opacity 0
  at 300 ms, 0.9 at 1200 ms, removed when `busy` ends.
- The icon rotates in 8 steps per second (css/popup.css:1-4, 64-69).
- `busy` is set only by: the initial markup (invisible, §8.1) and the click path of a level change
  (js/popup.js:55-57). Tool buttons and the drag path never set it.

### 8.3 No website (`body.nodata`)

- `#hostname` text = `popupNoWebsite` (js/popup.js:354) `[V]`.
- `.needData` elements (level control and caption) are `visibility: hidden`: invisible, not operable, space
  kept (css/popup.css:76-78; popup.html:21, 29) `[V]`.
- `.needHTTP` (local tools) is `display: none` because `html.isHTTP` is never set (css/popup.css:149-151;
  js/popup.js:341-342 not reached) `[V]`.
- Ribbon: dashboard button visible and working; matched-rules button hidden (§7) `[V]`.
- Admin tokens are NOT applied in this state: `disabledFeatures` only arrives with `popupPanelData`, which
  is not requested (or failed) (js/popup.js:316-328). The dashboard button is therefore shown even when
  `dashboard` is forbidden. Upstream quirk.
- No message has been sent when the cause is the tab/URL (steps 2, 5 of §3.1); exactly one
  (`popupPanelData`) when the cause is a non-object response (step 7) `[V]`.

### 8.4 Admin restrictions (`disabledFeatures`)

Source of the list: managed storage key `disabledFeatures`, read by the background through a cache
(session `admin.disabledFeatures`, then local) that is refreshed asynchronously after each read
(js/admin.js:209-230; js/ext.js:131-139). The value the popup gets is the cached one; the first read after
a policy change can still be the old value (js/admin.js:209-230).

The popup writes all tokens to `body[data-forbid]` (js/popup.js:35-39) `[V]`; five tokens have an effect:

| Token | Effect in the popup | Source |
|---|---|---|
| `filteringMode` | level control gets `pointer-events: none`: no click, no drag, no hover preview. It stays visible and still shows the current level and name. There is no script-side guard | css/popup.css:97-99; js/popup.js:60-111 `[V]` |
| `zapper` | zapper row removed | css/popup.css:100 `[V]` |
| `picker` | picker row AND unpicker row removed | css/popup.css:101-102 `[V]` |
| `report` | report row removed | css/popup.css:103 `[V]` |
| `zapper` + `picker` + `report` together | the whole local-tools section, label included, removed | css/popup.css:104 `[V]` |
| `dashboard` | the whole ribbon removed (dashboard AND matched-rules buttons) | css/popup.css:107-109 `[V]` |

Any other token (e.g. `develop`) is written to the attribute but changes nothing in the popup
(css/popup.css:97-109) `[V]`. An empty array or a missing field leaves the attribute unset (js/popup.js:36-37) `[V]`.
`null`, or a non-array whose `length` is not `0` (e.g. the string `'zapper'`, a number, an object), makes
`init()` throw (js/popup.js:37 for `null`, 38 otherwise) → INIT-THREW (§3.1) `[V]`. A non-array with
`length === 0` (e.g. `''`) is treated like `[]` `[V]`. Because the throw happens at js/popup.js:328, before
js/popup.js:330-344, no level, hostname, local tools or matched-rules decision is rendered.

### 8.5 `hasCustomFilters`

Count > 0 → unpicker row shown; 0 → row absent (js/popup.js:344; css/popup.css:168-170) `[V]`. Field missing
→ row shown (upstream `classList.toggle` quirk, §3.3; not reachable with the PRISTINE background) `[V]`. The count is
taken at popup open and includes filters stored for parent domains (js/filter-manager.js:69-95). No other
element depends on it.

### 8.6 Platform-specific behaviour in the popup

`js/popup.js`, `popup.html`, `css/popup.css` and `css/filtering-mode.css` contain no platform test
(no `webextFlavor`, no `data-platform`; checked by grep). No popup feature is switched off for Safari by
popup code. Safari-related facts that still matter are collected in §12.

---

## 9. i18n keys used by the popup (13 keys)

English text from `PRISTINE/_locales/en/messages.json` (line of the key in parentheses). PRISTINE has 71
locale folders.

| Key | English | Where | Source |
|---|---|---|---|
| `extName` (2) | `Blocker` (upstream: `uBlock Origin Lite`) | document `<title>` | popup.html:13 `[V]` |
| `popupFilteringModeLabel` (42) | `filtering mode` | caption line 1 | popup.html:29 |
| `filteringMode0Name` (230) | `no filtering` | level name: caption span 1, preview span 2, `aria-label` of stop 0 | popup.html:23; js/popup.js:51, 91, 131, 202 |
| `filteringMode1Name` (234) | `basic` | same, level 1 | popup.html:24; same lines |
| `filteringMode2Name` (238) | `optimal` | same, level 2 | popup.html:25; same lines |
| `filteringMode3Name` (242) | `complete` | same, level 3 | popup.html:26; same lines |
| `popupLocalToolsLabel` (46) | `On this website` | heading of the local tools | popup.html:32 |
| `zapperTipEnter` (362) | `Remove an element` | zapper row | popup.html:35 |
| `pickerTipEnter` (370) | `Create a custom filter` | picker row | popup.html:39 |
| `unpickerTipEnter` (374) | `Remove a custom filter` | unpicker row | popup.html:43 |
| `popupTipReport` (50) | `Report an issue` | report row | popup.html:47 |
| `popupTipDashboard` (54) | `Open the dashboard` | dashboard tooltip and caption | popup.html:53 |
| `popupNoWebsite` (66) | `not a website` | hostname text in NO-WEBSITE | js/popup.js:354 |

Also read: `@@ui_locale` for text direction (PRISTINE/js/i18n.js:39-44).
Not localised upstream: `Show matched rules` (popup.html:52). The arrow of the preview is CSS content, not a
message (css/popup.css:126-131). None of the 13 messages contains a `{{placeholder}}` or markup
(`PRISTINE/_locales/en/messages.json`, lines above). `popupMoreButton` / `popupLessButton` exist in the
locale file but are used by `picker-ui.html:43-44`, not by the popup.
The caption block is lower-cased by CSS (css/popup.css:115), which is why the English names are stored in
lower case.

---

## 10. Popup sizing (upstream)

- No fixed width or height anywhere. `body` has `min-width: var(--popup-min-width)` =
  slider width + half a thumb = `(4 × 60px + 3px) + 30px` = 273 px (css/popup.css:15-28;
  css/filtering-mode.css:2-3) `[V]`.
- On hover devices `html.desktop` is `display: flex` and `<main>` is a column aligned to the start
  (css/popup.css:41-45, 227-229), so the body shrink-wraps its content: width = max(273 px, widest
  unbreakable content), up to the viewport the browser allows. Observed `[V]` (Chrome): 273 px for English and
  German; 312 px for Bulgarian (long tool label); 608 px for an 82-character hostname when the viewport
  allowed it (the hostname wraps only once the viewport limit is reached).
- Height is content-driven and changes with state. Observed `[V]` (Chrome, 14 px base font,
  `PRISTINE/css/default.css:130`, English, width 273): NO-WEBSITE and the hidden loading phase 223 px;
  READY with three tools 375 px; READY with unpicker 410 px; `picker` forbidden 340 px; all five tokens
  forbidden 179 px. Each tool row is 35 px; the ribbon 44 px; the hostname bar has `min-height` 3 × font size
  = 42 px (css/popup.css:85).
- Consequence: the upstream document GROWS after data arrives (223 → 375/410 px) while still hidden by
  `body.loading` `[V]`.
- On no-hover devices (`html.mobile`) the base font is 16 px (`PRISTINE/css/default.css:138-139`), the body
  is a normal block (full viewport width) and ribbon captions are shown (css/popup.css:206-216) `[V]`.
- Dead rules: `:root.portrait …` (css/popup.css:49-51, 219-225) — no MV3 script sets `portrait`;
  `body.needReload #refresh` (css/popup.css:138-140) — no such element in `popup.html`.
- UNKNOWN: Safari's minimum/maximum popover size and how it reacts to a document that changes size.

ARCHITECTURE §6.9 deliberately replaces this with a fixed 340 px width and a height that is stable from
first paint (§13).

---

## 11. Input details

| Fact | Source |
|---|---|
| Zapper, picker, unpicker and the level stops accept any `click` event, including synthetic ones (`element.click()`) | js/popup.js:185-191, 257, 268, 283 `[V]` |
| Report requires `ev.isTrusted === true` | js/popup.js:230 `[V]` |
| Dashboard and matched rules require `ev.isTrusted === true` and `ev.button === 0` | js/popup.js:219-220, 250-251 `[V]` |
| Right and middle clicks do nothing on any button or stop: every handler listens to `click` only, and those buttons do not produce `click` | js/popup.js:181-184, 218, 229, 249, 257, 268, 283 `[V]` |
| Thumb drag requires mouse button 0 | js/popup.js:143, 160 |
| Tool and ribbon buttons are focusable (`tabindex="0"`), but there is NO key handler: Enter and Space do nothing. The level control is not focusable at all. No element has a `role` | popup.html:21-27, 33-53; js/popup.js (no `keydown`/`keyup` listener) `[V]` |
| Focus outline is removed for every element | css/popup.css:37-39 |
| Hovering a tool or ribbon button on hover devices only changes its colours | css/popup.css:164-167, 196-199, 230-232 |

---

## 12. Safari and PRISTINE specifics

1. `isSideloaded` is `true` in PRISTINE (§0, §7.1).
2. On Safari the matched-rules data path is `dnr.getMatchedRules({ tabId })`, because the Safari `dnr`
   wrapper has no `onRuleMatchedDebug` (js/debug.js:35, 159-192; safari/ext-compat.js:142-219, 160-162).
   UNKNOWN whether Safari returns anything from it.
3. The Safari manifest declares `host_permissions: ["<all_urls>"]` and no `optional_host_permissions`
   (safari/manifest.json:43-45; `PRISTINE/manifest.json:300-302`), and the `scripting` permission
   (safari/manifest.json:46-54), so the `browser.scripting === undefined` guard of §6 is expected to pass.
4. `webext` is `self.browser` only on Safari — no `chrome` fallback (safari/ext-compat.js:24).
5. Loading upstream `js/ext.js` in ANY page on Safari also runs the top level of `safari/ext-compat.js`:
   it reads session key `safari.seenRealms` and registers `windows.onFocusChanged` `[V]`. On a focus change
   to a normal window of a realm (normal/private) not yet marked in `safari.seenRealms`, the handler marks
   it (`storage.session.set`) and re-applies all enabled static rulesets by calling
   `declarativeNetRequest.updateEnabledRulesets` with the same ids in both `disableRulesetIds` and
   `enableRulesetIds` (WebKit bug 300236 workaround; js/popup.js:22; js/ext.js:22; safari/ext-compat.js:28-64).
   This is not tied to any user action. The background page loads the same module (bg:135) and registers
   the same top-level listener, so the workaround keeps running without the popup's copy. Not a parity
   target (§13): the new popup does not import upstream modules and must not call
   `declarativeNetRequest` or write `safari.seenRealms`.
6. Strict blocking defaults to OFF on Safari (js/config.js:35), so the strict-block branch of §3.1 step 4c
   is reached only when the user turned it on.
7. Text direction and the mirrored control are locale-driven, not platform-driven (PRISTINE/js/i18n.js:39-44;
   css/filtering-mode.css:74-92; js/popup.js:124-126).
8. The Safari manifest keeps both keyboard commands (safari/manifest.json:17-24).
9. Level 0 ("no filtering") is implemented differently on Safari, below the popup: the Safari `dnr` wrapper
   installs ONE dynamic `allow` rule with `condition: { urlFilter: '*', domains: [...] }` (or
   `excludedDomains`) (safari/ext-compat.js:189-215), where the generic build installs a dynamic
   `allowAllRequests` rule for `main_frame` plus a session `allow` rule for `tabIds: [TAB_ID_NONE]`
   (generic `ROOT/platform/mv3/extension/js/ext-compat.js`, not shipped in PRISTINE: js/ext-compat.js:38-99;
   called from js/ruleset-manager.js:412-436). The popup sends the same message on
   every platform; what Safari does with the rule is outside the popup (UNKNOWN in detail).
10. The Safari build replaces `js/scripting/css-api.js` with `safari/css-api.js` (ROOT/tools/make-mv3.sh:110;
   `cmp` identical with `PRISTINE/js/scripting/css-api.js`). None of the popup's `executeScript` file lists
   includes `css-api.js` (§6), so the tool calls are the same on Safari.

---

## 13. Upstream behaviour that ARCHITECTURE requires the new popup to change

These are NOT parity targets; a tester must not fail the new popup for differing here.

| Upstream | Required instead | Rule |
|---|---|---|
| Content-sized popup that grows after data arrives (§10) | fixed 340 px width, height stable from first paint | ARCHITECTURE §6.9 |
| A failed send is swallowed and treated as data (`undefined` level shown, tab reloaded; non-object `popupPanelData` shown as "not a website") (js/ext.js:51-55; js/popup.js:98-110, 325) | the bridge throws; the UI shows the failure. A failed `setFilteringMode` must not be displayed as a level | ARCHITECTURE §6.5 |
| Mouse-only control, no roles, Enter/Space inert, no focus ring (§11) | real semantics, full keyboard operation, visible focus | ARCHITECTURE §6.10 |
| `html.dark`/`html.light` set once (js/theme.js:26-33) | `html[data-theme]` kept current | ARCHITECTURE §6.8 |
| `Show matched rules` hard-coded (popup.html:52) | text through `t()`/`tNew()` | ARCHITECTURE §6.7 |
| INIT-THREW (`tabs.query` rejects, or `init()` throws later): half-rendered popup whose level control is still operable and can send `setFilteringMode` for the extension's own host or with `beforeLevel = NaN` (§3.1) | an error state; the level control and the local tools are not offered (no message, no `permissions.request` can result); the dashboard button may stay available | ARCHITECTURE §6.5; messaging.md §4.1, §4.6 step 1 |
| `disabledFeatures: null` throws (INIT-THREW) | `null` is treated exactly like a missing field (no restriction) | messaging.md §1.4, §4.1 |
| An `undefined` level (failed `setFilteringMode`, or missing `popupPanelData.level`) is stored and later sent as `level: NaN` / used as `beforeLevel: NaN` (§5.6 follow-on) | the control only ever holds an integer 0..3; a missing/non-integer `popupPanelData.level` is a failed load (error state); after a failed `setFilteringMode` no reload and no NaN in any later payload | ARCHITECTURE §6.5, §6.6 |
| `classList.toggle` with a missing `hasCustomFilters` / `developerMode` field turns the unpicker / matched-rules button ON (§3.3) | missing field = malformed response; the bridge validates it (unreachable with the PRISTINE background, so no parity test) | ARCHITECTURE §6.5 |
| The page imports `safari/ext-compat.js`, which reads/writes session key `safari.seenRealms` and may re-apply all rulesets on window focus (§12 item 5) | not reproduced; the background keeps doing it | ARCHITECTURE §6.4, §6.6 (not a user action) |

Everything else in §3-§9 is a parity target, including the quirks listed in §14 unless the row above
overrides them.

Note on trusted clicks: upstream ignores untrusted clicks on report, dashboard and matched rules (§11).
A re-implementation that triggers those actions from a user's click or key press on a real control is
equivalent; it must not trigger them programmatically at load.

---

## 14. Upstream quirks (consolidated)

1. `hasCustomFilters` is a count, not a boolean (js/filter-manager.js:92-95).
2. `hasOmnipotence` is sent but unused; `permissions.request` is made even with broad permission
   (js/popup.js:66, 77-81; bg:500).
3. `origin` in the `popupPanelData` request is unused by the handler (bg:492-508).
4. Report `mode` is the level at popup open, not the current one (js/popup.js:240) `[V]`.
5. The pending slot is never withdrawn after a denied prompt (js/popup.js:84-87; bg:145, 210-212).
6. Thumb press without movement re-commits the current level; at levels 2-3 this shows a permission
   request (js/popup.js:150, 66-81) `[V]`.
7. The drag path sets no `busy` state (js/popup.js:150).
8. The hostname's two-span markup and its bold rule are dead (js/popup.js:332; css/popup.css:93-95) `[V]`.
9. Admin tokens are not applied in the no-website state (js/popup.js:316-328).
10. A non-array `disabledFeatures` or a rejected `tabs.query` leaves a half-initialised popup (js/popup.js:38, 356) `[V]`.
11. `setFilteringMode` answering `undefined` shows an empty level and still reloads the tab (js/popup.js:98-110) `[V]`.
12. No timeout on load: a never-settling call leaves the popup blank (js/popup.js:349-360).
13. Popup and background can both reload the tab after a prompt (js/popup.js:101-110; bg:181-182).
14. Permission pattern is built from the full hostname, e.g. `*://*.www.example.com/*`, and for an IPv6
    host `*://*.[::1]/*` (js/popup.js:80) `[V]`.
15. With `tab.id` missing, the tool calls still run with `target: { tabId: undefined }` (js/popup.js:261, 276, 291) `[V]`.
16. `popupPanelData.level === undefined` in an otherwise valid response shows an empty name and
    `data-level="undefined"` (js/popup.js:330, 46-52) `[V]`; a thumb press then sends `level: NaN` (§5.6 follow-on) `[V]`.
17. INIT-THREW leaves the level control operable; after a rejected `tabs.query` it commits for the extension's
    own host (`setFilteringMode{ hostname: <extension host> }`, and `permissions.request` for
    `*://*.<extension host>/*` at levels 2-3) (js/popup.js:31, 61-97) `[V]`.
18. `beforeLevel` can be `NaN` (INIT-THREW after a `disabledFeatures` throw, or after an `undefined` answer); then
    a change to 2-3 sends no pending message and every change reloads (js/popup.js:65-67, 101) `[V]`.
19. `disabledFeatures: null` throws (the destructuring default replaces only `undefined`, js/popup.js:36-37) `[V]`.
20. `hasCustomFilters` / `developerMode` missing from the response enable the unpicker / matched-rules
    button, because `classList.toggle(name, undefined)` flips the class (js/popup.js:334-339, 344;
    PRISTINE/js/dom.js:184-190) `[V]`.
21. The `tabURL.hostname === ''` guard never protects NO-WEBSITE or INIT-THREW: the initial `tabURL` is the
    extension root (js/popup.js:31, 61).
22. The upstream popup page (not `popup.js`) touches `storage.session` (`safari.seenRealms`) and registers a
    `windows.onFocusChanged` listener through the imported Safari compat module (safari/ext-compat.js:40-64) `[V]`.

---

## 15. UNKNOWN list

1. Whether Safari fills `tab.url` for the active tab when the extension has no access to that site; if not,
   the popup shows "not a website" (js/popup.js:309, 316). The manifest's `activeTab` permission
   (`PRISTINE/manifest.json:304`) is the only thing in the build that could make the URL available then.
2. What `browser.permissions.request` does on Safari: whether a prompt appears for an origin already
   granted, what it resolves to, whether the popover closes while the prompt is shown, and whether
   `permissions.onAdded` fires (js/popup.js:77-83; bg:877-881).
3. Whether the popup's 437 ms timer still fires if Safari closes the popover (js/popup.js:103-109).
4. Whether `self.close()` closes the Safari popover (js/popup.js:263, 278, 293).
5. Whether Safari closes the popover on `runtime.openOptionsPage()`, and where it opens the page (js/popup.js:252).
6. Whether Safari closes the popover when the background creates or focuses a tab/window for `gotoURL` and
   `showMatchedRules` (js/ext-utils.js:49-67; bg:560-563), and whether `windows.create({ type: 'popup' })`
   is honoured.
7. Whether `browser.storage.managed` exists on Safari; if not, `disabledFeatures` is always `undefined`
   (js/ext.js:131-139).
8. Whether Safari reports `tab.url` in normalised form (decides `tabs.reload` vs `tabs.update`, js/popup.js:102).
9. Safari popover size limits and resize behaviour (§10).
10. Whether `dnr.getMatchedRules` works on Safari (§12 item 2).
11. Whether an `undefined` message answer arrives as `undefined` or `null` on Safari; upstream tolerates both
    for `popupPanelData` (js/popup.js:325), and compares the `setFilteringMode` answer with `!==` to numbers
    (js/popup.js:98-101).
12. What Safari's `permissions.request` does with an IP-literal pattern such as `*://*.[::1]/*` or
    `*://*.192.168.1.1/*` (reject, resolve `false`, or prompt) (js/popup.js:79-81).
13. Whether `NaN` in a message payload reaches the Safari background as `NaN` or `null` (§5.6 follow-on);
    both fall back to the default mode in the background.
14. The exact form Safari returns for `i18n.getMessage('@@ui_locale')`; upstream switches to RTL only on an
    exact match with `ar`, `he`, `fa`, `ps`, `ur` (PRISTINE/js/i18n.js:39-44), so a regional form such as
    `ar_SA` would leave upstream in LTR.
15. How long the background's start-up (`isFullyInitialized`, bg:343, 839-855) holds the popup's first
    message on Safari after a wake-up of the non-persistent background.

---

## 16. PARITY CHECKLIST

How to read: each line is one user action → the exact observable effects. "MSG x" = a
`runtime.sendMessage` call with exactly that object (no extra keys). Effects are in order; "then" means
strictly after. Fixture unless a line says otherwise: active tab `id: 42`,
`url: 'https://www.example.com/path?x=1'`; `popupPanelData` answers
`{ hasOmnipotence: false, level: 1, autoReload: true, isSideloaded: false, developerMode: false, hasCustomFilters: 0 }`;
`permissions.request` resolves `true`; `setFilteringMode` answers the requested level. H = `'www.example.com'`.
"Nothing else" = no other message and no other `tabs`/`permissions`/`scripting`/`runtime.openOptionsPage`/
`window.close` call.

Opening

1. Open the popup → `tabs.query({ active: true, currentWindow: true })`, then MSG `{ what: 'popupPanelData', origin: 'https://www.example.com', hostname: 'www.example.com' }`; nothing else. Shown: hostname `www.example.com`; level 1 with name `filteringMode1Name`; zapper, picker, report present; unpicker absent; dashboard present; matched rules absent.
2. Open on tab `EXT/strictblock.html#https://blocked.example/x?y=1` → `tabs.query(…)`, then MSG `{ what: 'popupPanelData', origin: 'https://blocked.example', hostname: 'blocked.example' }`; hostname shown `blocked.example`.
3. Open on tab `https://xn--bcher-kva.example/pfad` (or the same URL reported in Unicode form, `https://bücher.example/pfad`) → MSG `{ what: 'popupPanelData', origin: 'https://xn--bcher-kva.example', hostname: 'xn--bcher-kva.example' }`; hostname shown `bücher.example`; every later payload and the permission pattern use `xn--bcher-kva.example`.
4. Open on tab `http://user:pw@Sub.Example.COM:8080/a b?q=1#frag` → MSG `{ what: 'popupPanelData', origin: 'http://sub.example.com:8080', hostname: 'sub.example.com' }`; hostname shown `sub.example.com`.
5. Open on a non-website tab (`about:blank`; `file:///x`; `ftp://example.com/`; `EXT/dashboard.html`; `url` empty or missing; `EXT/strictblock.html` with no hash; no active tab) → `tabs.query(…)` only, NO message. Shown: `popupNoWebsite` text instead of a hostname; no level control, no caption, no local tools, no matched rules; dashboard button present.
6. Open when `popupPanelData` answers `undefined` or `null` → `tabs.query(…)`, then the one MSG of line 1; nothing else. Shown as line 5 (new UI: plus the error required by §13).
7. Open with `level: 0`, `2` or `3` → control shows that level with name `filteringMode0Name` / `2Name` / `3Name`.
8. Open with `hasCustomFilters: 2` → unpicker present, between picker and report. With `0` → absent.
9. Open with `isSideloaded: true, developerMode: true` → matched rules present. With only one of the two `true`, or tab `id` not a number → absent.
10. Open with `disabledFeatures: ['zapper']` → zapper absent. `['picker']` → picker and unpicker absent (even with `hasCustomFilters: 2`). `['report']` → report absent. `['zapper','picker','report']` → whole local-tools section including its heading absent. `['dashboard']` → dashboard and matched rules absent. `['filteringMode']` → level control shows the level but cannot be operated (line 24). `['develop']` or `[]` → no change. No message differs from line 1 in any of these.

Level control (popup opened as in line 1 unless stated)

11. Point at / preview level 3 without selecting → caption shows current name, arrow, `filteringMode3Name` (arrow `←` in RTL); leaving restores the plain current name. No message, no API call.
12. Select level 0 → MSG `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 0 }`; then, 437 ms after the answer, `tabs.reload(42)`. No `permissions.request`, no `setPendingFilteringMode`. Shown: level 0 immediately.
13. With `level: 0` or `3` at open, select level 1 → MSG `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 1 }`; then after 437 ms `tabs.reload(42)`. No `permissions.request`, no pending message.
14. Select level 2 → MSG `{ what: 'setPendingFilteringMode', tabId: 42, url: 'https://www.example.com/path?x=1', hostname: 'www.example.com', beforeLevel: 1, afterLevel: 2 }` (not awaited), then in the same event-handler run `permissions.request({ origins: [ '*://*.www.example.com/*' ] })`; after it resolves `true`: MSG `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 2 }`; then after 437 ms `tabs.reload(42)`.
15. With `level: 0` at open, select level 3 → as line 14 with `beforeLevel: 0, afterLevel: 3` and `level: 3`.
16. Select level 2 and the permission request resolves `false` (or rejects/throws) → the pending MSG of line 14, then `permissions.request(…)`; nothing else: no `setFilteringMode`, no reload. Shown: back to level 1 with its name; control usable again.
17. With `level: 2` at open, select level 3 (or `level: 3`, select 2) → `permissions.request({ origins: [ '*://*.www.example.com/*' ] })`; after `true`: MSG `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 3 }` (or `2`); then after 437 ms `tabs.reload(42)`. NO `setPendingFilteringMode`.
18. As line 17 but the request resolves `false` → `permissions.request(…)` only; nothing else. Shown: back to the previous level.
19. Select level 2, background answers `0` → calls as line 14; shown level becomes 0 (name `filteringMode0Name`); `tabs.reload(42)` after 437 ms (0 ≠ 1).
20. Select level 0, background answers `1` (unchanged) → MSG `setFilteringMode` as line 12; shown level back to 1; NO reload.
21. With `autoReload: false`, repeat lines 12, 14, 17 → same messages and permission calls; never `tabs.reload` / `tabs.update`.
22. On the strict-block tab of line 2 (opened at `level: 2`), select level 0 → MSG `{ what: 'setFilteringMode', hostname: 'blocked.example', level: 0 }`; then after 437 ms `tabs.update(42, { url: 'https://blocked.example/x?y=1' })`, NOT `tabs.reload`. Same substitution whenever the tab's `url` string differs from the normalised URL (line 4: `tabs.update(42, { url: 'http://user:pw@sub.example.com:8080/a%20b?q=1#frag' })`).
23. While a selection is being committed (permission prompt open or `setFilteringMode` unanswered) try to select another level → ignored; exactly one `setFilteringMode` in total. If the wait exceeds 1 s a busy overlay covers the popup until the commit ends.
24. With `disabledFeatures: ['filteringMode']`, try to change the level → no message, no API call.
25. Only if the control lets the user activate the level that is already current (upstream: press and release the thumb): at level 0 or 1 → MSG `{ what: 'setFilteringMode', hostname: H, level: <current> }` only, no reload; at level 2 or 3 → `permissions.request({ origins: [ '*://*.' + H + '/*' ] })` then that MSG, no pending message, no reload. If the control cannot do this, nothing is sent.
26. Only if a drag gesture is offered: while dragging, no message and no API call; caption shows `<name before> → <name under thumb>`; on release the effects are exactly those of lines 12-22 for (before = level when the drag began, after = level at release), without the busy overlay.

Tools and ribbon

27. Activate Zapper → `scripting.executeScript({ files: [ '/js/scripting/tool-overlay.js', '/js/scripting/zapper.js' ], target: { tabId: 42 } })`, then immediately `window.close()`. No message.
28. Activate Picker → `scripting.executeScript({ files: [ '/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/picker.js' ], target: { tabId: 42 } })`, then `window.close()`. No message.
29. Activate Unpicker (popup opened with `hasCustomFilters: 2`) → `scripting.executeScript({ files: [ '/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/unpicker.js' ], target: { tabId: 42 } })`, then `window.close()`. No message.
30. Activate Zapper / Picker / Unpicker when `browser.scripting` is `undefined` → nothing at all; the popup is NOT closed.
31. Activate Report → MSG `{ what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1' }`; no `window.close()`; nothing else.
32. Open at `level: 2`, select level 0, then activate Report → the `gotoURL` url ends with `&mode=2` (level at open), not `mode=0`.
33. On the strict-block tab of line 2 (opened at `level: 2`), activate Report → MSG `{ what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fblocked.example%2Fx%3Fy%3D1&mode=2' }`.
34. Activate Dashboard (any state, including line 5) → `runtime.openOptionsPage()` with no argument; no message; no `window.close()`.
35. Activate Matched rules (opened as line 9) → MSG `{ what: 'showMatchedRules', tabId: 42 }`; no `window.close()`; nothing else.
36. Right-click or middle-click any button → nothing.

Global

37. During any session the popup sends no `what` other than `popupPanelData`, `setPendingFilteringMode`, `setFilteringMode`, `gotoURL`, `showMatchedRules`; `popupPanelData` is sent exactly once per open; the new popup never touches `browser.storage`, never opens a `BroadcastChannel`, never calls `permissions.contains/getAll/remove`, `declarativeNetRequest.*` or `windows.*` (upstream's only storage/windows/DNR access comes from the imported Safari compat module and is excluded by §13).
38. Every `level`, `beforeLevel` and `afterLevel` in a payload is an integer 0..3 (never `NaN`, never a string); every `tabId` is the tab's numeric `id`; every `hostname` is the ASCII (punycode, lower-case, port-less) hostname and is never the extension's own host.
39. All visible strings come from the 13 keys of §9 (plus the matched-rules text, §13); with UI locale `ar`, `he`, `fa`, `ps` or `ur` the layout is RTL and the level order is mirrored (level 0 at the right).

Added by the audit (failure handling required by §13, plus cases the list above did not pin down)

40. Open when `tabs.query` rejects → `tabs.query(…)`, then NO message. An error is shown. No level control and no local tool can be operated: no interaction produces `setFilteringMode`, `setPendingFilteringMode`, `permissions.request` or `scripting.executeScript`. (Upstream would commit for the extension's own host, §3.1.)
41. Open when `popupPanelData` answers line 1's object plus `disabledFeatures: null` → exactly as line 1 (everything shown, no restriction).
42. Open when `popupPanelData` answers line 1's object without `level` (or with `level: '2'`, `null`, `7`) → the one MSG of line 1, then an error state as in line 40; no level is shown and no level message can result.
43. Select level 0 and `setFilteringMode` answers `undefined` (or the send rejects) → MSG of line 12, then an error is shown; NO `tabs.reload` / `tabs.update`; the control never shows an empty or "undefined" level. A following selection of level 2 sends `setPendingFilteringMode` only if the level the control then shows is 0 or 1 (with that integer as `beforeLevel`), then `permissions.request({ origins: [ '*://*.www.example.com/*' ] })`, then `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 2 }`; no payload contains `NaN`.
44. On the tab of line 4, activate Report → MSG `{ what: 'gotoURL', url: '/report.html?tabid=42&url=http%3A%2F%2Fuser%3Apw%40sub.example.com%3A8080%2Fa%2520b%3Fq%3D1%23frag&mode=1' }` (userinfo and fragment kept, `URLSearchParams` encoding).
45. On tab `http://[::1]:8080/`, select level 2 → MSG `{ what: 'setPendingFilteringMode', tabId: 42, url: 'http://[::1]:8080/', hostname: '[::1]', beforeLevel: 1, afterLevel: 2 }`, then `permissions.request({ origins: [ '*://*.[::1]/*' ] })`; if that rejects → as line 16 (back to level 1, nothing else).
46. Open with `hasCustomFilters: 1` → unpicker present (the field is a count; any value > 0 shows it).

---

## Appendix A. How the `[V]` facts were obtained

The UPSTREAM popup (`PRISTINE/popup.html` with its own scripts and styles) was served read-only over
`127.0.0.1` on a random port and loaded in headless system Chrome through `playwright-core`. Before any
page script ran, a mock `self.browser` was installed that recorded, with timestamps, every
`runtime.sendMessage`, `tabs.query/reload/update`, `permissions.request`, `scripting.executeScript`,
`runtime.openOptionsPage` and `window.close` call, and answered from a per-scenario fixture (tab, response
object, permission answer: grant / deny / throw / held open, optional delays). 107 scenarios covered: every
before→after level pair class, denial and throw, differing/unchanged/failed answers, `autoReload` off, the
437 ms timer, busy-overlay timing, thumb press and drags (LTR and RTL, at popup width), hover preview, each
tool and ribbon button, synthetic/right/middle clicks, Enter/Space, all no-website URL forms, strict-block
URLs, IDN/port/IPv6/trailing-dot hosts, every admin token, malformed responses, dark and no-hover media,
and document sizes. Nothing was written into PRISTINE. The scripts (`harness.mjs` … `harness6.mjs`) were temporary and are not included. The
"actual level differs" example of §5.6 was obtained separately, by running the upstream
`lookupFilteringMode` / `applyFilteringMode` functions (js/mode-manager.js:123-237) in Node.

Re-run on 2026-10-04 (this revision): all six harnesses were run again; the recorded calls and states are
identical to the first run except for timing-only differences (two scenarios now also captured the 437 ms
timer firing and the following `tabs.reload`, as §5.6 states; one RTL scenario read the arrow after
`mouseup`, when span 2 was already empty). A seventh harness (`harness7.mjs`, `results7.json`) confirmed
deterministically: in RTL, hovering stop 3 gives span 2 = `complete` with `::before` content EN SPACE + `←` +
EN SPACE; during a drag the stops compute `pointer-events: none`; a press and release of the thumb at level 1
sends only `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 1 }` and, with the answer 1, sets no
reload timer. `modecheck.mjs` re-confirmed the "requesting 1 answers 3" example and that a string `level`
(`'2'`) is not applied. A citation checker (`citecheck.py`) confirmed that every `file:line` citation in this
file points inside an existing file.

Limits: Chrome is not Safari. The run proves the behaviour of upstream `popup.js`/CSS for given API
answers; it says nothing about how Safari's own APIs answer (§15). Pixel sizes are Chrome measurements.

## Appendix A.2. Audit run (2026-10-04)

Method: every payload, response field, storage key, timer value, API argument and condition in this file
was re-read against the cited upstream lines (`js/popup.js` whole file; bg:142-235, 293-381, 492-564,
677-702, 806-881; js/mode-manager.js:123-356; js/admin.js:113-230; js/filter-manager.js:69-95;
js/ext-utils.js:33-68; js/debug.js:35-40; PRISTINE/js/dom.js, i18n.js, ext.js, ext-compat.js; popup.html;
css/popup.css; css/filtering-mode.css; js/config.js; both manifests). `js/popup.js`, `popup.html`,
`js/ext-compat.js` were confirmed byte-identical between source and PRISTINE with `cmp`. The upstream UI
modules were grepped for `sendMessage`, storage, `BroadcastChannel`, `addListener`, `matchMedia` and
platform tests not mentioned here.

A fresh harness (temporary, not included) served PRISTINE
read-only on `127.0.0.1` and ran the upstream popup in headless system Chrome (`playwright-core`) with a
recording mock `self.browser`. 25 scenarios. Re-confirmed unchanged: the open sequence and payload (line 1),
1→2 granted and denied, 2→3 without pending message, thumb press at level 2, strict-block `tabs.update`,
line-4 `tabs.update` URL, report `mode` = level at open, NO-WEBSITE for `about:blank`, document heights
222.6 / 374.8 / 409.8 px (§10). New `[V]` facts added by the audit: the two load-time calls of the Safari
compat module (§1, §2); INIT-THREW commits (§3.1); `disabledFeatures` `null` / `''` / `'zapper'`
(§8.4); missing `hasCustomFilters` / `developerMode` enabling buttons (§3.3); the `NaN` follow-on after an
`undefined` answer or level (§5.6); the IPv6 pending message and permission pattern (§16 line 45).

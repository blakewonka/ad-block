# Spec: dashboard "Settings" pane

Behaviour and data only. No visual design. Implementers follow this file
instead of reading upstream code. Where this file and upstream disagree,
upstream wins.

## 0. Sources, citation conventions, verification

Every statement cites `file:line`. Short names resolve as follows
(ROOT = `upstream`):

| Short name | Real path |
|---|---|
| `dashboard.html` | `ROOT/platform/mv3/extension/dashboard.html` |
| `settings.js`, `backup-restore.js`, `background.js`, `dashboard.js`, `ext.js`, `config.js`, `mode-manager.js`, `admin.js`, `utils.js`, `ext-utils.js`, `debug.js`, `prevent-popup.js`, `imported-lists.js`, `alarms.js`, `filter-manager.js`, `ruleset-manager.js`, `compiled-filters.js`, `scripting-manager.js`, `filter-lists.js`, `filter-manager-ui.js`, `rw-dnr-editor.js`, `mode-editor.js`, `develop.js`, `popup.js` | `ROOT/platform/mv3/extension/js/<name>` |
| `settings.css`, `dashboard.css`, `dashboard-common.css`, `popup.css` | `ROOT/platform/mv3/extension/css/<name>` |
| `messages.json` | `ROOT/platform/mv3/extension/_locales/en/messages.json` |
| `managed_storage.json` | `ROOT/platform/mv3/extension/managed_storage.json` |
| `safari/<name>` | `ROOT/platform/mv3/safari/<name>` |
| `src/js/<name>` | `ROOT/src/js/<name>` |
| `PRISTINE/<name>` | `build/pristine/safari/<name>` (the built Safari extension) |

How this file was verified:

- **Line numbers.** Checked with `cmp`: every file cited from
  `platform/mv3/extension/` is byte-identical to its copy in PRISTINE;
  `PRISTINE/js/ext-compat.js` and `PRISTINE/js/ext-offscreen.js` are
  byte-identical to `safari/ext-compat.js` and `safari/ext-offscreen.js`;
  `PRISTINE/js/i18n.js` and `PRISTINE/js/dom.js` are byte-identical to
  `src/js/i18n.js` and `src/js/dom.js`. Line numbers are therefore valid for
  the shipped build. In PRISTINE `_locales/en/messages.json` the value of
  `extName` is "Blocker"; the only other differences are indentation-only
  changes on lines 259-260 and 263-264 (keys of another pane), so no line
  number moves.
- **Observed behaviour, marker [H].** The unmodified PRISTINE `dashboard.html`
  was served read-only from 127.0.0.1 and loaded in headless system Chrome
  with a mocked `browser` object, and every `runtime.sendMessage`,
  `permissions.request`, `storage.*`, `alarms.*` call, file download and
  dialog was recorded for 54 scenarios. A statement marked **[H]** was seen in
  that run. The full run was repeated on 2026-10-04, and every [H] statement
  and both backup files of §6.2 (byte for byte) reproduced. This proves what
  the upstream page code does; it proves nothing about Safari itself. The
  mock background mirrors the handlers cited here; the background behaviour
  described in this file comes from reading its source, not from the run.
- **Citation ranges.** All 464 backticked `file:line` citations were checked
  to lie inside their files, and the cited lines were read against the
  claims.
- **Audit (2026-10-04).** Every message
  payload, response shape, storage key, timer value, API argument and
  condition was re-read against the cited upstream lines, and the `cmp`
  checks above were re-run (all identical). In addition, the unmodified
  upstream `js/backup-restore.js`, `js/imported-lists.js` and `js/alarms.js`
  were run in Node with a recording stub of `ext.js` (messages, `storage.local`
  get/set/remove/getKeys, `alarms.create`/`clear`). That run reproduced byte
  for byte both backup files of §6.2, the reset traffic of §8, and every
  `planRestore` vector of §13, including the vectors this audit added
  (sandbox edge cases, malformed files, the `deferredJobs` hazard). It ran
  upstream module code outside a browser, so it proves the page-side logic
  only; it says nothing about Safari. Corrections and additions made by this
  audit are not marked separately; they carry their own citations.

Other markers:

- **SAFARI** — behaviour that differs on Safari / in PRISTINE.
- **UNKNOWN** — could not be determined from source; needs a run in Safari.
- **HAZARD** — upstream quirk that must be known; do not "fix" silently
  (ARCHITECTURE §6.6), but do not let it hide a failure either (§6.5).

"Page" means the dashboard page context. "Background" means
`js/background.js`. "Store" means the page object `self.cachedRulesetData`
(§2.3).

---

## 1. What the pane contains (DOM order = reading/tab order)

Section `section[data-pane="settings"]` (`dashboard.html:43-113`) has three
blocks:

1. **Default filtering mode** (`dashboard.html:44-94`): heading, description,
   a group of three mutually exclusive options (radio `name="filteringMode"`,
   values `1`, `2`, `3`: `dashboard.html:50,65,80`). Each option carries a
   name, a fixed non-interactive illustration of its own level
   (`dashboard.html:53,68,83`; `settings.css:96-98` `pointer-events: none`) and
   a description (`dashboard.html:61,76,91`). The whole option is one `<label>`,
   so activating anywhere on it selects the radio (`dashboard.html:48,63,78`).
2. **Behavior** (`dashboard.html:95-103`): five checkboxes, in this order:
   `autoReload` (`:97`), `showBlockedCount` (`:99`), `strictBlockMode` (`:100`,
   has legend), `popupBlockMode` (`:101`, has legend), `developerMode` (`:102`,
   has legend).
3. **Backup** (`dashboard.html:104-112`): heading, summary, three buttons —
   Back up (`:108`), Restore (`:109`, followed by a hidden
   `<input type="file" accept="application/json">`, not `multiple`), Reset to
   default (`:110`, followed by a second hidden file input that no code uses:
   `settings.js:150` only ever selects the first one). File inputs are hidden
   by `dashboard-common.css:49-51`. [H]

The Settings pane is the default pane: `<body data-pane="settings">`
(`dashboard.html:22`); selecting the Settings tab removes the stored key
`dashboard.activePane` from `storage.local` (`dashboard.js:42-50`). Pane
switching itself belongs to the dashboard-shell spec.

The extension's options page is `dashboard.html`
(`safari/manifest.json:40-42`, `PRISTINE/manifest.json:297-299`).

---

## 2. Initial data

### 2.1 Request

At page load `settings.js` sends exactly one message (`settings.js:329-331`),
whatever pane is active (observed with the About pane stored as active) [H]:

```js
{ what: 'getOptionsPageData' }
```

The Settings pane's code sends nothing else at load. This holds for the whole
page only when the stored active pane is `settings` or `about` (as in the
observed run). When the stored pane is `rulesets`, `filters` or `develop`,
that pane's section is displayed and its own first-shown start-up sends its
own messages at load: `getEnabledRulesets` + `getRulesetDetails` for the
Filter-lists pane (`filter-lists.js:565`, `527-528`, `124-130`), and those of
the other panes (`filter-manager-ui.js:636`, `develop.js:628`). An
`IntersectionObserver` triggers them, and `visibility: hidden` from
`body.loading` does not stop it (`src/js/dom.js:160-168`), so they may go out
before the `getOptionsPageData` response arrives. They belong to the other
panes' specs.

The only other storage calls at load are three reads that belong to other
specs [H]:
`storage.session.get('safari.seenRealms')` (`safari/ext-compat.js:40`),
`storage.local.get('dashboard.activePane')` (`dashboard.js:52`),
`storage.local.get('hideUnusedFilterLists')` (`filter-lists.js:380`).
**SAFARI**: the same module also registers a page-side
`windows.onFocusChanged` listener (`safari/ext-compat.js:64`, `34-62`). This
is the WebKit ruleset-reload workaround. It is a concern of the whole page
and is specified in `messaging.md` (§17 item 7, U15), not here.

Transport facts:

- Upstream `sendMessage` is `runtime.sendMessage(msg).catch(console.log)`
  (`ext.js:51-55`): a failed send **resolves `undefined`**. Our bridge must
  not swallow it (ARCHITECTURE §6.5).
- The background listener ignores any message whose `what` contains `':'`,
  otherwise answers with the resolved value of `onMessage()` and returns
  `true` (`background.js:857-861`).
- Every handler first awaits full initialisation (`background.js:343`) and
  requires a trusted sender: `sender.origin` undefined or equal to the
  extension origin (`background.js:376-378`).

### 2.2 Response — every field

Built at `background.js:406-442`. 17 fields.

| Field | Type | Produced by | Meaning / consumer in this pane |
|---|---|---|---|
| `hasOmnipotence` | boolean | `hasBroadHostPermissions()` (`background.js:415,424`): `permissions.getAll().origins` includes `'<all_urls>'` or `'*://*/*'`, `false` on error (`ext-utils.js:33-38`) | Enables the strict-block toggle (`settings.js:62-64`). No other use in this pane. |
| `defaultFilteringMode` | 0, 1, 2 or 3 | `getDefaultFilteringMode()` (`background.js:416,425`) = mode of pseudo-hostname `'all-urls'` (`mode-manager.js:360-362`, `123-131`); `1` when no bucket holds `'all-urls'` (`mode-manager.js:130`). 0 none, 1 basic, 2 optimal, 3 complete (`mode-manager.js:53-56`) | Selected option (`settings.js:82-89`). |
| `enabledRulesets` | string[] | `getEnabledRulesets()` (`background.js:418,426`): enabled static DNR ruleset ids + ids (URLs) of enabled imported lists (`ruleset-manager.js:548-557`) | Backup (`backup-restore.js:62-71`); Filter-lists pane. |
| `adminRulesets` | string[] of `+id` / `-id` | `getAdminRulesets()` (`background.js:419,427`; `admin.js:171-205`) | Filter-lists pane only (`filter-lists.js:106-116`). |
| `maxNumberOfEnabledRulesets` | number | `dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` (`background.js:428`) | Filter-lists pane only (`filter-lists.js:61-63`). |
| `rulesetDetails` | object[] | `Array.from(getRulesetDetails().values())` (`background.js:417,429`): `/rulesets/ruleset-details.json` concatenated with imported lists (`ruleset-manager.js:78-89`) | Filter-lists pane only. Stock entry keys seen in `PRISTINE/rulesets/ruleset-details.json` (51 entries): `id, name, group, enabled, homeURL, filters{total,accepted,rejected}, rules{total,plain,regex,rejected}, css{generic,specific}`, optional `popups, lang, parent, tags`; inside `rules`, `strictblock` is optional (present in 45 of 51) and so is `urlskip` (2 of 51). Imported entry shape: `imported-lists.js:194-215`. |
| `autoReload` | boolean | `rulesetConfig.autoReload` (`background.js:430`); default `true` (`config.js:33`) | Checkbox (`settings.js:48`). |
| `showBlockedCount` | boolean | `rulesetConfig.showBlockedCount` (`background.js:431`); default `true` (`config.js:34`) | Checkbox (`settings.js:50-58`). |
| `canShowBlockedCount` | boolean | `typeof dnr.setExtensionActionOptions === 'function'` (`background.js:143,432`) | When `false` the checkbox is unchecked and disabled (`settings.js:54-57`). |
| `strictBlockMode` | boolean | `rulesetConfig.strictBlockMode` (`background.js:433`); default `webextFlavor !== 'safari'` (`config.js:35`) | Checkbox (`settings.js:60-65`). |
| `popupBlockMode` | boolean (see §4.4 for a non-boolean edge case) | `rulesetConfig.popupBlockMode` (`background.js:434`); default `true` (`config.js:36`) | Checkbox (`settings.js:67-70`). |
| `firstRun` | always `false` | `process.firstRun` is forced to `false` one statement before the object is built (`background.js:422`, `435`) | Dead: `settings.js:42-44` would add body class `firstRun`, never true, and no CSS uses that class. Ignore. |
| `isSideloaded` | boolean | manifest `permissions` includes `declarativeNetRequestFeedback` (`debug.js:37-40`; `background.js:436`) | Not used by any dashboard code (only `popup.js:335`). |
| `developerMode` | boolean | `rulesetConfig.developerMode` (`background.js:437`); default `false` (`config.js:37`) | Checkbox + Develop tab gate (`settings.js:72-77`). |
| `disabledFeatures` | string[] or absent | `adminReadEx('disabledFeatures')` (`background.js:420,438`): the value **cached** in `storage.session` / `storage.local` under `admin.disabledFeatures` (`admin.js:210-219`, `229`); managed storage is re-read only afterwards, asynchronously (`admin.js:220-228`) | Admin locks, §2.4. Schema: array of string tokens (`managed_storage.json:10-15`). |
| `supportsCompiledFilters` | boolean | `supportsOffscreenDocument` (`background.js:439`) | Token `compiled-filters` in `body[data-supports]` (`settings.js:338-341`); used by other panes' CSS (`settings.css:267-270,404-406`). |
| `supportsUserScripts` | boolean | `supportsUserScripts()` (`background.js:440`): `browser.userScripts.getScripts()` does not throw (`ext.js:40-44`) | Token `user-scripts` (`settings.js:335-337`); other panes only (`settings.css:278-280`). |

Side effects of the request in the background: sets `process.firstRun = false`
(`background.js:422`); `adminReadEx` rewrites `admin.disabledFeatures` in
`storage.session` and `storage.local` (`admin.js:220-225`).

Because `disabledFeatures` is the cached value, and every call refreshes the
cache only after answering (options data, popup data, session start:
`background.js:420,496,807`), a policy change reaches the dashboard only on a
page load that happens after some earlier call refreshed the cache, and never
without a reload (§2.4).

**SAFARI / PRISTINE values**

- `canShowBlockedCount` is always `true`: the Safari `dnr` wrapper object
  always defines the method (`safari/ext-compat.js:216-218`). The row is
  therefore enabled on Safari.
- `strictBlockMode` defaults to `false` (`config.js:35`) and the row is hidden
  (§4.3).
- `supportsCompiledFilters` is `false` (`safari/ext-offscreen.js:25`).
- `supportsUserScripts`: expected `false` — the manifest requests no
  `userScripts` permission (`PRISTINE/manifest.json:303-312`), so
  `browser.userScripts` should be undefined and the probe throws
  (`ext.js:40-44`). Runtime result **UNKNOWN**.
- `isSideloaded` is `true` in PRISTINE: its manifest contains
  `declarativeNetRequestFeedback` (`PRISTINE/manifest.json:311`); the upstream
  Safari manifest does not (`safari/manifest.json:46-54`).
- `maxNumberOfEnabledRulesets` = native
  `declarativeNetRequest.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS`
  (`safari/ext-compat.js:144`); numeric value **UNKNOWN**.
- `hasOmnipotence`: PRISTINE declares `host_permissions: ["<all_urls>"]`
  (`PRISTINE/manifest.json:300-302`), but what `permissions.getAll().origins`
  contains on Safari after the user allowed all websites is **UNKNOWN**.
- `disabledFeatures`: read from `browser.storage.managed`, skipped when that
  object does not exist (`ext.js:131-139`). Whether Safari exposes
  `storage.managed` is **UNKNOWN**; if it does not, the field is always absent
  and no admin lock ever applies.
- Default-enabled stock rulesets in PRISTINE (`enabled: true` in
  `PRISTINE/rulesets/ruleset-details.json`): `ublock-filters`, `easylist`,
  `easyprivacy`, plus language/mobile matches chosen at run time
  (`ruleset-manager.js:440-486`).

Fixture for mocks (Safari, fresh install, all websites allowed). Values marked
`*` are placeholders for UNKNOWN facts:

```json
{
  "hasOmnipotence": true,
  "defaultFilteringMode": 2,
  "enabledRulesets": ["ublock-filters", "easylist", "easyprivacy"],
  "adminRulesets": [],
  "maxNumberOfEnabledRulesets": 50,
  "rulesetDetails": [],
  "autoReload": true,
  "showBlockedCount": true,
  "canShowBlockedCount": true,
  "strictBlockMode": false,
  "popupBlockMode": true,
  "firstRun": false,
  "isSideloaded": true,
  "developerMode": false,
  "supportsCompiledFilters": false,
  "supportsUserScripts": false
}
```

(`maxNumberOfEnabledRulesets: 50`* ; `rulesetDetails` = the 51 records of
`PRISTINE/rulesets/ruleset-details.json`; `disabledFeatures` absent.) Without
broad host permission at install time the background switches the default to
basic (`background.js:793-801`): the second fixture is the same object with
`"hasOmnipotence": false, "defaultFilteringMode": 1`.

### 2.3 Boot sequence

`settings.js:327-353`, in order:

1. The store starts as `{}` (`settings.js:327`, `self.cachedRulesetData`). It
   is shared with the Filter-lists pane (`filter-lists.js:62,107,132-133`) and
   passed to backup (`settings.js:138`).
2. Until the response arrives the whole page is invisible: body has class
   `loading` (`dashboard.html:22`) → `visibility: hidden`
   (`settings.css:14-16`).
3. Response falsy → return (`settings.js:332`). **HAZARD**: the page then stays
   hidden forever, with no message, and the live-sync channel is never opened
   [H]. New UI must show an error state instead (ARCHITECTURE §6.5); it must
   still not render widgets from missing data.
4. Store := response (`settings.js:333`).
5. `body[data-supports]` := space-joined tokens: `user-scripts` if
   `supportsUserScripts`, `compiled-filters` if `supportsCompiledFilters`
   (`settings.js:334-341`). **SAFARI**: expected empty string. [H]
6. Apply admin rules (§2.4), then render widgets (§3.1, §4); any exception is
   logged, and `loading` is removed regardless (`settings.js:342-349`). Both
   calls share one `try`: an exception in `renderAdminRules` (for example a
   `disabledFeatures` value that has `length` but no `join`) skips
   `renderWidgets` entirely. An exception inside `renderWidgets` leaves every
   later control unrendered. `renderDefaultMode` runs first
   (`settings.js:46`), so a bad `defaultFilteringMode` leaves all five
   toggles unchecked. The page is shown anyway.
7. Only now is the live-sync channel opened (`settings.js:350`, §5). It is
   opened even when step 6 threw.

Ownership note for the React page: upstream runs steps 1-7 once per page load,
independent of the active pane, and the store and the channel are shared by
the Settings and Filter-lists panes. Exactly one part of the React page must do the same; the
Settings pane must not send a second `getOptionsPageData` or open a second
channel. The embedded `dashboard-classic.html` frame is the unmodified
upstream page. When the shell creates it, it runs upstream `settings.js`
itself and sends its own `getOptionsPageData` and opens its own channel
(`dashboard-shell.md` §5). That traffic belongs to the frame, not to the React
Settings pane, and does not count against the "exactly one" rule above.

### 2.4 Page-level flags derived from the data

| Flag | Set at | Rule |
|---|---|---|
| `body[data-platform]` | `dashboard.js:33` | `webextFlavor`: `'safari'` when `runtime.getURL('')` starts with `safari-web-extension:`, else `'firefox'` / `'chromium'` (`ext.js:30-34`). [H] |
| `body[data-forbid]` | `settings.js:29-32` | Space-joined `disabledFeatures`; attribute not set when the list is empty or absent. [H] |
| `body[data-pane] = 'about'` | `settings.js:33-35` | Forced when `disabledFeatures` includes `dashboard`. [H] |
| `body[data-develop]` | `settings.js:72-76`, `224-228` | `"true"` / `"false"`, see §4.5. Shows the Develop tab only when `"true"` (`dashboard.css:47-49`). |
| `body[data-supports]` | `settings.js:334-341` | See §2.3 step 5. |

`disabledFeatures` tokens that affect the dashboard:

| Token | Effect | Source |
|---|---|---|
| `dashboard` | Settings, Filter lists and Custom filters tabs and sections hidden; pane forced to About [H] | `settings.css:32-39`; `settings.js:33-35` |
| `filteringMode` | The whole "Default filtering mode" block is hidden [H] | `settings.css:40-43` |
| `develop` | Developer-mode row hidden; effective developer mode forced `false` [H] | `settings.css:48-50`; `settings.js:73-74` |
| `picker` | Custom filters tab and section hidden (shell) | `settings.css:44-47` |

Rules that apply to all tokens:

- They are evaluated **once**, at boot (`settings.js:343`). No broadcast
  carries `disabledFeatures` (the admin change processor has no case for it:
  `admin.js:124-166`), and the channel listener ignores such a key
  (`settings.js:249-323`) [H]. A changed policy takes effect on a later page
  load.
- They hide; they never disable. There is no "locked but visible" state.
- **HAZARD (ordering, from source, not observed).** Two independent async
  writers set `body[data-pane]` at load: `dashboard.js:52-55` (stored
  `dashboard.activePane`) and `settings.js:33-35` (forced `about`). The source
  does not order them. If the storage read resolves after the options
  response, a stored `rulesets` or `filters` pane overrides the forced About
  pane, and since those sections are hidden by `settings.css:32-39` the page
  shows no pane. In practice the storage read usually resolves first, but
  this is not guaranteed. The new UI must apply the forced About pane after both
  have resolved, so that it wins whatever the order.

Tokens `zapper` and `report` only affect the popup (`popup.css:100-104`).
The second selector of `settings.css:41` (`h3[data-i18n="filteringMode0Name"]`)
matches nothing in `dashboard.html`: dead CSS.

---

## 3. Default filtering mode selector

### 3.1 Options and rendering from state

- Offered levels: **1 (basic), 2 (optimal), 3 (complete)**, in that order
  (`dashboard.html:48-92`). **Level 0 (no filtering) is not offered.**
- Selected option = `defaultFilteringMode`. When it is `0`, **no option is
  selected** (`settings.js:82-89`) [H]. Level 0 can occur through admin policy
  `defaultFiltering: "none"` (`mode-manager.js:262-273`), through the
  Develop pane's mode editor, or through a restored file whose
  `filteringModes.none` contains `all-urls` (both via `setFilteringModeDetails`,
  `background.js:545-551`; `mode-manager.js:123-131`).
- Re-rendered on every `renderWidgets()` call (`settings.js:46`), i.e. after
  boot, after every mode change attempt (`settings.js:125`) and after every
  relevant broadcast (§5).
- Hidden entirely when `disabledFeatures` includes `filteringMode` (§2.4).
- Admin policy `defaultFiltering` does **not** disable the selector; it is only
  re-applied when the background rebuilds its mode cache
  (`mode-manager.js:241-300`). No lock state exists in upstream for it.

### 3.2 Change handling

Trigger: native `change` on a radio (`settings.js:128-132`). It fires only when
the selection actually changes; activating the already-selected option sends
nothing [H]. Native radios also fire `change` on arrow-key navigation, and
that path behaves identically, permission request included [H].

Handler `onFilteringModeChange` (`settings.js:93-126`), `newLevel` =
`parseInt(value, 10)`:

**Level 1** (`settings.js:99-106`) [H]

1. No permission call.
2. Send and await:
   ```js
   { what: 'setDefaultFilteringMode', level: 1 }
   ```
3. Store `defaultFilteringMode` := response (`actualLevel`).
4. Re-render all widgets (`settings.js:125`).

No permission is removed; `hasOmnipotence` is left as is.

**Level 2 or 3** (`settings.js:107-121`) [H]

1. Call, as the **first asynchronous operation of the handler**:
   ```js
   browser.permissions.request({ origins: [ '<all_urls>' ] })
   ```
   (`settings.js:109-111`). It is called on every change to 2 or 3, **even when
   `hasOmnipotence` is already `true`** (there is no check) [H].
2. If the result is truthy (`settings.js:112`):
   1. Send and await:
      ```js
      { what: 'setDefaultFilteringMode', level: 2 }   // or level: 3
      ```
   2. Store `defaultFilteringMode` := response (`settings.js:117`).
   3. Store `hasOmnipotence` := `true` (`settings.js:118`).
3. If the result is falsy: nothing is sent, the store is untouched.
4. Re-render all widgets (`settings.js:125`).

`level` is a JavaScript number in both cases.

Never sent by this pane: `setPendingFilteringMode` (popup only,
`popup.js:68-75`), `permissions.remove`, any tab reload.

There is no re-entrancy guard (`settings.js:93-126`): a second change while a
first one is still waiting (permission prompt, message) starts a second,
independent run; whichever response arrives last ends up in the store.

### 3.3 Gesture requirement

`browser.permissions.request` must run synchronously inside the user-gesture
event. Upstream satisfies this: the listener calls the handler directly from
event dispatch (`src/js/dom.js:32-51`, `settings.js:131`), and nothing is
awaited before line 109 (`settings.js:94-109` is synchronous). Observed: the
call happens while the `change` event is still being dispatched, for pointer
and keyboard alike; the message that follows is sent after dispatch [H].

For the new UI this means: call it in the same task as the user's
click/keydown/change callback — no `await`, promise `.then`, `setTimeout`,
state-update-then-effect, or message round trip before it (ARCHITECTURE §6.6).
A control that reports its change asynchronously cannot be used for levels 2
and 3.

### 3.4 Failure and revert

| Case | Upstream result | Source |
|---|---|---|
| Permission denied (`false`) | No message. `renderWidgets()` re-selects the option matching the unchanged stored `defaultFilteringMode` (or none if it is 0). This is the only revert mechanism. [H] | `settings.js:112-120,125`, `82-89` |
| Background returns a different level than requested | The option for the **returned** level is selected. [H] | `settings.js:104,117,125` |
| `permissions.request` rejects / throws | **HAZARD**: no `try/catch` (contrast `popup.js:77-83`). The handler rejects, `renderWidgets()` is skipped, the clicked option stays selected although nothing changed. [H] | `settings.js:109-111` |
| Message fails (upstream resolves `undefined`) | **HAZARD**: store gets `defaultFilteringMode = undefined` (and, for levels 2/3, `hasOmnipotence = true`); `renderDefaultMode` then dereferences a null element and throws; clicked option stays selected. [H] Until a broadcast carries a defined `defaultFilteringMode`, every later `renderWidgets()` run (for example the echo of a toggle) also throws in `renderDefaultMode`, before it reaches any toggle, so no control is refreshed from the store any more (from source). | `ext.js:51-55`; `settings.js:104,117-118,84-85`, `46`, `317-319` |

Required outcome in the new UI for the two HAZARD rows: selection returns to
the stored `defaultFilteringMode`, the store is not corrupted, the failure is
surfaced. No extra message is sent.

While the permission prompt is open upstream shows no busy state; the clicked
option stays visually selected, the store is unchanged, and the revert (if
any) happens only when the prompt is answered [H].

### 3.5 What the background does (for mocks and tests)

- Handler (`background.js:533-540`): reads the current default, calls
  `setDefaultFilteringMode(level)`, re-registers content scripts and user
  scripts only if the level changed, **returns the resulting level (number)**.
- `setDefaultFilteringMode` = `setFilteringMode('all-urls', level)`
  (`mode-manager.js:364-366`, `351-356`): moves `'all-urls'` to the bucket of
  the new level (`mode-manager.js:153-190`), writes `filteringModeDetails` to
  `storage.local` and `storage.session`, then broadcasts
  `{ defaultFilteringMode, hasOmnipotence, filteringModeDetails }`
  (`mode-manager.js:304-322`) — also when the level did not change
  (`mode-manager.js:351-356`). The page therefore also receives its own change
  through §5. `hasOmnipotence` in that broadcast is read afresh from the
  browser (`mode-manager.js:312`), so it corrects the optimistic `true` of
  `settings.js:118` if the two disagree.
- It does not check host permissions: the level is stored as requested.
- Granting `<all_urls>` also fires `permissions.onAdded` in the background
  (`background.js:877-881`). The dashboard never sets a pending request. The
  only exception is a stale one: the popup sends `setPendingFilteringMode`
  before its own permission prompt, and a declined prompt never clears it
  (`popup.js:66-87`; `background.js:525-527`, `211-212`). In that case the
  grant is routed to `onPermissionGrantedThruExtension`, which does nothing
  for `<all_urls>` beyond persisting host permissions
  (`background.js:169-175`), and no sync runs. Otherwise the background runs
  `syncWithBrowserPermissions()` (`background.js:210-217`, `186-190`), which may itself raise a `basic` default to `optimal`
  (`mode-manager.js:403-406`) and broadcast. That flow and the message handler
  are two concurrent read-modify-write runs on the same mode table
  (`mode-manager.js:351-356`, `304-309`); the source does not serialise them,
  so which write lands last is **UNKNOWN**. Whatever the outcome, the final
  level reaches the page as a broadcast (§5); the pane must show that level,
  not insist on the one the user picked. No tab is reloaded on this path: for
  `<all_urls>` the derived hostname is `'all-urls'` (`utils.js:114-119`),
  which never matches a tab hostname (`background.js:200-206`). Whether Safari
  fires `onAdded` is **UNKNOWN**.

---

## 4. Behaviour toggles

Common rules (`settings.js:196-228`):

- Trigger: native `change` on the checkbox. The message is sent synchronously
  in the event [H].
- The message is **fire-and-forget**: not awaited, response ignored, no revert
  on failure, no busy state. **HAZARD**: when the send fails the checkbox keeps
  showing the new state although nothing changed [H].
- The store is **not** updated by the handler [H]. Upstream relies on the
  native checkbox for immediate visual state and on the broadcast echo (§5) to
  update the store. The new UI must show the new state immediately and must end
  up with the same store content (the value backup reads, §6).
- No toggle has an "admin-locked" presentation in upstream. Admin policies
  `showBlockedCount`, `strictBlockMode`, `popupBlockMode`
  (`managed_storage.json:31-42`) overwrite the stored value at session start
  (`admin.js:53-64`, `68-78`; `background.js:711`) and when the policy changes
  (`admin.js:149-164`, `79-108`, which also broadcasts), but the user can still
  toggle them afterwards. The only admin-driven UI states are the
  `disabledFeatures` tokens of §2.4.

| Toggle | Message (exact) | Handler | Response | Broadcast echo |
|---|---|---|---|---|
| Auto reload | `{ what: 'setAutoReload', state: <checked> }` (`settings.js:196-201`) | `background.js:461-465` coerces to boolean, saves config | `undefined` | `{ autoReload }` |
| Show blocked count | `{ what: 'setShowBlockedCount', state: <checked> }` (`settings.js:203-208`) | `background.js:467-476` coerces, calls `dnr.setExtensionActionOptions({ displayActionCountAsBadgeText })` when supported, saves | `undefined` | `{ showBlockedCount }` |
| Strict blocking | `{ what: 'setStrictBlockMode', state: <checked> }` (`settings.js:210-215`) | `background.js:478-481` → `ruleset-manager.js:342-357` | `undefined` | `{ strictBlockMode }` |
| Pop-up blocking | `{ what: 'setPopupBlockMode', state: <checked> }` (`settings.js:217-222`) | `background.js:483-487` → `prevent-popup.js:65-72`, then re-registers content scripts | `undefined` | `{ popupBlockMode }` |
| Developer mode | `{ what: 'setDeveloperMode', state: <checked> }` (`settings.js:224-228`) | `background.js:489-490` → `264-270` (`state === true`), saves | boolean (new value) | `{ developerMode }` |

`<checked>` is the boolean `ev.target.checked`. Saving means writing the whole
`rulesetConfig` object to `storage.session` and `storage.local` under key
`rulesetConfig` (`config.js:70-73`). All five payloads were observed exactly
as written [H].

State of each control, derived from the store (`settings.js:40-78`):

| Control | Shown | Enabled | Checked |
|---|---|---|---|
| Auto reload | always | always | `autoReload` |
| Show blocked count | always | `canShowBlockedCount` | `canShowBlockedCount && showBlockedCount` |
| Strict blocking | platform is not Safari | `hasOmnipotence` | `hasOmnipotence && strictBlockMode` |
| Pop-up blocking | always | always | `popupBlockMode` |
| Developer mode | `disabledFeatures` lacks `develop` | always | `Boolean(developerMode) && disabledFeatures` lacks `develop` |

("always" is within a visible pane; `dashboard` in `disabledFeatures` removes
the whole pane, §2.4.)

### 4.1 Auto reload

- Rendered: checked = `autoReload` (`settings.js:48`). Always enabled, always
  visible.
- Meaning: tab reload after a filtering-mode change made from the popup or a
  browser permission grant (`popup.js:101-110`; `background.js:181,190`). It
  has no effect inside the dashboard.

### 4.2 Show blocked count

- Rendered (`settings.js:50-58`): if `canShowBlockedCount` → checked =
  `showBlockedCount`; else unchecked **and disabled** [H] (upstream never
  re-enables it within the page's lifetime).
- **SAFARI**: `canShowBlockedCount` is `true` (§2.2), so the row is enabled.
  Whether the native `setExtensionActionOptions` call succeeds is **UNKNOWN**;
  if it throws synchronously, the handler stops before saving and before
  broadcasting, and never answers (`background.js:467-476`, `857-861`).

### 4.3 Strict blocking

- Rendered (`settings.js:60-65`): checked = `hasOmnipotence && strictBlockMode`;
  **disabled when `hasOmnipotence` is false** [H]. The legend is dimmed with
  the disabled label (`settings.css:52-55`).
- **SAFARI: the whole row (checkbox + legend) is hidden** [H]. Markup
  `data-platform-exclude="safari"` (`dashboard.html:100`) + rule
  `body[data-platform="safari"] [data-platform-exclude="safari"] { display: none }`
  (`settings.css:104-106`). The new UI must not render it on Safari and so
  never sends `setStrictBlockMode` from a toggle there. (Restore/reset still
  send it, §7.3.) Strict-block rules are never installed on Safari
  (`ruleset-manager.js:267-272`).
- Background detail: no-op when the value is unchanged; turning it off also
  removes `excludedStrictBlockHostnames` from local and session storage
  (`ruleset-manager.js:342-357`). The echo is sent in every case
  (`background.js:480`).

### 4.4 Pop-up blocking

- Rendered: checked = `popupBlockMode` (`settings.js:67-70`). Always enabled.
  Visible on Safari (no platform exclusion, `dashboard.html:101`).
- Background detail: no save when `Boolean(state)` equals the current value,
  but content scripts are re-registered and the echo is sent in every case
  (`prevent-popup.js:65-72`; `background.js:483-487`). The handler stores the
  **raw** `state` value, not a coerced boolean (`prevent-popup.js:70`); the UI
  always sends a boolean, but a restored file can carry another type (§7.3).

### 4.5 Developer mode

- Effective state (`settings.js:72-77`):
  `Boolean(developerMode) && disabledFeatures?.includes('develop') !== true`.
  The checkbox shows the effective state and `body[data-develop]` is set to
  it as a string. The store keeps the raw `developerMode` [H].
- On change (`settings.js:224-228`): send the message, then **immediately** set
  `body[data-develop]` to the new checked state, i.e. the Develop tab appears
  or disappears without waiting for the background [H].
- Row hidden when `disabledFeatures` includes `develop` (`settings.css:48-50`).
  The background also forces it off at session start in that case
  (`background.js:807-814`).
- Visible on Safari. **SAFARI**: the rule-match debug listener that developer
  mode toggles is not available (the Safari `dnr` wrapper has no
  `onRuleMatchedDebug`: `safari/ext-compat.js:142-219`; `debug.js:35,201-209`),
  so the toggle gates the Develop tab and whether user DNR rules are applied
  the next time they are rebuilt (`ruleset-manager.js:758-760`). Because
  `isSideloaded` is `true` in PRISTINE (§2.2), it also gates the popup's
  matched-rules tool (`popup.js:334-338`). While it is on, every background
  session start also re-registers content scripts
  (`background.js:763-767`). The pane does not show any of this.
- Turning it off does not change `body[data-pane]`; pane fallback is a
  dashboard-shell concern.

---

## 5. Live synchronisation

### 5.1 Mechanism

- One `BroadcastChannel` named **`'uBOL'`**, opened by the page only after a
  successful boot (`settings.js:244-247`, `350`). Never closed.
- The background posts by creating a new channel object per message
  (`utils.js:133-136`).
- **There is no `storage.onChanged` listener for the Settings pane.** (Other
  panes have their own: `filter-manager-ui.js:620`, `rw-dnr-editor.js:52`.)
- **UNKNOWN (SAFARI)**: whether a message posted from the Safari background
  page (`"persistent": false`, `PRISTINE/manifest.json:12`) reaches a dashboard
  tab. If it does not, the store only changes through the page's own actions
  and upstream's toggles/backup would work on stale data; see §11 items H4
  and H7.

### 5.2 Merge rules

`listen.onmessage` (`settings.js:249-323`). A message is ignored unless it is
an object (`settings.js:251`; strings and `null` are ignored [H]). A message
may carry several fields; each is handled independently, then at most one
re-render of each kind happens. All rows observed [H].

| Field in message | Condition to apply | Store update | Then |
|---|---|---|---|
| `hasOmnipotence` | present and `!==` stored (`:256-261`) | replace | re-render widgets |
| `defaultFilteringMode` | present and `!==` stored (`:263-268`) | replace | re-render widgets |
| `autoReload` | present and `!==` stored (`:270-275`) | replace | re-render widgets |
| `showBlockedCount` | present and `!==` stored (`:277-282`) | replace | re-render widgets |
| `strictBlockMode` | present and `!==` stored (`:284-289`) | replace | re-render widgets |
| `popupBlockMode` | present and `!==` stored (`:291-296`) | replace | re-render widgets |
| `developerMode` | present and `!==` stored (`:298-303`) | replace | re-render widgets (updates the Develop tab gate, §4.5) |
| `adminRulesets` | present and sorted-joined hash differs (`:305-310`; `dashboard.js:83-86`) | replace | re-render filter lists |
| `enabledRulesets` | present (`:312-315`, no comparison) | replace | re-render filter lists |
| anything else (e.g. `filteringModeDetails`, `disabledFeatures`) | — | ignored | — |

"Present" means `!== undefined`. "Re-render widgets" = all of §3.1 and §4 from
the store (`settings.js:317-319`, `40-78`). "Re-render filter lists" =
`renderFilterLists(true)` (`settings.js:320-322`), which does nothing until
the Filter-lists pane has been shown once (`filter-lists.js:120-122`). Once it
has been shown, every such re-render sends
`{ what: 'getEnabledRulesets' }` and `{ what: 'getRulesetDetails' }` and
**overwrites** the store's `enabledRulesets` and `rulesetDetails` with the
responses (`filter-lists.js:124-133`). The fresh `getEnabledRulesets` value
reads the browser's enabled static rulesets plus the enabled imported lists
(`ruleset-manager.js:548-557`). It can differ from the broadcast value, which
is the background's saved config (§5.3). After that, backup (§6) reads the
fresh value. Those two messages belong to the Filter-lists spec; the
store-content consequence is what matters here.

Messages are applied in arrival order with no versioning. Two consequences of
upstream's "re-render everything from the store":

- A broadcast about one field re-applies **all** widgets from the store. A
  checkbox the user just toggled, whose echo has not arrived yet, is put back
  to the stored value until its own echo arrives (`settings.js:40-78`,
  `317-319`).
- Two quick toggles of the same control produce two echoes; the first one
  briefly shows the older value [H].

A React implementation that keeps the user's value until the matching echo
arrives avoids both; that is a presentation choice and changes no message.

### 5.3 Who broadcasts what

| Message | Sent when | Source |
|---|---|---|
| `{ autoReload }` | `setAutoReload` | `background.js:464` |
| `{ showBlockedCount }` | `setShowBlockedCount`; admin policy change | `background.js:475`; `admin.js:95` |
| `{ strictBlockMode }` | `setStrictBlockMode`; admin policy change | `background.js:480`; `admin.js:101` |
| `{ popupBlockMode }` | `setPopupBlockMode`; admin policy change | `background.js:486`; `admin.js:85` |
| `{ developerMode }` | `setDeveloperMode`; forced off at session start when `develop` is disabled | `background.js:267`, `807-814` |
| `{ defaultFilteringMode, hasOmnipotence, filteringModeDetails }` | any write of mode details: `setDefaultFilteringMode`, popup `setFilteringMode`, permission sync | `mode-manager.js:304-322` |
| `{ defaultFilteringMode }` | `setFilteringModeDetails`; admin `defaultFiltering` change | `background.js:548-549`; `admin.js:140-141` |
| `{ filteringModeDetails }` | admin `noFiltering` change | `admin.js:145-147` |
| `{ enabledRulesets }` | end of every `applyRulesets` run (message `applyRulesets`, `importFilterList`), even if nothing changed. The value is the background's saved `rulesetConfig.enabledRulesets`, not a fresh read of the browser | `background.js:259`, `239-260`, `640-647` |
| `{ adminRulesets, enabledRulesets }` | admin `rulesets` change | `admin.js:125-135` |

`filteringModeDetails` in these payloads holds `Set` objects
(`mode-manager.js:319`, `309`, `96-103`); this pane ignores the key.

Consequences to preserve: a second open dashboard, the popup's mode change,
and restore/reset (§7, §8) all update this pane without a reload.

---

## 6. Backup

Trigger: click on the Back up button (`settings.js:230-232`) →
`backupSettings()` (`settings.js:136-146`). No confirmation, no busy state
[H].

### 6.1 Calls, in order

`backupToObject(store)` (`backup-restore.js:36-88`), where `store` is the
current page store (`settings.js:138`). Observed order [H]:

1. `runtime.getManifest()` → `version` := `manifest.versionName ??
   manifest.version` (`backup-restore.js:38-39`). PRISTINE: `"2026.1003.1243"`
   (`PRISTINE/manifest.json:314`; there is no `versionName`).
2. In parallel, sent in this order (`backup-restore.js:40-46`):
   ```js
   { what: 'getDefaultConfig' }
   { what: 'getSandboxFilters' }
   ```
   The second result is trimmed; missing → `''`.
3. `{ what: 'getFilteringModeDetails' }` (`backup-restore.js:75`).
4. `{ what: 'getAllCustomFilters' }` (`backup-restore.js:76`).
5. Page-side read `browser.storage.local.get('userDnrRules')`
   (`backup-restore.js:83`; `ext.js:59-67`). Not a message.

No write of any kind. (Loading the upstream module for the first time also
reads `storage.session` key `console`, a side effect of `debug.js:47` being
imported through `imported-lists.js:34`; it is not part of backup.)

Responses:

- `getDefaultConfig` (`background.js:390-401`):
  ```js
  {
    autoReload: true,            // config.js:33
    developerMode: false,        // config.js:37
    showBlockedCount: true,      // config.js:34
    strictBlockMode: false,      // SAFARI; true elsewhere (config.js:35)
    popupBlockMode: true,        // config.js:36
    rulesets: [ /* default ruleset ids for this environment */ ],  // ruleset-manager.js:440-486
    filteringModes: { none: [], basic: [], optimal: [ 'all-urls' ], complete: [] }  // mode-manager.js:58-63
  }
  ```
- `getSandboxFilters` (`background.js:621-622`): string or `undefined`
  (`filter-manager.js:313-315`).
- `getFilteringModeDetails` (`background.js:542-543`):
  `{ none: string[], basic: string[], optimal: string[], complete: string[] }`
  (`mode-manager.js:87-94`, `326-335`).
- `getAllCustomFilters` (`background.js:578-579`): array of
  `[ hostname, selectors[] ]` pairs, one per `site.<hostname>` storage key
  (`filter-manager.js:99-114`).

### 6.2 JSON shape

Keys are added in exactly this order (`backup-restore.js:37-87`) [H]:

| Key | Included when | Value |
|---|---|---|
| `version` | always | string |
| `autoReload` | store value `!==` default (`:47-49`) | store value |
| `developerMode` | `!==` default (`:50-52`) | store value (raw, not the effective one of §4.5) |
| `popupBlockMode` | `!==` default (`:53-55`) | store value |
| `showBlockedCount` | `!==` default (`:56-58`) | store value |
| `strictBlockMode` | `!==` default (`:59-61`) | store value |
| `rulesets` | non-empty (`:62-74`) | first `"+id"` for each id in store `enabledRulesets` not in default `rulesets` (store order), then `"-id"` for each default id not enabled (default order) |
| `filteringModes` | always (`:75`) | response of `getFilteringModeDetails` |
| `customFilters` | array non-empty (`:76-79`) | response of `getAllCustomFilters` |
| `sandboxFilters` | trimmed text non-empty (`:80-82`) | `text.split('\n')` |
| `dnrRules` | stored value is a non-empty string (`:83-86`) | `text.split(/\n+/)` (runs of blank lines collapse) |

The toggle values and `enabledRulesets` come from the **store**, not from a
fresh read (`backup-restore.js:47-62`). **HAZARD**: if the store is stale
(toggle echo not received, §5.1), the file silently lacks the user's latest
toggles [H].

Example with every optional key present — the exact text upstream produced
[H] for these inputs:

- store: `autoReload: false, developerMode: true, popupBlockMode: false,
  showBlockedCount: false, strictBlockMode: true, enabledRulesets:
  ['ublock-filters','easylist','annoyances-cookies','deu-0']`;
- `getDefaultConfig`: the object of §6.1 with `strictBlockMode: false` and
  `rulesets: ['ublock-filters','easylist','easyprivacy']`;
- `getSandboxFilters`: `'  example.net##+js(set, foo, 1)\nexample.net##.x\n'`;
- `getFilteringModeDetails`:
  `{ none: ['example.com'], basic: [], optimal: [], complete: ['all-urls'] }`;
- `getAllCustomFilters`:
  `[ ['example.org', ['.ad-banner', '{"selector":"div","tasks":[["has-text","x"]]}']] ]`;
- stored `userDnrRules`:
  `'action:\n  type: block\n\n\ncondition:\n  urlFilter: x'`.

```json
{
  "version": "2026.1003.1243",
  "autoReload": false,
  "developerMode": true,
  "popupBlockMode": false,
  "showBlockedCount": false,
  "strictBlockMode": true,
  "rulesets": [
    "+annoyances-cookies",
    "+deu-0",
    "-easyprivacy"
  ],
  "filteringModes": {
    "none": [
      "example.com"
    ],
    "basic": [],
    "optimal": [],
    "complete": [
      "all-urls"
    ]
  },
  "customFilters": [
    [
      "example.org",
      [
        ".ad-banner",
        "{\"selector\":\"div\",\"tasks\":[[\"has-text\",\"x\"]]}"
      ]
    ]
  ],
  "sandboxFilters": [
    "example.net##+js(set, foo, 1)",
    "example.net##.x"
  ],
  "dnrRules": [
    "action:",
    "  type: block",
    "condition:",
    "  urlFilter: x"
  ]
}
```

Minimal file (nothing customised) — `version` and `filteringModes` only [H]:

```json
{
  "version": "2026.1003.1243",
  "filteringModes": {
    "none": [],
    "basic": [],
    "optimal": [
      "all-urls"
    ],
    "complete": []
  }
}
```

### 6.3 File delivery

`settings.js:139-145` [H]:

- Abort silently if the result is not an object (`:139`).
- Text = `JSON.stringify(data, null, 2) + '\n'` (2-space indent, trailing
  newline).
- A detached `<a>` (never inserted in the document) with
  `href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text)`,
  attribute `download="my-ubol-settings.json"`, attribute
  `type="application/json"`, then `a.click()`.
- **File name: `my-ubol-settings.json`.**
- The click happens after several awaits, i.e. outside the synchronous part of
  the user gesture [H]. **UNKNOWN (SAFARI)**: whether a programmatic click on
  a detached `data:` anchor with `download` saves a file named
  `my-ubol-settings.json` from a `safari-web-extension:` page.

### 6.4 Failures

What upstream does when one of the four messages fails (resolves `undefined`,
`ext.js:51-55`) [H]:

| Failed message | Upstream result | Source |
|---|---|---|
| `getDefaultConfig` | throws reading a property of `undefined`; no file, no message to the user | `backup-restore.js:47` |
| `getAllCustomFilters` | throws on `.length`; no file, no message | `backup-restore.js:77` |
| `getSandboxFilters` | **HAZARD**: treated as "no sandbox filters"; a file is produced without `sandboxFilters` | `backup-restore.js:45`, `80-82` |
| `getFilteringModeDetails` | **HAZARD**: `filteringModes` becomes `undefined` and is dropped by `JSON.stringify`; a file is produced **without `filteringModes`**. Restoring that file resets every per-site mode to the default (§7.3 step 13) | `backup-restore.js:75`; `settings.js:140` |

New UI: any failed message → no file, surfaced error. A missing sandbox text
(`undefined` from a healthy background) is not a failure; the bridge must
tell the two apart (ARCHITECTURE §6.5).

---

## 7. Restore

Trigger: click on the Restore button (`settings.js:234-236`) →
`restoreSettings()` (`settings.js:148-183`). **No confirmation dialog.**

### 7.1 File selection

Synchronously inside the click (`settings.js:149-180`; the promise executor
runs synchronously):

1. Take the first hidden file input of the pane (`accept="application/json"`,
   `dashboard.html:109`; `settings.js:150`).
2. Install `onchange` and `oncancel` handlers.
3. Set `input.value = ''` so that picking the same file again still fires
   `change` (`settings.js:175-178`). Restoring the same file twice in a row
   works [H].
4. `input.click()` (`settings.js:179`) — must stay in the gesture.

Cancel (`settings.js:172-174`): resolve; **no busy state was entered**, nothing
is sent [H].

### 7.2 Reading and validation

On `change` (`settings.js:151-171`):

1. **Enter busy state** (§9) (`:152`), remove the `change` handler (`:153`).
2. `file = files[0]`; if missing or `file.name === ''` → finish, nothing sent
   (`:154-155`).
3. `FileReader.readAsText(file)` (`:156`, `:170`); no size limit, no
   `onerror` handler.
4. On load: result not a string → finish (`:159`).
5. `JSON.parse` inside `try/catch`; a parse error is swallowed (`:160-164`).
6. **The only validation: `data instanceof Object`** (`:165`). Otherwise
   finish, nothing sent.
7. Call `restoreFromObject(data)` and wait for it (`:166-168`).
8. Leave busy state (`:181-182`).

Observed outcomes by file content [H]:

| File text | Result |
|---|---|
| not JSON, empty file, `42`, `"abc"`, `null` | nothing sent; busy entered and left; no feedback |
| `{}` | full reset to defaults (the traffic of §8) |
| `[]` (any array) | full reset to defaults (same traffic) |
| object with fields | §7.3 |

Notes:

- `version` in the file is never read (`backup-restore.js:92-215`).
- **HAZARD**: any JSON object or array passes, including `{}` and `[]`. Such a
  file is treated as "no customisation" and therefore **resets everything to
  defaults** (same as §8) without any confirmation [H].
  **DEVIATION:** the React page
  treats an object or array with none of the §6.2 keys (except `version`) or
  the legacy `cosmeticFilters` as an invalid file: it sends nothing and shows
  `settingsRestoreInvalidFile`. `{}`, `[]` and a `package.json` no longer
  reset; real backups always contain `filteringModes`. Reset stays available
  through "Reset to default settings…" (§8), which asks first.
- Upstream gives no feedback for an invalid file and none for success; there
  are no i18n keys for either (§10).
- **HAZARD**: busy state is left only if the promise resolves. A read error
  (no `onerror`) or a rejected `restoreFromObject` (malformed field types, a
  failed `getDefaultConfig`, or a background handler that never answers)
  leaves the page stuck in busy until reload, with a partial restore applied
  [H]. New UI must always leave busy and surface the failure.

### 7.3 `restoreFromObject(target)` — exact sequence

`backup-restore.js:92-215`. Every message is **awaited before the next one is
sent**. `default` = response of step 1. `??` means "use the default when the
field is `undefined` or `null`". The whole sequence was observed [H]; the test
vector is in §13.

| # | Call | Payload (exact) | Source |
|---|---|---|---|
| 1 | message | `{ what: 'getDefaultConfig' }` | `:93` |
| 2 | message | `{ what: 'setAutoReload', state: target.autoReload ?? default.autoReload }` | `:95-98` |
| 3 | message | `{ what: 'setShowBlockedCount', state: target.showBlockedCount ?? default.showBlockedCount }` | `:100-103` |
| 4 | message | `{ what: 'setDeveloperMode', state: target.developerMode ?? default.developerMode }` | `:105-108` |
| 5 | message | `{ what: 'setStrictBlockMode', state: target.strictBlockMode ?? default.strictBlockMode }` | `:110-113` |
| 6 | message | `{ what: 'setPopupBlockMode', state: target.popupBlockMode ?? default.popupBlockMode }` | `:115-118` |
| 7 | compute | `enabled` := `default.rulesets`; for each entry of `target.rulesets \|\| []`, in file order: `"+id"` → append `id` if absent; `"-id"` → remove `id` if present; other prefixes ignored. `id` = `entry.slice(1)`, so `"+"` appends `''`. A non-iterable `rulesets` (e.g. `5`) or a non-string entry throws here; a string `rulesets` is iterated character by character | `:120-131` |
| 8 | page storage | read `storage.local` key `rulesets.imported` (array, default `[]`) → `importedIds` | `:132-133`; `imported-lists.js:78-81` |
| 9 | compute | `toAdd` := entries of `enabled` matching `/^[a-z-]+:\/\//` and not in `importedIds`; `toRemove` := `importedIds` not in `enabled` | `:134-140` |
| 10 | page storage + alarms | if `toRemove` non-empty: `removeImportedLists(toRemove)` | `:141-143`; `imported-lists.js:225-232` |
| 11 | page storage + alarms | if `toAdd` non-empty: `addImportedLists(toAdd)` | `:144-146`; `imported-lists.js:185-221` |
| 12 | message | `{ what: 'applyRulesets', enabledRulesets: Array.from(enabled) }` (no `toRemove` key) | `:147-150` |
| 13 | message | `{ what: 'setFilteringModeDetails', modes: target.filteringModes ?? default.filteringModes }` | `:152-155` |
| 14 | message | `{ what: 'removeAllCustomFilters', hostname: '*' }` | `:157` |
| 15 | message, conditional | legacy: if `target.cosmeticFilters` is an array of `"hostname##selector"` lines, split each at the first `##`, group selectors by hostname (skip lines without `##`, with empty hostname or empty selector); if any: `{ what: 'addManyCustomFilters', entries: [ [hostname, selectors[]], ... ] }` | `:158-179` |
| 16 | compute | for each `[hn, selectors]` of `target.customFilters ?? []`: selectors starting with `+js` become sandbox lines `` `${hn}##${selector}` ``; the others stay; hostnames left with no selector are dropped | `:180-194` |
| 17 | message, conditional | if step 16 kept anything: `{ what: 'addManyCustomFilters', entries: [ [hn, selectors[]], ... ] }` | `:195-199` |
| 18 | compute | if `target.sandboxFilters` is truthy: append `''` and `target.sandboxFilters.join('\n')` to the sandbox lines. The empty line is appended even when step 16 produced no line, so the text then **starts with `'\n'`** (`["a##.b"]` → `'\na##.b'`; `[]` is truthy → `'\n'`). Send it exactly like that; the background trims it (`filter-manager.js:317-322`) | `:200-202` |
| 19 | message | `{ what: 'setSandboxFilters', text: sandboxLines.join('\n') }` — **always sent**, `text: ''` when there are none | `:203-205` |
| 20 | page storage | `dnr` := `target.dnrRules ?? []`; non-empty → `storage.local.set({ userDnrRules: dnr.join('\n') })`, else `storage.local.remove('userDnrRules')` | `:207-212` |
| 21 | message | `{ what: 'updateUserDnrRules' }` | `:213` |

**DEVIATION from step 12 wire parity (messaging.md §6.3 "never send an id that is not in the current
getRulesetDetails response"):** the React page leaves out of `enabled` every id
that is not in its `rulesetDetails`, not a default id and not an imported-list
URL, and names the skipped ids in a warning after the restore. Reason: when such
an id is the only newly enabled one, upstream `enableRulesets` returns no
`enabledRulesets` (`ruleset-manager.js:642-658`), `applyRulesets` stores
`rulesetConfig.enabledRulesets = undefined` (`background.js:239-245`), and the
next background start disables every ruleset (`background.js:729-736`).
Reproduced against the real PRISTINE background (restoring
`{"rulesets":["+fra-0","+removed-in-this-build"]}` twice). Messages and their
order are unchanged; only that payload differs, and only for such a file.

Values are passed through without type coercion: `state` and `modes` are
whatever the file holds when the field is present.
(bridge contract check) The React bridge does NOT pass such values: it
rejects a non-boolean `state` and a `modes` that is not a plain object with
`BridgeError` kind `bad-request` before sending (messaging.md §7.2 notes,
§21.1 item 5). This is the accepted, reported deviation for those fields: the
restore stops at that step and must be reported as only partly applied.

Steps 10 and 11 run **in the page**, not in the background. Page-side calls,
in the order observed [H] (`imported-lists.js:113-126`, `42-67`;
`alarms.js:31-63`):

1. `storage.local.get('rulesets.imported')` (a second read, inside the helper).
2. Key listing: `storage.local.getKeys()` when it exists, else
   `storage.local.get(null)` (`ext.js:79-87`).
3. `storage.local.remove([ 'rulesets.imported.compiled.<id>', ... ])` for
   every compiled list whose list is not enabled (only when there are any).
4. `storage.local.set({ 'rulesets.imported': lists })`. A list added by step
   11 has the shape of `imported-lists.js:194-215` with `enabled: false`.
5. Update job: with at least one enabled list →
   `registerJob('updateImportedLists', time)`; otherwise
   `removeJob('updateImportedLists')` (`imported-lists.js:55-67`). Both first
   read `storage.local` key `deferredJobs`. `registerJob` then always calls
   `browser.alarms.create('deferredJobs', { when })` and writes `deferredJobs`
   (`alarms.js:41-52`). `removeJob` does nothing more when that job was not
   registered; otherwise it calls `alarms.create('deferredJobs', { when })`
   (or `browser.alarms.clear('deferredJobs')` when no job is left) and writes
   or removes `deferredJobs` (`alarms.js:54-63`). `when` =
   `Math.max(jobs[0].time, Date.now() + 5 * 60 * 1000)` (`alarms.js:31-39`).

Sub-steps 3, 4 and the start of 5 are issued together inside one
`Promise.all` (`imported-lists.js:121-125`). The call order is the one listed
above, but none of them waits for another.

**HAZARD**: `removeJob` calls `.filter` on the stored `deferredJobs` without a
default (`alarms.js:55-56`). `removeJob` is the path taken whenever **no
list in the saved `rulesets.imported` has `enabled: true`**
(`imported-lists.js:57-66`). Lists added by step 11 are always
`enabled: false` (`imported-lists.js:198`), so step 11 alone always takes this
path. If `deferredJobs` is absent at that moment, step 10 or 11 throws
**after** `storage.local.set({ 'rulesets.imported': … })` was issued. The
restore then stops between step 6 and step 12, nothing from step 12 on is
sent, and the page stays busy [H; reproduced in the Node run, §0].
(`registerJob` defaults to `[]`, `alarms.js:42`, so it does not throw.) The key is normally present
because the background registers a `pruneCSSCache` job after every
content-script registration (`scripting-manager.js:362-365`, `380`); it is
absent before the first registration and for a moment each time the job runs
(`alarms.js:76-82`).

Responses (all ignored by restore except step 1): steps 2, 3, 5, 6, 12, 14,
15, 17, 19 → `undefined`; step 4 → boolean; step 13 → normalised modes object
(`background.js:545-551`); step 21 → `{ added, removed, errors }`
(`ruleset-manager.js:777,821`).

Failure of step 1 (`getDefaultConfig` resolves `undefined`): each of steps
2-6 throws only when its field is **missing** from the file, because
`a ?? b.x` does not evaluate `b.x` when `a` is present
(`backup-restore.js:95-118`). Toggles present in the file are therefore still
sent, up to the first missing one (observed for a file holding only
`autoReload`: `setAutoReload` is sent, then the sequence throws [H]); a file
with all five toggles sends steps 2-6 and throws at step 7
(`backup-restore.js:120`) [H]. Either way the page stays busy.

**Malformed field types (HAZARD, partial restore).** Only `data instanceof
Object` is checked (§7.2). A field of the wrong type makes the sequence throw
part-way, after some writes have already been made. Reproduced with the
upstream module (§0). Each row is for a file in which that field is the only
one present. With other fields present, the messages they cause before the
throw point are sent as usual (for example step 17 before a step-18 throw).

| File field | Throws at | Last message sent | Already applied |
|---|---|---|---|
| `rulesets` not iterable (`5`) or with a non-string entry (`[1]`) | step 7 | `setPopupBlockMode` | the five toggles |
| `cosmeticFilters` array with a non-string line (`[1]`) | step 15 | `removeAllCustomFilters` | toggles, rulesets, modes, **all custom filters deleted** |
| `customFilters` not iterable (`5`, `{}`), an entry whose selectors are not iterable (`[["a",5]]`), or a non-string selector (`[["a",[1]]]`) | step 16 | `removeAllCustomFilters` | same as above (custom filters deleted, not re-added) |
| `sandboxFilters` truthy but not an array (`"x"`) | step 18 | `removeAllCustomFilters` | same as above; sandbox filters untouched |
| `dnrRules` not an array and not nullish (`"x"`, `5`, `{}`) | step 20 | `setSandboxFilters` | everything except DNR rules |

Fields that do **not** throw although mistyped (upstream): toggles (passed raw, §4.4);
`filteringModes` of any non-nullish value. (With the React bridge both are
rejected before sending; see the note under the §7.3 table.) A string or `{}` gives
empty buckets in the background (`mode-manager.js:96-103`), so the default
mode becomes basic (`mode-manager.js:130`) and every per-site mode is
dropped. A string `rulesets` is iterated character by character.

Required in the new UI: the same message prefix as upstream for such a file
(do not pre-validate and send nothing: that changes traffic). Then always
leave busy and surface a failure that says the restore was only partly
applied. Pre-validating is allowed only as a deviation that the implementer
reports.

Background effects worth knowing:

- Step 13 writes the modes without any permission check
  (`mode-manager.js:337-342`) and broadcasts only `{ defaultFilteringMode }`
  (`background.js:548-549`). Legacy bucket names `network`,
  `extendedSpecific`, `extendedGeneric` are accepted
  (`mode-manager.js:96-103`).
- Step 12 always broadcasts `{ enabledRulesets }` (`background.js:259`).
- **SAFARI**: `updateCompiledFilters()` and `registerUserScripts()` return
  immediately (`compiled-filters.js:270-272`, `281-282`), so step 19 stores
  the trimmed text (or removes the key, `filter-manager.js:317-322`), compiles
  nothing, and rebuilds the user DNR rules (`background.js:624-629`). Steps 10
  and 11 are normally skipped because imported lists cannot be added through
  the UI on Safari (`settings.css:267-270`), but a backup made in another
  browser with `"+https://…"` ruleset entries does reach step 11.
- **SAFARI**: a file from another browser with `strictBlockMode: true` sets
  that flag (step 5) although the row is hidden and no strict-block rule is
  ever installed (`ruleset-manager.js:267-272`); a later backup then contains
  `"strictBlockMode": true`.

### 7.4 After restore

**No page reload and no tab reload** [H]. The pane reflects the restored
values only through the broadcasts of §5 (`autoReload`, `showBlockedCount`,
`developerMode`, `strictBlockMode`, `popupBlockMode`, `defaultFilteringMode`,
`enabledRulesets`). `hasOmnipotence` is not re-broadcast by this sequence.
Without those broadcasts the pane keeps showing the values from before the
restore or reset [H].

**HAZARD (from source, not observed): the Filter-lists pane's pending commit
is not cancelled.** That pane debounces its own `applyRulesets` by 997 ms
(`filter-lists.js:473-485`). It also commits on `beforeunload`
(`filter-lists.js:466-471`). The commit is built from the pane's checkboxes
(`filter-lists.js:426-458`). Neither busy state nor restore/reset cancels it.
Suppose the user toggles a list and starts restore or reset within that
window. If the commit fires after step 12, it can re-send the pre-restore
selection. The React page must make the outcome deterministic. Before
restore/reset step 1, it either flushes a pending Filter-lists commit (so
that the restore's `applyRulesets` lands last) or cancels it. This is a
cross-pane rule shared with `filter-lists.md` (commit timer, §9). It replaces
an upstream race, so the implementer reports the choice as a deviation.

### 7.5 Implementation constraints (backup, restore, reset)

- **Do not import upstream `js/backup-restore.js` or `js/settings.js`** from
  the React page, even though they exist at run time in the staged extension.
  `backup-restore.js` sends through upstream `sendMessage`, which turns every
  failure into `undefined` (`ext.js:51-55`; ARCHITECTURE §6.5 forbids this),
  and it reaches storage and alarms through `ext.js` and `imported-lists.js`
  rather than `src/lib/ext.ts` (ARCHITECTURE §6.4). `settings.js` binds DOM
  handlers and sends `getOptionsPageData` as soon as it loads
  (`settings.js:128-132`, `196-240`, `329-353`). Re-implement the sequences of
  §6.1 and §7.3 with the pure functions of §13 plus `bridge.ts` / `ext.ts`.
  (An earlier research note, which suggested calling
  `backupToObject` / `restoreFromObject` unchanged, conflicts with
  ARCHITECTURE and is superseded here.)
- The page itself needs these browser APIs, through `ext.ts`, for restore and
  reset: `storage.local.get` (`rulesets.imported`, `deferredJobs`,
  `userDnrRules` for backup), `storage.local.getKeys` with a fallback to
  `storage.local.get(null)`, `storage.local.set`, `storage.local.remove`,
  `alarms.create`, `alarms.clear` (§7.3 steps 8-11 and 20; `ext.js:59-87`;
  `alarms.js:31-63`).

---

## 8. Reset to default settings

Trigger: click on the Reset button (`settings.js:238-240`) → `resetSettings()`
(`settings.js:185-192`):

1. Blocking confirmation `self.confirm(text)` with text =
   `browser.i18n.getMessage('resetToDefaultConfirm')` (`settings.js:186`;
   `i18n` here is `browser.i18n`, `settings.js:22`, `ext.js:27`) — plain text
   [H].
2. Anything other than an explicit OK (`response !== true`) → stop. Nothing is
   sent, no busy state (`settings.js:187`) [H].
3. Enter busy state (`settings.js:188`).
4. `restoreFromObject({})` (`settings.js:189-190`) — the sequence of §7.3 with
   an empty target.
5. Leave busy state (`settings.js:191`). **No reload of the page or of any
   tab.** The pane updates through §5 only. Same stuck-busy HAZARD as §7.2.

Exact traffic for reset on Safari with no imported lists [H]:

```js
{ what: 'getDefaultConfig' }
{ what: 'setAutoReload', state: true }
{ what: 'setShowBlockedCount', state: true }
{ what: 'setDeveloperMode', state: false }
{ what: 'setStrictBlockMode', state: false }          // true on non-Safari
{ what: 'setPopupBlockMode', state: true }
// page: storage.local.get('rulesets.imported')
{ what: 'applyRulesets', enabledRulesets: [ /* default.rulesets */ ] }
{ what: 'setFilteringModeDetails', modes: { none: [], basic: [], optimal: [ 'all-urls' ], complete: [] } }
{ what: 'removeAllCustomFilters', hostname: '*' }
{ what: 'setSandboxFilters', text: '' }
// page: storage.local.remove('userDnrRules')
{ what: 'updateUserDnrRules' }
```

If imported lists exist, `removeImportedLists(<all imported ids>)` runs in the
page between the storage read and `applyRulesets` (§7.3 step 10), with the
page-side calls listed there [H].

**HAZARD**: reset sets the default mode to optimal (2) without requesting or
checking the `<all_urls>` permission (`mode-manager.js:58-63`, `337-342`). The
background lowers it to basic only at its next permission sync
(`mode-manager.js:400-402`; `background.js:749`, `871-881`).

**UNKNOWN (SAFARI)**: behaviour of `window.confirm` in the extension's options
page.

---

## 9. Busy state

- Entered by: restore after a file is chosen (`settings.js:152`), reset after
  confirmation (`settings.js:188`). Not by backup, mode change or toggles [H].
- Effect: body class `busy` hides every pane section and shows the dedicated
  busy section (spinner) instead (`dashboard.html:201-205`;
  `dashboard.css:64-71`; `settings.css:421-431`) [H]. The header and tab
  buttons are not hidden or disabled by upstream.
- Every message and page-side storage call of §7.3 happens while busy [H].
- Left by: `settings.js:182`, `191` — only on normal completion (HAZARD in
  §7.2).
- Broadcasts received while busy still update the store (§5) [H].

---

## 10. i18n keys

All from `messages.json`; identical line numbers in
`PRISTINE/_locales/en/messages.json`. 71 locales ship in PRISTINE and every
key below exists in all of them. The line number is that of the key; the
message text is on the next line.

| Key | English text | Used at | `messages.json` |
|---|---|---|---|
| `settingsPageName` | Settings | tab label, `dashboard.html:28` | `:18` |
| `defaultFilteringModeSectionLabel` | Default filtering mode | `dashboard.html:45` | `:222` |
| `defaultFilteringModeDescription` | The default filtering mode will be overridden by per-website filtering modes. You can adjust the filtering mode on any given website according to whichever mode works best on that website. Each mode has its advantages and disadvantages. | `dashboard.html:46` | `:226` |
| `filteringMode1Name` | basic | `dashboard.html:50` | `:234` |
| `filteringMode2Name` | optimal | `dashboard.html:65` | `:238` |
| `filteringMode3Name` | complete | `dashboard.html:80` | `:242` |
| `basicFilteringModeDescription` | Basic network filtering from selected filter lists.⏎⏎Does not require permission to read and modify data on websites. | `dashboard.html:61` | `:246` |
| `optimalFilteringModeDescription` | Advanced network filtering plus specific extended filtering from selected filter lists.⏎⏎Requires broad permission to read and modify data on all websites. | `dashboard.html:76` | `:250` |
| `completeFilteringModeDescription` | Advanced network filtering plus specific and generic extended filtering from selected filter lists.⏎⏎Requires broad permission to read and modify data on all websites.⏎⏎Generic extended filtering may cause higher web page resources usage. | `dashboard.html:91` | `:254` |
| `behaviorSectionLabel` | Behavior | `dashboard.html:96` | `:266` |
| `autoReloadLabel` | Automatically reload page when changing filtering mode | `dashboard.html:97` | `:270` |
| `showBlockedCountLabel` | Show the number of blocked requests on the toolbar icon | `dashboard.html:99` | `:274` |
| `enableStrictBlockLabel` | Enable strict blocking | `dashboard.html:100` (not Safari) | `:278` |
| `enableStrictBlockLegend` | Navigation to potentially undesirable sites will be blocked, and you will be offered the option to proceed. | `dashboard.html:100` (not Safari) | `:282` |
| `enablePopupBlockLabel` | Enable pop-up blocking | `dashboard.html:101` | `:286` |
| `enablePopupBlockLegend` | When active, matching filters will automatically close unwanted browser tabs created by websites. | `dashboard.html:101` | `:290` |
| `developerModeLabel` | Developer mode | `dashboard.html:102` | `:302` |
| `developerModeLegend` | Enables access to features suitable for technical users. | `dashboard.html:102` | `:306` |
| `settingsBackupRestoreLabel` | Backup | `dashboard.html:105` | `:310` |
| `settingsBackupRestoreSummary` | Back up your custom settings to a file, or restore your custom settings from a file. | `dashboard.html:106` | `:314` |
| `backupButton` | Back up… | `dashboard.html:108` | `:422` |
| `restoreButton` | Restore… | `dashboard.html:109` | `:426` |
| `resetToDefaultButton` | Reset to default settings… | `dashboard.html:110` | `:430` |
| `resetToDefaultConfirm` | All your custom settings will be removed. Do you really want to reset to default settings? | `settings.js:186` | `:434` |

(⏎ = a literal newline character in the message.)

Rendering rules that carry meaning:

- **Newlines.** The three mode descriptions contain `\n\n` paragraph breaks
  (71 of 71 locales for optimal and complete; 70 of 71 for basic — `el` has
  none). Upstream renders them with `white-space: pre-line`
  (`settings.css:91-95`) [H]. They must stay visible as breaks.
- **Capitalisation.** Mode names are lower-case in the catalogue and upstream
  capitalises them in CSS (`settings.css:74-76`) [H]; they are not separate
  strings.
- **Legends.** A legend is the description of the toggle that precedes it
  (`dashboard.html:100-102`; `settings.css:26-30`). `autoReload` and
  `showBlockedCount` have none.
- **Embedded HTML: none today.** Upstream passes every `data-i18n` string
  through a sanitiser that keeps only inline tags `a, b, code, em, i, span, u`,
  strips `style` attributes, drops other elements and decodes the entities
  `&shy; &ldquo; &rdquo; &lsquo; &rsquo; &lt; &gt;`
  (`src/js/i18n.js:54-103`, `105-152`, `189-199`). A scan of all 71 PRISTINE
  locales found **no** `<`, `&`, `{{` or `$` in any key of the table above, so
  every one of these strings, the three legends included, is plain text in
  every locale; the rendered legends contain no markup [H]. Use the safe
  renderer (`<T>`) for descriptions and legends anyway so a future translation
  with inline tags renders as upstream would. `resetToDefaultConfirm` goes
  through `browser.i18n.getMessage` directly and is always plain text.
- **No placeholders.** None of these keys has `{{…}}` placeholders or a
  `placeholders` object.
- **Direction.** Upstream sets `dir="rtl"` on body when `@@ui_locale` is one of
  `ar, he, fa, ps, ur` (`src/js/i18n.js:38-44`) [H]; `ar`, `fa`, `he`, `ur`
  ship in PRISTINE.

Not used by this pane although it looks related: `filteringMode0Name`
(`messages.json:230`) — in the dashboard it is referenced only by dead CSS
(`settings.css:41,100`).

Strings upstream does not have: any success or error text for backup, restore,
reset, mode change or toggles. If the new UI shows such feedback (ARCHITECTURE
§6.5, §6.10) it needs `tNew(...)` strings, documented as a deviation.

Longest translations (characters, for layout stress):
`defaultFilteringModeDescription` 323 (el),
`completeFilteringModeDescription` 349 (so), `enablePopupBlockLegend` 147
(fr), `resetToDefaultConfirm` 143 (ml), `showBlockedCountLabel` 84 (el),
`autoReloadLabel` 74 (bg), `resetToDefaultButton` 48 (ml),
`settingsBackupRestoreLabel` 40 (pl), `backupButton` 32 (el).

---

## 11. Upstream hazards (summary)

| # | Hazard | Source |
|---|---|---|
| H1 | Failed or empty `getOptionsPageData` leaves the page hidden forever. | `settings.js:332`; `settings.css:14-16` |
| H2 | `permissions.request` rejection is not caught; selection is not reverted. | `settings.js:109-111` |
| H3 | A failed `setDefaultFilteringMode` stores `undefined` (and `hasOmnipotence = true` for levels 2/3) and breaks rendering. | `settings.js:104,117-118,84-85` |
| H4 | Toggle handlers never update the store; correctness of the store (and so of backup) depends on the broadcast echo. A broadcast about another field re-applies the stale stored value to a just-toggled checkbox. | `settings.js:196-228`, `249-303`, `317-319` |
| H5 | Restore accepts any JSON object/array; `{}` or `[]` silently resets everything. No confirmation on restore. | `settings.js:165-168` |
| H6 | Busy state is never left when restore/reset rejects or the file read fails. | `settings.js:156-171`, `181-182`, `188-191` |
| H7 | After restore/reset the pane is refreshed only by broadcasts; nothing re-reads `getOptionsPageData`. If broadcasts do not arrive (UNKNOWN on Safari, §5.1) the pane shows stale values until reload. | `settings.js:148-192` |
| H8 | Reset/restore can select optimal/complete as default without the `<all_urls>` permission. | `mode-manager.js:337-342` |
| H9 | Restore runs imported-list storage writes and `browser.alarms` calls in the page. When no enabled imported list remains after the save (always the case for a pure add), `removeJob` runs. It throws if `deferredJobs` is absent, which rejects the restore after `rulesets.imported` was written and before `applyRulesets`. | `backup-restore.js:141-146`; `imported-lists.js:55-67`; `alarms.js:54-57` |
| H10 | Backup file name and nothing else identifies the product: `my-ubol-settings.json` (not renamed for "Blocker"). | `settings.js:143` |
| H11 | `firstRun` is always `false`; the related code is dead. | `background.js:422,435`; `settings.js:42-44` |
| H12 | A toggle whose message fails keeps showing the new state; nothing reverts it. | `settings.js:196-228`; `ext.js:51-55` |
| H13 | Backup still produces a file when `getFilteringModeDetails` or `getSandboxFilters` fails; the file then lacks `filteringModes` / `sandboxFilters` with no warning. | `backup-restore.js:45,75,80-82` |
| H14 | When `getDefaultConfig` fails during restore, toggles present in the file are still applied before the sequence throws. | `backup-restore.js:93-118` |
| H15 | No guard against a second mode change while one is pending. | `settings.js:93-126` |
| H16 | A file with a mistyped field (e.g. a non-string `cosmeticFilters` line, a non-iterable `customFilters`) throws after `removeAllCustomFilters`: every custom filter is deleted and not re-added, and the page stays busy (§7.3 malformed-field table). | `backup-restore.js:157-212` |
| H17 | A pending Filter-lists commit (997 ms debounce) is not cancelled by restore/reset and can land after the restore's `applyRulesets` (§7.4). | `filter-lists.js:466-485` |
| H18 | After a failed `setDefaultFilteringMode`, every later widget re-render throws before reaching the toggles until a broadcast restores a defined `defaultFilteringMode` (§3.4). | `settings.js:46`, `82-89` |

Decisions that deviate from upstream on H4 or H7 (for example, updating the
store optimistically on the user's own toggle, or re-reading
`getOptionsPageData` after restore/reset) change no write message, but they
are deviations: document them as deviations.

## 12. UNKNOWN (needs a Safari runtime check)

| # | Question | Why it matters |
|---|---|---|
| U1 | Does `BroadcastChannel('uBOL')` deliver from the Safari background page to a dashboard tab? | All of §5, H4, H7. |
| U2 | `browser.permissions.request({ origins: ['<all_urls>'] })` on Safari: prompt shown? result when dismissed (false, reject, never settles)? `true` without prompt when already granted? Is a keyboard-initiated change accepted as a gesture? | §3.2–3.4. |
| U3 | Does Safari fire `permissions.onAdded` after that grant, and which of the two concurrent mode writes lands last? | §3.5 (background only). |
| U4 | Does the detached `data:` anchor click save `my-ubol-settings.json` from a `safari-web-extension:` page, after awaits? | §6.3. |
| U5 | Does `window.confirm` work in the Safari options page? | §8. |
| U6 | Does `browser.storage.managed` exist on Safari? | `disabledFeatures`, all admin behaviour. |
| U7 | Value of `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` on Safari. | Fixture realism only. |
| U8 | Does native `declarativeNetRequest.setExtensionActionOptions` exist/succeed on Safari? | §4.2; a throw also blocks restore step 3. |
| U9 | What does `runtime.sendMessage` do when the background handler rejects (the response callback is never called, `background.js:857-861`)? | Hang detection in the bridge; H6. |
| U10 | Runtime value of `supportsUserScripts()` on Safari (expected `false`). | `body[data-supports]`. |
| U11 | Does Safari fire the `cancel` event on a file input? | §7.1; harmless if not (no busy state before `change`). |
| U12 | Does a programmatic `click()` on a `display: none` file input open the picker in a Safari extension page? Does `accept="application/json"` let the user pick a `.json` file, including one saved by §6.3 as `data:text/plain`? | §7.1 (upstream relies on it, `dashboard-common.css:49-51`; `dashboard.html:109`). |
| U13 | What does `permissions.getAll().origins` contain on Safari when all websites are allowed? | `hasOmnipotence` (§2.2); on Safari it only feeds the hidden strict-block row. |
| U14 | Does `storage.local.getKeys` exist on Safari? | Only which key-listing call restore makes (§7.3). |

---

## 13. Pure functions and test vectors

Candidates for `src/lib/model/` (no DOM, no browser API). Names are
suggestions; behaviour and vectors are binding. The store values, control
states, files and message traffic in the vectors below are what the upstream
code produced [H]; the `widgets` / `lists` flags of `mergeBroadcast` are read
from `settings.js:253-322`.

| # | Function | Input → output | Upstream |
|---|---|---|---|
| 1 | `selectedLevel` | `defaultFilteringMode` → `1`, `2`, `3`, or none for `0` | `settings.js:82-89` |
| 2 | `toggleStates` | store, platform, → the table of §4 (shown / enabled / checked per control) | `settings.js:48-77`; `settings.css:48-50,104-106` |
| 3 | `adminFlags` | `disabledFeatures` (array or absent) → `{ hidePane, hideModeBlock, hideDeveloperRow }` | `settings.js:29-36`; `settings.css:32-50` |
| 4 | `supportsTokens` | response → `'user-scripts'` / `'compiled-filters'` tokens | `settings.js:334-341` |
| 5 | `mergeBroadcast` | store, message → new store + `{ widgets, lists }` flags, rules of §5.2 | `settings.js:249-323` |
| 6 | `hashFromIterable` | iterable or falsy → `Array.from(x).sort().join('\n')`, `''` for falsy | `dashboard.js:83-86` |
| 7 | `buildBackup` | version, store, default config, sandbox text, modes, custom filters, DNR text → object of §6.2 | `backup-restore.js:36-88` |
| 8 | `serializeBackup` | object → `JSON.stringify(o, null, 2) + '\n'` | `settings.js:140` |
| 9 | `parseRestoreFile` | text → object/array, or "invalid" | `settings.js:159-165` |
| 10 | `resolveRulesets` | default ids, `target.rulesets` → enabled ids | `backup-restore.js:120-131` |
| 11 | `importedDelta` | enabled ids, imported ids → `{ toAdd, toRemove }` | `backup-restore.js:134-140` |
| 12 | `legacyCosmeticEntries` | `target.cosmeticFilters` → entries or none | `backup-restore.js:158-179` |
| 13 | `splitCustomFilters` | `target.customFilters` → `{ entries, sandboxLines }` | `backup-restore.js:180-194` |
| 14 | `sandboxText` | sandbox lines, `target.sandboxFilters` → text | `backup-restore.js:200-204` |
| 15 | `planRestore` | target, default config, imported ids → the ordered steps of §7.3 | `backup-restore.js:92-215` |

Vectors:

- **`selectedLevel`**: 0 → none; 1 → 1; 2 → 2; 3 → 3.
- **`toggleStates`**, Safari, fixture of §2.2: auto reload shown/enabled/on;
  blocked count shown/enabled/on; strict hidden; pop-up shown/enabled/on;
  developer shown/enabled/off. With `canShowBlockedCount: false`: blocked
  count off and disabled. Non-Safari with `hasOmnipotence: false,
  strictBlockMode: true`: strict shown, disabled, off; after
  `hasOmnipotence: true`: enabled, on. With `developerMode: true` and
  `disabledFeatures: ['develop']`: developer row hidden, effective state off,
  store value still `true`.
- **`adminFlags`**: absent → nothing hidden; `[]` → nothing hidden (no
  attribute); `['filteringMode']` → mode block hidden; `['develop']` →
  developer row hidden; `['dashboard']` → pane hidden, About forced.
- **`mergeBroadcast`**, starting from the §2.2 fixture, applied in sequence:
  `'hello'` → no change; `null` → no change; `{ autoReload: false }` →
  `autoReload` false, widgets; `{ showBlockedCount: false, popupBlockMode:
  false, developerMode: true }` → all three applied, widgets once;
  `{ defaultFilteringMode: 3, hasOmnipotence: false, filteringModeDetails:
  {…} }` → mode 3, omnipotence false, details ignored;
  `{ defaultFilteringMode: 0 }` → mode 0, no option selected;
  `{ enabledRulesets: ['easylist'] }` → replaced, lists;
  `{ adminRulesets: ['+easylist'] }` → replaced, lists;
  `{ filteringModeDetails: {…}, foo: 1 }` → no change;
  `{ disabledFeatures: ['develop'] }` → no change. A message whose value
  equals the stored one sets no flag, except `enabledRulesets`, which always
  sets `lists`.
- **`buildBackup` + `serializeBackup`**: the two files of §6.2, byte for byte.
- **`parseRestoreFile`**: `'this is not json'`, `''`, `'42'`, `'"abc"'`,
  `'null'` → invalid; `'{}'` → `{}`; `'[]'` → `[]`.
- **`planRestore`** on Safari, defaults
  `rulesets: ['ublock-filters','easylist','easyprivacy']`, no imported lists,
  for this file:

  ```json
  {
    "version": "2026.1003.1243",
    "autoReload": false,
    "developerMode": true,
    "popupBlockMode": false,
    "showBlockedCount": false,
    "strictBlockMode": true,
    "rulesets": ["+annoyances-cookies", "-easyprivacy", "+easylist", "-not-there", "xbad"],
    "filteringModes": { "none": ["example.com"], "basic": [], "optimal": [], "complete": ["all-urls"] },
    "customFilters": [
      ["example.org", [".ad-banner", "+js(set, a, 1)"]],
      ["only-js.example", ["+js(nowoif)"]]
    ],
    "cosmeticFilters": ["legacy.example##.x", "legacy.example##.y", "nohash", "##.nohost", "nosel.example##"],
    "sandboxFilters": ["example.net##+js(set, foo, 1)", "example.net##.z"],
    "dnrRules": ["action:", "  type: block"]
  }
  ```

  the traffic is exactly, in this order:

  ```js
  { what: 'getDefaultConfig' }
  { what: 'setAutoReload', state: false }
  { what: 'setShowBlockedCount', state: false }
  { what: 'setDeveloperMode', state: true }
  { what: 'setStrictBlockMode', state: true }
  { what: 'setPopupBlockMode', state: false }
  // page: storage.local.get('rulesets.imported')
  { what: 'applyRulesets', enabledRulesets: [ 'ublock-filters', 'easylist', 'annoyances-cookies' ] }
  { what: 'setFilteringModeDetails', modes: { none: [ 'example.com' ], basic: [], optimal: [], complete: [ 'all-urls' ] } }
  { what: 'removeAllCustomFilters', hostname: '*' }
  { what: 'addManyCustomFilters', entries: [ [ 'legacy.example', [ '.x', '.y' ] ] ] }
  { what: 'addManyCustomFilters', entries: [ [ 'example.org', [ '.ad-banner' ] ] ] }
  { what: 'setSandboxFilters', text: 'example.org##+js(set, a, 1)\nonly-js.example##+js(nowoif)\n\nexample.net##+js(set, foo, 1)\nexample.net##.z' }
  // page: storage.local.set({ userDnrRules: 'action:\n  type: block' })
  { what: 'updateUserDnrRules' }
  ```

- **`planRestore`** for `{}` and for `[]`: the traffic of §8.
- **`planRestore`** for `{ "rulesets": ["+https://example.com/list.txt"] }`
  with no imported lists and `deferredJobs` present in `storage.local`
  (e.g. `[{ name: 'pruneCSSCache', time: … }]`): steps 1-6 with defaults, then
  page-side `get('rulesets.imported')`, `get('rulesets.imported')`,
  `getKeys()`, `set({ 'rulesets.imported': [ { id: 'https://example.com/list.txt', name: 'https://example.com/list.txt', group: 'imported', enabled: false, homeURL: '', expires: 7, time: { added: <Date.now()>, updated: 0 }, filters: { total: 0, accepted: 0, rejected: 0 }, rules: { total: 0, plain: 0, regex: 0 } } ] })`,
  `get('deferredJobs')` (no alarm call, no `deferredJobs` write: the job
  was not registered), then
  `{ what: 'applyRulesets', enabledRulesets: [ 'ublock-filters', 'easylist', 'easyprivacy', 'https://example.com/list.txt' ] }`
  and the rest as in §8.
- Same file with `deferredJobs` **absent**: identical up to and including
  `get('deferredJobs')`, then the sequence throws (H9). Nothing more is sent.
  New UI: busy is left, and the failure is surfaced.
- **Reset with one enabled imported list** `https://a.example/l.txt`, its
  compiled key present, `deferredJobs =
  [{ name: 'updateImportedLists', time: 5 }, { name: 'pruneCSSCache', time: 9 }]`:
  steps 1-6, then `get('rulesets.imported')` ×2, `getKeys()`,
  `remove([ 'rulesets.imported.compiled.https://a.example/l.txt' ])`,
  `set({ 'rulesets.imported': [] })`, `get('deferredJobs')`,
  `alarms.create('deferredJobs', { when: max(9, Date.now() + 300000) })`,
  `set({ deferredJobs: [ { name: 'pruneCSSCache', time: 9 } ] })`, then the
  §8 messages from `applyRulesets` on.
- **Sandbox edge cases** (otherwise empty file): `{ "sandboxFilters": ["a##.b"] }`
  → `{ what: 'setSandboxFilters', text: '\na##.b' }`;
  `{ "sandboxFilters": [] }` → `{ what: 'setSandboxFilters', text: '\n' }`.
  Every other message is as in §8.
- **Nullish fields**: `{ "filteringModes": null, "autoReload": null, "dnrRules": null }`
  → exactly the traffic of §8.
- **Malformed files** (§7.3 table): `{ "rulesets": 5 }` and
  `{ "rulesets": [1] }` → messages 1-6 of §8, then failure;
  `{ "cosmeticFilters": [1] }`, `{ "customFilters": 5 }`,
  `{ "customFilters": [["a", 5]] }`, `{ "sandboxFilters": "x" }` → §8 traffic
  up to and including `removeAllCustomFilters`, then failure;
  `{ "dnrRules": "x" }` → §8 traffic up to and including
  `setSandboxFilters`, then failure (no `userDnrRules` write, no
  `updateUserDnrRules`).
- **`getDefaultConfig` fails**: file `{ "autoReload": false }` →
  `getDefaultConfig`, `setAutoReload(false)`, then failure. File with all five
  toggles → `getDefaultConfig` and the five toggle messages with the file's
  values, then failure (§7.3).

---

## 14. PARITY CHECKLIST

Boot

1. Per React dashboard page load, the React page sends exactly one
   `{ what: 'getOptionsPageData' }`, whatever pane is active. The Settings
   pane sends nothing else before the response, and never a second one.
   Traffic from the embedded classic frame and from other panes' own
   start-up is not counted (§2.1, §2.3).
2. No widget is rendered from missing data; a falsy/failed response shows an
   error state (not a blank page) and opens no channel.
3. `BroadcastChannel('uBOL')` is opened only after a successful response, once
   per page.
4. `firstRun` and `isSideloaded` are ignored by this pane.
5. Strict-block row is absent when the platform is Safari
   (`runtime.getURL('')` starts with `safari-web-extension:`).
6. "Default filtering mode" block is absent when `disabledFeatures` includes
   `filteringMode`; developer-mode row is absent when it includes `develop`;
   the pane is unreachable when it includes `dashboard` (the forced About
   pane wins over a stored `dashboard.activePane` whatever the order in which
   the two resolve, §2.4). An absent or empty `disabledFeatures` hides
   nothing. These flags are computed from the boot response only.

6a. The supports flags are derived from the boot response:
    `supportsUserScripts` → `user-scripts`, `supportsCompiledFilters` →
    `compiled-filters`. They are exposed to the other panes, and on Safari
    both are expected to be absent (§2.3 step 5).

6b. One malformed field in the boot response (e.g. an unexpected
    `defaultFilteringMode`) does not leave the other controls unrendered or
    stale (contrast §2.3 step 6).

Default filtering mode

7. Exactly three options, order 1 (basic), 2 (optimal), 3 (complete); level 0
   is not offered.
8. The selected option equals stored `defaultFilteringMode`; none is selected
   when it is 0.
9. Choosing 1 sends exactly `{ what: 'setDefaultFilteringMode', level: 1 }`
   and makes no `permissions` call.
10. Choosing 2 or 3 calls
    `browser.permissions.request({ origins: [ '<all_urls>' ] })` synchronously
    in the gesture handler, before any `await` or message, and does so even
    when `hasOmnipotence` is already `true`. This holds for pointer and
    keyboard.
11. Granted → exactly `{ what: 'setDefaultFilteringMode', level: 2 }` (or
    `level: 3`), `level` being a number; then stored mode := returned level
    and `hasOmnipotence` := `true`.
12. Denied → no message; selection returns to the stored mode.
13. The selection always shows the level **returned** by the background, and
    afterwards the level carried by any later broadcast.
14. Activating the already-selected option sends nothing.
15. The pane never sends `setPendingFilteringMode`, never calls
    `permissions.remove`, never reloads a tab.
16. A thrown/rejected permission request or a failed message reverts the
    selection, keeps the store intact and is surfaced; no extra message.

Toggles

17. Auto reload change → `{ what: 'setAutoReload', state: <boolean> }`.
18. Show blocked count change → `{ what: 'setShowBlockedCount', state: <boolean> }`;
    unchecked and disabled when `canShowBlockedCount` is `false`.
19. Strict blocking change (non-Safari only) →
    `{ what: 'setStrictBlockMode', state: <boolean> }`; shown checked only when
    `hasOmnipotence && strictBlockMode`; disabled when `hasOmnipotence` is
    `false`.
20. Pop-up blocking change → `{ what: 'setPopupBlockMode', state: <boolean> }`.
21. Developer mode change → `{ what: 'setDeveloperMode', state: <boolean> }`;
    the Develop tab gate flips immediately; effective state is
    `developerMode && !disabledFeatures.includes('develop')`.
22. Each toggle sends one message per change, shows its new state without
    waiting for a response, and sends no other message.
23. Toggle order: auto reload, blocked count, strict blocking, pop-up
    blocking, developer mode.
24. No toggle has a locked-but-visible admin state.

Live sync

25. Channel messages that are not objects are ignored.
26. `hasOmnipotence`, `defaultFilteringMode`, `autoReload`, `showBlockedCount`,
    `strictBlockMode`, `popupBlockMode`, `developerMode`: applied only when
    present and different, each followed by a refresh of the widgets.
27. `adminRulesets` (when its sorted content differs) and `enabledRulesets`
    (always) replace the stored arrays and refresh the Filter-lists pane.
    Once that pane has been shown, its refresh replaces the stored
    `enabledRulesets` / `rulesetDetails` with the fresh
    `getEnabledRulesets` / `getRulesetDetails` responses, and backup reads
    those (§5.2).
28. Unknown fields (e.g. `filteringModeDetails`, `disabledFeatures`) are
    ignored.
29. A change made in a second dashboard, in the popup, or by restore/reset is
    reflected without reload.
30. No `storage.onChanged` listener is needed for this pane.

Backup

31. Messages, in order: `getDefaultConfig` and `getSandboxFilters` (together),
    then `getFilteringModeDetails`, then `getAllCustomFilters`; then a
    `storage.local` read of `userDnrRules`. No write of any kind.
32. Output keys and order: `version`, `autoReload`, `developerMode`,
    `popupBlockMode`, `showBlockedCount`, `strictBlockMode`, `rulesets`,
    `filteringModes`, `customFilters`, `sandboxFilters`, `dnrRules`; the five
    toggles only when different from the default; `rulesets` as `+id` then
    `-id` deltas only when non-empty; `version` and `filteringModes` always.
    The toggle values and `enabledRulesets` come from the page store (raw
    `developerMode`, not the effective one), not from a fresh read.
33. Text is `JSON.stringify(obj, null, 2) + '\n'`; file name
    `my-ubol-settings.json`; no busy state; no confirmation. The two files of
    §6.2 are reproduced byte for byte.
34. A failed message — any of the four — produces no file and a surfaced
    error; an absent sandbox text from a healthy background is not a failure.

Restore

35. The file dialog opens synchronously in the click; accepts
    `application/json`; choosing the same file twice in a row works.
36. Cancelling sends nothing and never enters busy.
37. Busy is entered when a file is chosen and is always left afterwards.
38. A file that is unreadable, not JSON, or not a JSON object/array sends
    nothing.
39. A valid file triggers the 21-step sequence of §7.3, each message awaited
    before the next, with exactly those payloads, including the unconditional
    `setSandboxFilters` and `updateUserDnrRules`, the legacy `cosmeticFilters`
    path, and the `+js` split of `customFilters`. The vectors of §13 are
    reproduced exactly.
40. Missing or `null` toggle fields fall back to the `getDefaultConfig` values;
    `version` is ignored. `{}` and `[]` are accepted without confirmation and
    produce exactly the reset traffic of §8.

40a. The `setSandboxFilters` text is byte-exact, including the leading `'\n'`
     when only `sandboxFilters` is present (§7.3 step 18, §13 sandbox
     vectors).

40b. A file with a mistyped field produces exactly upstream's message prefix
     (§7.3 malformed-field table, §13 malformed vectors). Then the failure is
     surfaced as a partial restore and busy is left.

40c. A pending Filter-lists commit cannot land after the restore's/reset's
     `applyRulesets` (§7.4, H17).

41. Page-side storage calls happen at the same points: read
    `rulesets.imported` before `applyRulesets`; write or remove `userDnrRules`
    just before `updateUserDnrRules`; imported lists added/removed in the page
    when needed, with the same `storage.local` and `alarms.create` /
    `alarms.clear` calls as §7.3 (removal before addition, both before
    `applyRulesets`). A missing `deferredJobs` key is surfaced as a failure,
    not a hang.
42. No confirmation before restore; no page or tab reload after it.

Reset

43. Confirmation text is `resetToDefaultConfirm`; declining sends nothing and
    never enters busy.
44. Confirming runs exactly the §7.3 sequence with an empty object (the
    traffic listed in §8) inside a busy state that is always left.
45. No page or tab reload after reset.

i18n

46. Every string comes from the keys of §10; the three mode descriptions keep
    their paragraph breaks; mode names are the catalogue's lower-case strings
    capitalised by presentation only; legends stay attached to their toggle.
47. No new string is introduced except feedback texts that upstream lacks,
    each via `tNew` and documented as new strings.

Implementation

48. Upstream `js/backup-restore.js` and `js/settings.js` are not imported by
    the new page; every message goes through `bridge.ts` and every storage or
    alarms call through `ext.ts` (§7.5).

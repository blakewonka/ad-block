# Messaging spec — every channel between UI pages and the rest of the extension

Status: behaviour spec, transcribed from upstream source. Implementers follow this
file INSTEAD of reading upstream code. Nothing here is a design proposal.

## 0. Conventions

- `ROOT` = `upstream`.
- A path without prefix (`js/background.js:517`, `dashboard.html:100`, `css/settings.css:104`)
  is relative to `ROOT/platform/mv3/extension/`.
- `safari/…` = `ROOT/platform/mv3/safari/…`. `PRISTINE/…` = `build/pristine/safari/…`.
  `XCODE/…` = `build/xcode/safari-macos/…` (the generated project is `XCODE/Blocker/`, so the app
  sources are under `XCODE/Blocker/Blocker/`).
- `bg:N` is short for `js/background.js:N`.
- Line numbers were checked against PRISTINE: every cited `js/*.js`, `*.html`, `css/*.css`
  file is byte-identical (`cmp`) between `ROOT/platform/mv3/extension` and PRISTINE, EXCEPT
  four files that PRISTINE takes from the Safari folder: `js/ext-compat.js` (= `safari/ext-compat.js`),
  `js/ext-offscreen.js` (= `safari/ext-offscreen.js`), `js/scripting/css-api.js` (= `safari/css-api.js`),
  `js/scripting/css-user.js` (= `safari/css-user.js`). For those four, the `safari/…` citation is
  what actually runs.
- "UNKNOWN" = could not be determined from source; nobody may assume a value.
- "Upstream quirk" = behaviour that looks like a defect but is what upstream does.

Research disagreement found (upstream wins, per ARCHITECTURE):
An earlier research note said `#gotoMatchedRules` "can never be enabled" on this
build because the manifest lacks `declarativeNetRequestFeedback`. PRISTINE's manifest DOES contain it
(`PRISTINE/manifest.json` permissions list, added for local builds by `ROOT/tools/make-mv3.sh:166-175`),
so `isSideloaded === true` in PRISTINE (js/debug.js:37-40). See §4.1 and §17.

More research disagreements found by the audit (upstream wins):
- The research notes said filter lists are "debounced 997 ms with a beforeunload flush".
  In fact the `beforeunload` handler returns WITHOUT sending when a debounce timer is pending
  (js/filter-lists.js:466-467). It sends only when no timer is pending (§6.3).
- They said bg:239-260 "enables exactly that list". In fact admin `+`/`-` tokens are
  applied on top of the list and unknown ids are dropped (js/ruleset-manager.js:617-654, §6.3).
- The original plan said "setPendingFilteringMode is sent first", and
  the research notes imply it is sent for every level above 1. It is sent only when going from
  ≤ 1 to ≥ 2. A 2 ↔ 3 change requests the permission without it (js/popup.js:66-67, §4.2).

Audit (2026-10-04): every payload, response shape, storage key, timer value,
API argument and condition in §1-§17 was re-read against the cited upstream lines. The listed `js/*.js`,
`*.html`, `css/*.css` and `js/scripting/*.js` files were re-compared with PRISTINE (`cmp`). The only
differences are the four Safari substitutions named above, and each of those is byte-identical to its
`safari/…` source. Corrections and additions made by the audit are marked "(audit)". The new §21 is a
wire-level parity checklist. Nothing was run in Safari (ARCHITECTURE §7).

---

## 1. Transport: `runtime.sendMessage` and the background dispatcher

### 1.1 Upstream sender wrapper

```js
// js/ext.js:51-55
export function sendMessage(msg) {
    return runtime.sendMessage(msg).catch(reason => {
        console.log(reason);
    });
}
```

- A rejected send is swallowed; the caller receives `undefined` (js/ext.js:52-54).
- There is no retry, although the comment above it says so (js/ext.js:48-49).
- Content scripts and overlay scripts call `chrome.runtime.sendMessage` / `webext.runtime.sendMessage`
  directly with their own empty `.catch` (safari/css-api.js:29-33, js/scripting/tool-overlay.js:122-127).

### 1.2 Background listener

```js
// bg:857-861
runtime.onMessage.addListener((request, sender, callback) => {
    if ( request.what.includes(':') ) { return; }
    onMessage(request, sender).then(callback);
    return true;
});
```

- Every request is an object with a string `what`. If `request.what` has no `includes` method
  (missing, a number, `null`), the listener throws (bg:858) and no response is produced.
- Names containing `:` are skipped here (bg:858); they are served by a temporary listener that only
  exists while filters are being compiled (js/compiled-filters.js:56-93). That code path is never
  reached on Safari (js/compiled-filters.js:270-271 returns because `supportsOffscreenDocument` is
  `false`, safari/ext-offscreen.js:25).
- The handler's resolved value is passed to `callback` (bg:859). There is no `.catch`: if the handler
  rejects, `callback` is never called (bg:859).
- No UI page registers a `runtime.onMessage` listener; the only listeners are bg:857 and
  js/compiled-filters.js:93 (background only).
- A second entry into the same dispatcher exists for user scripts: `runtime.onUserScriptMessage`
  (bg:863-869), registered only when `supportsUserScripts()` is true and that event exists. It has no
  `:` filter. No UI page uses it; on Safari it is expected not to be registered (§17 item 3).

### 1.3 Dispatcher phases (`onMessage`, bg:293-673)

| Phase | Lines | Waits for init | Needs trusted origin | Cases |
|---|---|---|---|---|
| P1 | bg:302-339 | no | no | `insertCSS`, `removeCSS`, `injectCSSProceduralAPI` |
| — | bg:343 | `await isFullyInitialized` | | |
| P2 | bg:347-370 | yes | no | `toggleToolbarIcon`, `startCustomFilters`, `terminateCustomFilters`, `injectCustomFilters` |
| trust | bg:376-378 | | | untrusted sender → resolves `undefined` |
| P3 | bg:380-672 | yes | yes | all 45 remaining cases (§2) |

- `tabId = sender?.tab?.id ?? false; frameId = tabId && (sender?.frameId ?? false)` (bg:295-296).
  These two values are used only by the P1/P2 cases (bg:304-366). No P3 handler reads `sender.tab`:
  whenever a UI page means a tab, it sends the tab id explicitly in the payload (js/popup.js:70, 223).
- Trust check: `sender?.origin === undefined || sender.origin.toLowerCase() === UBOL_ORIGIN` (bg:376-377),
  with `UBOL_ORIGIN = runtime.getURL('').replace(/\/$/, '').toLowerCase()` (bg:142). Extension pages
  (popup, dashboard, report, matched-rules, strictblock, overlay iframes) pass; web-page content
  scripts do not. UNKNOWN whether Safari sets `sender.origin` at all; both outcomes pass for extension pages.
- `isFullyInitialized` is the promise chain of `start()` (bg:839-855). Every P2/P3 message waits for
  startup (bg:343). If `start()` rejects, the chain still resolves (bg:842-855) and messages are then
  answered by a partially initialised background; on the first such failure the background writes
  local `goodStart=false` and calls `runtime.reload()` (bg:845-854).
- An unknown `what` falls through every switch and resolves `undefined` (bg:670-673).
- The dispatcher is also called internally by the alarm job runner with `{ what: <jobName> }` and no
  sender (bg:896, js/alarms.js:82); job names are `pruneCSSCache` (js/scripting-manager.js:364, 380)
  and `updateImportedLists` (js/imported-lists.js:64).

### 1.4 Response semantics

- A handler `return;` resolves `undefined` (e.g. bg:465). UNKNOWN whether Safari delivers this to the
  sender as `undefined` or `null`; all upstream call sites use nullish-tolerant checks
  (js/popup.js:325, js/settings.js:332, js/filter-lists.js:458, js/backup-restore.js:45,
  js/matched-rules.js:37). The bridge must treat `null` and `undefined` as the same thing.
- `Set`s do not survive messaging; the mode table is therefore sent in array form
  (bg:543, js/mode-manager.js:87-94, 326-335).
- Object properties whose value is `undefined` (e.g. `disabledFeatures`, bg:438, 505) must be treated
  as optional; whether Safari drops the key or sends `null` is UNKNOWN.

### 1.5 Failure modes

| Failure | What the sender observes upstream | Source |
|---|---|---|
| `runtime.sendMessage` rejects (no receiver, context gone) | `sendMessage()` resolves `undefined` | js/ext.js:51-55 |
| Sender origin not trusted | `undefined` | bg:376-378 |
| Unknown `what` | `undefined` | bg:670-673 |
| Handler throws / rejects | `callback` never called (bg:859). What the sender's promise does then on Safari is UNKNOWN (may never settle) | bg:857-861 |
| `what` missing or not a string | listener throws; no response; sender outcome UNKNOWN | bg:858 |
| Background start-up failed | request still dispatched after bg:343 against partial state | bg:839-855 |

### 1.6 Requirements for `src/lib/bridge.ts` that follow from the above

1. Send exactly the payload objects quoted in this file (field names, types). Do not add fields.
2. Do not copy the `.catch` of js/ext.js:52: a rejected `runtime.sendMessage` must surface as a thrown error
   (ARCHITECTURE §6.5).
3. For the messages listed "never nullish on success" in §20, a nullish response means failure
   (causes: §1.5 rows 1-3) and must be surfaced as an error. For "void" messages a nullish response is
   the normal success value and failure can only be detected through a transport rejection.
4. Upstream has no timeout on any message (js/ext.js:51-55). Handlers such as `applyRulesets`,
   `setFilteringModeDetails`, `setDefaultFilteringMode` re-register all content scripts before
   answering (bg:255, 537, 547) and can legitimately take seconds; duration on Safari is UNKNOWN.
   (audit) Consequence: when a handler throws, the sender gets no answer (bg:859). For "void" messages
   that is the ONLY sign of failure, and it may be a promise that never settles (U2). The bridge cannot
   tell "slow" from "dead". Whatever the UI does while waiting, it must not send the next message of an
   ordered sequence (§7.2) before the previous one has settled.
5. `level` fields must be JavaScript numbers. The background compares with `===` and `switch`
   (bg:519, js/mode-manager.js:156-173, 192-234); a string such as `"2"` matches no `case`.
   (audit) Exact effect traced in js/mode-manager.js:191-236. For a hostname, the hostname is removed
   from the set it was in, then added to no set, so it falls back to the default mode. For `'all-urls'`
   (js/mode-manager.js:155-189), `'all-urls'` is removed from the current default set and added to no
   set, so the default becomes basic (1) (js/mode-manager.js:125-131). Both changes are written to
   storage and broadcast (js/mode-manager.js:351-356). `NaN` behaves the same way.

---

## 2. Catalogue of every `what` handled by the background (52 cases)

Class A = sent by surfaces rebuilt in React (popup, Settings, Filter lists, About, backup/restore/reset)
→ needs a bridge function. Class B = sent only by surfaces kept as upstream code. Class C = content
scripts / internal jobs; UI must never send them.

| `what` | Handler | Upstream sender(s) | Class |
|---|---|---|---|
| `popupPanelData` | bg:492-508 | js/popup.js:320-324 | A |
| `setPendingFilteringMode` | bg:525-527 | js/popup.js:68-75 | A |
| `setFilteringMode` | bg:517-523 | js/popup.js:93-97 | A |
| `showMatchedRules` | bg:559-564 | js/popup.js:221-224 | A |
| `gotoURL` | bg:514-515 | js/popup.js:241-244; js/report.js:92, 104, 117 | A |
| `getOptionsPageData` | bg:406-442 | js/settings.js:329-331 | A |
| `setDefaultFilteringMode` | bg:533-540 | js/settings.js:100-103, 113-116 | A |
| `setAutoReload` | bg:461-465 | js/settings.js:197-200; js/backup-restore.js:95-98 | A |
| `setShowBlockedCount` | bg:467-476 | js/settings.js:204-207; js/backup-restore.js:100-103 | A |
| `setStrictBlockMode` | bg:478-481 | js/settings.js:211-214; js/backup-restore.js:110-113 | A |
| `setPopupBlockMode` | bg:483-487 | js/settings.js:218-221; js/backup-restore.js:115-118 | A |
| `setDeveloperMode` | bg:489-490 | js/settings.js:226; js/backup-restore.js:105-108 | A |
| `getEnabledRulesets` | bg:444-445 | js/filter-lists.js:128; js/troubleshooting.js:69 | A |
| `getRulesetDetails` | bg:447-450 | js/filter-lists.js:129; js/troubleshooting.js:70; js/develop.js:54 | A |
| `applyRulesets` | bg:382-388 | js/filter-lists.js:450-457; js/backup-restore.js:147-150 | A |
| `importFilterList` | bg:640-647 | js/filter-lists.js:495 | A (hidden on Safari, §6.4) |
| `getDefaultConfig` | bg:390-401 | js/backup-restore.js:44, 93; js/troubleshooting.js:67 | A |
| `getCurrentConfig` | bg:403-404 | js/troubleshooting.js:68; js/strictblock.js:113-115 | A |
| `getFilteringModeDetails` | bg:542-543 | js/backup-restore.js:75; js/mode-editor.js:57 | A |
| `setFilteringModeDetails` | bg:545-551 | js/backup-restore.js:152-155; js/mode-editor.js:64 | A |
| `getAllCustomFilters` | bg:578-579 | js/backup-restore.js:76; js/filter-manager-ui.js:143 | A |
| `removeAllCustomFilters` | bg:611-619 | js/backup-restore.js:157; js/filter-manager-ui.js:284-286 | A |
| `addManyCustomFilters` | bg:588-601 | js/backup-restore.js:175-177, 196-198 | A |
| `getSandboxFilters` | bg:621-622 | js/backup-restore.js:45; js/filter-manager-ui.js:596 | A |
| `setSandboxFilters` | bg:624-629 | js/backup-restore.js:203-205; js/filter-manager-ui.js:592 | A |
| `updateUserDnrRules` | bg:575-576 | js/backup-restore.js:213; js/rw-dnr-editor.js:291 | A |
| `getDefaultFilteringMode` | bg:529-531 | js/troubleshooting.js:71 | A |
| `getEffectiveUserRules` | bg:572-573 | js/troubleshooting.js:72 | A |
| `getConsoleOutput` | bg:637-638 | js/troubleshooting.js:73 | A |
| `getRegisteredContentScripts` | bg:634-635 | js/troubleshooting.js:74 | A |
| `hasBroadHostPermissions` | bg:458-459 | js/troubleshooting.js:75 | A |
| `addCustomFilters` | bg:581-586 | js/filter-manager-ui.js:116, 291-294, 322-325, 513-516; js/picker-ui.js:232-236; js/unpicker-ui.js:83-86 | B |
| `removeCustomFilters` | bg:603-609 | js/filter-manager-ui.js:101, 315-318; js/unpicker-ui.js:72-75; js/scripting/unpicker.js:39-42 | B |
| `customFiltersFromHostname` | bg:631-632 | js/unpicker-ui.js:132-135 | B |
| `getEnabledRulesetsDetails` | bg:452-453 | js/strictblock.js:30 | B |
| `getRulesetRules` | bg:455-456 | js/ro-dnr-editor.js:52 | B |
| `getAllDynamicRules` | bg:566-567 | js/ro-dnr-editor.js:34 | B |
| `getAllSessionRules` | bg:569-570 | js/ro-dnr-editor.js:42 | B |
| `getMatchedRules` | bg:556-557 | js/matched-rules.js:30-33 | B |
| `excludeFromStrictBlock` | bg:553-554 | js/strictblock.js:75-79 | B |
| `getFilteringMode` | bg:510-512 | no sender exists in `js/` | B (unused) |
| `getImportedLists` | bg:649-651 | no sender exists in `js/` | B (unused) |
| `insertCSS` | bg:304-314 | safari/css-api.js:29-33, 39-43; js/scripting/tool-overlay.js:81; js/scripting/picker.js:276 | C |
| `removeCSS` | bg:316-326 | js/scripting/css-user-terminate.js:28-32; js/scripting/css-procedural-api.js:623, 787; js/scripting/tool-overlay.js:89; js/scripting/picker.js:256 | C |
| `injectCSSProceduralAPI` | bg:328-335 | js/scripting/css-specific.js:161-163; safari/css-user.js:41-43 | C |
| `toggleToolbarIcon` | bg:349-354 | js/scripting/toolbar-icon.js:23-25 | C |
| `startCustomFilters` | bg:356-358 | js/scripting/picker.js:295; js/scripting/unpicker.js:35 | C |
| `terminateCustomFilters` | bg:360-362 | js/scripting/picker.js:297; js/scripting/unpicker.js:37 | C |
| `injectCustomFilters` | bg:364-366 | safari/css-user.js:31-34 | C |
| `updateImportedLists` | bg:653-659 | alarm job only (js/alarms.js:82, js/imported-lists.js:64) | C |
| `pruneCSSCache` | bg:661-663 | alarm job only (js/alarms.js:82, js/scripting-manager.js:364, 380) | C |
| `keepAlive` | bg:667-668 | js/offscreen/compile-filters.js:336 (offscreen document; never on Safari) | C |

### 2.1 Class A at a glance

"Success response" is what the handler resolves with; `undefined` means the handler ends with a bare
`return` (it may reach the page as `null`, §1.4). "State" says how the payload is interpreted:
FULL = the complete desired value, DELTA = an addition, READ = no user state changes.
Failure behaviour common to all rows: §1.5.

| `what` | Payload besides `what` | Success response | State | Handler | Details |
|---|---|---|---|---|---|
| `popupPanelData` | `origin: string`, `hostname: string` | object, 7 fields | READ | bg:492-508 | §4.1 |
| `setPendingFilteringMode` | `tabId: number`, `url: string`, `hostname: string`, `beforeLevel: number`, `afterLevel: number` | `undefined` | replaces the one pending slot | bg:525-527 | §4.2 |
| `setFilteringMode` | `hostname: string`, `level: 0..3` | `number` (level now in force) | FULL (absolute level of one hostname) | bg:517-523 | §4.3 |
| `showMatchedRules` | `tabId: number` | `undefined` | action, no state | bg:559-564 | §4.4 |
| `gotoURL` | `url: string`, `type?: 'popup'` | tab/window objects, never read | action, no state | bg:514-515 | §4.5 |
| `getOptionsPageData` | — | object, 17 fields | READ (side effect: `process.firstRun = false`) | bg:406-442 | §5.1 |
| `setDefaultFilteringMode` | `level: 0..3` | `number` (default now in force) | FULL | bg:533-540 | §5.2 |
| `setAutoReload` | `state: boolean` | `undefined` | FULL | bg:461-465 | §5.3 |
| `setShowBlockedCount` | `state: boolean` | `undefined` | FULL | bg:467-476 | §5.3 |
| `setStrictBlockMode` | `state: boolean` | `undefined` | FULL | bg:478-481 | §5.3 |
| `setPopupBlockMode` | `state: boolean` | `undefined` | FULL | bg:483-487 | §5.3 |
| `setDeveloperMode` | `state: boolean` | `boolean` (new value) | FULL | bg:489-490 | §5.3 |
| `getEnabledRulesets` | — | `string[]` | READ | bg:444-445 | §6.1 |
| `getRulesetDetails` | — | `RulesetDetails[]` | READ | bg:447-450 | §6.2 |
| `applyRulesets` | `enabledRulesets: string[]`, `toRemove?: string[]` | `undefined` (never an error) | FULL list of enabled ids; `toRemove` is a delete list | bg:382-388 | §6.3 |
| `importFilterList` | `url: string` | `undefined` | DELTA (adds and enables one list) | bg:640-647 | §6.4 |
| `getDefaultConfig` | — | object, 7 fields | READ | bg:390-401 | §7.1 |
| `getCurrentConfig` | — | `RulesetConfig` | READ | bg:403-404 | §3.5, §8.2 |
| `getFilteringModeDetails` | — | mode table (arrays) | READ | bg:542-543 | §7.1 |
| `setFilteringModeDetails` | `modes: { none, basic, optimal, complete }` (each `string[]`) | mode table now in force | FULL replacement of the whole table | bg:545-551 | §7.2 |
| `getAllCustomFilters` | — | `Array<[string, string[]]>` | READ | bg:578-579 | §7.1 |
| `removeAllCustomFilters` | `hostname: string` (`'*'` = all sites) | `undefined` | deletes | bg:611-619 | §7.2 |
| `addManyCustomFilters` | `entries: Array<[string, string[]]>` | `undefined` | DELTA (merge) | bg:588-601 | §7.2 |
| `getSandboxFilters` | — | `string`, or `undefined` when nothing is stored | READ | bg:621-622 | §7.1 |
| `setSandboxFilters` | `text: string` | `undefined` | FULL replacement text | bg:624-629 | §7.2 |
| `updateUserDnrRules` | — (input is read from storage) | `{ added, removed, errors }` | re-applies stored rules | bg:575-576 | §7.2 |
| `getDefaultFilteringMode` | — | `number` 0..3 | READ | bg:529-531 | §8.2 |
| `getEffectiveUserRules` | — | DNR rule objects | READ | bg:572-573 | §8.2 |
| `getConsoleOutput` | — | `string[]` | READ | bg:637-638 | §8.2 |
| `getRegisteredContentScripts` | — | `string[]` | READ | bg:634-635 | §8.2 |
| `hasBroadHostPermissions` | — | `boolean` | READ | bg:458-459 | §8.2 |

Messages with `:` in the name (`compileFilters:getResourceTypes`, `compileFilters:getUserList`,
`compileFilters:result`, `compileFilters:getEnabledImportedLists`,
`compileFilters:getImportedListCompiledData`, `compileFilters:updateImportedListData`) flow from the
offscreen compile document to js/compiled-filters.js:56-93. No UI page sends them. Not reachable on
Safari (safari/ext-offscreen.js:25, js/compiled-filters.js:270-271).

---

## 3. Shared data shapes

### 3.1 Filtering level

`0` none, `1` basic, `2` optimal, `3` complete (js/mode-manager.js:48-56). Always a number.

### 3.2 Hostnames

- Per-site hostnames are whatever `URL.hostname` yields (ASCII/punycode, lower case)
  (js/popup.js:62, 323).
- The literal `'all-urls'` is the key of the default mode (js/mode-manager.js:58-63, 125-131). Host
  permission patterns `<all_urls>` and `*://*/*` are mapped to `'all-urls'` (js/utils.js:114-119).
- Mode lookup (js/mode-manager.js:123-149) goes through the sets in the order none → basic → optimal →
  complete. For each set it checks the exact hostname, then (only when that set does not hold
  `'all-urls'`) whether any parent domain of the hostname is in the set. The first set that matches
  wins. If none matches, the default applies. (audit: the earlier wording "walks up the parent
  domains, then checks the sets" had the loops in the wrong order. A parent entry in `none` beats an
  exact entry in `basic`.)
- (audit) Per-site writes (`setFilteringMode`, js/mode-manager.js:191-236) first delete the hostname AND
  every parent domain of it from the set that currently decides its level (`pruneHostnameFromSet`,
  js/mode-manager.js:76-83). Then they add the hostname to the target set only if the target differs
  from the default. Changing `www.example.com` therefore also deletes an `example.com` entry it
  inherited from. This is how the "actual level differs from the requested one" answers of §4.3 arise.
  (`setFilteringModeDetails` can still store any table; see §7.2.)

### 3.3 Filtering mode table ("filteringModeDetails")

Serialised form (messages, storage): `{ none: string[], basic: string[], optimal: string[], complete: string[] }`
(js/mode-manager.js:87-94). Exactly one array normally contains `'all-urls'`; if none does, the default
is treated as basic (js/mode-manager.js:125-131). Factory default:
`{ none: [], basic: [], optimal: ['all-urls'], complete: [] }` (js/mode-manager.js:58-63).
Legacy input keys accepted on write: `network` (→ basic), `extendedSpecific` (→ optimal),
`extendedGeneric` (→ complete) (js/mode-manager.js:96-103).

### 3.4 Ruleset details

Stock entries come from `PRISTINE/rulesets/ruleset-details.json`, generated by
`ROOT/platform/mv3/make-rulesets.js:1123-1154`, merged with imported lists (js/ruleset-manager.js:78-89).

```
{
  id: string,                 // e.g. "easylist"; imported lists use their URL as id (js/imported-lists.js:183-196)
  name: string,
  group?: "default"|"ads"|"privacy"|"malware"|"annoyances"|"regions"|"imported",   // absent on 2 stock entries
  parent?: string,            // "A|B" path of sub-group names (js/filter-lists.js:299-307); present on 3 stock entries
  lang?: string,              // space separated language codes; present on 36 stock entries
  tags?: string,              // space separated; present on 37 stock entries
  enabled: boolean,           // STOCK: "enabled by default" (static). IMPORTED: "currently enabled" (js/imported-lists.js:94-104, 198)
  homeURL: string,
  filters: { total: number, accepted: number, rejected: number },
  rules: { total: number, plain: number, regex: number, strictblock?: number, urlskip?: number, rejected?: number,
           removeparam?: number, redirect?: number, modifyHeaders?: number, discarded?: number },
  css?: { generic?: number, specific?: number },
  popups?: number,
  // imported entries only (js/imported-lists.js:194-215):
  expires?: number,           // days, initial 7
  time?: { added: number, updated: number }   // epoch ms
}
```

Counts measured on PRISTINE (script over `ruleset-details.json`): 51 entries; `group` values
default 3, ads 1, privacy 1, annoyances 7, regions 37, absent 2 (`ublock-experimental`, `ubol-tests`);
default-enabled ids: `ublock-filters`, `easylist`, `easyprivacy`. No stock entry has a `preferred`
field although js/filter-lists.js:201-203 sorts on it. Keys actually present in PRISTINE:
`id`, `name`, `enabled` (always a boolean), `homeURL` (always a string), `filters{total,accepted,rejected}`,
`rules{total,plain,regex,rejected}` and `css{generic,specific}` on all 51; `rules.strictblock` on 45;
`rules.urlskip` on 2; `popups` on 30; `group` on 49; `tags` on 37; `lang` on 36; `parent` on 3
(`pol-0`, `rus-0`, `rus-1`). `rules.removeparam`, `rules.redirect`, `rules.modifyHeaders` and
`rules.discarded` are named by the generator (`ROOT/platform/mv3/make-rulesets.js:1141-1146`) but occur
in no PRISTINE entry; treat them as optional and never rely on them.

IMPORTANT: for stock lists `enabled` is NOT the current state. The current state is the id's presence in
`enabledRulesets` (js/filter-lists.js:144-151); `enabled` only drives the "isDefault" marker
(js/filter-lists.js:155-158).

### 3.5 `rulesetConfig` (background config object)

```
{ version: string, enabledRulesets: string[], autoReload: boolean, showBlockedCount: boolean,
  strictBlockMode: boolean, popupBlockMode: boolean, developerMode: boolean,
  hasBroadHostPermissions: boolean, userScripts?: boolean }
```
(js/config.js:30-39; `userScripts` is added at bg:753-757.) Defaults: `autoReload: true`,
`showBlockedCount: true`, `strictBlockMode: webextFlavor !== 'safari'` (so `false` on Safari),
`popupBlockMode: true`, `developerMode: false` (js/config.js:30-39). Persisted as a whole under
`rulesetConfig` in both local and session storage on every save (js/config.js:70-73).

### 3.6 Admin tokens

`adminRulesets` is a list of `"+<id>"` / `"-<id>"` tokens from managed storage (js/admin.js:171-205).
`disabledFeatures` is a list of feature tokens from managed storage, or `undefined`
(js/admin.js:209-230; schema `PRISTINE/managed_storage.json`). Tokens the UI reacts to:
`dashboard`, `filteringMode`, `picker`, `zapper`, `report`, `develop`
(css/popup.css:97-109, css/settings.css:32-50, js/settings.js:29-36, 73-74). Whether Safari exposes
`browser.storage.managed` is UNKNOWN; when it does not, both values are empty/undefined
(js/ext.js:131-139, js/admin.js:179).

---

## 4. Popup (`popup.html`)

### 4.1 `popupPanelData`

- Sender: js/popup.js:320-324.
- Request: `{ what: 'popupPanelData', origin: url.origin, hostname: tabURL.hostname }` — `origin: string`,
  `hostname: string`. The handler reads only `hostname` (bg:495, 497); `origin` is ignored.
- Response (bg:499-507):
  ```
  { hasOmnipotence: boolean,        // browser.permissions.getAll() has '<all_urls>' or '*://*/*' (js/ext-utils.js:33-38)
    level: 0|1|2|3,                 // effective mode for hostname (js/mode-manager.js:346-349)
    autoReload: boolean,            // rulesetConfig.autoReload
    isSideloaded: boolean,          // manifest permissions include 'declarativeNetRequestFeedback' (js/debug.js:37-40)
    developerMode: boolean,
    disabledFeatures: string[] | undefined,   // js/admin.js:209-230
    hasCustomFilters: number }      // COUNT of custom selectors for hostname and its parents, not a boolean (js/filter-manager.js:92-95, 69-88)
  ```
- Side effects: none on user state. May lazily build the mode-table cache (session key
  `filteringModeDetails`) and refresh `admin.disabledFeatures` in local+session storage
  (js/mode-manager.js:241-300, js/admin.js:220-228).
- State: read-only.
- Upstream use of the response: `disabledFeatures` → hides features (js/popup.js:35-39);
  `level` → current slider value (js/popup.js:330) and `mode` param of the report URL (js/popup.js:240);
  `autoReload` → reload after change (js/popup.js:101); `isSideloaded === true && developerMode && tab id is a number`
  → matched-rules button enabled (js/popup.js:334-339); `hasCustomFilters` truthy → unpicker enabled
  (js/popup.js:344). `hasOmnipotence` is not read by the popup.
- Failure: a non-object response makes `init()` return `false` → "no data" state with
  `i18n popupNoWebsite` as hostname text (js/popup.js:325, 349-355).
- (audit) Failure that upstream does NOT turn into "no data": if `tabs.query` rejects, or anything in
  `init()` throws after the message (for example `disabledFeatures: null`, which the `= []` default of
  js/popup.js:36 does not replace, so `forbid.length` throws), `tryInit` swallows the error
  (js/popup.js:356). It only removes `loading`/`busy` (js/popup.js:358). The popup then shows neither
  data nor the "no data" text. The React popup must show an error state instead (ARCHITECTURE §6.5),
  and must treat `disabledFeatures: null` like `undefined`.
- (audit) Which actions can be reached after this message (upstream gating, so it decides which later
  messages are possible):
  - zapper, picker and report: shown only with data (`:root.isHTTP`, js/popup.js:341-342,
    css/popup.css:149-151).
  - unpicker: shown only when `hasCustomFilters` is non-zero (js/popup.js:344, css/popup.css:168-170).
  - matched rules: visible only under the condition above (js/popup.js:334-339, css/popup.css:187-202).
  - dashboard: always shown, also in the "no data" state (popup.html:53, css/popup.css:200-202).
  - level control: hidden in "no data" (§4.6 step 1).
  - `disabledFeatures` tokens additionally hide controls: `zapper`, `picker` (picker AND unpicker),
    `report`, `dashboard` (dashboard AND matched rules). `filteringMode` keeps the level control
    visible but sets `pointer-events: none` on it (css/popup.css:97-109).
- Safari / PRISTINE: `isSideloaded` is `true` in PRISTINE (see §0); with developer mode on, the
  matched-rules button is enabled.

Pre-conditions before the message is sent (js/popup.js:298-318), in order:
1. `browser.tabs.query({ active: true, currentWindow: true })` → first tab; not an object → no data.
2. `url = new URL(tab.url)`; if `url.href` starts with `runtime.getURL('/strictblock.')` the real URL is
   `new URL(url.hash.slice(1))` (js/popup.js:308-312). `tabURL.href = url.href`.
3. No data if the URL cannot be parsed, has an empty hostname, or protocol is not `http:`/`https:`
   (js/popup.js:316-318).
UNKNOWN: whether Safari supplies `tab.url` for the active tab when the extension has no permission for
that site; if it does not, step 2 throws and the popup shows "no data" (js/popup.js:306-316).
`PRISTINE/manifest.json` declares the `activeTab` permission, which is the only thing in the build that
could make the URL available in that case.

### 4.2 `setPendingFilteringMode`

- Sender: js/popup.js:68-75; NOT awaited; sent only when `afterLevel > 1 && beforeLevel <= 1`
  (js/popup.js:66-67), immediately before `browser.permissions.request` (js/popup.js:77-81).
- Request:
  ```
  { what: 'setPendingFilteringMode',
    tabId: currentTab.id,        // number
    url: tabURL.href,            // string, the (unwrapped) page URL
    hostname: targetHostname,    // string
    beforeLevel,                 // number
    afterLevel }                 // number (2 or 3)
  ```
- Handler: `pendingPermissionRequest = request; return;` (bg:525-527). Response: `undefined`.
- Side effects: the whole request object is kept in a background module variable (bg:145). It is consumed
  and cleared by the NEXT `permissions.onAdded` event (bg:210-217). If that event fires, the background
  itself (bg:169-183): persists host permissions; stops if the default mode is ≥ optimal; stops unless the
  granted origins cover `hostname`; stops if the site is already at `afterLevel`; otherwise sets the
  site's mode to `afterLevel`, re-registers content scripts, and, when `autoReload` is on, after 437 ms
  calls `browser.tabs.update(tabId, { url })` (bg:155-166, 181-182). Fields read: `hostname`,
  `afterLevel`, `tabId`, `url`; `beforeLevel` is not read.
- State: replaces the single pending slot (not a queue).
- Failure: none visible (fire-and-forget).
- Upstream quirks: the slot is not cleared when the user denies the prompt or when no `onAdded` event
  fires (bg:145, 210-212); it is then applied to the next permission grant of any kind. The variable is
  lost if the background is unloaded before the event (it is plain module state, bg:145). Popup and
  background may both reload the tab (js/popup.js:101-110 and bg:181-182).
- Purpose: lets the switch complete when the popup is destroyed by the permission prompt
  (comment bg:209 → uBOL-home issue 280).

### 4.3 `setFilteringMode`

- Sender: js/popup.js:93-97 (awaited).
- Request: `{ what: 'setFilteringMode', hostname: targetHostname, level: afterLevel }` — `hostname: string`,
  `level: 0|1|2|3` (number).
- Handler (bg:517-523): reads the current level; if `request.level === beforeLevel` returns it without
  writing; otherwise applies the level (js/mode-manager.js:351-356, 153-237), then awaits
  `registerContentScripts()` and `registerUserScripts()`, then returns the level actually in force.
- Response: `number` 0..3 — the ACTUAL level after the operation. It can differ from the request
  (the hostname may inherit a mode from a parent domain entry; js/mode-manager.js:191-236).
- Side effects when the level changes (js/mode-manager.js:304-322): DNR allow rules rewritten;
  `filteringModeDetails` written to local and session storage; BroadcastChannel message
  `{ defaultFilteringMode, hasOmnipotence, filteringModeDetails }` (§11).
- State: FULL desired level for that one hostname (absolute, not a delta).
- The background does NOT check host permissions here; the caller is responsible for
  `permissions.request` (bg:517-523 has no permission test).
- Failure upstream: an `undefined` response is treated as a level: the slider is set to `undefined`
  and, since `undefined !== beforeLevel`, the tab is reloaded when `autoReload` is on
  (js/popup.js:98-110). The bridge must throw instead (§1.6).

### 4.4 `showMatchedRules`

- Sender: js/popup.js:218-225 (only for trusted left clicks).
- Request: `{ what: 'showMatchedRules', tabId: currentTab.id }` — `tabId: number`.
- Handler (bg:559-564): `browser.windows.create({ type: 'popup', url: '/matched-rules.html?tab=<tabId>' })`,
  not awaited. Response: `undefined`.
- Failure: errors of `windows.create` are unobserved (bg:560-563). UNKNOWN whether Safari honours
  `type: 'popup'`.

### 4.5 `gotoURL`

- Senders: js/popup.js:241-244 (report page); js/report.js:92, 104, 117 (external https links).
- Request: `{ what: 'gotoURL', url: string, type?: 'popup' }`. No upstream sender sets `type`.
  Popup value: `url = reportURL.pathname + reportURL.search` where `reportURL = runtime.getURL('/report.html')`
  plus query `tabid=<currentTab.id>`, `url=<tabURL.href>`, `mode=<popupPanelData.level>` set in that order
  (js/popup.js:237-240, 243). The handler resolves `url` against `runtime.getURL('/')` (js/ext-utils.js:43).
  (audit) `popupPanelData.level` is the level reported when the popup OPENED. It is never updated after
  a level change (js/popup.js:93-110 writes only the slider), so after a change in the same popup the
  report still carries the old `mode`. Values are encoded by `URLSearchParams` (`:` → `%3A`, `/` → `%2F`).
  For a tab id of 42 the payload is
  `{ what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1' }`.
- Handler (bg:514-515 → js/ext-utils.js:42-68): `tabs.query({ url, windowType: type !== 'popup' ? 'normal' : 'popup' })`;
  if a tab exists → `windows.update(windowId, { focused: true })` + `tabs.update(id, { active: true })`;
  else if `type === 'popup'` → `windows.create({ type: 'popup', url })`; else `tabs.create({ active: true, url })`.
- Response: whatever those calls resolve to (an array `[Window, Tab]`, a `Window`, or a `Tab`); no caller reads it.
- Failure: an unparsable `url` throws in the handler → no response (§1.5).
- Safari: UNKNOWN whether `tabs.query` honours the `url` + `windowType` filter for an extension URL
  (js/ext-utils.js:44-47). If it never matches, every click opens a new report tab instead of focusing
  the existing one; either way the request payload is the same.
- The popup sends this only if `new URL(currentTab.url)` parses and the click is trusted (js/popup.js:229-236).

### 4.6 Popup: direct browser-API calls and exact order per user action

**Open** (js/popup.js:298-347): `tabs.query` → URL checks (§4.1) → `popupPanelData`.

**Change level to L** (click on a slider stop js/popup.js:181-192, or mouse-up after drag js/popup.js:142-157;
both run `commitFilteringMode`, js/popup.js:60-111):
1. Nothing happens if `tabURL.hostname === ''` (js/popup.js:61). Upstream quirk: `tabURL` starts as
   `new URL(runtime.getURL('/'))` (js/popup.js:31), whose hostname is the extension's own host, not `''`;
   the guard therefore does not protect the "no data" state. What prevents a commit there is CSS only:
   the slider carries `needData` (popup.html:21) and `body.nodata .needData { visibility: hidden; }`
   (css/popup.css:76-78). The React popup must not offer the level control without valid panel data,
   so that it never sends `setFilteringMode` for the extension's own hostname.
2. If `L > 1`:
   a. if `beforeLevel <= 1`: send `setPendingFilteringMode` (§4.2), not awaited (js/popup.js:66-76);
   b. `granted = await browser.permissions.request({ origins: [ '*://*.' + hostname + '/*' ] })` inside
      try/catch (js/popup.js:77-83). This call is made in the same synchronous run as the user event:
      nothing is awaited before it (js/popup.js:45-57, 60-81). It is made for EVERY change to level 2 or 3,
      including 2→3 and when broad permission is already held (js/popup.js:66, 77-81).
   c. if `granted !== true`: show `beforeLevel` again and stop; no further message (js/popup.js:84-87).
      A rejected request (for example an invalid pattern such as `*://*.[::1]/*` for an IPv6 host) is
      caught and counts as not granted (js/popup.js:78-83).
3. `actual = await setFilteringMode({ hostname, level: L })` (js/popup.js:93-97).
4. If `actual !== L` show `actual` (js/popup.js:98-100).
5. If `actual !== beforeLevel && popupPanelData.autoReload`: the choice is made at once,
   `justReload = (tabURL.href === currentTab.url)` (js/popup.js:102). After 437 ms →
   `browser.tabs.reload(currentTab.id)` if `justReload`, else
   `browser.tabs.update(currentTab.id, { url: tabURL.href })` (js/popup.js:103-109). The second form
   happens on the strict-block page, and whenever the tab's `url` string differs from its `URL`-normalised
   form. `autoReload` is the value from `popupPanelData` at open; later changes are not seen.
For `L` of 0 or 1 there is no permission request and no pending message (js/popup.js:66).
(audit) Upstream failure chain the bridge must break: an `undefined` answer to `setFilteringMode` is
written to the slider (`dataset.level = undefined`, js/popup.js:47, 99). The next commit then parses
`NaN` (js/popup.js:64) and sends `{ level: NaN }`, which resets the site to the default
(§1.6 item 5).

Details of the two entry points:
- `beforeLevel` is the level shown when the gesture started (`data-level-before`, written at
  js/popup.js:165 for a drag and js/popup.js:187 for a click); `afterLevel` is the level shown when it
  ended (js/popup.js:64-65). Both are parsed with `parseInt(…, 10)`, so the message carries numbers.
- A click on the stop that is already current is NOT filtered out: the handler has no equality test
  (js/popup.js:181-192), so the whole sequence runs with `afterLevel === beforeLevel` — including the
  permission request when that level is 2 or 3 — and the background answers `setFilteringMode` without
  writing anything (bg:519). No reload follows because `actual === beforeLevel` (js/popup.js:101).
- The click path wraps the sequence in `body.busy` (js/popup.js:55-57); the drag path does not
  (js/popup.js:150).
- (audit) A press and release of the thumb (left button) with no movement is also a full commit. The
  `mouseup` handler calls `commitFilteringMode()` whenever the slider was in `moving` state
  (js/popup.js:142-150, 159-171), with `afterLevel === beforeLevel`. This is the same as the "click on
  the current stop" case: at level 2 or 3 it issues `permissions.request` (no pending message, because
  `beforeLevel > 1`) and then `setFilteringMode`. The release on the thumb does not also fire the stop
  click handler: the thumb is a `div`, not a `span[data-level]` (popup.html:22-26, js/popup.js:181-184).
  Only the left button starts or ends a drag (js/popup.js:143, 160).
- While dragging, intermediate levels are only displayed; nothing is sent until mouse-up
  (js/popup.js:120-134, 142-157). In RTL the dragged position is mirrored: `level = 3 - level`
  (js/popup.js:124-126).

**Zapper** (js/popup.js:257-264): if `browser.scripting` exists,
`browser.scripting.executeScript({ files: [ '/js/scripting/tool-overlay.js', '/js/scripting/zapper.js' ], target: { tabId: currentTab.id } })`
(not awaited), then `self.close()`.

**Picker** (js/popup.js:268-279):
`browser.scripting.executeScript({ files: [ '/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/picker.js' ], target: { tabId: currentTab.id } })`,
then `self.close()`.

**Unpicker** (js/popup.js:283-294):
`browser.scripting.executeScript({ files: [ '/js/scripting/css-procedural-api.js', '/js/scripting/tool-overlay.js', '/js/scripting/unpicker.js' ], target: { tabId: currentTab.id } })`,
then `self.close()`.

(audit) The three tool handlers check neither `ev.isTrusted` nor `ev.button` (js/popup.js:257, 268, 283).
`executeScript` is not awaited and its rejection is not handled, so the popup closes even when injection
fails. When `browser.scripting` is `undefined` the handler returns BEFORE `self.close()`, and the popup stays
open.

**Report** (js/popup.js:229-245): `gotoURL` (§4.5) for trusted clicks. There is no `ev.button` test
(js/popup.js:230), but `click` fires only for the primary button, so the effect is the same. No `self.close()`.

**Dashboard** (js/popup.js:249-253): `runtime.openOptionsPage()` for trusted left clicks. No message.

**Matched rules** (js/popup.js:218-225): `showMatchedRules` (§4.4).

The popup does not read or write storage and has no BroadcastChannel listener (js/popup.js, whole file).

---

## 5. Settings pane

State holder upstream: the response of `getOptionsPageData` is stored as `self.cachedRulesetData` and
mutated by broadcasts (js/settings.js:327, 333, 249-323); the Filter lists pane and backup read the same
object (js/filter-lists.js:132-133, js/settings.js:138).

### 5.1 `getOptionsPageData`

- Sender: js/settings.js:329-331, once at page load.
- Request: `{ what: 'getOptionsPageData' }`.
- Response (bg:423-441):
  ```
  { hasOmnipotence: boolean,                 // js/ext-utils.js:33-38
    defaultFilteringMode: 0|1|2|3,           // js/mode-manager.js:360-362
    enabledRulesets: string[],               // enabled static ruleset ids + ids of enabled imported lists (js/ruleset-manager.js:548-557)
    adminRulesets: string[],                 // "+id"/"-id" tokens (js/admin.js:171-205)
    maxNumberOfEnabledRulesets: number,      // dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS (safari/ext-compat.js:144); numeric value on Safari UNKNOWN
    rulesetDetails: RulesetDetails[],        // §3.4, stock + imported
    autoReload: boolean,
    showBlockedCount: boolean,
    canShowBlockedCount: boolean,            // typeof dnr.setExtensionActionOptions === 'function' (bg:143)
    strictBlockMode: boolean,
    popupBlockMode: boolean,
    firstRun: boolean,                       // always false: bg:422 sets it false before bg:435 reads it
    isSideloaded: boolean,                   // js/debug.js:37-40
    developerMode: boolean,
    disabledFeatures: string[] | undefined,
    supportsCompiledFilters: boolean,        // false on Safari (safari/ext-offscreen.js:25)
    supportsUserScripts: boolean }           // js/ext.js:40-44
  ```
- Side effect: `process.firstRun = false` (bg:422).
- Failure upstream: a falsy response leaves the page in its `loading` state and the BroadcastChannel
  listener is never installed (js/settings.js:332, 348-350).
- Upstream use: `supportsUserScripts` / `supportsCompiledFilters` become the tokens `user-scripts` /
  `compiled-filters` of `body[data-supports]` (js/settings.js:334-341); `disabledFeatures` →
  `body[data-forbid]`, and `dashboard` in it forces the About pane (js/settings.js:29-36);
  show-blocked-count checkbox is unchecked+disabled when `canShowBlockedCount` is false
  (js/settings.js:50-58); strict-block checkbox is `hasOmnipotence && strictBlockMode` and disabled without
  `hasOmnipotence` (js/settings.js:60-65); developer checkbox (and `body[data-develop]`) is
  `Boolean(developerMode) && disabledFeatures?.includes('develop') !== true` (js/settings.js:72-77; the
  `?.` matters because `disabledFeatures` is usually `undefined`);
  default mode radio = `defaultFilteringMode`, with no radio checked when it is 0 (js/settings.js:82-89).

### 5.2 `setDefaultFilteringMode`

- Sender: js/settings.js:100-103 (level 1) and 113-116 (levels 2, 3). The upstream UI only offers
  1, 2, 3 (dashboard.html radio values; js/settings.js:95, 98-124).
- Request: `{ what: 'setDefaultFilteringMode', level: newLevel }` — `level: number`.
- Handler (bg:533-540): `afterLevel = setDefaultFilteringMode(level)`; if it differs from the level
  before, awaits `registerContentScripts()` + `registerUserScripts()`; returns `afterLevel`.
- Response: `number` 0..3, the default level now in force.
- Side effects: `'all-urls'` moves to the target set, whose previous content is cleared first
  (js/mode-manager.js:155-189); then the same writes and broadcast as §4.3
  (js/mode-manager.js:304-322). The write + broadcast happen even when the level did not change
  (js/mode-manager.js:351-356 always calls `writeFilteringModeDetails`).
- State: FULL desired default level.
- No permission check in the background (bg:533-540).
- Exact upstream order (js/settings.js:93-126):
  - level 1: send message → `data.defaultFilteringMode = response` → re-render.
  - level 2 or 3: `granted = await browser.permissions.request({ origins: [ '<all_urls>' ] })`
    (first statement of the handler for these levels, no `await` before it; no try/catch)
    → if granted: send message → `data.defaultFilteringMode = response; data.hasOmnipotence = true`
    → re-render. If not granted: no message; re-render restores the previous radio.
- Failure upstream: an `undefined` response is stored as the level and the re-render then throws
  (js/settings.js:104, 82-86). A rejected `permissions.request` rejects the handler before re-render
  (js/settings.js:109-111, 125). The radio the user clicked then STAYS checked although nothing was sent.
  The bridge/UI must surface both errors and show the level actually in force.
- (audit) A radio `change` for the level that is already the default cannot happen upstream, because a
  checked radio does not fire `change`. The React control must also send nothing when the user selects
  the current default. Sending it anyway would still write and broadcast (see "Side effects" above).

### 5.3 The five boolean settings

Common: request is `{ what: <name>, state: boolean }`; each value is the FULL desired state; the UI
upstream does not await or read the response and does not update its cached state itself — the cached
value changes only when the broadcast echo arrives (js/settings.js:196-228, 270-303).

| `what` | Sender | Handler | Response | Background effect |
|---|---|---|---|---|
| `setAutoReload` | js/settings.js:196-201 | bg:461-465 | `undefined` | `rulesetConfig.autoReload = state && true \|\| false`; save config; broadcast `{ autoReload }` |
| `setShowBlockedCount` | js/settings.js:203-208 | bg:467-476 | `undefined` | set config; if `canShowBlockedCount`: `dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: state })`; save; broadcast `{ showBlockedCount }` |
| `setStrictBlockMode` | js/settings.js:210-215 | bg:478-481 | `undefined` | `setStrictBlockMode(state)` (js/ruleset-manager.js:342-357): no-op if unchanged; else set + save, when turning off remove `excludedStrictBlockHostnames` (local + session), then rebuild session rules. Broadcast `{ strictBlockMode }` in all cases |
| `setPopupBlockMode` | js/settings.js:217-222 | bg:483-487 | `undefined` | `setPopupBlockMode(state)` (js/prevent-popup.js:65-72): no-op if unchanged; else store the raw value + save. Then ALWAYS `registerContentScripts()`; broadcast `{ popupBlockMode }` |
| `setDeveloperMode` | js/settings.js:224-228 | bg:489-490 → bg:264-270 | `boolean` (new value) | `developerMode = (state === true)`; toggle rule-match listener (no-op on Safari, §17); broadcast `{ developerMode }`; save |

- After sending `setDeveloperMode` the upstream UI immediately sets `body.dataset.develop = String(state)`
  (js/settings.js:227), which shows/hides the Develop tab (css/dashboard.css:47).
- `setDeveloperMode` does not re-apply user DNR rules; those are only effective in developer mode and
  are re-read on the next `updateUserDnrRules` (js/ruleset-manager.js:758-760).
- Failure: `setShowBlockedCount` calls `dnr.setExtensionActionOptions` synchronously before saving
  (bg:469-474); if the native function is missing on Safari the handler throws → no response, nothing
  saved, no broadcast. Whether Safari implements it is UNKNOWN (safari/ext-compat.js:216-218 only forwards).
  Evidence that it does: the background makes the very same call during every session start
  (bg:785-789, inside `startSession()`), where a throw would fail start-up (bg:839-855). This is an
  inference from the code, not a runtime check.
- The `state` values upstream sends are always real booleans (`ev.target.checked`, js/settings.js:199, 206,
  213, 220, 225). The background coerces differently per message: `state && true || false` for
  `setAutoReload` / `setShowBlockedCount` (bg:462, 468), `Boolean(state)` for the comparison in
  `setStrictBlockMode` / `setPopupBlockMode` (js/ruleset-manager.js:343, js/prevent-popup.js:66),
  `state === true` for `setDeveloperMode` (bg:265). Send booleans only.
- Safari: the strict-block row is hidden (`dashboard.html:100` `data-platform-exclude="safari"`,
  css/settings.css:104, `body.dataset.platform = webextFlavor` js/dashboard.js:33). The flag can still be
  set by restore (§7.2) but no strict-block rule is ever created on Safari (js/ruleset-manager.js:272).

---

## 6. Filter lists pane

### 6.1 `getEnabledRulesets`

- Sender: js/filter-lists.js:128 (also js/troubleshooting.js:69). Request: `{ what: 'getEnabledRulesets' }`.
- Response: `string[]` = `dnr.getEnabledRulesets()` followed by the ids of enabled imported lists
  (js/ruleset-manager.js:548-557). Includes rulesets forced on by admin tokens (js/ruleset-manager.js:617-625).

### 6.2 `getRulesetDetails`

- Sender: js/filter-lists.js:129 (also js/troubleshooting.js:70, js/develop.js:54).
  Request: `{ what: 'getRulesetDetails' }`.
- Response: `RulesetDetails[]` (§3.4), stock entries in file order then imported entries (bg:447-450,
  js/ruleset-manager.js:78-89).
- Failure: if `/rulesets/ruleset-details.json` cannot be fetched, the handler throws → no response
  (js/fetch.js:26-32 resolves `undefined`, then js/ruleset-manager.js:87 calls `.concat` on it).

Both are sent together (`Promise.all`) on the first display of the pane and again on every
BroadcastChannel message carrying `enabledRulesets` or a changed `adminRulesets`
(js/filter-lists.js:120-130, 565; js/settings.js:305-322). Upstream then overwrites
`cachedRulesetData.enabledRulesets` and `.rulesetDetails` (js/filter-lists.js:132-133).

### 6.3 `applyRulesets`

- Senders: js/filter-lists.js:450-457; js/backup-restore.js:147-150.
- Request: `{ what: 'applyRulesets', enabledRulesets: string[], toRemove?: string[] }`.
  - `enabledRulesets`: the COMPLETE list of ruleset ids that must be enabled afterwards (stock ids and
    imported-list URLs). Everything currently enabled and absent from the list is disabled
    (js/ruleset-manager.js:605-636).
  - `toRemove`: ids (URLs) of imported lists to delete from storage after applying (bg:384-386).
- Handler (bg:382-388 → bg:239-260):
  1. `enableRulesets(ids)` (js/ruleset-manager.js:605-703): applies admin `+`/`-` tokens on top of the
     request; computes enable/disable sets against the current state; drops ids unknown to
     `rulesetDetails`; calls `dnr.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds })` for stock
     ids; refreshes dynamic/session rules; flips the `enabled` flag of imported lists.
  2. If something changed: `rulesetConfig.enabledRulesets = result.enabledRulesets`, save config,
     re-register content scripts (stock change) and/or recompile imported filters (imported change)
     (bg:243-258).
  3. ALWAYS: broadcast `{ enabledRulesets: rulesetConfig.enabledRulesets }` (bg:259).
  4. If `toRemove` is truthy: `removeImportedLists(toRemove)` (bg:384-386, js/imported-lists.js:225-232).
- Response: ALWAYS `undefined` (bg:387). The DNR error string collected in
  `enableRulesets` (`response.error`, js/ruleset-manager.js:596-600, 676-679) is never returned.
  Consequently `dom.text('#dnrError', result?.error || '')` (js/filter-lists.js:457-458) always clears the
  error line; a failed enable is visible only through the next `getEnabledRulesets` read triggered by the
  broadcast.
- State: FULL list (plus an optional delete list).
- What upstream puts in `enabledRulesets` (js/filter-lists.js:429-438): the `rulesetid` of every leaf
  entry whose checkbox is checked, EXCLUDING entries forced by admin (`fromAdmin`).
  (audit) Details of that rule:
  - A stock leaf is `fromAdmin` when `isAdminRuleset(id)` holds (js/filter-lists.js:106-116, 168-174).
    That function tests by PREFIX, not equality: a token matches when `token.indexOf(id)` is 0, or is 1
    with a leading `+`/`-`. Example: the token `+easylist-foo` also marks `easylist`. No two PRISTINE
    ids are prefixes of each other, so with the shipped ids and well-formed tokens this equals an exact
    match.
  - Imported leaves are never `fromAdmin` (js/filter-lists.js:167).
  - Ids forced on with `+` are re-added by the background (js/ruleset-manager.js:617-625), so leaving
    them out of the payload does not disable them.
  - Leaves marked for removal are unchecked, so they are not in the list (js/filter-lists.js:501-507).
- (audit) Baseline of the "differs" test: `visuallyEnabledRulesets`. It holds the ids that were enabled
  at the LAST RENDER (js/filter-lists.js:135, 145-148). A render happens only on first display and on
  a broadcast (§6.2). The successful send itself does not move the baseline. Upstream relies on the
  `{ enabledRulesets }` echo (bg:259) to re-render. If the echo never arrives (U13), the following
  sequence loses the second change: tick list X → after 997 ms `applyRulesets` with X → untick X →
  ids now equal the stale baseline → nothing is sent, and X stays enabled. A React pane that copies
  this test must update its baseline from the echo, as upstream does, and §21 checks the result.
- (audit) Limit: when the number of checked stock leaves equals `maxNumberOfEnabledRulesets`,
  `body.noMoreRuleset` makes every unchecked leaf inert (js/filter-lists.js:61-63,
  css/settings.css:227-230). When the value is `undefined` (possible on Safari, U4) the limit never
  applies.
- When upstream sends it (js/filter-lists.js:425-486):
  - 997 ms after the last checkbox change (debounce; restarts if a commit is still running).
  - Only if the id set differs from the set enabled at the last render, or (final run) there is
    something to remove (js/filter-lists.js:446-449).
  - `toRemove` is included only in the "final" run triggered by `beforeunload`
    (js/filter-lists.js:454-456, 466-471).
  - Upstream quirk: the `beforeunload` handler returns WITHOUT sending when a debounce timer is pending
    (js/filter-lists.js:466-467), so changes made less than 997 ms before leaving are lost, and imported
    lists marked for removal are only deleted when the page is left with no timer pending.
- HAZARD (js/ruleset-manager.js:642-658 with bg:243-245): when every id that would change state is
  unknown to `rulesetDetails`, the background stores `rulesetConfig.enabledRulesets = undefined`. The
  typical case is the current enabled list plus one or more unknown ids. In that case the unknown ids
  are dropped and `stockUpdated` (or `importedUpdated` for URL-like ids) is set to `true`. The function
  returns early WITHOUT an `enabledRulesets` field, and bg:244 copies that `undefined`. The broadcast
  is then `{ enabledRulesets: undefined }`, which the settings listener ignores (`!== undefined` test,
  js/settings.js:312), so no page re-renders. Never send an id that is not in the current
  `getRulesetDetails` response. (The same `undefined` is stored if the final `getEnabledRulesets` in
  js/ruleset-manager.js:691-700 fails after a real change.)
  Consequence traced in the code (not runtime-verified): the saved config then has no usable
  `enabledRulesets`; at the next session start (only when session storage holds no `rulesetConfig`,
  i.e. `process.wakeupRun === false`, bg:819-824, js/config.js:52-58) the background runs
  `enableRulesets(rulesetConfig.enabledRulesets)` (bg:728-736) with the built-in default `[]`
  (js/config.js:32, 59-61) or a nullish value, both of which mean "nothing requested"
  (`new Set(ids)`, js/ruleset-manager.js:606), so every enabled ruleset that is not forced by an admin
  token is DISABLED (js/ruleset-manager.js:633-636, 670-674). That is blocking silently turned off.
  (audit) If the value comes back as `null` and the extension version changed, `patchDefaultRulesets`
  iterates it (`for … of null` throws, js/ruleset-manager.js:522). `startSession` then rejects, and the
  `goodStart` / `runtime.reload()` path of bg:839-855 runs.
- HAZARD: an empty `enabledRulesets: []` is a valid request and disables every ruleset
  (js/ruleset-manager.js:605-636). The bridge must never send `applyRulesets` built from data that has
  not finished loading.
- `enabledRulesets` missing or not iterable-as-ids: `new Set(undefined)` is the empty set
  (js/ruleset-manager.js:606), i.e. the same as `[]` above — everything is disabled.

### 6.4 `importFilterList`

- Sender: js/filter-lists.js:490-499. Request: `{ what: 'importFilterList', url: string }`. Upstream sends
  only if `/^[a-z-]+:\/\/(?:\S+\/\S*|\/\S+)/m.test(url)` (js/filter-lists.js:493).
- Handler (bg:640-647): adds an entry to local `rulesets.imported` if absent
  (js/imported-lists.js:185-221; initial entry `{ id: url, name: url, group: 'imported', enabled: false,
  homeURL: '', expires: 7, time: { added: Date.now(), updated: 0 }, filters: { total: 0, accepted: 0, rejected: 0 },
  rules: { total: 0, plain: 0, regex: 0 } }`), then runs the `applyRulesets` logic with the currently enabled
  ids plus `url` (bg:643-645), which broadcasts `{ enabledRulesets }`. `addImportedLists` always
  resolves `true` (js/imported-lists.js:220), so the `break` at bg:642 is unreachable and the
  `applyRulesets` step runs even when the URL was already imported.
- Response: `undefined`. State: additive (one list).
- (audit) Upstream page side (js/filter-lists.js:490-499): sets `body.committing` while the message is
  in flight. A pending 997 ms commit that falls due meanwhile is postponed by another 997 ms
  (js/filter-lists.js:479-480). Afterwards the page closes the `<details>` and clears the input. A failed
  send is not reported.
- Safari: nothing is ever fetched or compiled for imported lists (js/compiled-filters.js:270-271, 281-282,
  safari/ext-offscreen.js:25), and the import control plus the "imported" group are hidden when
  `supportsCompiledFilters` is false (css/settings.css:267-268). The React pane must not offer import
  when `supportsCompiledFilters` is false.

### 6.5 Storage used by the pane

Local key `hideUnusedFilterLists` (§12). No other direct API call.

---

## 7. Backup, Restore, Reset (Settings pane)

All three run in the dashboard page (js/settings.js:136-192, js/backup-restore.js). Nothing reloads the
page afterwards; visible state changes only through the broadcast echoes (§11).

### 7.1 Backup (`backupToObject(currentConfig)`, js/backup-restore.js:36-88)

`currentConfig` is the page's cached options object (js/settings.js:138): its `autoReload`,
`developerMode`, `popupBlockMode`, `showBlockedCount`, `strictBlockMode`, `enabledRulesets` are read.

Order of operations:
1. `runtime.getManifest()` → `out.version = manifest.versionName ?? manifest.version` (js/backup-restore.js:38-39).
2. In parallel: `{ what: 'getDefaultConfig' }` and `{ what: 'getSandboxFilters' }` (result `a?.trim() ?? ''`)
   (js/backup-restore.js:40-46).
3. For each of `autoReload`, `developerMode`, `popupBlockMode`, `showBlockedCount`, `strictBlockMode`:
   written to `out` only if different from the default (js/backup-restore.js:47-61).
4. `out.rulesets` (only if non-empty): `"+id"` for each enabled id not in `defaultConfig.rulesets`,
   then `"-id"` for each default id not enabled (js/backup-restore.js:62-74).
5. `out.filteringModes = await { what: 'getFilteringModeDetails' }` (always set; js/backup-restore.js:75).
6. `{ what: 'getAllCustomFilters' }` → `out.customFilters` if non-empty (js/backup-restore.js:76-79).
7. `out.sandboxFilters = sandboxFilters.split('\n')` if the text is non-empty (js/backup-restore.js:80-82).
8. `localRead('userDnrRules')`; if a non-empty string → `out.dnrRules = text.split(/\n+/)` (js/backup-restore.js:83-86).

File produced (js/settings.js:136-146): `JSON.stringify(out, null, 2) + '\n'`, offered through an `<a>`
with `href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(json)`, `download="my-ubol-settings.json"`,
`type="application/json"`, then `a.click()`. Nothing is offered when the result is not an object
(js/settings.js:139).

Failure upstream (audit: corrected; not every failure throws):
- `getDefaultConfig` nullish → throws at js/backup-restore.js:47 → unhandled rejection, no file, no
  message to the user.
- `getAllCustomFilters` nullish → throws at :77, same outcome.
- `currentConfig.enabledRulesets` not iterable (cache never loaded) → throws at :64, same outcome.
- `getSandboxFilters` nullish → NOT an error: it becomes `''` (:45), the normal "nothing stored" case.
- `getFilteringModeDetails` nullish → NO error. `out.filteringModes = undefined` is dropped by
  `JSON.stringify`, so the file is written WITHOUT `filteringModes`. Restoring that file later resets
  every per-site mode and the default to the factory table (§7.2 step 11). The bridge must reject a
  nullish answer here (it is in `NEVER_NULLISH_ON_SUCCESS`), so that no incomplete file is produced.
- The toggles and the enabled list come from the page cache, which only the broadcast echoes keep
  current (§11.2). If the echoes do not arrive (U13), the backup describes the state at page load.

#### `getDefaultConfig`
- Request: `{ what: 'getDefaultConfig' }`. Response (bg:390-401):
  ```
  { autoReload: true, developerMode: false, showBlockedCount: true,
    strictBlockMode: boolean,      // false on Safari (js/config.js:35)
    popupBlockMode: true,
    rulesets: string[],            // default-enabled stock ids + stock ids whose `lang` matches a browser/UI language
                                   // + ids tagged `mobile` on a mobile UA (js/ruleset-manager.js:440-486)
    filteringModes: { none: [], basic: [], optimal: ['all-urls'], complete: [] } }   // js/mode-manager.js:58-63
  ```
  Values come from `defaultConfig`, a copy of the built-in defaults (js/config.js:30-41). Read-only.

#### `getSandboxFilters`
- Request: `{ what: 'getSandboxFilters' }`. Response: `string`, or `undefined` when local key
  `sandboxFilters` is absent (bg:621-622, js/filter-manager.js:313-315, js/ext.js:59-67).

#### `getFilteringModeDetails`
- Request: `{ what: 'getFilteringModeDetails' }`. Response: serialised mode table §3.3 (bg:542-543,
  js/mode-manager.js:326-335). Includes admin overrides already applied (js/mode-manager.js:262-295).

#### `getAllCustomFilters`
- Request: `{ what: 'getAllCustomFilters' }`. Response: `Array<[hostname: string, selectors: string[]]>`,
  one pair per local key `site.<hostname>` (bg:578-579, js/filter-manager.js:99-114). Selectors are in
  stored ("compiled") form; procedural ones are JSON strings starting with `{` (js/filter-manager.js:40-41).

### 7.2 Restore (`restoreFromObject(targetConfig)`, js/backup-restore.js:92-215)

File reading (js/settings.js:148-183): the chosen file is read as text and `JSON.parse`d; anything that
is not an object ends the operation silently. The picker is the first `input[type="file"]` of the
settings section (js/settings.js:150), declared with `accept="application/json"` (dashboard.html:109);
its value is reset to `''` before `click()` so that picking the same file again fires `change`
(js/settings.js:175-179). `body.busy` is set when a file is chosen (js/settings.js:152) and removed when
the operation ends or the dialog is cancelled (js/settings.js:172-174, 181-182). (audit) While
`body.busy` is set, the dashboard hides every pane and shows only the spinner section
(css/dashboard.css:64-71). Upstream quirks: there is no `FileReader.onerror` handler, so a read
error leaves `busy` on for good (js/settings.js:156-170). A rejection inside `restoreFromObject`
propagates through `await promise` (js/settings.js:181), so `busy` is never removed either. Each step
below is awaited before the next; `T` = `targetConfig`, `D` = response of step 1.

| # | Operation | Exact payload / call | Source |
|---|---|---|---|
| 1 | message | `{ what: 'getDefaultConfig' }` | :93 |
| 2 | message | `{ what: 'setAutoReload', state: T.autoReload ?? D.autoReload }` | :95-98 |
| 3 | message | `{ what: 'setShowBlockedCount', state: T.showBlockedCount ?? D.showBlockedCount }` | :100-103 |
| 4 | message | `{ what: 'setDeveloperMode', state: T.developerMode ?? D.developerMode }` | :105-108 |
| 5 | message | `{ what: 'setStrictBlockMode', state: T.strictBlockMode ?? D.strictBlockMode }` | :110-113 |
| 6 | message | `{ what: 'setPopupBlockMode', state: T.popupBlockMode ?? D.popupBlockMode }` | :115-118 |
| 7 | compute | `enabled = D.rulesets`; for each entry of `T.rulesets \|\| []`: `"+id"` appends `id` if absent, `"-id"` removes `id` if present | :120-131 |
| 8 | page-side storage | read local `rulesets.imported` (array, default `[]`) | :132, js/imported-lists.js:78-81 |
| 9 | page-side storage | `toAdd` = ids in `enabled` matching `/^[a-z-]+:\/\//` and not yet imported; `toRemove` = imported ids not in `enabled`. If `toRemove` non-empty → remove them; then if `toAdd` non-empty → add them (see below) | :133-146 |
| 10 | message | `{ what: 'applyRulesets', enabledRulesets: Array.from(enabled) }` (no `toRemove`) | :147-150 |
| 11 | message | `{ what: 'setFilteringModeDetails', modes: T.filteringModes ?? D.filteringModes }` | :152-155 |
| 12 | message | `{ what: 'removeAllCustomFilters', hostname: '*' }` | :157 |
| 13 | message (conditional) | legacy: if `Array.isArray(T.cosmeticFilters)`, split each line at the first `##` into hostname/selector (skip lines without `##`, empty hostname or empty selector), group by hostname; if any → `{ what: 'addManyCustomFilters', entries: Array.from(map) }` | :158-179 |
| 14 | message (conditional) | for each `[hn, selectors]` of `T.customFilters ?? []`: selectors starting with `+js` are moved to a sandbox list as `hn + '##' + selector`, the rest kept; if any kept → `{ what: 'addManyCustomFilters', entries: kept }` | :180-199 |
| 15 | message | if `T.sandboxFilters` is truthy, append `''` and `T.sandboxFilters.join('\n')` to the sandbox list; ALWAYS send `{ what: 'setSandboxFilters', text: sandboxList.join('\n') }` | :200-205 |
| 16 | page-side storage | `dnr = T.dnrRules ?? []`; non-empty → `localWrite('userDnrRules', dnr.join('\n'))`; else `localRemove('userDnrRules')` | :207-212 |
| 17 | message | `{ what: 'updateUserDnrRules' }` | :213 |

(Sources in the last column are lines of js/backup-restore.js unless another file is named.)

Step 9 runs imported-list code INSIDE THE PAGE, not in the background (js/backup-restore.js:22-26, 141-146):
- remove (js/imported-lists.js:225-232): filter the array; if anything was removed, save.
- add (js/imported-lists.js:185-221): append the entry shape quoted in §6.4 for each new URL; save if the
  array grew.
- save (js/imported-lists.js:113-126): delete every local key `rulesets.imported.compiled.<id>` whose list
  is not enabled (keys found via `storage.local.getKeys()` or `get(null)`, js/ext.js:79-87,
  js/imported-lists.js:42-51); `localWrite('rulesets.imported', lists)`; reschedule the update job:
  with at least one enabled list → `registerJob('updateImportedLists', earliest time.updated + expires days)`,
  otherwise `removeJob('updateImportedLists')` (js/imported-lists.js:55-67).
- job bookkeeping (js/alarms.js:31-63): local key `deferredJobs` (`Array<{ name: string, time: number }>`,
  sorted by time) plus `browser.alarms.create('deferredJobs', { when: Math.max(jobs[0].time, Date.now() + 300000) })`
  or `browser.alarms.clear('deferredJobs')` when the list is empty. (audit) `registerJob` always
  re-arms the alarm and writes the key (js/alarms.js:41-52). `removeJob` touches neither the alarm nor
  the key when no job of that name was present (js/alarms.js:57). When it removes the last job it
  clears the alarm and REMOVES the key (js/alarms.js:58-62).
- Upstream quirk: `removeJob` calls `.filter` on the stored value without a default (js/alarms.js:55-56);
  if `deferredJobs` is absent, step 9 rejects and the restore stops after step 6. `removeJob` is reached
  whenever the saved array has no enabled list (js/imported-lists.js:55-67) — which is always the case
  right after an add, because new entries start with `enabled: false` (js/imported-lists.js:198).
  The key is normally present: every content-script registration in the background schedules the
  `pruneCSSCache` job through `registerJob`, which creates the array (js/scripting-manager.js:362-365,
  js/alarms.js:41-52). It is briefly absent after the job runner has emptied it (js/alarms.js:76-81) until
  the `pruneCSSCache` handler re-registers itself (js/scripting-manager.js:379-380).
- Step 9 does nothing at all (no storage write, no alarm call) when both `toAdd` and `toRemove` are empty
  (js/backup-restore.js:141-146); step 8's read still happens.
On Safari imported lists normally do not exist (import UI hidden, §6.4), so step 9 only does something
when the backup file contains `"+<url>"` ruleset entries.

Notes:
- Restore never calls `browser.permissions.request` (js/backup-restore.js:92-215). Step 11 can set the
  default mode to optimal/complete without the permission; the background later downgrades through
  `syncWithBrowserPermissions` only on a permission event or session start (js/mode-manager.js:383-434,
  bg:749, 871-881).
- (audit: corrected) A failed (undefined) step-1 response throws at the first step whose `T.x` is
  nullish, because only then is `D.x` evaluated (`??` short-circuits, js/backup-restore.js:97-117).
  At the latest it throws at step 7 (`D.rulesets`, :120). For Reset (`T = {}`) that is step 2, and
  nothing is applied. For a file that sets all five toggles, steps 2-6 ARE applied before the throw.
- (audit) Restore does not validate the file. Wrong types throw in the middle, with the earlier steps
  already applied. Examples:
  - a non-string entry in `T.rulesets` (`entry.slice`, :122) throws at step 7;
  - a `T.customFilters` entry that is not a `[string, string[]]` pair (:182-185) throws at step 14;
  - a truthy non-array `T.sandboxFilters` (`.join`, :201) throws at step 15;
  - a non-array `T.dnrRules` (`.join`, :209) throws at step 16, if it has a non-zero `length`.
  A non-nullish `T.filteringModes` that is not a mode table (for example a string or `[]`) is sent
  as is. It has no `none`/`basic`/`optimal`/`complete` properties, so the background builds four empty
  sets (js/mode-manager.js:96-103) and stores them. Every per-site entry is lost, and with no
  `'all-urls'` anywhere the default becomes basic (js/mode-manager.js:125-131).
- Step 7 mutates the `rulesets` array of the step-1 response in place (js/backup-restore.js:120-131);
  a bridge that caches `getDefaultConfig` must hand out a copy.
- Order matters and is part of parity: `setDeveloperMode` (step 4) precedes `updateUserDnrRules`
  (step 17), and user DNR rule text is only applied while developer mode is on
  (js/ruleset-manager.js:758-760).
- No step is wrapped in try/catch (js/backup-restore.js:92-215): the first rejecting step ends the
  restore with the earlier steps already applied. With upstream's swallowing `sendMessage`
  (js/ext.js:51-55) a failed message does NOT reject, so upstream simply continues with the next step.
- UI wrapper upstream: `body.busy` during the operation (js/settings.js:152, 182).
- (bridge contract check) DEVIATION of the React bridge, accepted: upstream sends a
  file's toggle values (steps 2-6) and `filteringModes` (step 11) raw. `bridge.ts` rejects a `state`
  that is not a boolean and a `modes` that is not a plain object (`BridgeError` kind `bad-request`,
  nothing sent; §1.6 item 5, §21.1 item 5). For a file such as `{ "autoReload": "yes" }` or
  `{ "filteringModes": "x" }` the React restore therefore stops at that step instead of continuing,
  and must report the restore as only partly applied (settings.md §7.3). Upstream effect of the raw
  values, for comparison: toggles are coerced per message (bg:462, 468, 265; `setPopupBlockMode`
  stores the raw value, js/prevent-popup.js:70); a non-table `modes` empties every bucket.

#### `setFilteringModeDetails`
- Request: `{ what: 'setFilteringModeDetails', modes: { none: string[], basic: string[], optimal: string[], complete: string[] } }`.
- Handler (bg:545-551): normalise (remove from basic/optimal/complete every hostname equal to or below a
  `none` hostname, js/mode-manager.js:107-119), write local `filteringModeDetails`, rebuild the cache
  bypassing it (re-applies admin overrides, rewrites DNR allow rules, writes session copy;
  js/mode-manager.js:337-342, 241-300), re-register content scripts and user scripts, broadcast
  `{ defaultFilteringMode }` only (bg:548-549).
- Response: the serialised table now in force (bg:550).
- State: FULL replacement of the whole per-site table.
- Hazards: `modes` missing → handler throws (js/mode-manager.js:96-103) → no response; a table without
  `'all-urls'` in any set makes the default basic (js/mode-manager.js:125-131).

#### `removeAllCustomFilters`
- Request: `{ what: 'removeAllCustomFilters', hostname: string }`; `'*'` means every site
  (js/filter-manager.js:264-272). Response: `undefined` (bg:611-619).
- Effect: deletes local key(s) `site.<hostname>`; if anything was deleted, re-registers content scripts
  and recompiles/re-registers user scripts.

#### `addManyCustomFilters`
- Request: `{ what: 'addManyCustomFilters', entries: Array<[hostname: string, selectors: string[]]> }`.
  Entries with a non-string/empty hostname or a non-array/empty selector list are skipped (bg:591-594).
  (bridge contract check) But every entry is destructured first (`for (const [hostname, selectors] of
  request.entries)`, bg:590): a non-iterable `entries` or entry (`null`, a number, an object) throws, so
  the handler never answers. Reproduced by running the real background.js. The bridge rejects such a
  request before sending (`bad-request`).
- (bridge contract check) HAZARD, duplicate hostnames in one request: the accepted entries run
  concurrently (`Promise.all`, bg:595-597). Each `addCustomFilters` reads `site.<hostname>` before any
  of them writes (js/filter-manager.js:50-58, 247-260), so when a hostname appears twice the LAST
  entry's merge overwrites the earlier one. Reproduced with the real background.js: stored `[]`,
  entries `[['example.com', ['.b', '.a']], ['example.com', ['.a', '.c']]]` → stored `['.a', '.c']`
  (`.b` lost). Upstream restore step 13 groups by hostname (unique keys); step 14 passes the file's
  `customFilters` pairs through, so a hand-edited file with a repeated hostname loses selectors. The
  mock reproduces this.
- Effect: for each entry, selectors not already stored are added to local `site.<hostname>` and the list
  is sorted (js/filter-manager.js:247-260); if any entry changed, content scripts are re-registered.
- Response: `undefined` (bg:598-600). State: additive delta.

#### `setSandboxFilters`
- Request: `{ what: 'setSandboxFilters', text: string }`. Effect: trimmed text is written to local
  `sandboxFilters`, or the key is removed when empty (js/filter-manager.js:317-322); then compile +
  user-script registration (both no-ops on Safari, js/compiled-filters.js:270-271, 281-282) and
  `updateUserRules()` (bg:625-627). Response: `undefined`. State: FULL replacement text.

#### `updateUserDnrRules`
- Request: `{ what: 'updateUserDnrRules' }` (no payload; input is read from storage).
- Effect (js/ruleset-manager.js:745-822): reads local `userDnrRules` (used only when developer mode is on,
  :758-760), `sandboxFilters.dnrRules`, `importedFilters.dnrRules`; replaces all dynamic DNR rules with
  id ≥ 9000000; writes local `userDnrRuleCount` (number) or removes it.
- Response: `{ added: number, removed: number, errors: string[] }` (js/ruleset-manager.js:777, 808-812, 821).

### 7.3 Reset

`self.confirm(i18n.getMessage('resetToDefaultConfirm'))`; if confirmed, run the restore of §7.2 with
`targetConfig = {}` (js/settings.js:185-192). Every `T.x ?? D.x` therefore resolves to the default,
all imported lists are removed (step 9), all custom filters are removed (step 12), the sandbox text is
set to `''` (step 15) and `userDnrRules` is removed (step 16).

---

## 8. About pane and troubleshooting text

### 8.1 About header

`runtime.getManifest()` → text `manifest.name + ' ' + manifest.version` (js/dashboard.js:35-38).
UNKNOWN whether Safari returns the localised name ("Blocker", `PRISTINE/_locales/en/messages.json` key
`extName`) or the raw `__MSG_extName__` from `PRISTINE/manifest.json`.
(audit) The About pane's external links are plain `<a href="https://…">` elements given
`target="_blank"` by js/dashboard.js:40 (dashboard.html:174-191). They send NO message. Only
`report.html` uses `gotoURL` for external links (§4.5).

### 8.2 Troubleshooting (`getTroubleshootingInfo(details?)`, js/troubleshooting.js:52-157)

Triggered every time the `<pre>` after the `supportS5H` summary becomes visible (js/dashboard.js:58-66);
also used by `report.html` with `details = { hostname, siteMode, tabId }` (js/report.js:28-59, 97).

Sent in parallel (one `Promise.all`, js/troubleshooting.js:65-76):

| Call | Response type | Source |
|---|---|---|
| `runtime.getPlatformInfo()` | `{ os: string, … }`; only `os` is read (:100) | :66 |
| `{ what: 'getDefaultConfig' }` | §7.1 | :67 |
| `{ what: 'getCurrentConfig' }` | `rulesetConfig` §3.5 (bg:403-404) | :68 |
| `{ what: 'getEnabledRulesets' }` | `string[]` | :69 |
| `{ what: 'getRulesetDetails' }` | `RulesetDetails[]` | :70 |
| `{ what: 'getDefaultFilteringMode' }` | `number` 0..3 (bg:529-531) | :71 |
| `{ what: 'getEffectiveUserRules' }` | DNR rule objects with `id >= 9000000` (js/ruleset-manager.js:735-743) | :72 |
| `{ what: 'getConsoleOutput' }` | `string[]`, at most 32 lines `"[MMDD.HHMM]text"` (js/debug.js:44-79, 97-99) | :73 |
| `{ what: 'getRegisteredContentScripts' }` | `string[]` of registered content-script ids (js/scripting-manager.js:372-375) | :74 |
| `{ what: 'hasBroadHostPermissions' }` | `boolean` (js/ext-utils.js:33-38) | :75 |

Output object, in this key order (js/troubleshooting.js:103-155):
- `name: manifest.name`, `version: manifest.version` (:110-111);
- `browser` (audit: order corrected): on Safari `"Safari" + (UA contains "Mobile" ? " Mobile" : "") +
  " " + <major.minor from /\bVersion\/(\d+\.\d+)\b/ in navigator.userAgent, or "?"> + " (" + platformInfo.os + ")"`,
  e.g. `Safari 18.6 (mac)`, where the `os` string Safari reports is UNKNOWN (U18) (:77-102);
- `filtering: { site?: <mode name>, default: <mode name> }` with names
  `['no filtering', 'basic', 'optimal', 'complete']`; `site` only when `details.siteMode` is truthy (:103-108),
  so a site at level 0 gets no `site` line (upstream quirk);
- `permission: hasOmnipotence ? 'all' : 'ask'` (:114);
- `strictblock` / `popupblock`: present only when the current value differs from the default (:116-121);
- `badge`: only when `details.tabId` is truthy: `browser.action.getBadgeText({ tabId })` if
  `showBlockedCount` is on, else `'?'`; the key is written only when that value is truthy (an empty
  badge text adds no line) (:122-130) — report page only;
- `user rules`: count, only when non-zero (:131-133);
- `rules`: sum of `rules.total` over enabled rulesets (:134-136);
- `rulesets`: enabled ids, non-default ones prefixed `+`, plus default ones that are disabled prefixed `-`,
  sorted (:137-147);
- `scripting`: the id list, only when non-empty (:148-150);
- `console`: only when non-empty; last 8 lines when `details.siteMode` is truthy (:151-155).

Rendering (js/troubleshooting.js:26-48): indentation is one space per depth; an object value prints
`name:` then its content one level deeper; an array prints each element on its own line at the same depth
as its key's children; scalars print `name: value`.

Failure upstream: an `undefined` `getRulesetDetails` result throws inside the `.then` (:70) and rejects
the whole call; the `<pre>` stays empty (js/dashboard.js:60-65 has no catch). The same happens when any
other response is `undefined` and is then dereferenced (:116, :131, :134, :137, :148, :151), or when an
enabled id has no entry in the details map (`rulesetDetails.get(b).rules.total`, :134-136).
Note: the function MUTATES the `getEnabledRulesets` response array in place (prefixing ids, pushing
`-id` entries, sorting; :138-147); a bridge that caches responses must hand it a copy.
Safari: `console` never appears because the background never records lines (§17, item 8).

---

## 9. Messages used only by surfaces kept as upstream code (class B)

Documented so that nobody re-uses the names with different meaning.

| `what` | Request | Response | Effect / notes | Source |
|---|---|---|---|---|
| `addCustomFilters` | `{ hostname: string, selectors: string[] }` | `undefined` | additive merge into local `site.<hostname>`; re-registers content scripts if changed | bg:581-586, js/filter-manager.js:247-260 |
| `removeCustomFilters` | `{ hostname: string, selectors: string[] }` | `undefined` | removes the selectors from `site.<hostname>` AND from every parent-domain key | bg:603-609, js/filter-manager.js:279-309 |
| `customFiltersFromHostname` | `{ hostname: string }` | `string[]` sorted, own + parent domains | read-only | bg:631-632, js/filter-manager.js:69-88 |
| `getEnabledRulesetsDetails` | `{}` | `RulesetDetails[]` of enabled rulesets | read-only | bg:452-453, js/ruleset-manager.js:714-731 |
| `getRulesetRules` | `{ id: string }` | `undefined`, or `{ serialized: string or undefined }` for URL ids, or `{ rules: DnrRule[] }` | read-only | bg:455-456, js/ruleset-manager.js:561-580 |
| `getAllDynamicRules` | `{}` | DNR rules array | read-only | bg:566-567 |
| `getAllSessionRules` | `{}` | DNR rules array | read-only | bg:569-570 |
| `getMatchedRules` | `{ tabId: number }` | `[]` unless `isSideloaded`; else array of `{ request, rule }` (or `undefined` items) | read-only; on Safari uses `dnr.getMatchedRules({ tabId })` (js/debug.js:182-191); native support UNKNOWN | bg:556-557, js/debug.js:159-192 |
| `excludeFromStrictBlock` | `{ hostname: string, permanent: boolean }` | `undefined`, `{}` or `{ error: string }` | adds hostname to local (permanent) or session `excludedStrictBlockHostnames`, rebuilds session rules | bg:553-554, js/ruleset-manager.js:332-340, 361-401 |
| `getFilteringMode` | `{ hostname: string }` | `number` 0..3 | read-only; no upstream sender | bg:510-512 |
| `getImportedLists` | `{}` | imported list entries (§6.4 shape) | read-only; no upstream sender | bg:649-651, js/imported-lists.js:78-81 |

Other facts about these surfaces:
- (audit) These handlers are all in P3, so they answer only senders that pass the trust check
  (bg:376-378). Overlay iframes and the classic dashboard are extension pages and pass. A content
  script running in a web page (for example the `removeCustomFilters` forward in
  js/scripting/unpicker.js:38-42) is refused with `undefined` whenever the browser sets
  `sender.origin` to the page origin (U3).
- `strictblock.js` reads `currentConfig.popupBlockingMode` (js/strictblock.js:117), a key that does not
  exist in `rulesetConfig` (js/config.js:30-39), so its popup-blocking block never runs (upstream quirk).
- `matched-rules.html` takes the tab id from its own URL: `parseInt(searchParams.get('tab'), 10) || 0`
  (js/matched-rules.js:27-28).
- Custom filters pane also listens to `browser.storage.local.onChanged` for keys starting with `site.`
  and for `sandboxFilters` (js/filter-manager-ui.js:620-628).
- Develop pane: see §12 for its storage keys; `ModeEditor` sends `getFilteringModeDetails` /
  `setFilteringModeDetails` (js/mode-editor.js:56-68) and listens on the BroadcastChannel (§11).

### 9.1 What the upstream dashboard document does by itself (applies to `dashboard-classic.html`)

ARCHITECTURE §5 ships the upstream dashboard page unchanged under the name `dashboard-classic.html`.
Wherever that document is loaded (own tab or a frame inside the new dashboard) it runs ALL of its
controllers, not only Custom filters and Develop: its script list is fixed (dashboard.html:291-298) and
`js/settings.js` imports `js/filter-lists.js` (js/settings.js:25). It is therefore a second, independent
sender on the same channels. The same holds for `popup-classic.html`, which behaves exactly as §4.

| When (in that document) | What it does | Source |
|---|---|---|
| load | sets `body[data-platform]`; `runtime.getManifest()` for its About header | js/dashboard.js:33-38 |
| load | reads local `dashboard.activePane`; a string value becomes `body[data-pane]`. Initial value in the markup is `settings` | js/dashboard.js:52-55; dashboard.html:22 |
| click on one of its nav buttons | sets `body[data-pane]`; writes the pane id to local `dashboard.activePane`, or removes the key for `settings` | js/dashboard.js:42-50 |
| load | sends `getOptionsPageData`; on success sets `body[data-supports]`, `body[data-forbid]` (forcing `data-pane="about"` when `dashboard` is forbidden), `body[data-develop]`, then opens its own `BroadcastChannel('uBOL')` listener | js/settings.js:329-353, 29-36, 72-77, 244-247 |
| load | reads local `hideUnusedFilterLists` | js/filter-lists.js:380-388 |
| first time its `section[data-pane="rulesets"]` is visible | sends `getEnabledRulesets` + `getRulesetDetails`; afterwards re-sends both on every broadcast carrying `enabledRulesets` or a changed `adminRulesets` | js/filter-lists.js:565, 120-130; js/settings.js:305-322 |
| first time its `section[data-pane="filters"]` is visible | sends `getAllCustomFilters`; adds a `storage.local.onChanged` listener | js/filter-manager-ui.js:636, 607-631, 142-143 |
| first time its `aside#sandboxEditor` is visible | sends `getSandboxFilters`. Never on Safari: the element is `display: none` there | js/filter-manager-ui.js:630, 595-598; css/settings.css:404 |
| first time its `section[data-pane="develop"]` is visible | sends `getRulesetDetails`; reads local `dashboard.develop.editor`; then the selected editor loads its text (`getFilteringModeDetails`, or local `userDnrRules`, or `getAllDynamicRules` / `getAllSessionRules` / `getRulesetRules`) | js/develop.js:628, 54, 67-69; js/mode-editor.js:56-59; js/rw-dnr-editor.js:44-46; js/ro-dnr-editor.js:32-58 |
| first time its troubleshooting `<pre>` is visible | the calls of §8.2 | js/dashboard.js:58-66 |
| its `beforeunload` | runs the filter-list commit in "final" mode. `applyRulesets` is sent only if the checked leaf entries of ITS OWN list DOM differ from ITS OWN last render, or an entry is marked for removal. When the rulesets pane was never rendered in that document both sides are empty and nothing is sent | js/filter-lists.js:466-471, 429-449; js/dashboard.js:83-86 |

"First time visible" means an `IntersectionObserver` reported an intersection (`PRISTINE/js/dom.js:160-168`);
an element inside a `display: none` section never does.

Facts that follow:
- The only inputs that select the visible pane of that document are the stored `dashboard.activePane`
  (read once, at load) and a click on its own nav buttons. It reads no URL parameter and no hash
  (js/dashboard.js, whole file). Pane visibility is pure CSS on `body[data-pane]`
  (css/dashboard.css:64-69).
- The key `dashboard.activePane` is shared by every document that runs upstream `js/dashboard.js`.
- Its Develop nav button is hidden unless `body[data-develop="true"]` (css/dashboard.css:47); the section
  itself is shown by `body[data-pane="develop"]` alone (css/dashboard.css:64-69).
- With rulesets forced ON by an admin `+id` token, the "differs" test of the `beforeunload` row is true
  whenever the rulesets pane was rendered there. Forced-on entries are enabled, so they are counted in
  the last-render set (js/filter-lists.js:144-148), but they are excluded from the DOM-derived list
  (js/filter-lists.js:436). The document then sends `applyRulesets` with ITS view of the list on every
  unload. (audit) `-id` tokens do not cause this: those rulesets are disabled, so they are in neither
  set.
- (audit) Its `storage.local.onChanged` listener calls `startsSandboxEditor.editor.loadContent()` when
  `sandboxFilters` changes (js/filter-manager-ui.js:620-628). On Safari that editor is never created
  (its aside is `display: none`, css/settings.css:404). So when a `setSandboxFilters` sent by the
  React dashboard (restore/reset step 15) really changes the stored `sandboxFilters`, that listener
  throws a `TypeError` in the classic document. This happens only after that document's Custom filters
  pane has been shown once (the listener is added in `start()`, js/filter-manager-ui.js:607-636). It is
  harmless to state, but it appears in the console.

---

## 10. Content-script and internal messages (class C) — never sent by UI pages

| `what` | Request | Response | Notes | Source |
|---|---|---|---|---|
| `insertCSS` | `{ css: string }` | `false` if sender has no tab; `undefined` on Safari for sub-frames; else result of `scripting.insertCSS({ css, origin: 'USER', target: { tabId, frameIds: [frameId] } })` | Safari: frames other than 0 are ignored | bg:304-314 |
| `removeCSS` | `{ css: string }` | same pattern with `scripting.removeCSS` | same Safari restriction | bg:316-326 |
| `injectCSSProceduralAPI` | `{}` | result of `scripting.executeScript({ files: ['/js/scripting/css-procedural-api.js'], target, injectImmediately: true })` | | bg:328-335 |
| `toggleToolbarIcon` | `{}` | `undefined` | sets the tab's toolbar icon to the off/on variant | bg:349-354, js/action.js:63-69 |
| `startCustomFilters` | `{}` | result of `executeScript({ files: ['/js/scripting/css-user.js'], … })` | | bg:356-358, js/filter-manager.js:150-158 |
| `terminateCustomFilters` | `{}` | result of `executeScript({ files: ['/js/scripting/css-user-terminate.js'], … })` | | bg:360-362, js/filter-manager.js:160-168 |
| `injectCustomFilters` | `{ hostname: string }` | `undefined` or `{ plainSelectors: string[], proceduralSelectors: string[] }` | | bg:364-366, js/filter-manager.js:172-205 |
| `updateImportedLists` | `{}` | `undefined` | alarm job | bg:653-659 |
| `pruneCSSCache` | `{}` | `undefined` | alarm job | bg:661-663, js/scripting-manager.js:379-394 |
| `keepAlive` | `{}` | `undefined` | offscreen document only | bg:667-668 |

---

## 11. `BroadcastChannel('uBOL')`

Posting: `broadcastMessage(message)` creates `new self.BroadcastChannel('uBOL')` and calls
`postMessage(message)`; the channel is never closed (js/utils.js:133-136). Only background code posts.
Payloads are structured-cloned, so `Set`s arrive as `Set`s.
UNKNOWN (not runtime-verified): delivery from Safari's non-persistent background page to extension pages.

### 11.1 Posters

| Posted by | When | Payload |
|---|---|---|
| bg:259 | end of every `applyRulesets()` run: messages `applyRulesets`, `importFilterList` | `{ enabledRulesets: string[] }` |
| bg:267 | `setDeveloperMode` (message, or forced off when `develop` is admin-disabled bg:807-814) | `{ developerMode: boolean }` |
| bg:464 | `setAutoReload` | `{ autoReload: boolean }` |
| bg:475 | `setShowBlockedCount` | `{ showBlockedCount: boolean }` |
| bg:480 | `setStrictBlockMode` | `{ strictBlockMode: boolean }` |
| bg:486 | `setPopupBlockMode` | `{ popupBlockMode: boolean }` |
| bg:549 | `setFilteringModeDetails` | `{ defaultFilteringMode: 0..3 }` |
| js/mode-manager.js:316-320 | every mode write: `setFilteringMode`, `setDefaultFilteringMode`, permission sync (js/mode-manager.js:401-430), pending-permission completion (bg:178) | `{ defaultFilteringMode: 0..3, hasOmnipotence: boolean, filteringModeDetails: { none: Set<string>, basic: Set<string>, optimal: Set<string>, complete: Set<string> } }` |
| js/admin.js:85 | managed `popupBlockMode` changed | `{ popupBlockMode }` |
| js/admin.js:95 | managed `showBlockedCount` changed | `{ showBlockedCount }` |
| js/admin.js:101 | managed `strictBlockMode` changed | `{ strictBlockMode }` |
| js/admin.js:134 | managed `rulesets` changed | `{ adminRulesets: string[], enabledRulesets: string[] }` |
| js/admin.js:141 | managed `defaultFiltering` changed | `{ defaultFilteringMode }` |
| js/admin.js:147 | managed `noFiltering` changed | `{ filteringModeDetails: { none: Set, basic: Set, optimal: Set, complete: Set } }` |

A message can carry any subset of the keys; receivers test each key with `!== undefined`
(js/settings.js:256-315).

### 11.2 Listeners

1. Dashboard settings (js/settings.js:244-323). Installed only after `getOptionsPageData` succeeded
   (js/settings.js:350). Non-object data is ignored (:251). For each of `hasOmnipotence`,
   `defaultFilteringMode`, `autoReload`, `showBlockedCount`, `strictBlockMode`, `popupBlockMode`,
   `developerMode`: if present and different from the cached value → store it and re-render the settings
   widgets (:256-303, 317-319). `adminRulesets`: if present and its sorted-joined form differs → store,
   re-render lists (:305-310; hash js/dashboard.js:83-86). `enabledRulesets`: if present → ALWAYS store and
   re-render lists (:312-315). "Re-render lists" = `renderFilterLists(true)`, which does nothing until the
   Filter lists pane has been shown once and otherwise re-sends §6.1 + §6.2 (:320-322,
   js/filter-lists.js:120-130).
2. Develop pane mode editor (js/mode-editor.js:37-54): only while that editor is selected; on a message with
   `filteringModeDetails` it replaces the editor text (:40-47).
3. The popup has no listener (js/popup.js). The Filter lists pane has no listener of its own.

Consequence that implementers must keep: the dashboard's knowledge of the five toggles, the default
mode, `hasOmnipotence` and the enabled list is kept current ONLY by these echoes (js/settings.js:196-228
send without updating the cache); backup (§7.1) reads that cache. The Filter lists "differs" baseline
is also moved only by the echo-triggered re-render (§6.3). (audit) Exceptions: the default-mode handler
writes the answered level and `hasOmnipotence = true` into the cache itself (js/settings.js:104,
117-118), and `setDeveloperMode` sets `body[data-develop]` at once (js/settings.js:227).
(audit) Messages that carry `filteringModeDetails` contain `Set`s (structured clone). The settings
listener ignores that key. A React listener that reads it must not assume arrays.

---

## 12. Storage keys

No code under `js/` uses `storage.sync` (verified by grep). `storage.managed` is read only by the
background (js/ext.js:131-139, js/admin.js:209-230).

### 12.1 Keys UI pages read or write directly

| Area | Key | Value shape | Read | Write / remove |
|---|---|---|---|---|
| local | `dashboard.activePane` | `string`, a pane id: `rulesets`, `filters`, `develop`, `about` (dashboard.html:28-32). Absent = `settings`. Upstream does not validate the string: whatever is stored becomes `body[data-pane]`. Shared with the classic document (§9.1) | js/dashboard.js:52-55 at load; a non-string is ignored | js/dashboard.js:42-50: tab click writes the id, or REMOVES the key when the pane is `settings` |
| local | `hideUnusedFilterLists` | `string[]`: group node ids whose unused lists are collapsed, or `'*'` meaning "all collapsed" (then listed ids are the exceptions). Absent = `['ads', 'regions', 'imported']` (js/filter-lists.js:32) | js/filter-lists.js:380-388 at module load; non-array ignored | js/filter-lists.js:354-377 on every expand/collapse |
| local | `userDnrRules` | `string` (YAML-like rule text) | js/backup-restore.js:83; js/rw-dnr-editor.js:45 | js/backup-restore.js:207-212; js/rw-dnr-editor.js:285-290 (removed when empty) |
| local | `userDnrRuleCount` | `number`, or absent | js/rw-dnr-editor.js:49 and `storage.onChanged` (area `local`) js/rw-dnr-editor.js:52-58 | background only (js/ruleset-manager.js:786, 813-819) |
| local | `dashboard.develop.editor` | `string` editor mode (`modes`, `dnr.rw.*`, `dnr.ro.<id>`) | js/develop.js:67 | js/develop.js:624 |
| local | `picker.view` | `string` `'0'`, `'1'` or `'2'` | js/picker-ui.js:369-372 | js/picker-ui.js:134-138 |
| local | `rulesets.imported` | `Array<imported list entry>` (§6.4) | restore, in page: js/imported-lists.js:78-81 | restore, in page: js/imported-lists.js:113-126 |
| local | `rulesets.imported.compiled.<id>` | compiled list data (string) | key names only, js/imported-lists.js:42-51 | removed in page during restore, js/imported-lists.js:113-123 |
| local | `deferredJobs` | `Array<{ name: string, time: number }>` | restore, in page: js/alarms.js:42, 55 | restore, in page: js/alarms.js:51, 59-62 |
| local | `site.<hostname>`, `sandboxFilters` | see §12.2 | change events only: js/filter-manager-ui.js:620-628 | — |
| session | `safari.seenRealms` | `number` bitmask (1 normal, 2 private) | every page that loads upstream `js/ext.js` (safari/ext-compat.js:40-43) | safari/ext-compat.js:55, 182 |
| session | `console` | `string[]` | any page that loads upstream `js/debug.js` (js/debug.js:47-53), e.g. the dashboard once backup/restore code is loaded (js/backup-restore.js:22-26 → js/imported-lists.js:34) | background service worker only (js/debug.js:78, 89-91) |

Helper semantics upstream (js/ext.js:59-87): `localRead(key)` resolves the stored value or `undefined`
(also on error); `localWrite(key, value)` = `storage.local.set({ [key]: value })`; `localRemove(keys)` =
`storage.local.remove(keys)`.

### 12.2 Keys owned by the background (UI must never write them)

`rulesetConfig` (local + session; js/config.js:52-73) · `filteringModeDetails` (local + session;
js/mode-manager.js:246-257, 297, 307-314, 338) · `permissions.hostnames` (local; js/mode-manager.js:370-379) ·
`site.<hostname>` → `string[]` of selectors (local; js/filter-manager.js:247-309) · `sandboxFilters` → `string`
(local; js/filter-manager.js:313-322) · `sandboxFilters.dnrRules`, `importedFilters.dnrRules`,
`sandboxFilters.userScripts`, `importedFilters.userScripts` (local; js/compiled-filters.js:155-193) ·
`defaultRulesetIds` (local; js/ruleset-manager.js:496, 536) · `excludedStrictBlockHostnames` (local + session;
js/ruleset-manager.js:282-289, 332-354) · `admin.<key>` → `{ data }` (local + session; js/admin.js:209-230) ·
`goodStart` (local; bg:840-851) · `css.specific.<id>` (local; js/scripting-manager.js:172-204) ·
`cache.css.*` (session; js/scripting-manager.js:77-80, 379-394) · `userDnrRuleCount` (local, §12.1).

---

## 13. Direct browser-API calls made by UI pages (exact arguments)

### 13.1 `browser.permissions`

| Call | Where | Notes |
|---|---|---|
| `browser.permissions.request({ origins: [ '*://*.' + hostname + '/*' ] })` | js/popup.js:79-81 | inside try/catch; result must be `=== true`; see §4.6 for ordering |
| `browser.permissions.request({ origins: [ '<all_urls>' ] })` | js/settings.js:109-111 | no try/catch; truthy result = granted; see §5.2 |

No UI page calls `permissions.contains`, `getAll` or `remove`; `hasOmnipotence` always comes from the
background (bg:415, 494, 458-459). The background reacts to `permissions.onAdded` / `onRemoved`
(bg:871-881, 186-235). `PRISTINE/manifest.json` declares `host_permissions: ["<all_urls>"]` and no
`optional_host_permissions`. UNKNOWN: what `permissions.request` does on Safari for an origin that is
already granted, and whether the popup survives the prompt.

### 13.2 `browser.tabs`

| Call | Where |
|---|---|
| `browser.tabs.query({ active: true, currentWindow: true })` | js/popup.js:299-302 |
| `browser.tabs.reload(currentTab.id)` (after 437 ms) | js/popup.js:103-106 |
| `browser.tabs.update(currentTab.id, { url: tabURL.href })` (after 437 ms) | js/popup.js:103-108 |

### 13.3 `browser.scripting`

Three `executeScript` calls, quoted in §4.6 (js/popup.js:259-262, 270-277, 285-292). Each is guarded by
`if ( browser.scripting === undefined ) { return; }` and followed by `self.close()`. The same file lists
are used by the keyboard commands in the background (bg:677-702; there is no command for the unpicker).

### 13.4 `browser.windows`

No UI page calls it. The background opens windows for `showMatchedRules` (bg:560-563) and `gotoURL`
(js/ext-utils.js:49-62). Side effect on Safari: every page that loads upstream `js/ext.js` also registers
`windows.onFocusChanged` (§17, item 7).

### 13.5 `browser.runtime`

| Call | Where |
|---|---|
| `runtime.sendMessage(msg)` | js/ext.js:52 |
| `runtime.openOptionsPage()` | js/popup.js:252 (opens `options_ui.page` = `dashboard.html`, `PRISTINE/manifest.json`) |
| `runtime.getPlatformInfo()` | js/troubleshooting.js:66 |
| `runtime.getManifest()` / `runtime.getURL()` | §14 |

### 13.6 Other APIs

| Call | Where | Used by rebuilt surfaces? |
|---|---|---|
| `browser.alarms.create('deferredJobs', { when })`, `browser.alarms.clear('deferredJobs')` | js/alarms.js:31-39, reached from the page during restore (§7.2 step 9) | yes (restore/reset) |
| `browser.action.getBadgeText({ tabId })` | js/troubleshooting.js:125 | only when `details.tabId` is set (report page) |
| `browser.storage.local.onChanged.addListener` | js/filter-manager-ui.js:620 | no (Custom filters pane) |
| `browser.storage.onChanged.addListener` | js/rw-dnr-editor.js:52 | no (Develop pane) |
| `i18n.getMessage(key)` | everywhere through `i18n$` (`PRISTINE/js/i18n.js:25-30`); `resetToDefaultConfirm` js/settings.js:186 | yes |
| `i18n.getMessage('@@ui_locale')` for text direction | `PRISTINE/js/i18n.js:39-44` | yes |
| `navigator.clipboard.write` | js/filter-manager-ui.js:429-430 | no |
| `self.confirm(text)` (must return exactly `true`) | js/settings.js:186-187 | yes (reset) |
| `<a href="data:text/plain;charset=utf-8,…" download="my-ubol-settings.json" type="application/json">` + `a.click()` | js/settings.js:141-145 | yes (backup) |
| `<input type="file">` `.click()`, `FileReader.readAsText(file)` | js/settings.js:150-179 | yes (restore) |
| `self.close()` | js/popup.js:263, 278, 293 | yes (popup tools) |
| `navigator.userAgent` | js/troubleshooting.js:82-97 | yes (troubleshooting text) |

UNKNOWN (not runtime-verified on Safari): whether `self.confirm` shows a dialog on the options page,
and whether a `data:` URL with the `download` attribute saves a file from an extension page.

Note for `src/lib/ext.ts`: besides `runtime`, `storage`, `permissions`, `tabs`, `i18n` (the APIs `ext.ts` was planned to cover)
the rebuilt surfaces need `scripting.executeScript` (§4.6) and `alarms.create/clear` (§7.2).

The complete list of `browser.*` members the rebuilt surfaces touch, for the mock in
`src/dev/mock-ext.ts`: `runtime.sendMessage`, `runtime.getURL`, `runtime.getManifest`,
`runtime.getPlatformInfo`, `runtime.openOptionsPage`, `tabs.query`, `tabs.reload`, `tabs.update`,
`scripting.executeScript`, `permissions.request`, `storage.local.get` / `set` / `remove` / `getKeys`
(optional, js/ext.js:81-83), `alarms.create`, `alarms.clear`, `i18n.getMessage`, and the DOM global
`BroadcastChannel` (sources: §4.6, §5.2, §7, §8, §11, §12.1, §13.1-13.6).

---

## 14. `runtime.getManifest` and `runtime.getURL` uses in UI code

| Call | Purpose | Source |
|---|---|---|
| `runtime.getManifest()` → `name`, `version` | About header text | js/dashboard.js:35-38 |
| `runtime.getManifest()` → `versionName ?? version` | `version` field of the backup file | js/backup-restore.js:38-39 |
| `runtime.getManifest()` → `name`, `version` | troubleshooting text | js/troubleshooting.js:53, 110-111 |
| `runtime.getURL('')` | `webextFlavor`: `'safari'` when it starts with `safari-web-extension:` | js/ext.js:30-34 |
| `runtime.getURL('')` | browser vendor line | js/troubleshooting.js:78-87 |
| `runtime.getURL('/')` | placeholder initial value of `tabURL` | js/popup.js:31 |
| `runtime.getURL('/report.html')` | build the report URL; only `pathname + search` is sent | js/popup.js:237-244 |
| `runtime.getURL('/strictblock.')` | detect the strict-block page in the active tab | js/popup.js:308-312 |
| `runtime.getURL(file)` (content script, not a UI page) | URL of the overlay iframe; `safari-web-extension:` selects the direct-`src` load path | js/scripting/tool-overlay.js:311, 348-356 |

`PRISTINE/manifest.json`: `version` `2026.1003.1243`, `name` `__MSG_extName__`, `short_name` `Blocker`,
no `version_name` (so the backup file's `version` is `manifest.version`), `options_ui.page`
`dashboard.html`, `action.default_popup` `popup.html`. The background reads two more manifest fields that
no UI page reads: `permissions` (js/debug.js:38-39) and `declarative_net_request.rule_resources`
(js/ruleset-manager.js:707-710).

---

## 15. Overlay tools: `MessageChannel` between overlay iframe and content script

Kept as upstream code; documented because it is a UI channel.

- Start: the content script creates an iframe for `/picker-ui.html`, `/zapper-ui.html` or `/unpicker-ui.html`
  and, on load, posts to it `{ what: 'startOverlay', url: document.baseURI, width: innerWidth, height: innerHeight }`
  with one `MessagePort`, targeting the extension origin (js/scripting/tool-overlay.js:309-359). On Safari
  the iframe `src` is set directly (js/scripting/tool-overlay.js:348-356).
- The iframe accepts exactly one such window message, stores the port and synthesises a local
  `{ what: 'startTool', url, width, height }` (js/tool-overlay-ui.js:35-61).
- Envelope: a request from the iframe is `{ fromFrameId: number, msg }` and its reply
  `{ fromFrameId, msg: <response> }`; from the content script `{ fromScriptId: number, msg }` /
  `{ fromScriptId, msg }`; un-enveloped objects are one-way (js/tool-overlay-ui.js:73-123,
  js/scripting/tool-overlay.js:129-189).

| Direction | `msg.what` | Fields | Reply | Source |
|---|---|---|---|---|
| iframe → script | `startTool` | — | — | js/picker-ui.js:367, js/zapper-ui.js:97, js/unpicker-ui.js:140; js/scripting/tool-overlay.js:143-145 |
| iframe → script | `quitTool` | — (raw, no envelope) | — | js/tool-overlay-ui.js:63-71; js/scripting/tool-overlay.js:146-148 |
| iframe → script | `highlightElementAtPoint` | `mx`, `my` (raw) | — | js/tool-overlay-ui.js:144-152 |
| iframe → script | `highlightFromSelector` | `selector`, `scrollTo?` | `{ count: number, error?: string }` | js/picker-ui.js:329-334, js/unpicker-ui.js:40-44; js/scripting/tool-overlay.js:152-160 |
| iframe → script | `unhighlight` | — | — | js/picker-ui.js:325, 401; js/zapper-ui.js:113; js/unpicker-ui.js:46 |
| iframe → script | `candidatesAtPoint` | `mx`, `my`, `broad` | `{ partsDB: Array<[number, string]>, listParts: number[][], sliderParts: number[][] }` or `undefined` | js/picker-ui.js:96-103; js/scripting/picker.js:81-227, 298-299 |
| iframe → script | `previewSelector` | `selector` | — | js/picker-ui.js:216-224; js/scripting/picker.js:240-277 |
| iframe → script | `zapElementAtPoint` | `mx?`, `my?`, `options: { stay: true, highlight?: boolean }` | — | js/zapper-ui.js:30-39, 81-84; js/scripting/zapper.js:38-87, 118-123 |
| iframe → script | `startCustomFilters` / `terminateCustomFilters` | — | forwarded to the background (class C) | js/picker-ui.js:231, 237; js/unpicker-ui.js:139, 150; js/scripting/picker.js:294-297; js/scripting/unpicker.js:34-37 |
| script → iframe | `svgPaths` | `ocean`, `islands` (SVG path strings, raw) | — | js/scripting/tool-overlay.js:241-245; js/tool-overlay-ui.js:92-95 |
| local in iframe | `stopTool` | synthesised on port error | — | js/tool-overlay-ui.js:46-48 |

Overlay iframes also talk to the background through `runtime.sendMessage` with `addCustomFilters`,
`removeCustomFilters`, `customFiltersFromHostname` (§9; js/tool-overlay-ui.js:127-129).
The unpicker content script additionally has a port handler for `{ what: 'removeCustomFilters', selector }`
that forwards to the background (js/scripting/unpicker.js:38-42); no upstream iframe posts that message
over the port (the unpicker iframe uses `runtime.sendMessage` instead, js/unpicker-ui.js:72-75).
The content script picks its API object as `typeof browser === 'object' ? browser : chrome`
(js/scripting/tool-overlay.js:33) and posts `startOverlay` to the origin built from
`i18n.getMessage('@@extension_id')` (js/scripting/tool-overlay.js:329-341).

---

## 16. Container-app window (`Main.html`) — native channel, not extension messaging

The page runs in a `WKWebView`, not in the extension; no `browser` API exists there.

Files (all generated by the converter; paths relative to `XCODE/Blocker/`):
`Blocker/ViewController.swift`, `Blocker/Resources/Base.lproj/Main.html`, `Blocker/Resources/Script.js`,
`Blocker/Resources/Style.css`, `Blocker/Resources/Icon.png`, `Blocker Extension/SafariWebExtensionHandler.swift`.

- Loading: Swift loads the bundle resource named `Main` with extension `html` and grants read access to
  the whole resource folder (`Blocker/ViewController.swift:25`). The generated `Main.html` sits in
  `Base.lproj/` and references its siblings one level up: `../Style.css`, `../Script.js` (with `defer`),
  `../Icon.png` (`Blocker/Resources/Base.lproj/Main.html:9-13`). Its CSP meta is `default-src 'self'`
  (`Blocker/Resources/Base.lproj/Main.html:5`).
- Native → page: after the page finishes loading, Swift asks Safari for the extension state and then
  evaluates the string `show(<true|false>, <true|false>)` on the main queue
  (`Blocker/ViewController.swift:28-42`): first argument = extension enabled state, second = `true` on
  macOS 13+ ("Settings" wording), `false` otherwise. If the state lookup fails nothing is called
  (`Blocker/ViewController.swift:30-33`). A global function `show(enabled, useSettingsInsteadOfPreferences)`
  must therefore exist on `window` when loading finishes (generated `Blocker/Resources/Script.js:1-16`;
  it treats a non-boolean `enabled` as "unknown", :9-15). The call arrives asynchronously, some time
  after `didFinish`; how long is UNKNOWN. Errors of `evaluateJavaScript` are not observed by Swift
  (`Blocker/ViewController.swift:37, 39` pass no completion handler).
- Page → native: `webkit.messageHandlers.controller.postMessage("open-preferences")`
  (`Blocker/Resources/Script.js:18-20`, wired to `button.open-preferences` at :22; handler name registered
  at `Blocker/ViewController.swift:23`). Swift force-casts the body to `String`
  (`Blocker/ViewController.swift:46`): any non-string body crashes the app; any other string is ignored
  (:46-48). On receipt it opens Safari's extension settings and, in the completion handler, terminates
  the app (:50-54).
- The extension identifier Swift queries is the constant `org.example.blocker.Extension`
  (`Blocker/ViewController.swift:12`).
- `Blocker Extension/SafariWebExtensionHandler.swift:13-40` only echoes native messages; no upstream
  code calls `sendNativeMessage`/`connectNative` (grep over `js/` and `safari/`: no match).

---

## 17. Safari-specific behaviour (consolidated)

1. `webextFlavor === 'safari'` (js/ext.js:30-34): default `strictBlockMode` is `false` (js/config.js:35);
   strict-block rules are never created (js/ruleset-manager.js:267-272); the setting row is hidden
   (dashboard.html:100, css/settings.css:104, js/dashboard.js:33); `strictblock.html` is not reached through rules.
2. No offscreen document: `supportsOffscreenDocument = false` (safari/ext-offscreen.js:25) →
   `supportsCompiledFilters: false` (bg:439); `updateCompiledFilters()` and `registerUserScripts()` return
   `false` immediately (js/compiled-filters.js:270-271, 281-282). Imported lists and sandbox filters are
   stored but never compiled; their UI is hidden (css/settings.css:267-268, 404).
3. `supportsUserScripts()` returns `false` whenever `browser.userScripts` is absent (js/ext.js:40-44);
   `PRISTINE/manifest.json` requests no `userScripts` permission. Runtime value not verified.
4. DNR wrapper (safari/ext-compat.js:142-219): `getAvailableStaticRuleCount()` is the constant 150000
   (:146-148); dynamic/session rule getters resolve `[]` on a non-array result and rename `domains` →
   `initiatorDomains` (:149-170, 121-138); rule updates drop unsupported rules and rename domain keys
   (:72-117, 174-188); the "no filtering" list is one dynamic `allow` rule with `urlFilter: '*'`
   (:189-215); there is no `onRuleMatchedDebug`, so `toggleDeveloperMode` does nothing and
   `getMatchedRules` uses the `dnr.getMatchedRules` branch (js/debug.js:35, 159-192, 201-209).
   (audit) The wrapper method always exists (safari/ext-compat.js:160-162), so the
   `typeof … !== 'function'` guard at js/debug.js:183 never fires. If Safari lacks the native function,
   the call throws and `getMatchedRules` gets no answer (§1.5).
5. `canShowBlockedCount` is `true` because the wrapper defines `setExtensionActionOptions`
   (bg:143, safari/ext-compat.js:216-218); native support UNKNOWN, though the start-up path calls it
   unconditionally (bg:785-789; see §5.3).
6. `insertCSS` / `removeCSS` ignore frames other than the top frame (bg:306-307, 318-319).
7. Loading upstream `js/ext.js` in ANY page executes safari/ext-compat.js (js/ext.js:22): it reads session
   `safari.seenRealms` and registers `windows.onFocusChanged` → may call
   `declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ids, enableRulesetIds: ids })` from
   that page (safari/ext-compat.js:34-64). The background registers the same listener. React pages that
   do not import upstream `js/ext.js` will not run this copy; effect of its absence in pages: not
   runtime-verified.
8. Console capture: `ubolErr` records lines only when `globalThis.ServiceWorkerGlobalScope` exists
   (js/debug.js:87-95). The Safari manifest declares a background page (`background.scripts`,
   `persistent: false`; safari/manifest.json:7-11), not a service worker, so `getConsoleOutput` is expected
   to return `[]` (inference from those two facts; not runtime-verified).
9. PRISTINE is a local build: `declarativeNetRequestFeedback` is in the manifest
   (`ROOT/tools/make-mv3.sh:166-175`), hence `isSideloaded === true` (js/debug.js:37-40) and the popup's
   matched-rules button is enabled when developer mode is on (js/popup.js:334-339).
10. Troubleshooting vendor string uses `Version/x.y` from the user agent (js/troubleshooting.js:84-87).
11. `webext = self.browser` only; there is no `chrome` fallback (safari/ext-compat.js:24).
12. Minimum Safari 18.6 (safari/manifest.json:12-16).

---

## 18. Upstream quirks and hazards (consolidated checklist)

1. `sendMessage` hides every transport failure as `undefined` (js/ext.js:51-55).
2. A throwing handler never answers (bg:859).
3. `applyRulesets` never returns an error; `#dnrError` is always cleared (bg:382-388, js/filter-lists.js:457-458).
4. Unknown ids in `applyRulesets.enabledRulesets` can store `enabledRulesets = undefined`
   (js/ruleset-manager.js:642-658, bg:243-245).
5. Filter-list changes younger than 997 ms are dropped on page unload; `toRemove` is sent only on unload
   (js/filter-lists.js:454-456, 466-471).
6. `level` must be a number (js/mode-manager.js:156-189, 192-236).
7. Neither `setFilteringMode`, `setDefaultFilteringMode` nor `setFilteringModeDetails` checks host
   permissions (bg:517-551).
8. `setPendingFilteringMode` is never cleared on denial (bg:145, 210-212).
9. `popupPanelData.hasCustomFilters` is a count (js/filter-manager.js:92-95).
10. `getOptionsPageData.firstRun` is always `false` (bg:422, 435).
11. Stock `RulesetDetails.enabled` means "default", not "current" (§3.4).
12. Toggle messages do not update the dashboard cache; only broadcasts do (js/settings.js:196-228, 270-303).
13. Restore/Reset run imported-list storage and alarm code in the page and can stop midway
    (js/backup-restore.js:132-146, js/alarms.js:54-57).
14. Restore/Reset never request permissions (js/backup-restore.js:92-215).
15. `setDeveloperMode` enables only on literal `true` (bg:265); `setPopupBlockMode` stores the raw value
    (js/prevent-popup.js:70).
16. `permissions.request` is issued for every popup change to level 2 or 3 (js/popup.js:66-81).
17. `strictblock.js` reads a non-existent config key (js/strictblock.js:117).
18. `applyRulesets` with `[]`, or with a missing `enabledRulesets`, disables every ruleset
    (js/ruleset-manager.js:605-636).
19. Setting the DEFAULT mode to level N first empties set N of the mode table, i.e. deletes every per-site
    entry stored at that same level (js/mode-manager.js:157-174). Per-site entries at other levels stay.
20. A popup click on the already-current level still runs the full commit, permission request included
    (js/popup.js:181-192, 66-81).
21. `getTroubleshootingInfo` and `restoreFromObject` mutate arrays they received as message responses
    (js/troubleshooting.js:138-147, js/backup-restore.js:120-131).
22. The upstream dashboard document, when loaded anywhere, sends `getOptionsPageData`, shares the
    `dashboard.activePane` key and installs a `beforeunload` commit for filter lists (§9.1).
23. `removeJob` throws when local `deferredJobs` is absent (js/alarms.js:54-57); reachable from the page
    during restore/reset and from the background during `importFilterList` (js/imported-lists.js:55-67,
    113-126).
24. (audit) Pressing and releasing the popup thumb without moving it is a full commit, the same as
    item 20 (js/popup.js:142-150).
25. (audit) A rejected `tabs.query`, or a throw after `popupPanelData`, leaves the popup with neither
    data nor the "no data" text (js/popup.js:349-360).
26. (audit) The report URL's `mode` is the level at popup open, even after a change (js/popup.js:240).
27. (audit) The Filter lists baseline moves only on the broadcast echo. Without the echo, reverting a
    committed change sends nothing (js/filter-lists.js:135-148, 446-449).
28. (audit) `isAdminRuleset` matches admin tokens by prefix (js/filter-lists.js:106-116).
29. (audit) A backup taken while `getFilteringModeDetails` fails is written without `filteringModes`
    and no error is shown (js/backup-restore.js:75, js/settings.js:140).
30. (audit) Restore does not validate the file and can stop at any step with the earlier steps
    applied. A step-1 failure is detected only at the first `T.x ?? D.x` whose `T.x` is nullish
    (js/backup-restore.js:93-131). Read errors and rejections leave `body.busy` on for good
    (js/settings.js:148-183).
31. (audit) A per-site level change also deletes the parent-domain entries that decided the old level
    (js/mode-manager.js:76-83, 194-207).

---

## 19. UNKNOWN list

| # | Question | Why it matters | Nearest source |
|---|---|---|---|
| U1 | Does Safari deliver an `undefined` handler result as `undefined` or `null`? | bridge null handling | bg:859 |
| U2 | What does the sender's promise do on Safari when the handler never calls back? | hung calls | bg:857-861 |
| U3 | Does Safari set `sender.origin`? | trust check | bg:376-377 |
| U4 | Numeric value of `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` on Safari | list limit | safari/ext-compat.js:144 |
| U5 | Does Safari implement `declarativeNetRequest.setExtensionActionOptions`? | `setShowBlockedCount` could throw | safari/ext-compat.js:216-218, bg:469-473 |
| U6 | Does Safari implement `declarativeNetRequest.getMatchedRules`? | matched-rules page | safari/ext-compat.js:160-162, js/debug.js:182-191 |
| U7 | Does Safari expose `browser.storage.managed`? | `disabledFeatures`, `adminRulesets` | js/ext.js:131-139 |
| U8 | Behaviour of `permissions.request` on Safari (already granted origins; popup lifetime during prompt; `<all_urls>` prompt) | level changes | js/popup.js:79-81, js/settings.js:109-111 |
| U9 | Which origin strings `permissions.getAll()` reports on Safari for "all websites" | `hasOmnipotence` | js/ext-utils.js:33-38 |
| U10 | Does `runtime.getManifest().name` come back localised on Safari? | About header, troubleshooting | js/dashboard.js:35-38 |
| U11 | Does `tabs.query` return `url` for the active tab without site permission? | popup "no data" | js/popup.js:299-316 |
| U12 | Does `windows.create({ type: 'popup' })` work on Safari? | matched-rules window | bg:560-563 |
| U13 | Does `BroadcastChannel` deliver from the background page to extension pages on Safari? | live sync | js/utils.js:133-136 |
| U14 | Duration of handlers that re-register content scripts | any timeout choice | bg:255, 537, 547 |
| U15 | Effect of not registering the `windows.onFocusChanged` workaround in UI pages | §17 item 7 | safari/ext-compat.js:34-64 |
| U16 | Does `self.confirm` show a dialog on a Safari extension options page? | reset | js/settings.js:186 |
| U17 | Does `<a download>` with a `data:` URL save a file from a Safari extension page? | backup | js/settings.js:141-145 |
| U18 | Does Safari implement `runtime.getPlatformInfo`? If not, the troubleshooting call rejects | About | js/troubleshooting.js:66 |
| U19 | How Safari stores a config property whose value is `undefined` (dropped or `null`) | §6.3 hazard | js/config.js:70-73 |
| U20 | Delay between `didFinish` and the native `show(…)` call in the container window | first paint of the container page | `XCODE/Blocker/Blocker/ViewController.swift:28-42` |
| U21 | Does Safari's `tabs.query` honour `{ url, windowType }` for an extension URL? | `gotoURL` focus-vs-new-tab | js/ext-utils.js:44-47 |

None of the items above was checked in a running Safari: this spec was produced by reading source
only (ARCHITECTURE §7 forbids launching Safari or the app).

---

## 20. TypeScript — ready to paste

```ts
/* ============================================================================
 * Blocker UI <-> background contract. Source: docs/specs/messaging.md.
 * Function names of the bridge are exactly the `what` strings (already camelCase).
 * ========================================================================== */

/* ---------- shared data ---------- */

/** 0 none, 1 basic, 2 optimal, 3 complete. Must be a number on the wire. */
export type FilteringLevel = 0 | 1 | 2 | 3;

/** Serialised mode table. The literal 'all-urls' marks the default mode. */
export interface FilteringModeDetails {
  none: string[];
  basic: string[];
  optimal: string[];
  complete: string[];
}

/** Same table as delivered over BroadcastChannel (structured clone keeps Sets). */
export interface FilteringModeDetailsSets {
  none: Set<string>;
  basic: Set<string>;
  optimal: Set<string>;
  complete: Set<string>;
}

export interface RulesetFilterStats {
  total: number;
  accepted: number;
  rejected: number;
}

export interface RulesetRuleStats {
  total: number;
  plain: number;
  regex: number;
  removeparam?: number;
  redirect?: number;
  modifyHeaders?: number;
  strictblock?: number;
  urlskip?: number;
  discarded?: number;
  rejected?: number;
}

export type RulesetGroup =
  | 'default'
  | 'ads'
  | 'privacy'
  | 'malware'
  | 'annoyances'
  | 'regions'
  | 'imported';

export interface RulesetDetails {
  id: string;
  name: string;
  group?: RulesetGroup;
  /** "A|B" path of sub-group names. */
  parent?: string;
  /** Space separated language codes. */
  lang?: string;
  /** Space separated tags. */
  tags?: string;
  /** Stock list: enabled BY DEFAULT. Imported list: enabled NOW. */
  enabled: boolean;
  homeURL: string;
  filters: RulesetFilterStats;
  rules: RulesetRuleStats;
  css?: { generic?: number; specific?: number };
  popups?: number;
  /** Imported lists only: refresh period in days. */
  expires?: number;
  /** Imported lists only: epoch milliseconds. */
  time?: { added: number; updated: number };
}

export interface ImportedListEntry extends RulesetDetails {
  group: 'imported';
  expires: number;
  time: { added: number; updated: number };
}

/** "+<rulesetId>" or "-<rulesetId>". */
export type RulesetToken = string;

export interface DnrRule {
  id: number | string;
  priority?: number;
  action: Record<string, unknown>;
  condition: Record<string, unknown>;
}

export interface RulesetConfig {
  version: string;
  /** Absent after the §6.3 hazard (bg:244 stores `undefined`). */
  enabledRulesets?: string[];
  autoReload: boolean;
  showBlockedCount: boolean;
  strictBlockMode: boolean;
  popupBlockMode: boolean;
  developerMode: boolean;
  hasBroadHostPermissions: boolean;
  userScripts?: boolean;
}

export type CustomFilterEntry = [hostname: string, selectors: string[]];

/* ---------- class A: popup ---------- */

export interface PopupPanelDataRequest {
  what: 'popupPanelData';
  origin: string;
  hostname: string;
}
export interface PopupPanelDataResponse {
  hasOmnipotence: boolean;
  level: FilteringLevel;
  autoReload: boolean;
  isSideloaded: boolean;
  developerMode: boolean;
  disabledFeatures?: string[] | null;
  /** A count, not a boolean. */
  hasCustomFilters: number;
}

export interface SetPendingFilteringModeRequest {
  what: 'setPendingFilteringMode';
  tabId: number;
  url: string;
  hostname: string;
  beforeLevel: FilteringLevel;
  afterLevel: FilteringLevel;
}
export type SetPendingFilteringModeResponse = void;

export interface SetFilteringModeRequest {
  what: 'setFilteringMode';
  hostname: string;
  level: FilteringLevel;
}
/** Level actually in force afterwards; may differ from the request. */
export type SetFilteringModeResponse = FilteringLevel;

export interface ShowMatchedRulesRequest {
  what: 'showMatchedRules';
  tabId: number;
}
export type ShowMatchedRulesResponse = void;

export interface GotoURLRequest {
  what: 'gotoURL';
  /** Absolute URL, or path+query relative to the extension root. */
  url: string;
  type?: 'popup';
}
/** Tab / Window objects; never read. */
export type GotoURLResponse = unknown;

/* ---------- class A: settings ---------- */

export interface GetOptionsPageDataRequest {
  what: 'getOptionsPageData';
}
export interface GetOptionsPageDataResponse {
  hasOmnipotence: boolean;
  defaultFilteringMode: FilteringLevel;
  enabledRulesets: string[];
  adminRulesets: RulesetToken[];
  maxNumberOfEnabledRulesets?: number | null;
  rulesetDetails: RulesetDetails[];
  autoReload: boolean;
  showBlockedCount: boolean;
  canShowBlockedCount: boolean;
  strictBlockMode: boolean;
  popupBlockMode: boolean;
  /** Always false. */
  firstRun: boolean;
  isSideloaded: boolean;
  developerMode: boolean;
  disabledFeatures?: string[] | null;
  supportsCompiledFilters: boolean;
  supportsUserScripts: boolean;
}

export interface SetDefaultFilteringModeRequest {
  what: 'setDefaultFilteringMode';
  level: FilteringLevel;
}
export type SetDefaultFilteringModeResponse = FilteringLevel;

export interface SetAutoReloadRequest {
  what: 'setAutoReload';
  state: boolean;
}
export type SetAutoReloadResponse = void;

export interface SetShowBlockedCountRequest {
  what: 'setShowBlockedCount';
  state: boolean;
}
export type SetShowBlockedCountResponse = void;

export interface SetStrictBlockModeRequest {
  what: 'setStrictBlockMode';
  state: boolean;
}
export type SetStrictBlockModeResponse = void;

export interface SetPopupBlockModeRequest {
  what: 'setPopupBlockMode';
  state: boolean;
}
export type SetPopupBlockModeResponse = void;

export interface SetDeveloperModeRequest {
  what: 'setDeveloperMode';
  state: boolean;
}
/** New value of developerMode. */
export type SetDeveloperModeResponse = boolean;

/* ---------- class A: filter lists ---------- */

export interface GetEnabledRulesetsRequest {
  what: 'getEnabledRulesets';
}
export type GetEnabledRulesetsResponse = string[];

export interface GetRulesetDetailsRequest {
  what: 'getRulesetDetails';
}
export type GetRulesetDetailsResponse = RulesetDetails[];

export interface ApplyRulesetsRequest {
  what: 'applyRulesets';
  /** COMPLETE list of ids to be enabled; ids must exist in getRulesetDetails. */
  enabledRulesets: string[];
  /** Imported-list ids to delete after applying. */
  toRemove?: string[];
}
/** Always empty: the background never reports a DNR error here. */
export type ApplyRulesetsResponse = void;

export interface ImportFilterListRequest {
  what: 'importFilterList';
  url: string;
}
export type ImportFilterListResponse = void;

/* ---------- class A: backup / restore / reset ---------- */

export interface GetDefaultConfigRequest {
  what: 'getDefaultConfig';
}
export interface GetDefaultConfigResponse {
  autoReload: boolean;
  developerMode: boolean;
  showBlockedCount: boolean;
  strictBlockMode: boolean;
  popupBlockMode: boolean;
  rulesets: string[];
  filteringModes: FilteringModeDetails;
}

export interface GetSandboxFiltersRequest {
  what: 'getSandboxFilters';
}
/** Nullish when nothing is stored. */
export type GetSandboxFiltersResponse = string | null | undefined;

export interface GetFilteringModeDetailsRequest {
  what: 'getFilteringModeDetails';
}
export type GetFilteringModeDetailsResponse = FilteringModeDetails;

export interface SetFilteringModeDetailsRequest {
  what: 'setFilteringModeDetails';
  /** COMPLETE replacement table. */
  modes: FilteringModeDetails;
}
/** Table in force afterwards (normalised, admin overrides applied). */
export type SetFilteringModeDetailsResponse = FilteringModeDetails;

export interface GetAllCustomFiltersRequest {
  what: 'getAllCustomFilters';
}
export type GetAllCustomFiltersResponse = CustomFilterEntry[];

export interface RemoveAllCustomFiltersRequest {
  what: 'removeAllCustomFilters';
  /** '*' = every site. */
  hostname: string;
}
export type RemoveAllCustomFiltersResponse = void;

export interface AddManyCustomFiltersRequest {
  what: 'addManyCustomFilters';
  entries: CustomFilterEntry[];
}
export type AddManyCustomFiltersResponse = void;

export interface SetSandboxFiltersRequest {
  what: 'setSandboxFilters';
  text: string;
}
export type SetSandboxFiltersResponse = void;

export interface UpdateUserDnrRulesRequest {
  what: 'updateUserDnrRules';
}
export interface UpdateUserDnrRulesResponse {
  added: number;
  removed: number;
  errors: string[];
}

/* ---------- class A: about / troubleshooting ---------- */

export interface GetCurrentConfigRequest {
  what: 'getCurrentConfig';
}
export type GetCurrentConfigResponse = RulesetConfig;

export interface GetDefaultFilteringModeRequest {
  what: 'getDefaultFilteringMode';
}
export type GetDefaultFilteringModeResponse = FilteringLevel;

export interface GetEffectiveUserRulesRequest {
  what: 'getEffectiveUserRules';
}
export type GetEffectiveUserRulesResponse = DnrRule[];

export interface GetConsoleOutputRequest {
  what: 'getConsoleOutput';
}
export type GetConsoleOutputResponse = string[];

export interface GetRegisteredContentScriptsRequest {
  what: 'getRegisteredContentScripts';
}
export type GetRegisteredContentScriptsResponse = string[];

export interface HasBroadHostPermissionsRequest {
  what: 'hasBroadHostPermissions';
}
export type HasBroadHostPermissionsResponse = boolean;

/* ---------- class B: only sent by upstream-kept surfaces ---------- */

export interface AddCustomFiltersRequest {
  what: 'addCustomFilters';
  hostname: string;
  selectors: string[];
}
export type AddCustomFiltersResponse = void;

export interface RemoveCustomFiltersRequest {
  what: 'removeCustomFilters';
  hostname: string;
  selectors: string[];
}
export type RemoveCustomFiltersResponse = void;

export interface CustomFiltersFromHostnameRequest {
  what: 'customFiltersFromHostname';
  hostname: string;
}
export type CustomFiltersFromHostnameResponse = string[];

export interface GetEnabledRulesetsDetailsRequest {
  what: 'getEnabledRulesetsDetails';
}
export type GetEnabledRulesetsDetailsResponse = RulesetDetails[];

export interface GetRulesetRulesRequest {
  what: 'getRulesetRules';
  id: string;
}
export type GetRulesetRulesResponse =
  | { rules: DnrRule[] }
  | { serialized?: string | null }
  | null
  | undefined;

export interface GetAllDynamicRulesRequest {
  what: 'getAllDynamicRules';
}
export type GetAllDynamicRulesResponse = DnrRule[];

export interface GetAllSessionRulesRequest {
  what: 'getAllSessionRules';
}
export type GetAllSessionRulesResponse = DnrRule[];

export interface GetMatchedRulesRequest {
  what: 'getMatchedRules';
  tabId: number;
}
export type GetMatchedRulesResponse = Array<
  { request: Record<string, unknown>; rule?: DnrRule | null } | null | undefined
>;

export interface ExcludeFromStrictBlockRequest {
  what: 'excludeFromStrictBlock';
  hostname: string;
  permanent: boolean;
}
export type ExcludeFromStrictBlockResponse = { error?: string } | null | undefined;

export interface GetFilteringModeRequest {
  what: 'getFilteringMode';
  hostname: string;
}
export type GetFilteringModeResponse = FilteringLevel;

export interface GetImportedListsRequest {
  what: 'getImportedLists';
}
export type GetImportedListsResponse = ImportedListEntry[];

/* ---------- class C: content scripts / internal jobs. The UI must NEVER send these. ---------- */

export interface InsertCSSRequest {
  what: 'insertCSS';
  css: string;
}
/** false when the sender is not a tab frame; otherwise the scripting.insertCSS result. */
export type InsertCSSResponse = unknown;

export interface RemoveCSSRequest {
  what: 'removeCSS';
  css: string;
}
export type RemoveCSSResponse = unknown;

export interface InjectCSSProceduralAPIRequest {
  what: 'injectCSSProceduralAPI';
}
export type InjectCSSProceduralAPIResponse = unknown;

export interface ToggleToolbarIconRequest {
  what: 'toggleToolbarIcon';
}
export type ToggleToolbarIconResponse = void;

export interface StartCustomFiltersRequest {
  what: 'startCustomFilters';
}
export type StartCustomFiltersResponse = unknown;

export interface TerminateCustomFiltersRequest {
  what: 'terminateCustomFilters';
}
export type TerminateCustomFiltersResponse = unknown;

export interface InjectCustomFiltersRequest {
  what: 'injectCustomFilters';
  hostname: string;
}
export type InjectCustomFiltersResponse =
  | { plainSelectors: string[]; proceduralSelectors: string[] }
  | null
  | undefined;

export interface UpdateImportedListsRequest {
  what: 'updateImportedLists';
}
export type UpdateImportedListsResponse = void;

export interface PruneCSSCacheRequest {
  what: 'pruneCSSCache';
}
export type PruneCSSCacheResponse = void;

export interface KeepAliveRequest {
  what: 'keepAlive';
}
export type KeepAliveResponse = void;

/* ---------- maps ---------- */

/** Messages the React bridge exposes (class A). */
export interface BridgeMessageMap {
  popupPanelData: { request: PopupPanelDataRequest; response: PopupPanelDataResponse };
  setPendingFilteringMode: { request: SetPendingFilteringModeRequest; response: SetPendingFilteringModeResponse };
  setFilteringMode: { request: SetFilteringModeRequest; response: SetFilteringModeResponse };
  showMatchedRules: { request: ShowMatchedRulesRequest; response: ShowMatchedRulesResponse };
  gotoURL: { request: GotoURLRequest; response: GotoURLResponse };
  getOptionsPageData: { request: GetOptionsPageDataRequest; response: GetOptionsPageDataResponse };
  setDefaultFilteringMode: { request: SetDefaultFilteringModeRequest; response: SetDefaultFilteringModeResponse };
  setAutoReload: { request: SetAutoReloadRequest; response: SetAutoReloadResponse };
  setShowBlockedCount: { request: SetShowBlockedCountRequest; response: SetShowBlockedCountResponse };
  setStrictBlockMode: { request: SetStrictBlockModeRequest; response: SetStrictBlockModeResponse };
  setPopupBlockMode: { request: SetPopupBlockModeRequest; response: SetPopupBlockModeResponse };
  setDeveloperMode: { request: SetDeveloperModeRequest; response: SetDeveloperModeResponse };
  getEnabledRulesets: { request: GetEnabledRulesetsRequest; response: GetEnabledRulesetsResponse };
  getRulesetDetails: { request: GetRulesetDetailsRequest; response: GetRulesetDetailsResponse };
  applyRulesets: { request: ApplyRulesetsRequest; response: ApplyRulesetsResponse };
  importFilterList: { request: ImportFilterListRequest; response: ImportFilterListResponse };
  getDefaultConfig: { request: GetDefaultConfigRequest; response: GetDefaultConfigResponse };
  getSandboxFilters: { request: GetSandboxFiltersRequest; response: GetSandboxFiltersResponse };
  getFilteringModeDetails: { request: GetFilteringModeDetailsRequest; response: GetFilteringModeDetailsResponse };
  setFilteringModeDetails: { request: SetFilteringModeDetailsRequest; response: SetFilteringModeDetailsResponse };
  getAllCustomFilters: { request: GetAllCustomFiltersRequest; response: GetAllCustomFiltersResponse };
  removeAllCustomFilters: { request: RemoveAllCustomFiltersRequest; response: RemoveAllCustomFiltersResponse };
  addManyCustomFilters: { request: AddManyCustomFiltersRequest; response: AddManyCustomFiltersResponse };
  setSandboxFilters: { request: SetSandboxFiltersRequest; response: SetSandboxFiltersResponse };
  updateUserDnrRules: { request: UpdateUserDnrRulesRequest; response: UpdateUserDnrRulesResponse };
  getCurrentConfig: { request: GetCurrentConfigRequest; response: GetCurrentConfigResponse };
  getDefaultFilteringMode: { request: GetDefaultFilteringModeRequest; response: GetDefaultFilteringModeResponse };
  getEffectiveUserRules: { request: GetEffectiveUserRulesRequest; response: GetEffectiveUserRulesResponse };
  getConsoleOutput: { request: GetConsoleOutputRequest; response: GetConsoleOutputResponse };
  getRegisteredContentScripts: { request: GetRegisteredContentScriptsRequest; response: GetRegisteredContentScriptsResponse };
  hasBroadHostPermissions: { request: HasBroadHostPermissionsRequest; response: HasBroadHostPermissionsResponse };
}

/** Messages only upstream-kept pages send (class B). Not part of the bridge unless such a page is ported. */
export interface ClassicMessageMap {
  addCustomFilters: { request: AddCustomFiltersRequest; response: AddCustomFiltersResponse };
  removeCustomFilters: { request: RemoveCustomFiltersRequest; response: RemoveCustomFiltersResponse };
  customFiltersFromHostname: { request: CustomFiltersFromHostnameRequest; response: CustomFiltersFromHostnameResponse };
  getEnabledRulesetsDetails: { request: GetEnabledRulesetsDetailsRequest; response: GetEnabledRulesetsDetailsResponse };
  getRulesetRules: { request: GetRulesetRulesRequest; response: GetRulesetRulesResponse };
  getAllDynamicRules: { request: GetAllDynamicRulesRequest; response: GetAllDynamicRulesResponse };
  getAllSessionRules: { request: GetAllSessionRulesRequest; response: GetAllSessionRulesResponse };
  getMatchedRules: { request: GetMatchedRulesRequest; response: GetMatchedRulesResponse };
  excludeFromStrictBlock: { request: ExcludeFromStrictBlockRequest; response: ExcludeFromStrictBlockResponse };
  getFilteringMode: { request: GetFilteringModeRequest; response: GetFilteringModeResponse };
  getImportedLists: { request: GetImportedListsRequest; response: GetImportedListsResponse };
}

/** Content-script / internal messages (class C). Typed for completeness only. */
export interface InternalMessageMap {
  insertCSS: { request: InsertCSSRequest; response: InsertCSSResponse };
  removeCSS: { request: RemoveCSSRequest; response: RemoveCSSResponse };
  injectCSSProceduralAPI: { request: InjectCSSProceduralAPIRequest; response: InjectCSSProceduralAPIResponse };
  toggleToolbarIcon: { request: ToggleToolbarIconRequest; response: ToggleToolbarIconResponse };
  startCustomFilters: { request: StartCustomFiltersRequest; response: StartCustomFiltersResponse };
  terminateCustomFilters: { request: TerminateCustomFiltersRequest; response: TerminateCustomFiltersResponse };
  injectCustomFilters: { request: InjectCustomFiltersRequest; response: InjectCustomFiltersResponse };
  updateImportedLists: { request: UpdateImportedListsRequest; response: UpdateImportedListsResponse };
  pruneCSSCache: { request: PruneCSSCacheRequest; response: PruneCSSCacheResponse };
  keepAlive: { request: KeepAliveRequest; response: KeepAliveResponse };
}

export type BridgeMessageName = keyof BridgeMessageMap;

/** One bridge function per class-A message; the name is the `what` string. */
export const BRIDGE_FUNCTION_NAMES = [
  // popup
  'popupPanelData',
  'setPendingFilteringMode',
  'setFilteringMode',
  'showMatchedRules',
  'gotoURL',
  // settings
  'getOptionsPageData',
  'setDefaultFilteringMode',
  'setAutoReload',
  'setShowBlockedCount',
  'setStrictBlockMode',
  'setPopupBlockMode',
  'setDeveloperMode',
  // filter lists
  'getEnabledRulesets',
  'getRulesetDetails',
  'applyRulesets',
  'importFilterList',
  // backup / restore / reset
  'getDefaultConfig',
  'getSandboxFilters',
  'getFilteringModeDetails',
  'setFilteringModeDetails',
  'getAllCustomFilters',
  'removeAllCustomFilters',
  'addManyCustomFilters',
  'setSandboxFilters',
  'updateUserDnrRules',
  // about / troubleshooting
  'getCurrentConfig',
  'getDefaultFilteringMode',
  'getEffectiveUserRules',
  'getConsoleOutput',
  'getRegisteredContentScripts',
  'hasBroadHostPermissions',
] as const satisfies readonly BridgeMessageName[];

/**
 * Class-A messages whose success response is never nullish: a nullish
 * response means the call failed and must be surfaced as an error.
 * The other class-A messages answer nothing on success, except
 * `getSandboxFilters` (nullish = nothing stored) and `gotoURL` (browser
 * objects nobody reads): for all of those a nullish response is normal and
 * failure shows only as a transport rejection.
 */
export const NEVER_NULLISH_ON_SUCCESS = [
  'popupPanelData',
  'setFilteringMode',
  'getOptionsPageData',
  'setDefaultFilteringMode',
  'setDeveloperMode',
  'getEnabledRulesets',
  'getRulesetDetails',
  'getDefaultConfig',
  'getFilteringModeDetails',
  'setFilteringModeDetails',
  'getAllCustomFilters',
  'updateUserDnrRules',
  'getCurrentConfig',
  'getDefaultFilteringMode',
  'getEffectiveUserRules',
  'getConsoleOutput',
  'getRegisteredContentScripts',
  'hasBroadHostPermissions',
] as const satisfies readonly BridgeMessageName[];

/** Names the UI must never send (content scripts / internal jobs). */
export const FORBIDDEN_MESSAGE_NAMES = [
  'insertCSS',
  'removeCSS',
  'injectCSSProceduralAPI',
  'toggleToolbarIcon',
  'startCustomFilters',
  'terminateCustomFilters',
  'injectCustomFilters',
  'updateImportedLists',
  'pruneCSSCache',
  'keepAlive',
] as const satisfies readonly (keyof InternalMessageMap)[];

/** Suggested call shape: payload without `what`, promise of the response. */
export type Bridge = {
  [K in BridgeMessageName]: (
    payload: Omit<BridgeMessageMap[K]['request'], 'what'>,
  ) => Promise<BridgeMessageMap[K]['response']>;
};

/* ---------- BroadcastChannel('uBOL') ---------- */

export const BROADCAST_CHANNEL_NAME = 'uBOL';

/** Any subset of keys may be present in one message. */
export interface BroadcastMessage {
  hasOmnipotence?: boolean;
  defaultFilteringMode?: FilteringLevel;
  filteringModeDetails?: FilteringModeDetailsSets;
  autoReload?: boolean;
  showBlockedCount?: boolean;
  strictBlockMode?: boolean;
  popupBlockMode?: boolean;
  developerMode?: boolean;
  adminRulesets?: RulesetToken[];
  enabledRulesets?: string[];
}

/* ---------- storage keys the rebuilt UI touches directly ---------- */

export interface UiLocalStorage {
  /** Absent means 'settings'. */
  'dashboard.activePane'?: 'rulesets' | 'filters' | 'develop' | 'about';
  /** Absent means ['ads', 'regions', 'imported']. '*' = all collapsed. */
  hideUnusedFilterLists?: string[];
  /** Rule text; read by backup, written/removed by restore. */
  userDnrRules?: string;
  /** Restore only. */
  'rulesets.imported'?: ImportedListEntry[];
  /** Restore only. */
  deferredJobs?: Array<{ name: string; time: number }>;
}

/* ---------- backup file ---------- */

export interface BackupFile {
  version: string;
  autoReload?: boolean;
  developerMode?: boolean;
  popupBlockMode?: boolean;
  showBlockedCount?: boolean;
  strictBlockMode?: boolean;
  /** "+id" / "-id" relative to the default set. */
  rulesets?: RulesetToken[];
  filteringModes?: FilteringModeDetails;
  customFilters?: CustomFilterEntry[];
  /** Sandbox text split on '\n'. */
  sandboxFilters?: string[];
  /** userDnrRules split on /\n+/. */
  dnrRules?: string[];
  /** Legacy input only: "hostname##selector" lines. */
  cosmeticFilters?: string[];
}

/* ---------- container app (WKWebView, not the extension) ---------- */

/** Must exist on window when Main.html finishes loading. */
export type ContainerShow = (enabled: boolean, useSettingsInsteadOfPreferences: boolean) => void;
/** The only message body the native side accepts; must be a string. */
export const CONTAINER_OPEN_PREFERENCES = 'open-preferences';
```

---

## 21. Wire-level parity checklist (audit)

Scope: the transport, the bridge, and the sequences that cross surfaces. UI-level lines are in
`popup.md` §16, `settings.md` §14, `filter-lists.md` §19 and `dashboard-shell.md` §8. Those files
own the UI. A few payload lines are repeated here on purpose because a wrong payload can turn
blocking off.

How to test: run the React page against `src/dev/mock-ext.ts` with a recorder that keeps, in order,
the following:
- a deep copy of every `runtime.sendMessage` argument, taken at call time;
- every call to `tabs.*`, `permissions.*`, `scripting.*`, `storage.local.*` (`get`/`set`/`remove`/
  `getKeys`), `alarms.*`, `runtime.openOptionsPage`, `window.close` and `confirm`;
- every `new BroadcastChannel(name)`.

Wording used below:
- "MSG {…}" = one `sendMessage` whose argument deep-equals that object: same keys, no extra keys,
  numbers as numbers.
- "→" = strictly after.
- "nothing else" = no other recorded call.

Fixture F (unless a line says otherwise):
- popup tab: `{ id: 42, url: 'https://www.example.com/path?x=1' }`;
- `popupPanelData` answers `{ hasOmnipotence: false, level: 1, autoReload: true, isSideloaded: true,
  developerMode: false, hasCustomFilters: 0 }`;
- `getOptionsPageData` answers the §5.1 shape with `defaultFilteringMode: 2`,
  `enabledRulesets: ['ublock-filters','easylist','easyprivacy']`, `adminRulesets: []`,
  `rulesetDetails` = the 51 PRISTINE entries, all five toggles at their defaults (§3.5, so
  `strictBlockMode: false`), `canShowBlockedCount: true`, `supportsCompiledFilters: false`,
  `supportsUserScripts: false`, `disabledFeatures` absent;
- `getDefaultConfig` answers `{ autoReload: true, developerMode: false, showBlockedCount: true,
  strictBlockMode: false, popupBlockMode: true, rulesets: ['ublock-filters','easylist','easyprivacy'],
  filteringModes: { none: [], basic: [], optimal: ['all-urls'], complete: [] } }`;
- every other read answers its documented success shape;
- `permissions.request` resolves `true`.

### 21.1 Bridge and transport

1. Each class-A bridge function makes exactly one `runtime.sendMessage` call. Its argument is
   `{ what: <name>, ...payload }` with exactly the payload keys of §2.1. The optional keys (`toRemove`
   of `applyRulesets`, `type` of `gotoURL`) are absent unless used. No key has the value `undefined`.
2. Over the whole run of every test below, every `what` sent by the React documents is in
   `BRIDGE_FUNCTION_NAMES`. None contains `:`, and none is in `FORBIDDEN_MESSAGE_NAMES` or in
   `ClassicMessageMap`. A grep of the built `ui/**` for the class-B and class-C names (§9, §10) finds
   no `what:` literal for them. The embedded `dashboard-classic.html` is a separate document and is
   out of scope here; see §9.1.
3. For each name in `NEVER_NULLISH_ON_SUCCESS`: a mock answer of `undefined`, and separately of
   `null`, makes the bridge promise reject. For every other class-A name, both resolve without error.
4. When `runtime.sendMessage` rejects, every bridge function rejects. None resolves `undefined`
   (contrast js/ext.js:51-55).
5. Every `level`, `beforeLevel` and `afterLevel` sent is a number in {0,1,2,3}. Every `tabId` is a
   number. Every `state` is a boolean. Every `hostname` is a string. A test that feeds a string
   level, `NaN` or `undefined` into the calling code sees NO message (§1.6 item 5).
6. The React pages never call `runtime.onMessage.addListener`, `runtime.connect`,
   `runtime.sendNativeMessage` or `storage.sync`, and never open a `BroadcastChannel` with a name
   other than `'uBOL'`.

### 21.2 Popup (wire view; UI detail in `popup.md` §16)

7. Open → `tabs.query({ active: true, currentWindow: true })` → MSG
   `{ what: 'popupPanelData', origin: 'https://www.example.com', hostname: 'www.example.com' }`.
   Nothing else, and no storage call.
8. Open on `about:blank`, `file:///x` or a missing `url` → `tabs.query(…)` only.
9. Level 1 → 2: MSG `{ what: 'setPendingFilteringMode', tabId: 42, url: 'https://www.example.com/path?x=1',
   hostname: 'www.example.com', beforeLevel: 1, afterLevel: 2 }`, then
   `permissions.request({ origins: [ '*://*.www.example.com/*' ] })`. Both calls are recorded before
   the dispatch of the user event returns (synchronous gesture; ARCHITECTURE §6.6). After `true`
   → MSG `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 2 }` → `tabs.reload(42)`
   no earlier than 437 ms after the answer.
10. As line 9 with `permissions.request` resolving `false`, and separately rejecting → the pending
    MSG and the request only; nothing else.
11. Level 2 → 3 (open with `level: 2`) → `permissions.request(…)` → MSG `setFilteringMode` with
    `level: 3` → reload. No `setPendingFilteringMode`.
12. Level 1 → 0 → MSG `{ what: 'setFilteringMode', hostname: 'www.example.com', level: 0 }` → reload.
    No permission call.
13. With `autoReload: false` → no `tabs.reload` and no `tabs.update` after any change.
14. Report → MSG `{ what: 'gotoURL', url: '/report.html?tabid=42&url=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1&mode=1' }`.
    After a level change in the same popup, `mode` is still `1` (§4.5).
15. Matched rules (`developerMode: true`) → MSG `{ what: 'showMatchedRules', tabId: 42 }`.
16. Zapper / Picker / Unpicker → exactly the `scripting.executeScript` arguments of §4.6 →
    `window.close()`. No message.

### 21.3 Settings and default mode (UI detail in `settings.md` §14)

17. Dashboard load → MSG `{ what: 'getOptionsPageData' }` exactly once per page. Then
    `new BroadcastChannel('uBOL')` only if the answer is an object.
18. Default 1 → MSG `{ what: 'setDefaultFilteringMode', level: 1 }`. No permission call.
19. Default 2 or 3 → `permissions.request({ origins: [ '<all_urls>' ] })` recorded synchronously in
    the gesture → after `true`, MSG `{ what: 'setDefaultFilteringMode', level: N }`. After `false` or
    a rejection → no message.
20. Each toggle change → exactly one MSG `{ what: <name>, state: <boolean> }` (§5.3). The cached value
    shown elsewhere (for example in backup) changes only after a broadcast carrying that key. The
    exception is `setDeveloperMode`, whose Develop tab visibility follows at once.
21. Broadcasts received on `'uBOL'` never cause a message, except `{ enabledRulesets }` or a changed
    `{ adminRulesets }`. Those cause MSG `getEnabledRulesets` + MSG `getRulesetDetails`, and only
    after the Filter lists pane has been shown once.

### 21.4 Filter lists (UI detail in `filter-lists.md` §19)

22. No `applyRulesets` can be produced before both reads of line 21 have answered for the pane's
    first display.
23. Tick `deu-0` with fixture F → nothing for 996 ms → MSG
    `{ what: 'applyRulesets', enabledRulesets: [ …the four ids… ] }`. The list holds exactly the
    checked non-admin leaf ids, and every id is in the last `getRulesetDetails` answer. Element order
    is as `filter-lists.md` defines it; the background treats the list as a set
    (js/ruleset-manager.js:606). There is no `toRemove` key.
24. Untick every list and wait → MSG `{ what: 'applyRulesets', enabledRulesets: [] }` is sent (legal;
    upstream does the same). It is sent only after line 22 holds.
25. With the `{ enabledRulesets }` echo delivered: tick X, commit, untick X → a second MSG without X.
    The echo-off behaviour must match `filter-lists.md` (upstream sends nothing, §6.3, §18 item 27).
26. No `importFilterList` is ever sent while `supportsCompiledFilters` is `false`.

### 21.5 Backup, restore, reset (sequence parity; §7)

27. Backup with fixture F → MSG `{ what: 'getDefaultConfig' }` and MSG `{ what: 'getSandboxFilters' }`
    (sent in that order, the second before the first is awaited) → MSG `getFilteringModeDetails` →
    MSG `getAllCustomFilters` → `storage.local.get('userDnrRules')` → one download of `my-ubol-settings.json`. The content
    deep-equals `{ version: '2026.1003.1243', filteringModes: <answer> }` (all defaults, so no other
    keys), as `JSON.stringify(out, null, 2) + '\n'`.
28. Backup when `getFilteringModeDetails` answers `undefined` → no file, and an error is shown
    (§7.1).
29. Reset after confirmation (the `confirm` mock returns `true`) produces exactly this sequence,
    each step awaited:
    1. MSG `{ what: 'getDefaultConfig' }`;
    2. MSG `{ what: 'setAutoReload', state: true }`;
    3. MSG `{ what: 'setShowBlockedCount', state: true }`;
    4. MSG `{ what: 'setDeveloperMode', state: false }`;
    5. MSG `{ what: 'setStrictBlockMode', state: false }`;
    6. MSG `{ what: 'setPopupBlockMode', state: true }`;
    7. `storage.local.get('rulesets.imported')`;
    8. MSG `{ what: 'applyRulesets', enabledRulesets: ['ublock-filters','easylist','easyprivacy'] }`;
    9. MSG `{ what: 'setFilteringModeDetails', modes: { none: [], basic: [], optimal: ['all-urls'], complete: [] } }`;
    10. MSG `{ what: 'removeAllCustomFilters', hostname: '*' }`;
    11. MSG `{ what: 'setSandboxFilters', text: '' }`;
    12. `storage.local.remove('userDnrRules')`;
    13. MSG `{ what: 'updateUserDnrRules' }`.

    Nothing else: no `permissions` call, no `alarms` call, no `addManyCustomFilters`. Step 7 assumes
    no imported lists are stored; with stored lists see line 31.
30. Reset with `confirm` returning `false` → `confirm(<resetToDefaultConfirm text>)` only.
31. Restore of `{ rulesets: ['+https://example.org/list.txt'] }`, with `rulesets.imported` absent
    and `deferredJobs` holding one `pruneCSSCache` job → steps 1-7 of line 29, then:
    1. `storage.local.get('rulesets.imported')` again (inside `addImportedLists`,
       js/imported-lists.js:186);
    2. `storage.local.getKeys()`, or `get(null)` when `getKeys` is missing;
    3. `storage.local.set({ 'rulesets.imported': [ <§6.4 entry for the URL> ] })`;
    4. `storage.local.get('deferredJobs')`. `removeJob('updateImportedLists')` finds no such job, so
       there is no `alarms` call and no `deferredJobs` write.

    Calls 3 and 4 run in one `Promise.all` and may interleave (js/imported-lists.js:121-125). Then
    MSG `{ what: 'applyRulesets', enabledRulesets: ['ublock-filters','easylist','easyprivacy','https://example.org/list.txt'] }`,
    then steps 9-13 of line 29.
32. Restore of a file with all five toggles, but `getDefaultConfig` failing → the bridge rejects
    at step 1, and NOTHING after it is sent. This follows from ARCHITECTURE §6.5 (no swallowed
    failures). Upstream would instead apply steps 2-6 and then throw at step 7 (§7.2).
    A restore that throws midway (the §7.2 validation examples) shows an error and ends the busy
    state.
33. Restore never calls `permissions.request`, even when the file sets the default to optimal or
    complete.

### 21.6 About / troubleshooting (UI detail in `dashboard-shell.md` §8)

34. Expanding the troubleshooting block → `runtime.getPlatformInfo()` plus the nine MSGs of §8.2
    (`getDefaultConfig`, `getCurrentConfig`, `getEnabledRulesets`, `getRulesetDetails`,
    `getDefaultFilteringMode`, `getEffectiveUserRules`, `getConsoleOutput`,
    `getRegisteredContentScripts`, `hasBroadHostPermissions`), all started before any of them is
    awaited. Nothing else. Collapsing and expanding again repeats the set.
35. Fixture: F, plus UA `… Version/18.6 Safari/…`, `getPlatformInfo` → `{ os: 'mac' }`,
    `getCurrentConfig` → the §3.5 defaults, `getEnabledRulesets` →
    `['ublock-filters','easylist','easyprivacy']`, `getDefaultFilteringMode` → `2`,
    `hasBroadHostPermissions` → `true`, and `getEffectiveUserRules`, `getConsoleOutput`,
    `getRegisteredContentScripts` → `[]`. The text equals `renderData` (§8.2) of
    `{ name, version, browser: 'Safari 18.6 (mac)', filtering: { default: 'optimal' }, permission: 'all',
    rules: <sum of rules.total of the three lists>, rulesets: ['easylist','easyprivacy','ublock-filters'] }`.
    There are no `strictblock`/`popupblock`/`badge`/`user rules`/`scripting`/`console` lines, and a
    `getEnabledRulesets` answer the bridge cached is left unmutated.
36. Clicking an About link sends no message.

### 21.7 Storage keys written by React pages

37. Over all tests, the React pages write only `dashboard.activePane`, `hideUnusedFilterLists`,
    `userDnrRules`, and (restore/reset only) `rulesets.imported`, `rulesets.imported.compiled.*`
    (removal) and `deferredJobs`. They never write a §12.2 key.

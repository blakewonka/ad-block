# Spec: dashboard "Filter lists" pane

Behaviour spec for the React rebuild of the upstream `rulesets` pane. Implementers follow this
document instead of reading upstream code. It describes behaviour and data only, no visual design.

Status of every statement: taken from the upstream source at the cited `file:line`. Anything that
could not be determined from the repository is marked **UNKNOWN** (collected in section 17). Places
where upstream behaviour is defective or surprising are marked **QUIRK Qn** and collected in section
16 with a recommended treatment. Places where the React pane is expected to differ from upstream on
purpose are marked **DEVIATION Dn** (also section 16). Statements tagged **[run Rn]** were
additionally observed by running the unmodified upstream dashboard (section 18).

## 0. Sources and citation conventions

| Short name used in citations | Full path |
|---|---|
| `dashboard.html` | `upstream/platform/mv3/extension/dashboard.html` |
| `filter-lists.js`, `settings.js`, `dashboard.js`, `background.js`, `ruleset-manager.js`, `admin.js`, `imported-lists.js`, `ext.js`, `utils.js`, `config.js`, `compiled-filters.js`, `backup-restore.js`, `fetch.js`, `filter-manager-ui.js`, `ext-offscreen.js`, `troubleshooting.js` | `upstream/platform/mv3/extension/js/<name>` |
| `settings.css`, `dashboard.css` | `upstream/platform/mv3/extension/css/<name>` |
| `src/js/dom.js`, `src/js/i18n.js`, `src/css/common.css`, `src/css/fa-icons.css` | `upstream/src/...` (copied unchanged into the build) |
| `safari/ext-compat.js`, `safari/ext-offscreen.js`, `safari/manifest.json` | `upstream/platform/mv3/safari/<name>` |
| `chromium/manifest.json` | `upstream/platform/mv3/chromium/manifest.json` |
| `make-rulesets.js` | `upstream/platform/mv3/make-rulesets.js` |
| `ruleset-details.json` | `build/pristine/safari/rulesets/ruleset-details.json` |
| `messages.json` | `build/pristine/safari/_locales/en/messages.json` (cited line = line of the key) |
| PRISTINE | `build/pristine/safari` |

Checked with `cmp`: the PRISTINE copies of `dashboard.html`, `css/settings.css`, `css/dashboard.css`,
`js/filter-lists.js`, `js/settings.js`, `js/dashboard.js`, `js/background.js`,
`js/ruleset-manager.js`, `js/admin.js`, `js/imported-lists.js`, `js/ext.js`, `js/utils.js`,
`js/config.js`, `js/compiled-filters.js`, `js/backup-restore.js`, `js/filter-manager-ui.js`,
`js/troubleshooting.js`, `js/fetch.js`,
`js/dom.js`, `js/i18n.js`, `css/common.css`, `css/fa-icons.css` are byte-identical to the sources
above, so the line numbers apply to the built extension too. In PRISTINE, `js/ext-compat.js` and
`js/ext-offscreen.js` are the **Safari** files (`safari/ext-compat.js`, `safari/ext-offscreen.js`),
not the generic ones (also checked with `cmp`).

`filter-lists.js` is not referenced from `dashboard.html`; it is loaded because `settings.js`
imports it (`settings.js:25`).

## 1. Data sources and message contract

All messages go through `runtime.sendMessage` (`ext.js:51-55`). Upstream's wrapper swallows a
rejected send (logs, resolves `undefined`); our bridge must not (ARCHITECTURE 6.5). The background
answers only when the sender origin is the extension itself (`background.js:376-378`) and after
initialisation (`background.js:343`); the listener is at `background.js:857-861`.

The listener is `onMessage(request, sender).then(callback); return true;` (`background.js:859-860`):
when a handler throws or rejects, `callback` is **never called**, so the page gets no response at
all. What the sender's promise then does on Safari (reject when the port closes, or never settle) is
**UNKNOWN** (17.8; same row in `messaging.md` section 1.5). Every message of this pane can hit this:
`getRulesetDetails` when the JSON fetch failed (1.3), `applyRulesets` when anything inside
`enableRulesets`/`saveRulesetConfig`/`registerContentScripts` throws (`background.js:239-260`).
Consequences for the commit path are in 9.4 (QUIRK Q14).

Browser-API surface of this pane, complete (checked by grepping `filter-lists.js`, `settings.js`,
`dashboard.js`): the messages of 1.2-1.5, `storage.local` get/set of the single key of 1.6, one
`beforeunload` listener (14) and, through the shell, the `BroadcastChannel('uBOL')` listener (1.7).
No `permissions.*`, `tabs.*`, `scripting.*`, `storage.session`, `storage.onChanged`,
`localStorage` or `sessionStorage` use. The `windows.onFocusChanged` listener that the upstream page
gets from importing the Safari `ext-compat.js` is page-wide, not this pane's (15).

### 1.1 `getOptionsPageData` (sent by the dashboard shell, not by this pane)

Sent once at page load: `{ what: 'getOptionsPageData' }` (`settings.js:329-331`). The response
replaces the page-global `self.cachedRulesetData`, which starts as `{}` (`settings.js:327,333`).
Fields this pane reads (`background.js:423-441`):

| Field | Type | Used for |
|---|---|---|
| `adminRulesets` | `string[]` of tokens `+id` / `-id` (`admin.js:171-205`) | admin lock, section 11 |
| `maxNumberOfEnabledRulesets` | number, `dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` (`background.js:428`) | limit, section 10 |
| `supportsCompiledFilters` | boolean, `supportsOffscreenDocument` (`background.js:439`) | imported lists availability, section 12 |
| `supportsUserScripts` | boolean (`background.js:440`, `ext.js:40-44`) | the "user scripts" notice inside the import area (`settings.css:274-280`) |
| `disabledFeatures` | `string[]` or undefined (`background.js:420,438`) | if it contains `dashboard`, the whole pane and its tab are hidden and the shell forces the active pane to `about` (`settings.js:29-36`, `settings.css:32-39`) |

`enabledRulesets` and `rulesetDetails` are also present in that response (`background.js:426,429`)
but the pane does not render from them: it fetches both again (1.2, 1.3) and overwrites those two
fields (`filter-lists.js:124-133`).

Cross-pane contract: the Settings pane's backup reads `cachedRulesetData.enabledRulesets`
(`settings.js:138`, `backup-restore.js:62`). Upstream keeps that field current from this pane's
reads (`filter-lists.js:132`) and from broadcasts (`settings.js:312-314`). The React store must keep
one shared, current `enabledRulesets` value for the same purpose. Upstream writes the read result
there unchecked (`filter-lists.js:132`), so a failed read stores `undefined` and the next backup
throws on `for ( const id of enabledRulesets )` (`backup-restore.js:64`). The React store must only
ever replace that value with a successful `string[]` read or a broadcast array.

Failure of this request (upstream): `sendMessage` resolves `undefined`, the `.then` returns at
`if ( !data ) { return; }` (`settings.js:332`), so `body.loading` is never removed and the whole
dashboard stays `visibility: hidden` (`dashboard.html:22`, `settings.css:14-16`), and the
BroadcastChannel listener is never created (`settings.js:350` not reached). The pane itself can still
initialise (IntersectionObserver ignores `visibility`), with `cachedRulesetData = {}`: no admin locks,
no limit. React treatment: show the failure and do not offer the pane's controls until the options
data has been read successfully (part of D2 and D4).

### 1.2 `getEnabledRulesets`

Request, exact: `{ what: 'getEnabledRulesets' }` (`filter-lists.js:128`).
Response: `string[]` = ids of the enabled static rulesets as reported by the browser
(`dnr.getEnabledRulesets()`), followed by the ids of the enabled imported lists
(`background.js:444-445`, `ruleset-manager.js:548-557`, `imported-lists.js:71-74`).

1.2 and 1.3 are always sent together: both `sendMessage` calls are made synchronously inside one
`Promise.all`, `getEnabledRulesets` first, then `getRulesetDetails`, without waiting for either
answer (`filter-lists.js:124-130`). Upstream renders nothing until both have answered. Note for
tests: the About pane's troubleshooting block sends the same two requests when it scrolls into view
(`troubleshooting.js:69-70`, triggered from `dashboard.js:58-66`); they are not this pane's.

### 1.3 `getRulesetDetails`

Request, exact: `{ what: 'getRulesetDetails' }` (`filter-lists.js:129`).
Response: array of ruleset records = the content of `/rulesets/ruleset-details.json` followed by the
imported lists from `storage.local['rulesets.imported']`, de-duplicated by `id`
(`background.js:447-450`, `ruleset-manager.js:78-89`, `imported-lists.js:78-81`). If the JSON file
cannot be fetched the handler throws and the page gets no usable response (`fetch.js:26-32`,
`ruleset-manager.js:87`; the callback is never called, section 1). The fetch promise is cached for
the lifetime of the background context (`ruleset-manager.js:79-81`), so after one failed fetch every
later `getRulesetDetails` (and `getOptionsPageData`, `applyRulesets`, which also call it,
`background.js:417`, `ruleset-manager.js:614`) fails the same way until the background restarts. A
React retry button therefore cannot be expected to succeed by itself; it must still be offered and
must still report the failure.

Stock record shape (written by `make-rulesets.js:1123-1154`; keys whose value is `undefined` are
absent from the JSON). Real example, `ruleset-details.json:2-26`:

```json
{
  "id": "ublock-filters",
  "name": "uBlock filters – Ads, trackers, and more",
  "group": "default",
  "enabled": true,
  "homeURL": "https://github.com/uBlockOrigin/uAssets",
  "filters": { "total": 10728, "accepted": 10703, "rejected": 1 },
  "rules": { "total": 6913, "plain": 6651, "regex": 262, "strictblock": 53, "urlskip": 240, "rejected": 0 },
  "css": { "generic": 685, "specific": 5138 },
  "popups": 178
}
```

Real example with `parent`, `lang`, `tags` (`ruleset-details.json:1015-1041`):

```json
{
  "id": "rus-0",
  "name": "🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList",
  "group": "regions",
  "parent": "🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList",
  "enabled": false,
  "lang": "be kk tt ru uz",
  "tags": "ads belarusian беларуская kazakh tatar russian русский ukrainian українська uzbek uk",
  "homeURL": "https://forums.lanik.us/viewforum.php?f=102",
  "filters": { "total": 19834, "accepted": 19827, "rejected": 7 },
  "rules": { "total": 17148, "plain": 17132, "regex": 16, "strictblock": 8, "rejected": 0 },
  "css": { "generic": 1269, "specific": 7710 },
  "popups": 770
}
```

Real example without `group` (`ruleset-details.json:305-325`): `ubol-tests` has only `id`, `name`,
`enabled`, `homeURL`, `filters`, `rules`, `css`.

Field inventory of the real file (51 records, measured with a script):

| Field | Present in | Meaning for this pane |
|---|---|---|
| `id` string | 51 | ruleset id; the value sent in `applyRulesets` |
| `name` string | 51 | display name; all 37 `regions` names start with regional-indicator flag emoji, no other name has one |
| `group` string | 49 (values: `regions` 37, `annoyances` 7, `default` 3, `ads` 1, `privacy` 1) | group selection, section 3.1. Absent on `ublock-experimental` and `ubol-tests` |
| `parent` string | 3 (`pol-0`, `rus-0`, `rus-1`) | composite parent path, segments separated by `\|` (`filter-lists.js:301`). No real value contains `\|` |
| `enabled` boolean | 51 (true only for `ublock-filters`, `easylist`, `easyprivacy`) | "enabled by default" flag, NOT the current state; drives `isDefault` (4.3) |
| `lang` string | 36 (all in `regions`; `rus-1` is the one regional record without it) | only used to keep a group-less ruleset out of `misc` (3.1) |
| `tags` string | 37 (36 regional records and `adguard-mobile`) | search haystack (8) |
| `homeURL` string | 51, never empty | home link (3.6) |
| `filters.accepted` number | 51 | "filter count" (5) |
| `rules.plain`, `rules.regex` numbers | 51 | "rule count" = `plain + regex` (5). In the real file `rules.total === plain + regex` for all 51 records, and both numbers equal the number of entries in `PRISTINE/rulesets/main/<id>.json` and `PRISTINE/rulesets/regex/<id>.json` (measured) |
| `rules.strictblock` (45), `rules.urlskip` (2), `rules.rejected` (51), `filters.total`, `filters.rejected`, `css.generic`, `css.specific` (51), `popups` (30) | varies | not used by this pane |

No record has a `title` or `preferred` key (they matter for sorting, 3.4). The 51 ids are exactly
the 51 ids of `declarative_net_request.rule_resources` in `PRISTINE/manifest.json` (measured).

`enabled` is only the build-time default flag. The set actually enabled at install is computed by
the background and also contains regional lists whose `lang` matches a browser language
(`ruleset-manager.js:449-456,471-476`) and, when the user agent contains `Mobile`, lists whose
`tags` contain the word `mobile` (`ruleset-manager.js:458-460,477-481`; with the real data that is
`adguard-mobile`). Imported lists are skipped (`ruleset-manager.js:465`). None of those extra lists
becomes `isDefault` (4.3), so "hide unused" can still hide them when unchecked.

Imported-list record shape, `imported-lists.js:194-215`: `{ id: <url>, name, group: 'imported',
enabled, homeURL, expires: 7, time: { added, updated }, filters: { total, accepted, rejected },
rules: { total, plain, regex } }`. Here `enabled` is the live state (created `false`,
`imported-lists.js:198`; flipped by `imported-lists.js:85-109`), unlike stock records. Such records
cannot be created through this pane on Safari; see 12.1 for how one can still exist.

### 1.4 `applyRulesets` (the only state-changing message of this pane on Safari)

Request, exact (`filter-lists.js:450-456`):

```js
{ what: 'applyRulesets', enabledRulesets }             // debounced commit
{ what: 'applyRulesets', enabledRulesets, toRemove }   // "final" commit at page unload only
```

- `enabledRulesets`: `string[]`, the **complete** list of ids that must be enabled (not a delta),
  built as described in 9.2.
- `toRemove`: `string[]` of imported-list ids flagged for deletion; present only in the unload path
  (`filter-lists.js:454-456`), where it is present even when empty (`[]`) [run R7].

Response: **always `undefined`**. The handler ends with a bare `return;`
(`background.js:382-388`) and the helper it awaits returns nothing (`background.js:239-260`).
Consequences are in 9.5.

What the background does with it (`background.js:239-260`, `ruleset-manager.js:605-703`):
1. `afterIds = new Set(enabledRulesets)`; admin tokens are then forced on top: `+id` adds, `-id`
   removes (`ruleset-manager.js:606-625`).
2. It diffs against the currently enabled set and enables/disables the difference
   (`ruleset-manager.js:627-674`). So an id missing from the payload is **disabled**.
3. If something changed it stores the resulting list in `rulesetConfig.enabledRulesets`, saves the
   config and re-registers content scripts (`background.js:243-258`).
4. It always posts `{ enabledRulesets: rulesetConfig.enabledRulesets }` on
   `BroadcastChannel('uBOL')` (`background.js:259`, `utils.js:133-136`), changed or not.
5. If `toRemove` is truthy it then deletes those imported lists (`background.js:384-386`,
   `imported-lists.js:225-232`). `[]` is truthy but deletes nothing (`imported-lists.js:226-229`).

Hazards (derived from the code above, not exercised):
- `enabledRulesets: []` disables every non-admin ruleset. `enabledRulesets: undefined` does the same
  (`new Set(undefined)` is empty, `ruleset-manager.js:606`).
- An id that is not in the current ruleset details and is not currently enabled sets
  `stockUpdated = true` (`ruleset-manager.js:642-650`); if nothing else changes the function returns
  without `enabledRulesets` (`ruleset-manager.js:656-658`) and the background then stores
  `rulesetConfig.enabledRulesets = undefined` (`background.js:243-245`). A URL-shaped unknown id
  does the same through `importedUpdated` (`ruleset-manager.js:645-646`). Never send an id that is
  not in the latest `getRulesetDetails` response.
  - Follow-on effects of that `undefined` (traced in the code, not executed): the broadcast is
    `{ enabledRulesets: undefined }`, which the dashboard listener ignores (`settings.js:312`), so no
    page re-renders and the pane keeps showing the user's choice; the saved config loses the key, and
    at the next background start without session data the background calls
    `enableRulesets(rulesetConfig.enabledRulesets)` with the built-in default `[]`
    (`background.js:728-733`, `config.js:32,59-61`), which **disables every ruleset not forced by an
    admin token** (full trace in `messaging.md` section 6.3, HAZARD). The same `undefined` is stored
    when the trailing `getEnabledRulesets` inside `enableRulesets` fails after a real change
    (`ruleset-manager.js:691-700`).
- `enabledRulesets` must be a JavaScript array of strings. A string is iterated by `new Set(...)`
  character by character (`ruleset-manager.js:606`); every character is an unknown id and is dropped
  (`ruleset-manager.js:642-650`), and every currently enabled non-admin ruleset is disabled
  (`ruleset-manager.js:633-636`).

### 1.5 `importFilterList` (not reachable on Safari, see 12)

Request, exact: `{ what: 'importFilterList', url }` (`filter-lists.js:495`). Response: `undefined`
(`background.js:640-647`).

### 1.6 Storage key owned by this pane

`storage.local['hideUnusedFilterLists']`: `string[]`, see 7. Read with
`browser.storage.local.get('hideUnusedFilterLists')`, written with
`browser.storage.local.set({ hideUnusedFilterLists: [...] })` (`ext.js:59-72`,
`filter-lists.js:376,380`) [run R1, R2]. The key is not part of the settings backup and is not
touched by restore or "reset to default" (`backup-restore.js` never names it; checked by grep). The
upstream write is not awaited and its failure is not handled (`filter-lists.js:376`, `ext.js:69-72`).

### 1.7 Broadcasts consumed

`new BroadcastChannel('uBOL')`, listener created by the dashboard shell only after the options data
arrived (`settings.js:244-247,332,350`). Messages relevant to this pane (`settings.js:305-322`):

```js
{ enabledRulesets: string[] }                          // background.js:259 (every applyRulesets, importFilterList, restore)
{ adminRulesets: string[], enabledRulesets: string[] } // admin.js:124-135 (managed "rulesets" policy changed)
```

Broadcasts posted before the listener exists (options data not yet answered, or never answered,
1.1) are lost; nothing replays them. `{ enabledRulesets: undefined }` (1.4 hazard) carries no
`enabledRulesets` for the `!== undefined` test (`settings.js:312`) and triggers nothing. Other
broadcast keys (`hasOmnipotence`, `defaultFilteringMode`, `autoReload`, `showBlockedCount`,
`strictBlockMode`, `popupBlockMode`, `developerMode`, `filteringModeDetails`) do not concern this
pane (`settings.js:256-303`).

### 1.8 i18n keys used by this pane

| Key | English text | `messages.json` line | Where |
|---|---|---|---|
| `perRulesetStats` | "{{ruleCount}} rules, converted from {{filterCount}} network filters" | 10 | totals line and leaf tooltip (5) |
| `3pGroupDefault` ... `3pGroupImported` | see 3.1 | 70-98 | group names (3.1) |
| `findListsPlaceholder` | "Find lists" | 322 | search input placeholder (8) |
| `aboutFilterLists` | "Filter lists" | 146 | the tab button, owned by the shell (`dashboard.html:29`) |
| `customListImportLabel` | "Add filter list…" | 102 | import area, not shown on Safari (12) |
| `customListImportPlaceholder` | "URL of the filter list to add" | 106 | same |
| `customListImportUserScriptsInfo`, `userScriptsInfo` | (long texts) | 110, 122 | same |
| `addButton` | "Add" | 410 | same |

There is no upstream string for "no search results", for an error, or for the ruleset limit.

## 2. Lifecycle

1. The pane initialises the first time its `<section data-pane="rulesets">` becomes visible
   (IntersectionObserver; `filter-lists.js:565`, `src/js/dom.js:160-168`). Until then nothing is
   fetched and broadcasts are ignored (`filter-lists.js:121-122`) [run R1, R8]. If the stored
   active pane is `rulesets` (`dashboard.js:52-55`) this happens at page load [run R11].
2. First render = `renderFilterLists()` (`filter-lists.js:527-528`): sends 1.2 and 1.3 in parallel
   (`filter-lists.js:124-130`), then builds the tree (3), node states (6), totals (5). These two
   messages are the only ones caused by showing the pane [run R1].
3. Only after the first render completes are the input, click and change handlers attached
   (`filter-lists.js:530-562`). If the first render throws (a failed message makes `rulesetDetails`
   undefined, `filter-lists.js:137`), the pane stays empty and inert, with no message to the user
   [run R13]. The React pane must show the failure instead (ARCHITECTURE 6.5).
4. Re-render = `renderFilterLists(true)` on a broadcast (13). It re-sends 1.2 and 1.3 and updates
   the existing tree in place (`filter-lists.js:142-149,179-190,331-333`).
5. `adminRulesets` and `maxNumberOfEnabledRulesets` are read from `self.cachedRulesetData` at render
   time (`filter-lists.js:62,107`). **QUIRK Q1**: upstream does not wait for the options data; if
   the pane renders first, admin locks and the limit are missing and stay missing until the next
   re-render [run R12]. The React pane must wait for the options data before its first render
   (DEVIATION D2).
6. The hide-unused state is read from storage once, when the script loads, not when the pane is
   shown (`filter-lists.js:380-388`). The read is asynchronous and not awaited by the render; if it
   resolves after the first render it re-applies the stored state to the existing nodes
   (`filter-lists.js:383-387`), so the stored value wins whichever finishes first.
7. The "has been shown" flag is set at the **start** of the first render, before its reads answer
   (`filter-lists.js:121-122`). A broadcast that arrives during the first render therefore starts a
   second, overlapping render (see 13 for overlapping renders).
8. **QUIRK Q15**: if the first render throws, the input/click/change handlers are never attached
   (`filter-lists.js:528-562`), but the "shown" flag is already set, so a later broadcast re-render
   can succeed and fill the tree. That tree is inert: a checkbox click flips the native box only; no
   `toggled` mark, no count/totals update, no debounced commit; the next render resets the box.
   Until then, the unload path (14) reads the boxes as they are and, no timer being pending, sends
   them (`filter-lists.js:429-438,466-471`). The React pane must make a successful later read fully
   operable (D4).
9. Switching to another pane and back does nothing to this pane: no re-fetch (the observer is
   disconnected after the first show, `src/js/dom.js:160-168`), the tree, search text, hide-unused
   state and uncommitted edits persist, and a pending debounce timer keeps running and commits while
   another pane is shown (`filter-lists.js:473-485` has no visibility check). The header block with
   the totals line and search input is hidden while another pane is active (`dashboard.css:50-52`),
   but its content is kept. Re-rendering on broadcasts continues while the pane is hidden.

### 2.1 Upstream markup inventory (roles only)

| Element | Source | Role |
|---|---|---|
| `#commit-spinner` | `dashboard.html:36` | commit indicator (9.4) |
| `#listsOfBlockedHostsPrompt` | `dashboard.html:36` | totals line (5) |
| `#dnrError` | `dashboard.html:37` | error line (9.5) |
| `#findInLists` | `dashboard.html:38` | search input (8) |
| `#lists` | `dashboard.html:117` | tree container |
| `aside` with `.userScriptsInfo`, `details.importRulesetURL`, URL input, Add button | `dashboard.html:118-126` | import area (12) |
| template `listEntryLeaf` | `dashboard.html:208-220` | leaf row: label wrapping checkbox and name; icon bar with trash, undo, home link |
| template `listEntryNode` | `dashboard.html:221-229` | composite node row: label wrapping checkbox and name; count; expander |
| template `listEntryRoot` | `dashboard.html:230-238` | root group row: `h3` name; count; expander; no checkbox |
| template `listEntries` | `dashboard.html:239-241` | children container |

The four header elements sit in a block that is displayed only while this pane is active
(`dashboard.html:35-39`, `dashboard.css:50-52`), inside the sticky page header (`dashboard.css:1-6`).
Their order is: spinner, totals line, error line, search input.

## 3. Tree construction

### 3.1 Root groups: fixed order and membership

Eight root groups, always in this order (`filter-lists.js:240-283`). Membership is by exact match
on the record's `group`:

| # | Group id (node id) | Members | i18n key for the name | English text (`messages.json` line) |
|---|---|---|---|---|
| 1 | `default` | `group === 'default'` | `3pGroupDefault` | "Default" (70) |
| 2 | `ads` | `group === 'ads'` | `3pGroupAds` | "Ads" (74) |
| 3 | `privacy` | `group === 'privacy'` | `3pGroupPrivacy` | "Privacy" (78) |
| 4 | `malware` | `group === 'malware'` | `3pGroupMalware` | "Malware protection, security" (82) |
| 5 | `annoyances` | `group === 'annoyances'` | `3pGroupAnnoyances` | "Annoyances" (86) |
| 6 | `misc` | `group === undefined && typeof lang !== 'string'` (`filter-lists.js:267-271`) | `3pGroupMisc` | "Miscellaneous" (90) |
| 7 | `regions` | `group === 'regions'` | `3pGroupRegions` | "Regions, languages" (94) |
| 8 | `imported` | `group === 'imported'` | `3pGroupImported` | "Imported lists" (98) |

The key is computed as `'3pGroup' + id[0].toUpperCase() + id.slice(1)` (`filter-lists.js:293`).

A record with any other `group` value, or with no `group` but a string `lang`, belongs to no group
and gets no row at all (`filter-lists.js:240-283`). No such record exists in the real file. Because
it has no row it can never be in an `applyRulesets` payload (9.2).

All eight root groups are always created, even when empty (`filter-lists.js:290-297`). Visibility:
- An empty root group other than `imported` is not displayed (`settings.css:148-150`). With the
  real data this hides `malware` [run R1].
- The `imported` root group is displayed even when empty (`settings.css:148`), except where
  compiled filters are unsupported, where it is not displayed (`settings.css:267-270`; Safari, 12)
  [run R1, R10].

Root groups have a name, a count and an expander, and **no checkbox** (`dashboard.html:230-238`).

### 3.2 Parent/child lists

Inside its group a record with `parent` is placed under nested composite nodes: `parent` is split on
`|`; each segment is a node whose id and name are both the segment text; the record becomes a leaf
of the innermost node (`filter-lists.js:298-311`). Records without `parent` are direct leaves of the
group (`filter-lists.js:308-310`). A composite node has a checkbox, a name, a count and an expander
(`dashboard.html:221-229`). A leaf has a checkbox, a name and an icon bar (`dashboard.html:208-220`).

### 3.3 `promoteLonelySublist`

After the tree is built, every composite node (depth >= 1) with exactly one child is replaced by
that child, re-keyed under the child's `id` (`filter-lists.js:313-329`). Root groups (depth 0) are
never replaced (`filter-lists.js:323`). The replacement is appended to the parent's key order
(`filter-lists.js:320-321`), which only matters for sort ties (3.4).

Real data: `pol-0` is the only record with parent `🇵🇱pl: Polskie listy filtrów`, so it is promoted
to a direct leaf of `regions` and that parent name is never displayed. `rus-0` and `rus-1` share
parent `🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList`, which therefore stays as the only composite node in the
whole tree [run R1].

**QUIRK Q2** (multi-segment parents, absent from the real data; results obtained by running the
upstream algorithm in Node on synthetic records):

| Input (`id`: `parent`) | Upstream result under the group |
|---|---|
| `x`: `A\|B` | throws `TypeError` (`filter-lists.js:320-325`: the lookup at 325 uses the pre-rename key) |
| `x`, `y`: `A\|B` | one node stored under the key `"undefined"` holding `x`, `y` (`filter-lists.js:320`, a node has no `id`) |
| `x`: `A`; `y`: `A\|B` | node `A` holding `x`, `y` |
| `x`: `A\|B`; `y`: `A\|C` | node `A` holding `x`, `y` |
| `x`, `y`: `A\|B`; `z`, `w`: `A\|C` | node `A` holding nodes `B` (`x`, `y`) and `C` (`z`, `w`) |

### 3.4 Sort order

- Root groups: never sorted, fixed order of 3.1 (`filter-lists.js:198`, sorting only when
  `depth !== 0`).
- Children of every root group and of every composite node are sorted (`filter-lists.js:198-208`):
  1. entries whose value has `preferred === true` first (no real record has it);
  2. then by `key.replace(/\p{Emoji}+/gu, '')` compared with `String.prototype.localeCompare` with
     no arguments, where `key` is `value.title || entryKey`. No record has `title`, so the key is the
     **ruleset id** for a leaf and the **parent segment text** for a composite node. The sort is not
     by display name.
- `\p{Emoji}` also matches ASCII digits, `#` and `*`, so digits are stripped: `rus-0` becomes
  `rus-`, `jpn-1` becomes `jpn-` (measured). `spa-0` and `spa-1` therefore compare equal and keep
  their file order (stable sort).
- `localeCompare()` without a locale uses the browser's default collation, so the order is
  locale-dependent. Computed with the upstream comparator for 43 locales: the order below holds for
  all of them except `cs` and `sk` (`chn-0` moves after `hun-0`: "ch" is a letter sorted after
  "h"), `cy` (`chn-0` and `cze-0` swap, and `tha-0` and `tur-0` swap: "ch" and "th" are letters),
  `sq` (`tha-0` and `tur-0` swap) and Spanish traditional collation `es-u-co-trad` (`chn-0` and
  `cze-0` swap). Re-checked in the second pass with Node 26.8.2 / ICU 78.3 (full ICU).

Expected result for the real file (computed with the upstream algorithm in Node, locale `en-US`,
and identical to the DOM order observed in [run R1]):

```json
{
 "default": ["easylist","easyprivacy","ublock-filters"],
 "ads": ["adguard-mobile"],
 "privacy": ["block-lan"],
 "malware": [],
 "annoyances": ["annoyances-ai","annoyances-cookies","annoyances-notifications","annoyances-others","annoyances-overlays","annoyances-social","annoyances-widgets"],
 "misc": ["ublock-experimental","ubol-tests"],
 "regions": ["alb-0","ara-0","bgr-0","chn-0","cze-0","deu-0","est-0","fin-0","fra-0","grc-0","hrv-0","hun-0","idn-0","ind-0","irn-0","isl-0","isr-0","ita-0","jpn-1","kor-1","ltu-0","lva-0","mkd-0","nld-0","nor-0","pol-0","rou-1",
   {"🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList": ["rus-0","rus-1"]},
   "spa-0","spa-1","svn-0","swe-1","tha-0","tur-0","ukr-0","vie-1"],
 "imported": []
}
```

Leaf totals per group: default 3, ads 1, privacy 1, malware 0, annoyances 7, misc 2, regions 37
(36 direct children), imported 0; 51 in all.

### 3.5 Names, flags

- Group name: the i18n text of 3.1. Composite node name: the parent segment. Leaf name: `name`.
- Every name is passed through `i18n.patchUnicodeFlags` (`filter-lists.js:219-223`,
  `src/js/i18n.js:301-344`): each of 63 known flag emoji is replaced by
  `<img src="/img/flags-of-the-world/<cc>.png" title="<cc>" class="countryFlag">` followed by a hair
  space U+200A; all other text is kept. Example, `🇩🇪de 🇨🇭ch 🇦🇹at: EasyList Germany` becomes
  `[img de] U+200A "de " [img ch] U+200A "ch " [img at] U+200A "at: EasyList Germany"` [run R1].
  The image is sized by `.countryFlag` (`src/css/common.css:338-343`). A flag emoji not in the map
  stays as text. The real file uses 59 distinct flags; all are in the map and all 59 PNG files exist
  in `PRISTINE/img/flags-of-the-world/` (measured).
- The name is written once, when the row is created; it is not refreshed on re-render
  (`filter-lists.js:212,219-223`).
- A leaf's label wraps both checkbox and name, so activating the name toggles the checkbox
  (`dashboard.html:211-212`). The same holds for a composite node (`dashboard.html:224`).

### 3.6 Home links

Each leaf has a link with the `home` icon, `target="_blank"`, no `rel` (`dashboard.html:216`)
[run R13]. Its `href` is set to `homeURL` when truthy (`filter-lists.js:152-154`); otherwise it
keeps `href="#"` and is not displayed (`settings.css:213-215`) [run R14]. All 51 real records have
a `homeURL`. Root groups and composite nodes have no link. On a stock leaf the home link is the only
icon displayed; the trash and undo icons belong to imported leaves (`settings.css:216-221`)
[run R14].

## 4. Row state

### 4.1 State model (restatement of upstream's DOM-as-state)

Upstream keeps state in the DOM. The equivalent data model, which the React pane should use:

| Name | Upstream carrier | Meaning |
|---|---|---|
| `serverEnabled: Set<id>` | `visuallyEnabledRulesets` (`filter-lists.js:30,135,145-148`) | ids that have a leaf row and are in the last `getEnabledRulesets` response. With the real data every enabled id has a row |
| `desired: Map<id, boolean>` | the `checked` property of each leaf checkbox | what the user currently sees |
| `toggled: Set<id>` | class `toggled` on a leaf (`filter-lists.js:544,548`) | leaves changed by the user since the last commit started |

Rules:
- On every render, for each leaf **not** in `toggled`: `desired[id] = serverEnabled.has(id)`.
  Leaves in `toggled` keep the user's value (`filter-lists.js:145-151`) [run R8].
- A user change adds the affected leaves to `toggled` (`filter-lists.js:543-549`) [run R2].
- When a commit starts, `toggled` is emptied; `desired` is left as is (`filter-lists.js:440`). The
  boxes keep showing the user's choice until the next render replaces it with the server state.

### 4.2 Composite node checkbox

Derived only, see 6.

### 4.3 `isDefault`

A leaf is "default" when `enabled === true` in its record and it is not imported
(`filter-lists.js:155-158`). Used only by "hide unused" (7). With the real data: `ublock-filters`,
`easylist`, `easyprivacy`.

## 5. Counts

Number formatting everywhere: `value.toLocaleString()` with no arguments, i.e. the browser's
default locale (`filter-lists.js:36-38`).

1. **Count on root groups and composite nodes**: text `${checkedCount}/${totalCount}`, plain
   integers, no formatting (`filter-lists.js:74-78`). `totalCount` = number of leaves at any depth
   under the node; `checkedCount` = those whose `desired` is true (`filter-lists.js:70-77`). Hidden
   leaves (hide-unused, search, admin-hidden) are counted. Recomputed after every render and every
   checkbox change (`filter-lists.js:335,550`). Empty groups read `0/0` (not displayed, 3.1).
2. **Per-ruleset rule and filter counts**: shown only as the tooltip (`title`) of the leaf row, using
   i18n `perRulesetStats` with `ruleCount = rules.plain + rules.regex` and
   `filterCount = filters.accepted` (`filter-lists.js:95-102,162-166`). Refreshed at every render.
   Example: `ublock-filters` gives "6,913 rules, converted from 10,703 network filters" (en-US)
   [run R1]. Root groups and composite nodes have no tooltip.
3. **Totals line** (`#listsOfBlockedHostsPrompt`): the same `perRulesetStats` template filled with
   the sums of `ruleCount` and `filterCount` over all leaves whose `desired` is true, including
   admin-locked and imported leaves and hidden leaves (`filter-lists.js:42-59`). It reflects the
   user's pending choices immediately, before any commit (`filter-lists.js:551`) [run R2].
   With only the three default lists enabled: "113,615 rules, converted from 121,437 network
   filters" [run R1]. With `deu-0` added: 115,809 and 123,751 [run R2]. All 51 enabled: 196,322 and
   214,575.
4. **Ruleset count for the limit**: number of leaves with `desired` true that are not imported
   (`filter-lists.js:43-50`), see 10.

Only the first `{{ruleCount}}` and the first `{{filterCount}}` in the template are replaced
(`String.prototype.replace` with a string pattern, `filter-lists.js:56-58,164-166`).

## 6. Tri-state parent checkboxes

Applies to composite nodes only (root groups have no checkbox; `filter-lists.js:79-80`). With the
real data that is exactly one node, "RU AdList", with leaves `rus-0` and `rus-1`.

Derived state, recomputed after every render and every change (`filter-lists.js:68-91`):

| `checkedCount` | checkbox `checked` | `partial` |
|---|---|---|
| 0 | false | false |
| between 1 and `totalCount - 1` | true | true |
| `totalCount` | true | false |

(`filter-lists.js:82-85`; the partial look is `src/css/common.css:223-227`.) A partial node is a
*checked* checkbox with a different look, which is why the transitions below are what they are.

User activation of a node checkbox (`filter-lists.js:536-553`): `checkAll = newChecked || wasPartial`
(`filter-lists.js:541-542`), then every leaf under the node, at any depth, is set to `checkAll` and
added to `toggled` (`filter-lists.js:543-546`) [run R3].

| State before | State after |
|---|---|
| none checked | all checked |
| partial | all checked |
| all checked | none checked |

User activation of a leaf checkbox: that leaf's `desired` flips and it is added to `toggled`
(`filter-lists.js:547-549`).

After either: recompute node states (6), totals (5), then schedule a commit (9)
(`filter-lists.js:550-552`).

**QUIRK Q3**: the node toggle also flips admin-locked leaves under it and marks them `toggled`
(their inputs are disabled but the property is set by script, `filter-lists.js:543-546`). Until the
next render the counts and the totals line follow the flipped value, and an admin leaf flipped to
unchecked disappears (11). Admin leaves are excluded from the payload (9.2) and the render that
follows the commit restores them (4.1) [run R13].

## 7. Expand/collapse = "hide unused"

There is no true collapse. Each root group and each composite node has a boolean "hide unused"
state; class `expandable` in the templates has no CSS.

### 7.1 Effect

When a node is in "hide unused" state, each **direct** child row that is not `isDefault` and whose
own checkbox is unchecked is not displayed (`settings.css:164-166`). For a composite child "own
checkbox unchecked" means none of its leaves is checked (6). Checked rows and default rows always
stay. The rule is live: unchecking a non-default row in such a group makes it disappear at once.
A group whose children are all hidden still shows its header and count, for example "Regions,
languages 0/37" [run R1].

The expander icon points down when everything is shown and sideways when "hide unused" is on
(`settings.css:189-195`). The `default` group has no visible expander (`settings.css:186-188`).

### 7.2 State and storage

- In-memory set `hideUnusedSet`, initial value `['ads', 'regions', 'imported']`
  (`filter-lists.js:32`).
- At script load, `storage.local['hideUnusedFilterLists']` is read once; if it is an array it
  **replaces** the set, and every existing node gets hide-unused = `set.has(nodeId)`
  (`filter-lists.js:380-388`). If nothing is stored, or the stored value is not an array, the
  initial value stays and nothing is written [run R11].
- At every render, each root group and composite node gets hide-unused = `set.has(nodeId)`
  (`filter-lists.js:213-218`).
- Node ids: the group id for root groups; the parent segment text for composite nodes (for example
  `🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList`) (`filter-lists.js:216`) [run R3].
- Toggle (`filter-lists.js:354-377`), for a node id `which`: if the set has it, delete it, else add
  it; the node's hide-unused becomes the new membership; then write the **whole** set as an array:
  `storage.local.set({ hideUnusedFilterLists: Array.from(set) })` (`filter-lists.js:376`).
  Example: first toggle of `regions` on a fresh profile writes `['ads','imported']` [run R2].
- No message is sent and the storage is not re-read afterwards; two dashboard tabs each keep their
  own set and the last writer wins.

### 7.3 What triggers the toggle

A click whose target is the row bar itself or the expander (`filter-lists.js:531-535`; the delegated
handler fires only when the click target itself matches, `src/js/dom.js:32-51`; the icon inside the
expander lets clicks through, `src/css/fa-icons.css:14-16`):
- Root group: the name and count let clicks through to the bar (`settings.css:145-147`), so a click
  anywhere on the group header row toggles [run R2].
- Composite node: a click on the count (`settings.css:151-156`), the expander or the empty part of
  the bar toggles hide-unused; a click on the checkbox or the name toggles the checkbox instead
  (`dashboard.html:224`) [run R3].
- The `default` group header is clickable like any other; the click toggles and stores the state
  although its expander is hidden (`settings.css:186-188`) and, with the real data, nothing changes
  visually (all three leaves are `isDefault`) [run R3].
- In search mode the expanders are not clickable but a root header still is: the click changes and
  stores the state with no visible effect until the search is cleared (8) [run R4].

Upstream offers no keyboard way to toggle (the expander is a non-focusable `span`,
`dashboard.html:226,235`); the React pane must provide one (ARCHITECTURE 6.10; DEVIATION D3).

### 7.4 The `'*'` entry (legacy)

`mustHideUnusedLists('*')` and the `which === '*'` branch (`filter-lists.js:285,348-363`) handle a
"hide all" token. No element in the MV3 page has node id `*`, so the UI can never produce it, and
the classes it sets (`body.hideUnused`, `#lists.hideUnused`) have no CSS (checked by searching all
PRISTINE stylesheets). If a stored array contains `'*'`: per-node toggles then compute the new state
as `had === setHasStar` (`filter-lists.js:365-373`) while renders use plain membership
(`filter-lists.js:217`), which is inconsistent upstream. Treat `'*'` as an opaque member: keep it in
the array when writing, and use plain membership for display.

### 7.5 Side effect on the import area

The import area below the tree is not displayed while the `imported` group is in hide-unused state
(`settings.css:271-273`) [run R10]. Not relevant on Safari (12).

## 8. Search

Input: `#findInLists`, `type="search"`, `spellcheck="false"`, placeholder from i18n
`findListsPlaceholder` (`dashboard.html:38`, `src/js/i18n.js:257-261`). The handler runs on every
`input` event (`filter-lists.js:530`). The value is not stored anywhere; searching sends no message
and writes no storage [run R4].

Algorithm (`filter-lists.js:392-419`):
1. `pattern` = the raw input value, not trimmed (`filter-lists.js:393`). Search mode is on iff
   `pattern !== ''` (`filter-lists.js:394`). When empty, stop.
2. Matcher: the pattern with regex metacharacters escaped, case-insensitive, substring
   (`filter-lists.js:396`). It is a literal, not a user regex.
3. For every leaf, **skipping admin-locked leaves** (`filter-lists.js:398`): the haystack is

   ```js
   [ details.name, undefined, details.group || '', details.tags || '' ].join(' ').trim()
   ```

   (`filter-lists.js:404-409`; the second element is `listEntry.dataset.nodeid`, which a leaf never
   has, so it joins as an empty string). Matched text is therefore: the list **name**, the raw
   **group id** (not the localised group name) and the **tags**. The ruleset `id`, `lang` and the
   parent name are not searched. Examples from the real file:
   `"EasyList  default"`, `"uBO Lite Test Filters"`,
   `"🇩🇪de 🇨🇭ch 🇦🇹at: EasyList Germany  regions ads german deutschland luxembourgish lëtzebuerg romansh"`.
4. A root group or composite node matches iff at least one leaf below it matches
   (`filter-lists.js:414-418`).

Display in search mode (`settings.css:232-241`):
- Only matching leaves and the groups/nodes that contain them are displayed [run R4]. A matching
  row is displayed even if hide-unused (7.1) would hide it.
- Admin-locked leaves never appear in search results (step 3), including checked ones that are
  normally shown [run R6].
- Expanders are invisible and not clickable (`settings.css:239-241`).
- Checkboxes keep working. A composite node's checkbox still affects all its leaves, including ones
  the search hides (6).
- Counts, totals line and the limit lock are unchanged by search.
- Nothing is highlighted and there is no "no results" text: with no match the tree area is empty.
- A re-render during search keeps search mode and the current matches [run R4].

Leaving search mode (empty input) restores the normal display rules [run R4].

Test vectors against the real file (pattern, matching ids in file order):
`german` gives `deu-0`; `GERMAN` gives `deu-0`; `default` gives `ublock-filters, easylist,
easyprivacy`; `mobile` gives `adguard-mobile`; `privacy` gives `easyprivacy, block-lan`;
`ru adlist` gives `rus-0, rus-1`; `counters` gives `rus-1`; `русский` gives `rus-0, rus-1`;
`(中文)` gives `chn-0`; `pl` gives `pol-0`; `regions` gives the 37 regional lists; `rus-0` gives
nothing (ids are not searched); `a.b` gives nothing; `zzz` gives nothing; a single space matches
all 51.

**QUIRK Q4**: search is not re-evaluated on re-render (`filter-lists.js:120-342` never calls it),
and for one input event a group header can stay visible with no visible child when the last match
inside a composite node disappears (groups are evaluated before the nested node is cleared,
`filter-lists.js:414-418`; observed: after `ru adlist`, typing `rus-0` leaves the "Regions" header
alone on screen [run R4]). Derive matches from state instead; do not reproduce (DEVIATION D5).

**QUIRK Q10**: the search rule is `!important` (`settings.css:232-235`) and so also overrides the
rule that hides the `imported` group where compiled filters are unsupported (`settings.css:267-270`).
On Safari, if an imported list exists in storage (12.1) and matches the search, its row and the
"Imported lists" header become visible, with a working checkbox and trash icon [run R10]. This is an
accident of CSS precedence; recommended treatment in 16.

## 9. Commit path

### 9.1 Trigger and debounce

Every checkbox change (leaf or composite node) schedules a commit (`filter-lists.js:552`). The
scheduler (`filter-lists.js:473-485`):
- cancels a pending timer and starts a new one of **997 ms**;
- when the timer fires: if the page is in the "committing" state (9.4), schedule again (another
  997 ms); otherwise run the commit.

So rapid changes collapse into one message sent 997 ms after the last change, and nothing is sent
at the moment of the change [run R2: three changes 400 ms apart gave one message 996-997 ms after
the last one; a single change gave one message about 1.0 s later].

### 9.2 Payload construction (exact)

At commit time (`filter-lists.js:426-448`):
1. Enter the "committing" state (`filter-lists.js:427`).
2. `enabledRulesets` = the ids of **all leaves** in display order (3.4) whose `desired` is true and
   that are **not admin-locked** (`filter-lists.js:429-438`).
   - It is the complete list, not a delta.
   - Leaves hidden by hide-unused, by search or because the `imported` group is not displayed are
     included; visibility plays no part.
   - Admin-locked leaves are excluded whatever their state (`filter-lists.js:436`) [run R6].
   - Imported lists are **not** excluded: a checked imported leaf's id (its URL) is in the list
     [run R10]. Imported leaves flagged for removal are unchecked (12.3) and so are absent.
   - Order is irrelevant to the background (it builds a `Set`, `ruleset-manager.js:606`).
3. Empty `toggled` (`filter-lists.js:440`).
4. `toRemove` = ids of imported leaves flagged for removal (`filter-lists.js:442-444`).
5. `modified = hash(enabledRulesets) !== hash(serverEnabled) || (final && toRemove.length)`, where
   `hash(x) = Array.from(x).sort().join('\n')` (`filter-lists.js:446-448`, `dashboard.js:83-86`).
6. If `modified`: send the message of 1.4 (with `toRemove` only when `final`), wait for the
   response, then set the error line to `response?.error || ''` (`filter-lists.js:449-459`).
7. Leave the "committing" state (`filter-lists.js:461`).

Example [run R2]: only the three defaults enabled, the user ticks `deu-0`. One message, 997 ms
later:

```js
{ what: 'applyRulesets', enabledRulesets: ['easylist', 'easyprivacy', 'ublock-filters', 'deu-0'] }
```

If the user ticks and unticks within the debounce window, nothing is sent (step 5) [run R2].

**QUIRK Q5**: `serverEnabled` contains admin-enabled ids but the payload never does, so with at
least one admin-enabled ruleset `modified` is always true and an identical list is re-sent at every
commit and at every unload (`filter-lists.js:436,446-447`) [run R6]. Harmless: the background
handles an unchanged list as a no-op apart from the broadcast (`ruleset-manager.js:656-658`,
`background.js:243-259`).

### 9.3 After the message

`serverEnabled` is not updated by the commit itself. The background's broadcast (1.4 step 4) makes
every open dashboard, including the sender, re-render from fresh `getEnabledRulesets` /
`getRulesetDetails` (13). Observed message order for one change [run R2]: `applyRulesets`, then
`getEnabledRulesets` and `getRulesetDetails`. Until that render, the boxes show the user's choice
(4.1).

**QUIRK Q16** (stale baseline when the echo is missing): `modified` (9.2 step 5) compares against
`serverEnabled` as of the last render. If the `{ enabledRulesets }` echo never reaches the page
(UNKNOWN 17.5 on Safari; or the `undefined` case of 1.4), the baseline never moves, and a change that
returns to the old state is never sent: tick X, commit sends X, untick X, the payload equals the stale
baseline, nothing is sent, X stays enabled in the browser while the box shows it unticked (traced in
the code; also in `messaging.md` section 6.3). Treatment, **DEVIATION D8**: after an `applyRulesets`
response settles, the React pane re-reads 1.2 and 1.3 itself if no `{ enabledRulesets }` broadcast
has caused a re-read since the commit started. Message impact: at most one extra pair of read-only
messages per commit; no state-changing message is added or altered. If UNKNOWN 17.5 is confirmed
"delivered" on Safari, D8 may be dropped.

### 9.4 "Committing" state

A page-wide flag (class `committing` on `body`) set from the start of a commit until its response
(`filter-lists.js:427,461`), also during `importFilterList` (`filter-lists.js:494-498`) and by the
Custom filters pane (`filter-manager-ui.js:99-104,114-119,281-296,312-327`). In the new
architecture the Custom filters pane lives in a separate embedded document (ARCHITECTURE 2), so for
the React pane the flag is only its own commit. Effects:
- the commit spinner in the pane header is displayed and animated only while the flag is set
  (`settings.css:114-120`) [run R9];
- a debounce timer that fires while it is set re-arms instead of committing
  (`filter-lists.js:479-481`). Consequently debounced commits never overlap: a change made during a
  slow commit is sent in a second message after the first response, with the complete list
  [run R9, mock apply delay 2.5 s: first message at about 1.0 s, response at about 3.5 s, second
  message at about 4.3 s after the first change].

Nothing is disabled during a commit; the user can keep toggling [run R9]. A commit whose list is
unmodified sets and clears the flag within the same task, so no spinner is seen.

**QUIRK Q14** (response that never comes): the flag is cleared only after `await sendMessage(msg)`
settles (`filter-lists.js:457-461`). When the background handler throws, no response is sent
(section 1); if the promise then never settles (UNKNOWN 17.8), upstream stays "committing" forever:
the spinner never stops, and every later debounced commit re-arms every 997 ms without ever sending
(`filter-lists.js:479-481`), so all further changes in that page are silently never saved (only the
unload path, which has no committing check, can still send, 14). Treatment for the React pane: keep
the upstream rule that no second debounced `applyRulesets` is sent while one is unsettled (also
`messaging.md` 1.6 item 4), but do not stay silent: while a commit is unsettled for a long time,
show that saving has not completed (new string via `tNew`); the time threshold is a UI choice and
changes no message. If the promise rejects instead, D4 applies.

### 9.5 Response and error display

- The response to `applyRulesets` is always `undefined` (1.4). Upstream therefore always clears the
  error line (`filter-lists.js:458`, the only place that writes it), and an empty error line is not
  displayed (`settings.css:121-126`). **In this upstream version no error is ever shown in this
  pane.**
- Errors do occur in the background: a rejected `dnr.updateEnabledRulesets` is caught, logged and
  put in `response.error` as `` `${reason}` `` (`ruleset-manager.js:591-600`), likewise for dynamic
  rules (`ruleset-manager.js:245-248,676-679`); but that object never leaves the background
  (`background.js:239-260,382-388`). On Safari the available static rule count is a constant
  150000 (`safari/ext-compat.js:146-148`) and is only logged (`ruleset-manager.js:694-697`).
- The text of Safari's rule-limit or ruleset-limit error: **UNKNOWN** (not in the repository, and
  not observable by the page).
- Observable effect of a failed apply: the background still broadcasts (`background.js:259`), the
  pane re-renders from the real state, and since `toggled` was emptied at commit start the boxes
  and the totals line **silently revert** (4.1) [run R9].
- The only failure signal available to the page without changing `background.js` is that, after the
  refresh following a commit, `serverEnabled` lacks an id that was sent (or contains a non-admin id
  that was not). Whether to surface that is a UI decision; it would need a new string (`tNew`).
- A rejected `sendMessage` itself (background unreachable) resolves `undefined` upstream
  (`ext.js:51-55`): same silent outcome, and the spinner stops. Our bridge throws instead; the pane
  must then leave the "committing" state, show the failure, and re-read the state (1.2, 1.3) before
  any further commit (DEVIATION D4).

## 10. Limit on enabled rulesets (`noMoreRuleset`)

- After every render and every change: the pane is "at the limit" iff
  `rulesetCount === maxNumberOfEnabledRulesets`, strict equality, where `rulesetCount` counts checked
  non-imported leaves including admin-locked ones (`filter-lists.js:43-50,61-63`). If the option is
  missing (`undefined`) the pane is never at the limit [run R5].
- While at the limit, every row (leaf or composite node) whose own checkbox is unchecked is dimmed
  and ignores pointer input (`settings.css:227-230`) [run R5]. The whole row is affected, so its
  home link cannot be clicked either. This includes unchecked imported leaves even though they do
  not count. Root groups have no checkbox and stay clickable. Checked rows stay operable, so the
  user can untick something to get below the limit.
- The value on Safari: `nativeDNR.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` read at runtime
  (`safari/ext-compat.js:144`, `background.js:428`). Its numeric value is **UNKNOWN** from the
  repository; never hard-code it. The build ships 51 static rulesets (`PRISTINE/manifest.json`,
  `declarative_net_request.rule_resources`, 51 entries).

**QUIRK Q6**: the lock is pointer-only (`settings.css:227-230`); the inputs are not disabled, so the
keyboard can still tick a locked row [run R5]. A partial composite node is "checked", so it is not
locked and activating it ticks all its leaves (6) [run R13]. Either way the count can exceed the
limit, at which point the strict equality is false and the lock disappears (`filter-lists.js:61-63`)
[run R5]. The commit is then sent as usual; what Safari does with more than the maximum is
**UNKNOWN**; if the browser rejects, the outcome is the silent revert of 9.5.

## 11. Admin-locked rulesets

- `adminRulesets` tokens: `+id` (forced on) or `-id` (forced off), already expanded from
  `+default`, `-default`, `-*` by the background (`admin.js:171-205`).
- A leaf is admin-locked iff `isAdminRuleset(id)` (`filter-lists.js:106-116`): some token `t` has
  `t.indexOf(id) === 0`, or `t.indexOf(id) === 1` with `t[0]` being `+` or `-`. Note this is a
  prefix test, not equality: token `+easylist-extra` also locks `easylist` (measured). No real id is
  a prefix of another real id (measured), so with the shipped rulesets it is equivalent to equality.
- Imported leaves are never admin-locked (`filter-lists.js:167-168`).
- Effects on an admin-locked leaf [run R6]: its checkbox is disabled (`filter-lists.js:169-174`);
  if it is unchecked the row is not displayed at all (`settings.css:167-169`); if it is checked the
  row is shown dimmed (`settings.css:196-199`); it never matches a search (8); it is never in the
  payload (9.2); it counts in node counts, totals and the limit (5, 10).
- A composite node is admin-locked iff **all** its leaves are admin-locked
  (`filter-lists.js:86-89`): its checkbox is disabled, and it is not displayed when unchecked
  (`settings.css:167-169`) [run R6].
- The checked state of an admin-locked leaf comes from `serverEnabled` like any other; the
  background enforces the policy on every apply (`ruleset-manager.js:617-625`).
- On Safari: whether `browser.storage.managed` exists and can carry a policy is **UNKNOWN**
  (`ext.js:131-139` returns `undefined` when it does not, giving `adminRulesets = []`). The Safari
  manifest declares no managed schema (`safari/manifest.json`; compare `chromium/manifest.json:54-56`),
  although `PRISTINE/managed_storage.json` is shipped.
- The background reads the policy through a cache: `adminReadEx('rulesets')` returns the value last
  stored in `storage.session`/`storage.local` under `admin.rulesets` and refreshes it from
  `storage.managed` in the background; a changed value is processed 127 ms later and broadcast as
  `{ adminRulesets, enabledRulesets }` (`admin.js:209-230,116-135`). So the `adminRulesets` in the
  options data can be one step stale, and the correction arrives as the broadcast of 13. The pane
  never reads `storage.managed` or `admin.*` keys itself.

## 12. Imported lists

### 12.1 Availability

The import area (`dashboard.html:118-126`) and the `imported` root group are displayed only when the
options data has `supportsCompiledFilters === true` (`settings.js:334-341`, `settings.css:267-270`).
That value is `supportsOffscreenDocument` (`background.js:439`).

**Safari: not available.** `safari/ext-offscreen.js:25` is
`export const supportsOffscreenDocument = false;` and this is the file shipped as
`PRISTINE/js/ext-offscreen.js`. (Generic Chromium: `chrome.offscreen !== undefined`,
`ext-offscreen.js:24`.) The background never compiles or registers imported filters on Safari
(`compiled-filters.js:270-271,281-282`). On Safari the React pane must not render the import area
or the `imported` group, and never sends `importFilterList` [run R1, R10].

Even on Safari the background keeps imported-list plumbing: `getRulesetDetails` and
`getEnabledRulesets` include whatever is in `storage.local['rulesets.imported']`
(`ruleset-manager.js:78-89,548-557`); entries can get there without this UI (settings restore,
`backup-restore.js:132-146`; migration of a removed stock list, `ruleset-manager.js:513-535`).
Upstream still builds (undisplayed) rows for them, so their checked ids **are in the payload** and
their stats **are in the totals line** (5.3, 9.2) [run R10]. The React pane must keep them in its
model and payload although it does not display them; dropping them would disable them on the next
commit (1.4 step 2). For search see QUIRK Q10.

### 12.2 Adding (non-Safari; for completeness)

URL input + Add button inside a `<details>` (`dashboard.html:120-125`). The button is displayed only
when the input is non-empty and valid for `type="url"` (`settings.css:288-290`). On click
(`filter-lists.js:490-499,554-556`): if the URL does not match
`/^[a-z-]+:\/\/(?:\S+\/\S*|\/\S+)/m` nothing happens; otherwise set "committing", send
`{ what: 'importFilterList', url }`, close the details, clear the input, clear "committing". The
background adds the list, enables it and broadcasts (`background.js:640-647`).

### 12.3 Removing (non-Safari; for completeness)

Imported leaves show a trash icon, or an undo icon once flagged (`settings.css:216-221`). Trash
(`filter-lists.js:501-511`): remember the checked state, uncheck and disable the box, mark the leaf
`toggled`, flag it for removal (row struck through, `settings.css:222-224`), recompute, schedule a
commit. Undo (`filter-lists.js:513-523`) reverses it. The debounced commit only disables the list;
the deletion (`toRemove`) is sent only by the unload path (14).

## 13. Reaction to broadcasts from other pages

Handler: `settings.js:249-323`.
- `adminRulesets` present and its sorted content differs from the cached one
  (`settings.js:305-310`): store it, re-render the lists [run R8].
- `enabledRulesets` present (`settings.js:312-315`): always re-render the lists.
- Re-render is skipped entirely if this pane has never been shown (`filter-lists.js:121`) [run R8].

Re-render (`filter-lists.js:120-342`):
1. Sends 1.2 and 1.3 again. The pane renders from those responses, **not** from the broadcast
   payload (`filter-lists.js:124-133`) [run R8].
2. Rebuilds `serverEnabled` (`filter-lists.js:135,145-148`).
3. Keeps existing rows, adds rows for new records, removes rows whose record is gone
   (`filter-lists.js:142,179-190,211,331-333`).
4. Leaves in `toggled` keep the user's value; all others take the server value (4.1). A change made
   in another tab therefore does not discard this tab's uncommitted edits, and this tab's next
   commit sends its full list on top of the other tab's change. Observed [run R8]: this tab ticks
   `deu-0`; within the debounce window another page enables `fra-0` and disables `ita-0`; this tab
   then shows `deu-0` and `fra-0` ticked, `ita-0` unticked, and its commit sends the three defaults
   plus `deu-0` and `fra-0`.
5. Recomputes admin locks, hide-unused flags, node states, counts, totals, limit
   (`filter-lists.js:168-174,217,335,341`).

Upstream has no guard against overlapping re-renders: each awaits its own two responses and then
updates synchronously, so the response that arrives last wins. The React pane must apply only the
most recently requested pair of reads (an older pair answering later is discarded).

Interaction with a Settings restore or reset in the same dashboard (`settings.js:148-192`): the
restore runs in the page and sends its own `applyRulesets` (`backup-restore.js:147-150`), whose
broadcast re-renders this pane. Leaves this pane still has in `toggled` keep the user's value
(item 4), so a debounced commit pending in this pane at that moment is sent afterwards and
re-applies those leaves' values on top of the restored state. If that commit fires before the
restore's re-render has completed, its complete list is built from the pre-restore boxes and undoes
the restore for every id that differs. Upstream does nothing about either. The same holds for a change from another dashboard tab (item 4). The React pane
should behave the same (no message change); during the restore the Settings pane shows the `busy`
state, which hides every pane (`dashboard.css:64-71`).

Broadcast sources: any `applyRulesets` from any page (this dashboard, another dashboard tab,
settings restore `backup-restore.js:147-150`), `importFilterList` (`background.js:645`), and a
managed-policy change (`admin.js:124-135`).

Whether `BroadcastChannel` messages posted by the Safari background page reach the dashboard page
was not tested here: **UNKNOWN at runtime** (the upstream Safari build relies on it,
`settings.js:244-247`).

## 14. Pending change when the tab closes

Upstream registers a `beforeunload` handler when the script loads (`filter-lists.js:466-471`):

```js
if ( timer !== undefined ) { return; }
...
apply(true);
```

- **A debounce timer is pending (the user changed something less than 997 ms ago): the handler
  returns and the change is lost.** Nothing is sent [run R7].
- No timer pending: a "final" commit runs (9.2 with `final = true`). It sends
  `{ what: 'applyRulesets', enabledRulesets, toRemove }` only if the list differs from
  `serverEnabled` or `toRemove` is non-empty. This is the only path that ever sends `toRemove`.
  In the normal case (nothing pending, nothing flagged) nothing is sent [run R7].
- If the pane was never shown: both lists are empty, hashes are equal, nothing is sent
  (`filter-lists.js:29-30,429-449`) [run R7].
- **QUIRK Q11**: this path has no "committing" check. Leaving while a commit is still in flight
  sends the same list a second time, with `toRemove: []` [run R7]. Likewise with an admin-enabled
  ruleset (Q5) every unload sends the list [run R6]. Both are no-ops in the background apart from a
  broadcast.
- Whether Safari fires `beforeunload` for an extension page being closed, and whether a message sent
  from it is delivered: **UNKNOWN**.

**DEVIATION D1** (from the original plan: "New: flush a pending change on
pagehide"; a design review asked to treat it as optional until delivery is confirmed in
Safari): the React pane may flush a pending debounced change when the page is hidden/unloaded. If
implemented, the flush must send exactly what the debounced commit would have sent at that moment
(9.2), must send nothing when the list is unmodified, and must not be the only way a change is
saved. On Safari `toRemove` is never needed; omitting the key is equivalent to sending `[]`
(`background.js:384-386`, `imported-lists.js:226-229`). If a debounced commit is still unsettled at
that moment, the flush compares against the list that commit sent (not against the possibly stale
`serverEnabled`) and sends only when the pending list differs from it; this is the one case where a
second `applyRulesets` may be sent while the first is unsettled, as upstream's unload path also does
(Q11).

## 15. Safari differences (summary)

| Topic | Safari behaviour | Citation |
|---|---|---|
| Imported lists and import area | not available, not displayed | `safari/ext-offscreen.js:25`, `background.js:439`, `settings.css:267-270` |
| `maxNumberOfEnabledRulesets` | native constant read at runtime; value UNKNOWN | `safari/ext-compat.js:144` |
| Available static rule count | constant 150000, never shown | `safari/ext-compat.js:146-148` |
| `updateEnabledRulesets` | native call, then resets the "seen realms" workaround state | `safari/ext-compat.js:179-183` |
| Error text shown to the user | none (as on every platform) | `background.js:382-388` |
| Platform detection | `safari` when the extension URL starts with `safari-web-extension:`; sets `body[data-platform]`; no rule keyed on it affects this pane | `ext.js:30-34`, `dashboard.js:33`, `settings.css:104-106` |
| "User scripts" notice | lives inside the import area, so not displayed | `dashboard.html:119`, `settings.css:267-270` |
| Managed policy (`adminRulesets`) | UNKNOWN whether Safari provides `storage.managed`; no managed schema in the Safari manifest | `ext.js:131-139`, `safari/manifest.json` |
| Background context | non-persistent background page (not a service worker) | `safari/manifest.json:7-11` |
| WebKit ruleset-reload workaround | every page that loads upstream `ext.js` (the upstream dashboard included, `ext.js:22`) registers `windows.onFocusChanged`; once per realm (normal/private, tracked in `storage.session['safari.seenRealms']`) it disables and re-enables the currently enabled static rulesets with the same ids. It does not change the enabled set and sends no broadcast, so it has no effect on this pane's data. Page-wide concern, specified in `messaging.md` and `popup.md`, not here | `safari/ext-compat.js:28-64` |

## 16. Upstream quirks, treatment, and deliberate deviations

| Id | Quirk | Treatment |
|---|---|---|
| Q1 | First render can precede options data (2.5) | Fix: wait for options data (D2). No message impact |
| Q2 | Multi-segment `parent` chains break `promoteLonelySublist` (3.3) | Not in real data. Implementation must not crash; exact output unspecified |
| Q3 | Node toggle flips admin-locked leaves visually (6) | May fix (leave admin leaves untouched). No message impact, they are excluded from the payload |
| Q4 | Stale search state (8) | Fix: derive from state (D5). No message impact |
| Q5 | Redundant re-send when an admin-enabled ruleset exists (9.2) | Keep the upstream comparison, or compare against `serverEnabled` minus admin-locked ids; both are safe (unchanged list is a no-op in the background) |
| Q6 | Limit lock is pointer-only and can be exceeded (10) | Decision for the implementer; if the lock is made effective for keyboard too, no message changes |
| Q7 | No error is ever displayed (9.5) | Cannot be fixed through the response; see 9.5 for the only available signal |
| Q8 | Pending change lost on unload (14) | Optional D1 |
| Q9 | New rows are appended after existing rows instead of in sorted position on re-render (`filter-lists.js:232-234`) | Only affects imported lists added while the pane is open; sort from state |
| Q10 | Search reveals the `imported` group on Safari (8) | Recommended: keep imported rows undisplayed on Safari in search too (D6); keep them in model and payload (12.1). No message impact |
| Q11 | Unload during an in-flight commit re-sends the list (14) | Do not reproduce (D7); harmless either way |
| Q12 | A re-render whose reads fail clears `serverEnabled` before throwing (`filter-lists.js:135-137`), so the next commit counts as modified | Keep the last good state on a failed read and show the failure (D4) |
| Q13 | A composite node that first appears during a re-render gets no children container: the lookup for its container falls back to the root container (`filter-lists.js:195-197`), so its new leaves are appended there, beside the root groups, and the node shows `0/0` (`filter-lists.js:224-228,232-234`). Found by reading the code; not reachable with the shipped data (composite nodes come only from stock `parent` values, which do not change while the page is open; imported records have no `parent`, `imported-lists.js:194-215`) | Build the tree from state on every render; do not reproduce |
| Q14 | An `applyRulesets` that never answers leaves the page "committing" forever; later debounced commits re-arm forever and nothing more is saved (9.4) | Keep "one debounced commit in flight"; tell the user that saving has not completed |
| Q15 | After a failed first render the tree can be filled by a later re-render but stays inert; only the unload path sends (2.8) | A successful later read makes the pane fully operable (D4) |
| Q16 | Without the broadcast echo the baseline is stale and a change back to the old state is never sent (9.3) | D8: re-read after the response if no echo-driven re-read happened |

| Id | Deliberate deviation | Message impact |
|---|---|---|
| D1 | Optional flush of a pending change on page hide (14) | one `applyRulesets` that upstream would not send; same payload rules |
| D2 | First render waits for options data (2.5) | none |
| D3 | Keyboard-operable hide-unused toggle (7.3) | none; same storage write |
| D4 | Failures of reads and sends are shown, last good state is kept (2.3, 9.5) | none |
| D5 | Search results derived from state (8) | none |
| D6 | Imported rows never displayed on Safari, even in search (8, Q10) | none |
| D7 | No duplicate send at unload while a commit is in flight (14) | removes a redundant message |
| D8 | Re-read 1.2 + 1.3 after an `applyRulesets` response when no echo-driven re-read happened since the commit started (9.3, Q16) | at most one extra pair of read-only messages per commit |

## 17. UNKNOWN list

1. Numeric value of `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` in Safari.
2. Text and form of Safari's error when a ruleset or rule limit is exceeded, and whether
   `updateEnabledRulesets` rejects at all in that case.
3. Whether `browser.storage.managed` is available to this extension in Safari.
4. Whether `beforeunload` / `pagehide` fire for the dashboard tab in Safari and whether a message
   sent from them is delivered.
5. Whether `BroadcastChannel('uBOL')` messages from the Safari background reach the dashboard
   (assumed yes; upstream depends on it).
6. How long `applyRulesets` takes on Safari (how long the spinner shows).
7. Relative arrival order, on Safari, of the `applyRulesets` response and the broadcast that
   precedes it in the background (`background.js:259,387`). The pane must work with either order.
8. What `runtime.sendMessage` does on Safari when the background listener returned `true` but never
   calls `callback` because the handler threw (`background.js:857-861`): reject (and when), or never
   settle. Decides whether Q14 shows up as D4 (rejection) or as a commit that never ends.

## 18. Evidence from running upstream

Besides reading the source, two kinds of checks were made. Neither ran in Safari.

- **Node scripts** over the real `ruleset-details.json`, `messages.json`, `manifest.json` and
  `src/js/i18n.js`: field inventory (1.3), totals (5), tree and order (3.3, 3.4, including the
  locale comparison and the Q2 table), flags (3.5), search vectors (8), `isAdminRuleset`,
  `hashFromIterable` and import-URL vectors (20).
- **Runs of the unmodified upstream dashboard**: PRISTINE served read-only on `127.0.0.1`, loaded in
  headless Google Chrome (locale `en-US`) through `playwright-core`, with a mocked `browser` object
  (flavour `safari`, `supportsCompiledFilters: false` unless stated) that records every message and
  storage call and answers `applyRulesets` like the background (apply, broadcast, return
  `undefined`). The scripts (temporary, not included) were
  `run-upstream.mjs`, `verify1.mjs`, `verify2.mjs`, and `cite-check.mjs`, which checks that every
  `file:line` citation in this document points inside an existing file.

Second pass (everything below was re-done before the spec was used):
- `run-upstream.mjs` was re-run in full against unmodified PRISTINE; its output agrees with every
  `[run Rn]` statement in this document. Timings quoted in 9.1 and 9.4 are from that re-run.
- A new, independent script `recheck.mjs` re-implements the upstream tree, sort, totals, search,
  admin and import-URL algorithms and checks every data claim in sections 1.3, 3, 5, 8 and 20 against
  the real `ruleset-details.json`, `manifest.json`, the rule files and the flag images: all pass. It
  found one error in the earlier text (the `cy` locale row of 3.4), now corrected.
- `cite-check.mjs`: 353 citations, all inside their files; the first cited line of each of the 274
  distinct citations was read and points at the code described.
- `cmp` re-confirmed that the PRISTINE copies of all cited extension files are byte-identical to the
  sources (section 0).

Independent audit (after the second pass):
- Every `[run Rn]` statement was re-derived by reading the cited upstream code; none contradicted
  it. Nothing was run in a browser during the audit.
- A new independent script `check.mjs` (copies the upstream algorithms
  verbatim) re-checked every data claim of 1.3, 3.1-3.5, 5, 8, 20 (inventory, rule-file counts,
  manifest ids, group sizes, tree and `en-US` order, the five locales that differ, Q2 table, totals,
  stats vectors, search vectors and haystacks, admin vectors, import-URL vectors, the 13 displayed
  leaves, 59 flags and their PNG files): all pass, Node 26.8.2.
- `cite.mjs`: 407 cited line ranges (307 distinct, after the audit edits) all inside their
  files; the cited code was read for every section. `cmp`: all cited PRISTINE copies byte-identical.
- Added by the audit (all from reading code, not executed): the never-answering handler and its
  effect on the commit path (section 1, 9.4, Q14, 17.8); the follow-on effects of the
  `enabledRulesets: undefined` hazard (1.4, 1.7); the options-data failure path (1.1); the cached
  failed `ruleset-details` fetch (1.3); the send order of the two reads (1.2); lifecycle items
  2.6-2.9 and Q15; the stale-baseline quirk Q16 and D8; restore interplay (13); admin cache (11);
  D1 behaviour with an unsettled commit (14); the complete browser-API surface (section 1).

| Run | Scenario | Observed |
|---|---|---|
| R1 | first show | only `getEnabledRulesets` + `getRulesetDetails` sent; DOM order equals 3.4; `malware` and `imported` not displayed; default hide-unused state; totals and tooltip texts; flag images |
| R2 | commit | header click writes `['ads','imported']`; tick updates totals and count at once, sends nothing; one `applyRulesets` about 1 s later with the complete list; then the two reads; tick+untick sends nothing; three quick changes give one message |
| R3 | tri-state and hide-unused clicks | transitions of section 6; payload after a sequence; count/expander click writes the node id; `default` header click writes `['default']` |
| R4 | search | vectors of section 8; no message or storage write; header click in search mode still writes storage; Q4 stale header; re-render keeps search mode |
| R5 | limit | lock at equality; pointer blocked, keyboard not; lock disappears above the limit; no lock when the maximum is `undefined` |
| R6 | admin | locked/hidden rows; node locked when all leaves are; excluded from payload and search; Q5 re-send; unload send with `toRemove: []` |
| R7 | unload | pending change lost; nothing sent when untouched or never shown; duplicate send during an in-flight commit |
| R8 | broadcasts | ignored before first show; re-read on `{enabledRulesets}`; pending edit kept; `{adminRulesets}` applied |
| R9 | failed and slow apply | silent revert with empty error line; spinner while in flight; second commit waits for the first |
| R10 | imported record with `supportsCompiledFilters: false` | not displayed, counted in totals, id in payload; revealed by search with a trash icon and a checkbox whose change is committed (Q10); with `true`: group displayed, import area hidden while `imported` is in hide-unused state |
| R11 | stored hide-unused values; stored active pane | array replaces default; non-array ignored; pane initialises at load |
| R12 | options data slower than the pane's reads | admin lock and limit missing after load (Q1) |
| R13 | admin leaf under a toggled node; partial node at the limit; failed first render; link attributes | Q3; Q6; empty inert pane; `target="_blank"`, no `rel` |
| R14 | leaf icons, with `supportsCompiledFilters: true` and an imported record whose `homeURL` is empty | stock leaf: home link only; imported leaf: trash icon, no home link |

## 19. PARITY CHECKLIST

1. No `applyRulesets` and no storage write is caused by this pane, and no control of the pane is
   operable, until both `getEnabledRulesets` and `getRulesetDetails` have answered successfully and
   the options data (`adminRulesets`, `maxNumberOfEnabledRulesets`, `supportsCompiledFilters`) is
   available (D2).
2. First show sends exactly `{ what: 'getEnabledRulesets' }` then `{ what: 'getRulesetDetails' }`,
   the second without waiting for the first's answer, and nothing else (the About pane's identical
   reads, `troubleshooting.js:69-70`, are not counted). Opening the pane and touching nothing never
   sends `applyRulesets` (upstream exception: Q5 with an admin-enabled ruleset).
3. Root groups appear in the order default, ads, privacy, malware, annoyances, misc, regions,
   imported, named by `3pGroupDefault` ... `3pGroupImported`; empty groups other than `imported` are
   not shown; `imported` is not shown on Safari.
4. `misc` holds exactly the records with no `group` and no string `lang` (real data:
   `ublock-experimental`, `ubol-tests`).
5. Children are ordered by id with `\p{Emoji}+` removed, `localeCompare` without a locale, stable;
   in an `en` browser the result for the real file equals the JSON in 3.4.
6. `pol-0` is a direct leaf of `regions`; `rus-0` and `rus-1` sit under one composite node named
   `🇷🇺ru 🇺🇦ua 🇺🇿uz 🇰🇿kz: RU AdList`.
7. Flag emoji in names render as `/img/flags-of-the-world/<cc>.png` images followed by U+200A; other
   text unchanged.
8. Each leaf links to its `homeURL` in a new tab; no link when `homeURL` is empty.
9. Group and node counts read `checked/total` over all leaves below, hidden ones included.
10. Leaf tooltip and totals line use `perRulesetStats` with `rules.plain + rules.regex` and
    `filters.accepted`, numbers through `toLocaleString()`. With only the three defaults enabled the
    totals are 113,615 and 121,437.
11. The totals line and counts update immediately on a change, before any message.
12. Composite node: unchecked when 0 leaves checked, indeterminate when some, checked when all.
    Activating it: none to all, partial to all, all to none.
13. Root groups have no checkbox.
14. Hide-unused: default set `['ads','regions','imported']`; a node in that state hides its direct
    children that are unchecked and not default-enabled; toggling writes the whole array to
    `storage.local['hideUnusedFilterLists']`; a stored array replaces the default; a stored
    non-array is ignored; the key is read once per page load and nothing is written without a
    toggle.
15. Hide-unused node ids are group ids, or the parent segment text for composite nodes.
16. Search matches a case-insensitive literal substring of `name + ' ' + '' + ' ' + group + ' ' + tags`
    (trimmed); ids are not searched; admin-locked leaves never match; results override hide-unused;
    groups show only when they contain a match; empty input leaves search mode; searching sends no
    message and writes no storage.
17. A checkbox change sends nothing immediately; one `applyRulesets` is sent 997 ms after the last
    change.
18. The payload is `{ what: 'applyRulesets', enabledRulesets: string[] }` with the complete list of
    checked leaf ids, admin-locked leaves excluded, hidden leaves included, checked imported ids
    included. `enabledRulesets` is always an array. Every id comes from the latest
    `getRulesetDetails`.
19. No message is sent when the sorted payload equals the sorted `serverEnabled` (tick then untick
    within the window sends nothing).
20. `toRemove` is never sent by a debounced commit.
21. While a commit is in flight, a due commit is postponed by another 997 ms, not dropped and not
    sent in parallel; at most one debounced `applyRulesets` is in flight.
22. The spinner is shown from commit start until the `applyRulesets` response; nothing is disabled
    meanwhile.
23. The response is treated as carrying no data (`undefined`); the pane never reads an error from
    it.
24. After a commit the pane does not assume success: it re-reads the state when the
    `{ enabledRulesets }` broadcast arrives, using fresh `getEnabledRulesets` and
    `getRulesetDetails`, never the broadcast payload. A rejected change shows as the boxes
    returning to the real state.
25. On re-render, leaves the user changed since the last commit started keep the user's value; all
    other leaves take the server value.
26. A broadcast received before the pane was first shown triggers no fetch.
27. `{ adminRulesets }` in a broadcast replaces the cached admin tokens (when different) and
    re-renders.
28. Admin-locked leaf: checkbox disabled; row not shown when unchecked; never in the payload;
    still counted in counts, totals and the limit.
29. Composite node is admin-locked only when all its leaves are.
30. At the limit (`checked non-imported leaves === maxNumberOfEnabledRulesets`) every row with an
    unchecked own checkbox cannot be ticked with the pointer; checked rows stay operable; group
    headers stay operable. No limit when the option is undefined. The maximum is never hard-coded.
31. On Safari no import area, no `imported` group, no `importFilterList`, no trash/undo icons.
32. Enabled imported lists present in the data on Safari stay in the model: they are in the payload
    and in the totals although not displayed (D6: not displayed in search either).
33. Unload with a pending debounce: upstream sends nothing (change lost). With D1 the pending
    change is sent once, with the payload of item 18.
34. Unload with nothing pending and nothing changed sends nothing (upstream exception: Q5).
35. With `disabledFeatures` containing `dashboard`, the pane and its tab do not exist.
36. The shared `enabledRulesets` value used by the Settings backup is updated by every successful
    read of this pane and by every `{ enabledRulesets }` broadcast carrying an array, and is never
    set to `undefined` by a failed read.
37. A failed read or send is shown to the user; the tree keeps its last good state and no commit is
    built from a partial or failed read (D4).
38. Switching to another pane and back sends nothing and keeps the tree, the search text, the
    hide-unused state and uncommitted edits; a pending debounce still commits while another pane is
    shown; broadcasts still re-read while the pane is hidden (once it has been shown).
39. The pane makes no `permissions.*`, `tabs.*`, `scripting.*` or `storage.session` call, and touches
    no storage key other than `storage.local['hideUnusedFilterLists']` (read once per page load,
    written only by a hide-unused toggle).
40. A broadcast `{ enabledRulesets: undefined }` (or one with only unrelated keys) causes no read.
41. When two read pairs overlap, only the most recently requested pair is applied.
42. While an `applyRulesets` is unsettled, no second debounced `applyRulesets` is sent, however long
    it stays unsettled; the pane shows that the save has not completed (Q14). The only exception is
    the optional unload flush of D1.
43. After an `applyRulesets` response, if no `{ enabledRulesets }` broadcast has caused a re-read
    since the commit started, the pane sends one `getEnabledRulesets` + `getRulesetDetails` pair
    (D8). Test: tick X, let it commit with the broadcast suppressed, untick X: a second
    `applyRulesets` without X is sent.
44. If `getOptionsPageData` fails, the pane shows the failure and offers no operable controls.
45. A successful read after a failed first read makes the pane fully operable (checkbox changes
    update counts and commit) (Q15).
46. Every `enabledRulesets` sent is an array of strings, never `undefined`, never a string, and only
    contains ids of the latest successful `getRulesetDetails` response.

## 20. Pure functions to extract

All are free of DOM and browser API. `Details` is the record type of 1.3. Expected values are for
the real `ruleset-details.json` unless stated. "Tree" below means the output of function 5.

| # | Function | Inputs | Output | Upstream | Test vectors |
|---|---|---|---|---|---|
| 1 | `rulesetStats` | `Details` | `{ ruleCount: rules.plain + rules.regex, filterCount: filters.accepted }` | `filter-lists.js:95-102` | `ublock-filters` 6913/10703; `easylist` 50512/54506; `easyprivacy` 56190/56228; `ublock-experimental` 0/0; `ubol-tests` 17/10; `deu-0` 2194/2314; `rus-0` 17148/19827; `rus-1` 1413/1554 |
| 2 | `formatStats` | template string, `{ruleCount, filterCount}`, number formatter | template with the first `{{ruleCount}}` and first `{{filterCount}}` replaced | `filter-lists.js:56-59,164-166` | en-US, `ublock-filters`: "6,913 rules, converted from 10,703 network filters" |
| 3 | `groupRulesets` | `Details[]` | ordered `[groupId, Details[]][]`, 8 entries | `filter-lists.js:240-283` | sizes 3, 1, 1, 0, 7, 2, 37, 0; no record left out; a record with `group: 'x'` or with no group and `lang: 'de'` is in no group |
| 4 | `groupNameKey` | group id | i18n key | `filter-lists.js:293` | `default` gives `3pGroupDefault`; `regions` gives `3pGroupRegions` |
| 5 | `buildListTree` | `Details[]`, `(groupId) => name` | tree `{ [groupId]: { name, lists: { [key]: Details or { name, lists } } } }` after parent nesting and `promoteLonelySublist` | `filter-lists.js:287-329` | `regions` has 36 children, one of them a node with `rus-0`, `rus-1`; `pol-0` is a direct leaf; synthetic `x`,`y` with parent `A` give node `A`; synthetic `x` with parent `A` gives a direct leaf |
| 6 | `sortKey` | entry key (id or parent segment), entry value | `(value.title or key)` with `/\p{Emoji}+/gu` removed | `filter-lists.js:199,204-205` | `rus-0` gives `rus-`; `jpn-1` gives `jpn-`; `annoyances-ai` unchanged; the RU node key gives `ru ua uz kz: RU AdList`; `a#b*c9` gives `abc` |
| 7 | `sortEntries` | `[key, value][]`, comparator (default `localeCompare`) | stably sorted: `preferred === true` first, then `sortKey` via the comparator | `filter-lists.js:200-207` | full order = JSON in 3.4 (locale `en`); with locale `cs`, `chn-0` comes after `hun-0` |
| 8 | `flattenLeaves` | tree | leaf ids in display order | `filter-lists.js:429-432` (DOM order) | starts `easylist, easyprivacy, ublock-filters, adguard-mobile, block-lan, annoyances-ai`; `..., rou-1, rus-0, rus-1, spa-0, spa-1, ...`; ends `tur-0, ukr-0, vie-1`; 51 ids |
| 9 | `splitFlags` | name | segments: text, or flag `{ cc }` followed by text U+200A | `src/js/i18n.js:301-344` | `🇩🇪de 🇨🇭ch 🇦🇹at: EasyList Germany` gives flag de, U+200A, `de `, flag ch, U+200A, `ch `, flag at, U+200A, `at: EasyList Germany`; `EasyList` gives one text segment; the map has 63 entries |
| 10 | `isAdminRuleset` | id, `adminRulesets: string[]` | boolean | `filter-lists.js:106-116` | `('easylist', ['+easylist'])` true; `['-easylist']` true; `['easylist']` true; `['+easylist-extra']` true; `['+xeasylist']` false; `['xeasylist']` false; `[]` false; `('spa-0', ['+spa-1'])` false |
| 11 | `mergeServerState` | `desired`, `toggled`, `serverEnabled`, all leaf ids | new `desired` (toggled ids keep their value, others take `serverEnabled.has(id)`) | `filter-lists.js:145-151` | toggled `{deu-0: true}`, server = 3 defaults + `fra-0`: result has the defaults, `deu-0` and `fra-0` true |
| 12 | `nodeState` | leaf ids under the node, `desired`, `isAdmin` | `{ checkedCount, totalCount, checked, partial, fromAdmin }` | `filter-lists.js:68-91` | RU node with `rus-0` only: `1/2`, checked, partial; `regions` with defaults only: `0/37`; RU node with both leaves admin-locked: `fromAdmin` true; with one: false |
| 13 | `nodeToggleTarget` | new `checked` of the node input, `wasPartial` | `checkAll` boolean | `filter-lists.js:541-542` | (true, false) true; (false, true) true; (false, false) false |
| 14 | `totals` | leaves, `desired`, `isImported` | `{ rulesetCount, ruleCount, filterCount }` | `filter-lists.js:42-55` | 3 defaults: 3, 113615, 121437; plus `deu-0`: 4, 115809, 123751; all 51: 51, 196322, 214575; 3 defaults plus one checked imported record with `plain 7, regex 2, accepted 11`: 3, 113624, 121448 |
| 15 | `isAtLimit` | `rulesetCount`, `max` (number or undefined) | `rulesetCount === max` | `filter-lists.js:61-63` | (3, 50) false; (50, 50) true; (51, 50) false; (3, undefined) false |
| 16 | `isRowLocked` | at-limit flag, own checkbox checked | `atLimit && !checked` | `settings.css:227-230` | partial node (checked) at the limit: not locked |
| 17 | `hideUnusedInit` | stored value | the set: `new Set(stored)` if array, else `{'ads','regions','imported'}` | `filter-lists.js:32,380-382` | `undefined` gives the default; `'nope'` gives the default; `[]` gives empty; `['misc']` gives `{'misc'}` |
| 18 | `toggleHideUnused` | set, node id | new set (membership flipped) and the array to store | `filter-lists.js:364-376` | default set, `regions` gives `['ads','imported']`; empty set, RU node id gives `[<RU node id>]`; `'*'` members are kept |
| 19 | `isHiddenByHideUnused` | parent in hide-unused state, child `isDefault`, child own checkbox checked | `parentHides && !isDefault && !checked` | `settings.css:164-166` | default state, 3 defaults enabled: all 36 children of `regions` hidden, `adguard-mobile` hidden, all of `annoyances` shown; 13 leaves displayed in the whole tree |
| 20 | `isAdminHidden` | row admin-locked, own checkbox checked | `fromAdmin && !checked` | `settings.css:167-169` | |
| 21 | `searchHaystack` | `Details` | `[name, undefined, group or '', tags or ''].join(' ').trim()` | `filter-lists.js:404-409` | `easylist` gives `EasyList  default` (two spaces); `ubol-tests` gives `uBO Lite Test Filters`; `adguard-mobile` gives `AdGuard/uBO – Mobile Ads  ads mobile` |
| 22 | `searchRegex` | pattern | `new RegExp(escaped, 'i')` | `filter-lists.js:396` | `a.b` has source `a\.b`; `[x]` has source `\[x\]` |
| 23 | `searchLeaves` | tree, pattern, `isAdmin` | set of matching leaf ids (admin-locked skipped), plus the groups/nodes that contain a match | `filter-lists.js:392-419` | vectors in section 8; with admin token `+easylist`, pattern `easylist` does not return `easylist` |
| 24 | `collectEnabled` | leaves in display order, `desired`, `isAdmin` | `string[]` payload | `filter-lists.js:429-438` | 3 defaults plus `deu-0`: `['easylist','easyprivacy','ublock-filters','deu-0']`; with admin token `+easylist`: `easylist` absent; a checked imported id is present, last |
| 25 | `hashFromIterable` | iterable or falsy | `Array.from(x).sort().join('\n')`, `''` for falsy | `dashboard.js:83-86` | `['b','a']` gives `"a\nb"`; `undefined`, `[]`, empty Set give `''` |
| 26 | `isModified` | payload, `serverEnabled`, `final`, `toRemove` | boolean | `filter-lists.js:446-448` | equal sets in different order: false; final with one `toRemove`: true; `serverEnabled` holding an admin-enabled id that the payload lacks: true |
| 27 | `commitTimerAction` | `committing` boolean (evaluated when the 997 ms timer fires) | `'rearm'` or `'commit'` | `filter-lists.js:477-484` | true gives `rearm`; false gives `commit` |
| 28 | `unloadAction` | `timerPending`, `modified` (item 26 with `final = true`) | `'none'` or `'sendFinal'` (upstream semantics) | `filter-lists.js:466-471,449` | (true, any) none; (false, false) none; (false, true) sendFinal |
| 29 | `isValidImportUrl` (non-Safari) | string | boolean | `filter-lists.js:493` | `https://example.com/list.txt` true; `https://example.com` false; `HTTPS://example.com/x` false; `file:///a/b` true; `ftp://h/` true |
| 30 | `afterCommitAction` (D8) | `rereadSinceCommitStart` boolean (a broadcast-driven read pair was requested after the commit started) | `'none'` or `'reread'` | none upstream (9.3, Q16) | true gives `none`; false gives `reread` |

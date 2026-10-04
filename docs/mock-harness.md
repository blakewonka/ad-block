# Mock extension environment and browser test harness

The harness lets the React pages run, be tested and be screenshotted in ordinary
Google Chrome, without Safari or an installed extension. The harness pages
(`ui/dist/harness/*.html`, built with `npm --prefix ui run build:harness`) load
`ui/harness/boot/boot.ts`. That file imports `ui/src/dev/install-mock.ts`, which
puts a mock on `globalThis.browser` before the app entry is loaded. Production
builds never contain the mock (section 7).

Paths below are relative to `ui/`. Spec names (`messaging.md`, `popup.md`,
`settings.md`, `filter-lists.md`, `i18n.md`) are files in [specs/](specs/), and
`ARCHITECTURE §N` is a rule in [specs/README.md](specs/README.md).
`PRISTINE` is `build/pristine/safari`.

## 1. Files

| File | What it is |
|---|---|
| `src/dev/mock-ext.ts` | The mock API (`createMockExt`), the in-memory background (`MockBackground`), and switch parsing (`parseMockOptions`, `resolveMockConfig`). Pure: it touches no global. |
| `src/dev/install-mock.ts` | Installs the mock on `globalThis.browser` and patches `window.close`, `window.confirm`, `BroadcastChannel` and, with `?theme=`, `matchMedia`. Sets `window.__blockerCalls`, `window.__blockerMock` and `globalThis.__BLOCKER_MOCK__` (the boot marker). Synchronous; it does nothing if a real API exists. |
| `src/dev/fixtures/ruleset-details.json` | Byte copy of `PRISTINE/rulesets/ruleset-details.json` (51 entries). |
| `src/dev/fixtures/manifest.json` | Byte copy of `PRISTINE/manifest.json`. |
| `src/dev/fixtures/locales/<folder>.json` | Byte copies of all 71 `PRISTINE/_locales/<folder>/messages.json`. All 71 cost about 1.5 MB, in the harness only; the i18n checklist needs many of them. |
| `src/dev/fixtures/index.ts` | Loads the JSON. `LOCALES`, `LONGEST_LOCALE = 'el'`, `RTL_LANGUAGES`, `RULESET_DETAILS`, `MANIFEST`. |
| `src/dev/fixtures/background-state.ts` | The initial background state, which is fixture F, plus `EXPECTED_DEFAULT_RESPONSES`. The header cites the spec sections. |
| `src/dev/fixtures/scenarios.ts` | The scenario presets. The header cites the spec section for each. |
| `src/dev/mock-ext.test.ts` | vitest cases: response shapes equal the fixtures, state changes, hazards, switches, the record, i18n, and a scan of production sources for mock imports. |
| `tests/e2e/helpers/index.mjs` | `startStaticServer`, `launchChrome`, `openHarness`, `getCalls`, `getMessages`, `clearCalls`, `getMockState`, `mockBroadcast`, `screenshot`, `harnessQuery`, `userDataDirRemoved`, `POPUP_VIEWPORT`, `DASHBOARD_VIEWPORT`, `PHONE_VIEWPORT` and `TOUCH_DEVICE` (`launchChrome({ viewport: PHONE_VIEWPORT, ...TOUCH_DEVICE })` makes Chrome answer `(hover: none) and (pointer: coarse)` like a phone), `PURE_APIS`. |
| `tests/e2e/harness.smoke.mjs` | The smoke test for all of the above. |
| `tests/e2e/platform.mjs` | What differs per `?platform=` (Settings strict blocking, imported lists, import, removal with `toRemove`) and the touch layouts at 390 x 844. |

## 2. The call record: `window.__blockerCalls`

This is an array, appended to synchronously at call time. Each entry is:

```ts
{ api: string,      // dotted name, see the list below
  args: unknown[],  // deep copy (structuredClone) of the arguments AT CALL TIME;
                    // functions become "[function name]"; NaN / undefined are preserved
  t: number }       // performance.now() at call time (ms since navigation start)
```

Recorded `api` names:
- `runtime.sendMessage`, `runtime.getURL`, `runtime.getManifest`, `runtime.getPlatformInfo`, `runtime.openOptionsPage`, `runtime.connect`, `runtime.sendNativeMessage`, `runtime.reload`, `runtime.onMessage.addListener` (and `.removeListener` / `.hasListener` on every event)
- `tabs.query`, `tabs.get`, `tabs.reload`, `tabs.update`, `tabs.create`
- `scripting.executeScript`, `scripting.insertCSS`, `scripting.removeCSS`
- `permissions.request`, `permissions.contains`, `permissions.getAll`, `permissions.remove`, `permissions.onAdded.addListener`, `permissions.onRemoved.addListener`
- `storage.local.get` / `set` / `remove` / `clear` / `getKeys`; the same for `storage.session.*` and `storage.sync.*`; `storage.onChanged.addListener`, `storage.local.onChanged.addListener`
- `alarms.create`, `alarms.clear`, `alarms.get`, `alarms.getAll`, `alarms.onAlarm.addListener`
- `i18n.getMessage`, `i18n.getUILanguage`, `i18n.getAcceptLanguages`
- `action.getBadgeText`
- Page globals: `window.close` (also covers `self.close()`), `window.confirm` (`args = [text]`), `BroadcastChannel` (construction, `args = [name]`) and `BroadcastChannel.postMessage` (`args = [name, message]`)

Some calls are deliberately not recorded:
- Posts made by the mock background itself. They are logged separately in `__blockerMock.broadcasts`.
- Its internal storage writes, for example `filteringModeDetails` and `rulesetConfig`.

`getCalls(page)` hides `PURE_APIS` by default. These are `i18n.getMessage`, `i18n.getUILanguage`, `runtime.getURL` and `runtime.getManifest`: every render makes them, and parity lines never count them. Use `getCalls(page, { all: true })` for everything, and `getCalls(page, { api: 'tabs.query' })` or `{ api: /^permissions\./ }` to filter. `getMessages(page)` returns just the `sendMessage` objects in order. `clearCalls(page)` empties the array in place.

How to check "called synchronously in the gesture" (messaging.md §21 line 9, ARCHITECTURE §6.6): dispatch the click inside one `page.evaluate` and read the array length in the same synchronous run.

```js
const n = await page.evaluate(() => {
    const before = __blockerCalls.length;
    document.querySelector('[data-level="2"]').click();          // synchronous dispatch
    return __blockerCalls.slice(before).map((c) => c.api);       // read before any await
});
// n must already contain 'runtime.sendMessage' (setPendingFilteringMode) and 'permissions.request'
```

`?gesture=strict` makes `permissions.request` reject without a user activation (`navigator.userActivation.isActive`), as Chrome does. That catches requests made outside a real click, but it cannot prove the call was synchronous: transient activation lasts several seconds.

## 3. Switches

### 3.1 Precedence

From lowest to highest:
1. Scenario presets, in the order given.
2. Query switches.
3. `?mock=<URL-encoded JSON MockOptions>`.
4. `globalThis.__BLOCKER_MOCK_CONFIG__`, a MockOptions object set before page scripts run, for example `openHarness(page, 'popup', {}, { config: {...} })`, which uses `page.addInitScript`.

`background`, `delays`, `failures`, `responses` and `storage` merge key by key. Other keys are replaced.

### 3.2 Query switches (`openHarness(page, name, { ...these })`)

| Switch | Values | Effect |
|---|---|---|
| `scenario` | `default`, `admin-locked`, `max-rulesets`, `no-website`, `error-on-apply`, `slow`; comma list, applied in order | Presets, see 3.3. Unknown names are ignored with a warning. Also written to `html[data-mock-scenario]`. |
| `platform` | `safari` (default), `chromium`, `firefox` | The browser family. Sets the scheme of `runtime.getURL` (`safari-web-extension:`, `chrome-extension:`, `moz-extension:`), which is what upstream's `webextFlavor` and the UI branch on, and the background defaults of that build: `supportsCompiledFilters` and `strictBlockMode` are `true` on Chromium and Firefox (`ext-offscreen.js`, `config.js:35`). On `chromium` the mock is installed as `chrome` only, with no `browser` global. Applied before scenarios and the other switches; written to `html[data-mock-platform]`. |
| `lang` | a locale folder (`en`, `ar`, `de`, `el`, `pt_BR` / `pt-BR`, ...), or `longest` (= `el`) | Which real `messages.json` answers `i18n.getMessage`. Unknown → `en` with a warning. Default `en`. |
| `ui_locale` | any string, e.g. `ar_SA`, `fa`, `en_US` | Value of `@@ui_locale`; `getUILanguage()` is the same with `_`→`-`. Default: `lang`. |
| `dir` | `rtl`, `ltr` | Sets `<html dir>` and `<body dir>` at install. With `rtl` and a left-to-right `lang`, `@@ui_locale` becomes `ar` (unless `ui_locale` is given), so the app's own direction logic (i18n.md §2.2) turns RTL while the strings stay in `lang`. |
| `theme` | `dark`, `light` | Forces `html[data-theme]` and the `dark`/`light` classes, overriding `theme-init.js` (a MutationObserver puts them back if the OS scheme changes). `matchMedia('(prefers-color-scheme: …)').matches` answers accordingly. Without it, `theme-init.js` follows the OS / Playwright `colorScheme`. |
| `perm` | `grant` (default), `deny`, `reject`, `hang` | `permissions.request` resolves `true`, resolves `false`, rejects, or never settles. A grant adds the origins and runs the background's `onAdded` logic (§4). An invalid pattern such as `*://*.[::1]/*` is rejected in every mode, like Chrome. |
| `permDelay` | ms | Delay before the permission answer, to simulate the prompt being open. |
| `gesture` | `strict` | `permissions.request` rejects without user activation. |
| `url` | a URL, or `none` | URL of the active tab. Default `https://www.example.com/path?x=1`. `none` gives a tab without a `url` property (messaging.md U11). Use `about:blank`, `file:///x` or `safari-web-extension://<host>/strictblock.html#https://…` for the other popup.md §16 lines. |
| `tab` | `none` | `tabs.query` returns `[]`. |
| `tabId` | number | Id of the active tab. Default `42`. |
| `scripting` | `none` / `0` | `browser.scripting` is `undefined` (messaging.md §13.3 guard). |
| `getKeys` | `none` / `0` | `storage.local.getKeys` is missing, so js/ext.js falls back to `get(null)`. |
| `confirm` | `false` / `0` | `window.confirm()` returns `false`. Default `true`. No dialog is ever shown. |
| `echo` | `off` / `0` | The background posts no BroadcastChannel echo (messaging.md U13; the filter-lists §6.3 baseline case). |
| `delay` | ms | Delay before every `sendMessage` is handled. |
| `fail` | `what:mode,…` with mode `reject` (default), `undefined`, `null`, `hang`; `all:mode` = every message | Transport-level failure for those messages. The state does not change. `reject` uses Chrome's "Could not establish connection. Receiving end does not exist." |
| `nullAs` | `null` | A handler's `undefined` arrives as `null` (U1). |
| `manifestName` | `raw` | `getManifest().name` is `__MSG_extName__` instead of the localised `Blocker` (U10). |
| `dnrError` | `1` | `applyRulesets` changes nothing, answers `undefined` and echoes the old list: the silent DNR failure of messaging.md §6.3 and filter-lists.md §9.5. |
| `level` | 0-3 | Level of the active tab's hostname at start, applied like `setFilteringMode`. |
| `default` | 0-3 | Default level at start, applied like `setDefaultFilteringMode`. Applied before `level`. |
| `customFilters` | N | Stores N selectors for the active tab's hostname, so `popupPanelData.hasCustomFilters === N`. |
| `dev` | `1` / `0` | `developerMode`. |
| `autoReload` | `1` / `0` | `autoReload`. |
| `sideloaded` | `1` / `0` | `isSideloaded` (default `true`, as in PRISTINE). |
| `compiled` | `1` / `0` | `supportsCompiledFilters` (imported lists and "Add filter list…"). |
| `userScripts` | `1` / `0` | `supportsUserScripts` (hides the user-scripts notice of the import area). |
| `omni` | `1` / `0` | Granted origins `['<all_urls>']` or `[]`, which sets `hasOmnipotence`. |
| `max` | N, or `none` | `maxNumberOfEnabledRulesets`. `none` means absent (U4: no limit). |
| `disabled` | token list, `none`, or `null` | `disabledFeatures`, e.g. `zapper,picker,report`. `null` reproduces the INIT-THREW hazard of popup.md §8.4. |
| `admin` | token list, e.g. `+easylist,-easyprivacy` (URL-encode `+` as `%2B`) | `adminRulesets`. Also give `enabled` if the start list must already reflect them. |
| `enabled` | id list | The enabled rulesets at start. |
| `mock` | JSON MockOptions | Anything else, e.g. `{"responses":{"popupPanelData":{"level":"2"}}}`, `{"background":{"customFilters":[["a.com",[".x"]]]}}`, `{"storage":{"local":{"dashboard.activePane":"about"}}}`. `openHarness` JSON-encodes object values automatically. |

`MockOptions` (JSON) has these fields: `scenario, platform, lang, uiLocale, dir, theme, permission, permissionDelay, requireGesture, tab, tabUrl, tabId, scripting, storageGetKeys, confirm, echo, delay, delays{what:ms}, failures{what:mode}, responses{what:json}, nullishAs, manifestName, dnrError, level, defaultLevel, customFilterCount, background{…BackgroundInit}, storage{local,session}`. `responses` answers that message verbatim, with no state change and no echo. It is the way to feed malformed shapes, for example a string level or a missing field. For an `undefined` or `null` answer, use `failures` instead.

### 3.3 Scenarios

| Name | What it sets | Spec |
|---|---|---|
| `default` | Fixture F (§4) | messaging.md §21 |
| `admin-locked` | `disabledFeatures: ['filteringMode','develop','picker']`; `adminRulesets: ['+annoyances-cookies','-easyprivacy']`; enabled list `ublock-filters, easylist, annoyances-cookies`. Developer mode is forced off by `develop` (bg:807-814). Add `disabled=dashboard` etc. for other tokens. | messaging.md §3.6, popup.md §8.4, settings.md §2.4, filter-lists.md §11 |
| `max-rulesets` | `maxNumberOfEnabledRulesets: 5` with 5 enabled (`…, annoyances-cookies, deu-0`), so the pane is at the limit. An apply that would exceed 5 is refused like a DNR error: list unchanged, answer `undefined`, echo with the old list. | filter-lists.md §10, messaging.md §6.3 |
| `no-website` | Active tab `about:blank`, so the popup must send no message | messaging.md §4.1, popup.md §16 line 5 |
| `error-on-apply` | Every state-changing message rejects at transport level. These are `setFilteringMode`, `setDefaultFilteringMode`, the five toggles, `applyRulesets`, `importFilterList`, `setFilteringModeDetails`, `removeAllCustomFilters`, `addManyCustomFilters`, `setSandboxFilters` and `updateUserDnrRules`. Reads, `setPendingFilteringMode`, `gotoURL` and `showMatchedRules` still answer. | ARCHITECTURE §6.5, messaging.md §1.5 |
| `slow` | Every message answered after 1500 ms, permission answers after 600 ms. Override with `delay=` / `permDelay=`. | messaging.md §1.6 item 4, U14 |

## 4. What the mock background does

- **Default state, fixture F (messaging.md §21; settings.md §2.2):**
  - Tab `{ id: 42, url: 'https://www.example.com/path?x=1' }`.
  - Mode table `{ none: [], basic: ['www.example.com'], optimal: ['all-urls'], complete: [] }`. So `popupPanelData.level` is 1 and the default is 2.
  - Granted `<all_urls>`, so `hasOmnipotence` is true.
  - Enabled `ublock-filters, easylist, easyprivacy`.
  - `maxNumberOfEnabledRulesets: 50` (a placeholder: U4).
  - Toggles at the §3.5 defaults (`strictBlockMode: false`); `canShowBlockedCount: true`; `isSideloaded: true`; `supportsCompiledFilters: false`; `supportsUserScripts: false`.
  - No `disabledFeatures`, no custom filters, no sandbox text, no imported lists.
  - `getConsoleOutput`, `getRegisteredContentScripts` and `getEffectiveUserRules` answer `[]`. `getPlatformInfo().os` is `mac`.
  - Local storage is seeded with `deferredJobs: [{ name: 'pruneCSSCache', … }]` (§7.2, §21 line 31).
  - **Deviation from F:** F gives the popup `hasOmnipotence: false`. Here it is `true`, consistent with the dashboard fixture; the popup never reads it (§4.1).
  - `EXPECTED_DEFAULT_RESPONSES` in `fixtures/background-state.ts` holds the exact answers, and the unit test checks them.
- **Messages:** every class-A message of messaging.md §2.1 is answered in its exact shape, with the background's state change and echo.
  - The mode logic is a line-by-line port of js/mode-manager.js:66-237. That includes the parent-domain pruning and the string/NaN-level hazard: a string level drops the site to the default.
  - The ruleset logic is a port of js/ruleset-manager.js:605-703 and bg:239-260. That includes admin `+`/`-` re-application, unknown ids being dropped, the `enabledRulesets: undefined` hazard, and `[]` disabling everything. The `{ enabledRulesets }` echo always fires.
  - `setDefaultFilteringMode` always writes and echoes (§5.2). `setDeveloperMode` answers the new boolean.
  - Toggle coercions are as bg:461-490: `setPopupBlockMode` stores the raw value.
  - Custom filters, `sandboxFilters` and `rulesets.imported` live in the mock's `storage.local`, as upstream. Their changes fire `storage.onChanged`.
  - Class-B messages get minimal answers. Class-C messages answer `undefined` with a `console.warn`. An unknown `what` answers `undefined`.
- **The wire:** requests and responses are JSON round-tripped, as in Chrome: `undefined` keys are dropped, `NaN` becomes `null`, and a `Set` becomes `{}`. Whether Safari does the same is UNKNOWN (U1). The record keeps the raw argument.
  - A handler that throws (for example `setFilteringModeDetails` without `modes`, or a `what` that is not a string) makes `sendMessage` reject with "The message port closed before a response was received." Upstream would never answer (U2); use `fail=x:hang` for that.
- **Echoes:** the background posts on a real `BroadcastChannel('uBOL')` created with the unpatched constructor. Pages receive the messages; the record does not show them. `filteringModeDetails` in echoes contains `Set`s (§11). Every post is also kept in `__blockerMock.broadcasts`.
- **Permissions:** a grant adds the origins and then, asynchronously, does what `permissions.onAdded` does (bg:169-235).
  - With a pending `setPendingFilteringMode` request: the request is consumed. If the default is below optimal and the hostname is covered, the site's level is set.
  - Without one: a simplified `syncWithBrowserPermissions` runs. `<all_urls>` raises a basic default to optimal; losing it lowers the default to basic.
  - **Not reproduced:** the background's own 437 ms `tabs.update` after a pending grant (that is the background's call, not the page's), and the "add newly allowed hostnames to optimal" loop of js/mode-manager.js:421-427.
- **Other simplifications:**
  - Content-script registration is not modelled.
  - `updateUserDnrRules` counts `---`-separated blocks of local `userDnrRules`, and only while developer mode is on.
  - `getRulesetRules` returns `{ rules: [] }`.
  - The admin `noFiltering` policy is not modelled.
  - `storage.managed` is absent (U7).
  - `gotoURL` answers a fake tab and opens nothing. `showMatchedRules` and `openOptionsPage` open nothing.
  - `window.close` does not close the page; `__blockerMock.closed` becomes `true`.

## 5. Control object: `window.__blockerMock` (also `globalThis.__BLOCKER_MOCK__`)

| Member | Effect |
|---|---|
| `config` | The resolved MockConfig, read-only. |
| `calls` | The same array as `__blockerCalls`. |
| `clearCalls()` | Empties the record in place. |
| `broadcasts` | `{ message, t }[]` posted by the background. |
| `state()` | A serialisable snapshot of the background (mode table, enabled list, config, origins, pending request, custom filters, …) and of both storage areas. |
| `broadcast(msg)` | Posts `msg` on `'uBOL'` as the background would, even when echoes are off. Example: `{ developerMode: true }` (i18n.md checklist 28). |
| `setFailure(what, mode \| null)`, `setDelay(what \| '*', ms \| null)`, `setResponse(what, json)`, `clearResponse(what)`, `setPermission(mode)`, `setConfirm(bool)`, `setEcho(bool)` | Change the behaviour mid-test. |
| `background` | The MockBackground instance, for unusual tests. |
| `closed` | `true` after `window.close()` / `self.close()`. |

## 6. Test helpers (`tests/e2e/helpers/index.mjs`)

- **`startStaticServer(dir = HARNESS_DIR)`:** serves on 127.0.0.1 with a random free port; it reuses the server in `tests/e2e/lib/harness.mjs`. The most recent server's URL becomes `openHarness`'s default base.
- **`launchChrome({ viewport, colorScheme, deviceScaleFactor = 2, locale, reducedMotion })`:**
  - Starts playwright-core `launchPersistentContext` headless, in a fresh `mkdtemp` user-data folder that `close()` deletes. `userDataDirRemoved(chrome)` checks it.
  - The browser channel comes from `BLOCKER_E2E_CHANNEL` (exported as `E2E_CHANNEL`; both launch helpers use it). The default `chrome` is the installed Google Chrome. CI sets `chromium`, Playwright's own Chromium, installed once with `npx --prefix ui playwright-core install --no-shell chromium` (add `--with-deps` on Linux). Any other Playwright channel name, such as `msedge`, also works when that browser is installed.
  - Returns `{ context, page, userDataDir, consoleErrors, pageErrors, failedRequests, externalRequests, close }`. The error arrays also collect from pages opened later in the context.
  - It differs from `launchChrome` in `tests/e2e/lib/harness.mjs`: there is no `browser`, because the context is persistent.
- **`openHarness(page, 'popup' | 'dashboard' | 'gallery', params, { baseURL, config, waitForMount = true, timeout })`:** builds the query string (arrays are comma-joined, objects become JSON), navigates, requires `html[data-harness="mock-installed"]`, and waits until `#root` has a child. It returns the URL.
- **`getCalls`, `getMessages`, `clearCalls`, `getMockState`, `mockBroadcast`:** described in §2 and §5.
- **`screenshot(page, name)`:** writes `build/screenshots/<name>.png` at the repository root (or `BLOCKER_SCREENSHOT_DIR`) with `animations: 'disabled'`, because the library Button animates colours. It returns the path.
- **Viewports:** `POPUP_VIEWPORT` is 340×520 and `DASHBOARD_VIEWPORT` is 1100×800.

**Manual use:** run `npm run dev` and open `http://127.0.0.1:<port>/popup.html?scenario=slow&lang=ar&theme=dark`. Or serve `dist/harness` after `npm run build:harness`. In the console, `__blockerCalls` and `__blockerMock.state()` show what happened.

## 7. Production isolation

- `vite.shared.ts` `noDevModules` fails any production build that bundles `src/dev/*` or `harness/*`.
- `src/dev/mock-ext.test.ts` scans every production source for an import of `src/dev`, `install-mock` or `mock-ext`, and for the identifiers `__blockerCalls`, `__blockerMock` and `__BLOCKER_MOCK__`, comments excluded. The production sources are `src/{popup,dashboard,container,lib,components}/**`, `src/styles`, `popup.html`, `dashboard.html` and `container/**`; test files are excluded.
- **Gate check on shipped files:** `grep -rlE "__blockerCalls|__blockerMock|__BLOCKER_MOCK__" ui/dist/extension build/stage/*/ui` must print nothing.

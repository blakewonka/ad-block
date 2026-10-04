# Spec: macOS container-app window (`Main.html` in the Xcode project)

Status: behaviour spec for `ui/container/Main.html` + `ui/src/container/*`
and for the container step of `platforms/safari/package.sh`. Implementers
follow this file instead of reading the Xcode project.
Date: 2026-10-04. Machine used for the probes: macOS 27.0.1 (26A434), Xcode 27
(27A266a), arm64.

Every citation, payload, condition and probe result was re-checked on the
same day by an independent pass that re-ran the probes in a real `WKWebView`
and in headless Chrome (§13 and Appendices C/D). Facts added or re-verified by
that pass say "VERIFIED (audit A*n*)".

Legend

- `file:N` / `file:N-M` = line numbers in the upstream file. Short names:

  | Short | Path (the generated Xcode project, `XCODE` in [README.md](README.md)) |
  |---|---|
  | `VC` | `build/xcode/safari-macos/Blocker/Blocker/ViewController.swift` |
  | `AD` | `build/xcode/safari-macos/Blocker/Blocker/AppDelegate.swift` |
  | `SB` | `build/xcode/safari-macos/Blocker/Blocker/Base.lproj/Main.storyboard` |
  | `HTML` | `build/xcode/safari-macos/Blocker/Blocker/Resources/Base.lproj/Main.html` |
  | `JS` | `build/xcode/safari-macos/Blocker/Blocker/Resources/Script.js` |
  | `CSS` | `build/xcode/safari-macos/Blocker/Blocker/Resources/Style.css` |
  | `ICON` | `build/xcode/safari-macos/Blocker/Blocker/Resources/Icon.png` |
  | `PBX` | `build/xcode/safari-macos/Blocker/Blocker.xcodeproj/project.pbxproj` |
  | `APP` | `build/xcode/safari-macos/DerivedData/Build/Products/Release/Blocker.app` (the probes used a Debug build of the same project) |
  | `TPL` | `/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/Library/Xcode/Templates/Project Templates/macOS/Application/Safari Extension App.xctemplate` (the macOS-only template the converter output matches, §2.3) |
  | `TPLX` | `/Applications/Xcode.app/Contents/Developer/Library/Xcode/Templates/Project Templates/MultiPlatform/Application/SharedContent Safari Extension App.xctemplate` (multi-platform variant; **not** what `--macos-only` produced) |

- **VERIFIED (probe Pn)** = observed by running the page in a real `WKWebView`
  outside the Blocker app (see §12.4 and Appendix A). The Blocker app itself was
  never launched (ARCHITECTURE §7).
- **INFERRED** = follows from the code/platform rules but was not observed.
- **UNKNOWN** = could not be determined; do not build on it.

---

## 1. What the window is

A native macOS window (AppKit storyboard) whose whole content is one
`WKWebView` showing a local HTML page. It tells the user whether the Safari
extension is on, off or unknown, and offers one button that opens Safari's
extension settings and quits the app. It has **no access to the extension**:
no `browser`/`chrome` API, no `browser.i18n`, no extension storage, no
messaging with `js/background.js`. Its only inputs/outputs are the two native
channels in §4 and §5.

The page is not part of the extension package; nothing in
`platform/mv3/safari/*.js` or `PRISTINE` refers to it (grep for `Main.html`,
`messageHandlers`, `container` over `platform/mv3/safari/` → no match).
`build/xcode/safari-macos/Blocker/Blocker Extension/SafariWebExtensionHandler.swift:13-40`
only echoes native messages and is unrelated to the window.

---

## 2. Files, bundling and the converter

### 2.1 Which files are bundled (app target "Blocker")

The app target's Resources build phase (`PBX:270-280`) contains exactly:

| Build file (`PBX` line) | File reference (`PBX` line) | Lands in the app as (verified in `APP`) |
|---|---|---|
| `Main.html in Resources` (`PBX:11`, phase `:276`) | variant group `Main.html` (`PBX:333-340`) whose only child is `Base` → `path = Base.lproj/Main.html` (`PBX:67`) | `Contents/Resources/Base.lproj/Main.html` |
| `Script.js in Resources` (`PBX:14`, `:275`) | `path = Script.js` (`PBX:70`) | `Contents/Resources/Script.js` |
| `Style.css in Resources` (`PBX:13`, `:278`) | `path = Style.css` (`PBX:69`) | `Contents/Resources/Style.css` |
| `Icon.png in Resources` (`PBX:12`, `:273`) | `path = Icon.png` (`PBX:68`) | `Contents/Resources/Icon.png` |
| `Main.storyboard`, `Assets.xcassets` (`PBX:16-17`) | — | `Base.lproj/Main.storyboardc`, `Assets.car`, `AppIcon.icns` |

The four web files live in the group `Resources` (`PBX:145-155`, `path =
Resources`), i.e. on disk in `build/xcode/safari-macos/Blocker/Blocker/Resources/`
(`Main.html` inside its `Base.lproj/` sub-folder). `knownRegions` are only
`en` and `Base` (`PBX:252-255`); there is no other localisation of `Main.html`.

Consequences (binding):

1. **Only these four names ship.** Any other file our build emits (a second
   script, a font, an image, a `.map`, an `assets/` folder) is **not** copied
   into the app unless `PBX` is edited, and ARCHITECTURE §5 does not allow a
   resource edit of `PBX`. The container build must therefore produce exactly
   `Base.lproj/Main.html`, `Script.js`, `Style.css` (the scaffold's
   `containerPage()` guard in `vite.shared.ts:150-194` already enforces this).
2. `Icon.png` is **not** ours to emit: it is written by the converter and is
   byte-identical to `PRISTINE/img/icon_512.png` (md5
   `d87f284f2feb2d8c5ad351a844a54671` for both; 512×512 RGBA). The template's
   own `TPL/Icon.png` is a different file (100 020 bytes, md5
   `aae98804273e7a4335898a98cb975f66`), so the converter replaces it with the
   extension icon (VERIFIED audit, `md5`). The page may reference it as
   `../Icon.png`.
3. File contents are copied at `xcodebuild` time from the paths above, so
   overwriting the three files before `xcodebuild` is enough; no `PBX` change
   (INFERRED from how a Resources phase works; consistent with `APP`, whose
   four files are byte-identical to the source files — `cmp`, VERIFIED).

### 2.2 Bundle layout and relative paths

`Contents/Resources/` of the app (VERIFIED, `APP`):

```
Contents/Resources/
  Base.lproj/Main.html          <- page; loads ../Style.css ../Script.js ../Icon.png
  Base.lproj/Main.storyboardc/
  Script.js
  Style.css
  Icon.png
  AppIcon.icns  Assets.car
```

Swift finds the page with `Bundle.main.url(forResource: "Main", withExtension:
"html")` (`VC:25`), which resolves to the localised copy
`Base.lproj/Main.html`. All references in the page are relative and go one
level up: `href="../Style.css"` (`HTML:9`), `src="../Script.js"` (`HTML:10`),
`src="../Icon.png"` (`HTML:13`). Read access is granted to the whole
`Contents/Resources/` folder (`allowingReadAccessTo: Bundle.main.resourceURL!`,
`VC:25`), so `../` works; nothing outside `Contents/Resources/` is readable
(INFERRED from the API contract).

Our build output must keep this shape. The scaffold emits
`dist/container/Base.lproj/Main.html`, `dist/container/Script.js`,
`dist/container/Style.css` (`vite.container.config.ts:1-13`). Note: ARCHITECTURE
§5 says `dist/container/` "with `Main.html`"; the real path is
`dist/container/Base.lproj/Main.html` — the copy step must map:

| From (`ui/dist/container/`) | To (`build/xcode/safari-macos/Blocker/Blocker/Resources/`) |
|---|---|
| `Base.lproj/Main.html` | `Base.lproj/Main.html` |
| `Script.js` | `Script.js` |
| `Style.css` | `Style.css` |
| (nothing) | `Icon.png` stays as the converter wrote it |

### 2.3 The converter regenerates these files on every run

- The four web files, `ViewController.swift`, `AppDelegate.swift` and
  `Main.storyboard` are generated from Xcode's macOS Safari-extension app
  template `TPL` (VERIFIED audit, `diff` after substituting the template
  variables): `TPL/TemplateInfo.plist:211-219` declares the nodes
  `Base.lproj/Main.storyboard`, `Resources/Base.lproj/Main.html`,
  `Resources/Icon.png`, `Resources/Style.css`, `Resources/Script.js`;
  `TPL/Main.html`, `TPL/Script.js`, `TPL/Style.css` are **byte-identical** to
  `HTML`/`JS`/`CSS` once `___VARIABLE_productName:XML___` is replaced by
  `Blocker`; `TPL/ViewController.swift` equals `VC` except the file header once
  `___VARIABLE_bundleIdentifier:bundleIdentifier___` is replaced by
  `org.example.blocker`; `TPL/Main.storyboard` equals `SB` except
  `___PACKAGENAMEASXML___` → `Blocker` and the module-provider variable;
  `TPL/AppDelegate.swift` equals `AD` except the header and class-name
  variable. The headers `VC:1-6`, `AD:1-6` ("Created by … on 10/3/26") and the
  Info.plist key `SFSafariWebExtensionConverterVersion = 27.0`
  (`build/xcode/safari-macos/Blocker/Blocker/Info.plist:5-6`, from
  `TPL/TemplateInfo.plist:196-205`) show they came from a converter run.
  Do **not** use `TPLX` as a reference: its `show(platform, enabled,
  useSettings)` takes an extra first argument, and its message handler
  terminates the app only when `error == nil`, unlike `VC:50-54`.
- The pre-implementation research notes record that object IDs in `PBX`
  differ between converter runs and that `--force` rewrites the project.
- The product name in every text (`Blocker’s extension …`, alt text
  `Blocker Icon`) comes from `--app-name Blocker` (template variable
  `productName`).
- Whether `--force` deletes the folder first or only overwrites: **UNKNOWN**.
  Either way, **the build must copy our three files after every converter run
  and before `xcodebuild`** (ARCHITECTURE §5 `platforms/safari/package.sh` order:
  converter → container copy → pbxproj patch → xcodebuild). A converter run
  after our copy silently restores the template page.
- The extension identifier `org.example.blocker.Extension` used by Swift is a
  generated constant (`VC:12`) derived from `--bundle-identifier`; the Swift
  code is never edited by us (ARCHITECTURE §2).

---

## 3. Window and application behaviour

### 3.1 Window (`SB`)

| Property | Value | Source |
|---|---|---|
| Title | `Blocker` (static; `document.title` is not used — `HTML` has no `<title>`) | `SB:80`, `HTML:3-11` |
| Content size | **425 × 325 points** (the title bar is extra) | `SB:83` (`contentRect … width="425" height="325"`) |
| Web view frame | 425 × 325, fills the content view, autoresizing width+height | `SB:102-107` |
| Style mask | `titled="YES" closable="YES"` only → **not resizable, not miniaturizable** (no zoom/minimise) | `SB:81` |
| Full screen | `fullScreenNone="YES"` → cannot enter full screen | `SB:82` |
| Restoration | `restorable="NO"`, `releasedWhenClosed="NO"` | `SB:80` |
| Web view configuration | storyboard `wkWebViewConfiguration`: `mediaTypesRequiringUserActionForPlayback` = none, default `wkPreferences` (JavaScript on); no custom user agent, no user scripts, no `uiDelegate`; the only addition at run time is the `controller` message handler (`VC:23`) | `SB:105-112`, `VC:18-26` |
| Initial position | storyboard rect origin x=196 y=240 on a 1680×1027 design screen; actual placement on the user's screen **UNKNOWN** | `SB:83-84` |

CSS viewport inside the web view: `innerWidth = 425`, `innerHeight = 325`,
`devicePixelRatio = 2` on a Retina display (VERIFIED, probe P1, web view
created with the same 425×325 frame). Because the window cannot be resized,
**every state must fit in 425 × 325 CSS px without scrolling**; upstream fits
exactly (`document.documentElement.scrollHeight = 325`, `scrollWidth = 425`,
VERIFIED probe P2). Content that overflows makes the web view scroll
(INFERRED).

The `<meta name="viewport" … user-scalable=no>` (`HTML:7`) has no observable
effect on macOS (innerWidth is the view width; INFERRED: macOS WebKit does not
apply viewport meta). Keep it (harmless, template parity).

### 3.2 Application

- Closing the window quits the app: `applicationShouldTerminateAfterLastWindowClosed`
  returns `true` (`AD:17-19`).
- Main menu (`SB:13-65`): app menu with *About Blocker*
  (`orderFrontStandardAboutPanel:`), *Hide Blocker* ⌘H, *Hide Others* ⌥⌘H,
  *Show All*, *Quit Blocker* ⌘Q; *Help* menu with *Blocker Help* ⌘? (`showHelp:`).
  There is no Edit, File or Window menu, so ⌘C/⌘A/⌘W key equivalents are not
  provided by the menu (INFERRED). What *Blocker Help* shows (no help book is
  bundled): **UNKNOWN** (AppKit normally shows a "Help isn't available" alert).
- App sandbox on, outgoing network client entitlement on (built `APP`
  entitlements: `app-sandbox`, `network.client`, `files.user-selected.read-only`;
  `PBX:552` `ENABLE_APP_SANDBOX`). The page must still make **no** network
  requests (ARCHITECTURE §6.2) and CSP blocks them anyway (§7).
- Deployment target of the app target: not set on the target
  (`PBX:542-628` contain no `MACOSX_DEPLOYMENT_TARGET`), inherited from the
  project: `27.0` (`PBX:405, 462`); the built `Info.plist` has
  `LSMinimumSystemVersion = 27.0` (`APP/Contents/Info.plist`). Consequence in §4.2.

---

## 4. Native → page: `show(enabled, useSettingsInsteadOfPreferences)`

### 4.1 Sequence (from `VC`)

1. `viewDidLoad` (`VC:18-26`):
   - sets the navigation delegate (`VC:21`);
   - registers the script message handler **named `controller`**
     (`VC:23`) through `webView.configuration.userContentController` of the
     already-created storyboard web view — before the page loads, so
     `window.webkit.messageHandlers.controller` already exists while
     `Script.js` is evaluated (VERIFIED, probe P1 `hasWebkitControllerAtEval:
     true`; re-VERIFIED audit A1 with the exact `VC:23` call order — handler
     added via `wv.configuration.userContentController` after the
     `WKWebView` was created → `typeof webkit.messageHandlers.controller ===
     "object"` at script evaluation);
   - loads `Base.lproj/Main.html` with `loadFileURL(…, allowingReadAccessTo:
     Bundle.main.resourceURL!)` (`VC:25`). Both URLs are **force-unwrapped**
     (`!`): if the bundle has no `Main.html` (e.g. a copy step that drops or
     renames it), the app crashes in `viewDidLoad` before showing anything
     (INFERRED from Swift `!` semantics). The page file must keep the name
     `Main.html` inside `Resources/Base.lproj/`.
2. The page parses; `<script src="../Script.js" defer>` (`HTML:10`) runs after
   parsing, before `DOMContentLoaded`.
3. `webView(_:didFinish:)` fires after the `load` event (`VC:28`). Observed
   order (VERIFIED, probe P1, ms since navigation start): script evaluated 9 →
   `DOMContentLoaded` 10 → `load` 13 → `didFinish` 14 (at that moment
   `typeof show === "function"`). Re-VERIFIED audit A1 (single run): 8 → 10 →
   13 → 15. Single-run timings; only the order is binding.
4. Swift asks Safari for the extension state:
   `SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier:
   "org.example.blocker.Extension")` (`VC:29`, `VC:12`). Asynchronous; the delay
   is **UNKNOWN**.
5. If `state` is `nil` or `error != nil`, Swift does **nothing** — `show` is
   never called and the page stays in its initial state forever
   (`VC:30-33`).
6. Otherwise, on the main queue (`VC:35`), Swift evaluates **exactly one** of
   these JavaScript source strings (`VC:36-40`):

   ```js
   show(true, true)     // macOS 13+, extension enabled
   show(false, true)    // macOS 13+, extension disabled
   show(true, false)    // before macOS 13, enabled
   show(false, false)   // before macOS 13, disabled
   ```

   The first argument is Swift string interpolation of `state.isEnabled`
   (`Bool`) → always the literal `true` or `false`. The second is the literal
   `true` under `#available(macOS 13, *)` (`VC:36-37`), else `false`
   (`VC:38-39`). No completion handler is passed (`VC:37, 39`): if `show` is
   missing or throws, the failure is silent and nothing retries.
7. `didFinish` fires again for every new main-frame navigation of the web view
   (reload, link click), and steps 4-6 repeat on the **new** document
   (INFERRED from the delegate contract). It does not fire for same-document
   navigations (`history.pushState`, `#hash` changes). So in the real app
   `show` is called **at most once per document**. Whether the default
   WKWebView context menu offers *Reload* here: **UNKNOWN**.
8. The state is read **once per navigation and never refreshed**: there is no
   timer, no `applicationDidBecomeActive`/window-focus hook, no observer of
   extension-state changes (`VC:14-57`, `AD:11-21` contain none). If the user
   toggles the extension in Safari while the window is open, the page keeps
   showing the old state. The new page must not try to compensate (it has no
   channel to ask; do not poll, do not reload itself).

### 4.2 Which variant actually occurs

The app's minimum OS is 27.0 (§3.2), so `#available(macOS 13, *)` is always
true at run time: **in this build Swift only ever calls `show(true, true)` or
`show(false, true)`**. The `false` branch (`VC:38-39`) is dead code here, but
the converter may regenerate a project with a lower deployment target, so the
page must still handle `useSettingsInsteadOfPreferences === false`.

### 4.3 Upstream page semantics (`JS:1-16`)

```js
function show(enabled, useSettingsInsteadOfPreferences) {
    if (useSettingsInsteadOfPreferences) { /* replace 4 texts with "Settings" wording */ }   // JS:2-7
    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);                                     // JS:10
        document.body.classList.toggle(`state-off`, !enabled);                                   // JS:11
    } else {
        document.body.classList.remove(`state-on`);                                              // JS:13
        document.body.classList.remove(`state-off`);                                             // JS:14
    }
}
```

- `show` is a top-level function declaration in a classic script, therefore a
  property of `window` (`JS:1`).
- Wording switch is **one-way**: a truthy second argument replaces the texts
  (`JS:2-7`); a falsy one leaves whatever is there (it never restores the
  "Preferences" wording).
- State: boolean `enabled` → on/off; anything else (e.g. `undefined`) → unknown
  (`JS:9-15`). Swift never sends a non-boolean (§4.1 step 6).
- **Upstream is NOT safe to call twice on one document.** The class names used
  as text targets (`state-on`, `state-off`) are also the state classes put on
  `<body>` (`JS:10-11`), and `<body>` precedes the paragraphs in document
  order. So once a boolean call has put `state-on`/`state-off` on `<body>`, a
  later call with a truthy second argument finds `<body>` as
  `getElementsByClassName('state-on'|'state-off')[0]` (`JS:3` or `JS:4`),
  sets `body.innerText` to one sentence — icon, other paragraphs and button
  are destroyed — and then throws `TypeError` on the next line because the
  paragraph it looks for is gone. VERIFIED audit A2 (real WKWebView, upstream
  files): `show(true, true); show(false, true)`, `show(true, false); show(false,
  true)` and `show(true, true); show(true, true)` each end with `innerText` =
  "Blocker’s extension is currently on. You can turn it off in the Extensions
  section of Safari Settings." only, no button, and `WKErrorDomain Code=4
  TypeError … getElementsByClassName('state-off')[0].innerText` at
  `Script.js:4`; reproduced in Chrome (audit A4). This never happens in the
  real app because Swift calls `show` once per document (§4.1 step 7). The new
  page deliberately does **not** reproduce it: §4.4.5 (any number of calls,
  each replaces the state) is the requirement; this is the only allowed
  deviation from upstream in this spec.
- A single call (the real-app case) fully determines the visible state.

### 4.4 Contract the new page MUST honour

1. `window.show` is assigned **synchronously during evaluation of
   `Script.js`**, as the first thing the bundle does, before importing/
   initialising React or the library and before any `await`, `setTimeout`,
   `requestAnimationFrame` or React effect. In an IIFE bundle a top-level
   `function show` is NOT global — assign `window.show = …` explicitly.
2. `show` must work when called **before the UI has mounted**, while mounting,
   and after. It must never throw (wrap the body in `try/catch`; Swift ignores
   errors, and a throw would leave the UI stale).
3. It stores the latest call in a module-level store, then notifies
   subscribers (React reads it with `useSyncExternalStore`). A call that
   arrives before mount is not lost: the first render reads the store.
4. Argument handling (parity with `JS:2-15`):
   - `enabled`: `true` → on; `false` → off; any non-boolean → unknown.
   - `useSettingsInsteadOfPreferences`: truthy → Settings wording; once
     Settings wording has been selected it stays selected for the life of the
     page (one-way, `JS:2-7`). Initial wording (before any call) = Preferences.
5. It may be called any number of times on the same document (tests, harness,
   a future Swift change); each call replaces the state and the icon, the
   button and the active paragraph stay intact. (Deliberate deviation from
   upstream's double-call breakage, §4.3; unobservable in the real app.)
6. Return value: ignored by Swift; return `undefined`.
7. Do not rename, wrap in a namespace, or make `show` async. Do not depend on
   it being called at all (§4.1 step 5).

---

## 5. Page → native: `"open-preferences"`

### 5.1 Exact payload

```js
webkit.messageHandlers.controller.postMessage("open-preferences");   // JS:18-20
```

Wired to the click of `button.open-preferences` (`JS:22`, `HTML:17`). The
message body is the **bare string** `"open-preferences"` — not an object, not
JSON. (VERIFIED, probe P1/P2: Swift receives `__NSCFString` `open-preferences`.)

### 5.2 Native handling (`VC:45-55`)

1. `message.body as! String` (`VC:46`) is a **forced cast: posting any
   non-string body (object, number, array, `null`, boolean) crashes the app**
   (Swift runtime trap; INFERRED from `as!` semantics, the crash itself was not
   provoked). VERIFIED audit A1, what Swift receives as `message.body`:
   `"open-preferences"` → `__NSCFString` (`is String` true); `1` →
   `__NSCFNumber`; `{a:1}` → `__NSDictionaryM`; `null` → `NSNull`; `['x']` →
   `__NSArrayM`; `true` → `__NSCFBoolean` — all `is String` false, i.e. all
   would trap at `VC:46`. Never post anything else to `controller`.
2. Any string other than `"open-preferences"` is ignored (`VC:46-48`).
3. `SFSafariApplication.showPreferencesForExtension(withIdentifier:
   "org.example.blocker.Extension")` (`VC:50`) — opens Safari's settings at the
   Extensions pane for this extension (launching Safari if needed; INFERRED
   from the API name/docs).
4. In its completion handler, on the main queue, **regardless of `error`**,
   the app terminates: `NSApplication.shared.terminate(nil)` (`VC:51-53`).
   So the window disappears shortly after the click; the page gets no reply
   and no chance to show a result.

### 5.3 Requirements for the new page

- Post exactly `"open-preferences"` (a string literal), once per activation of
  the button. Upstream does not debounce; a second click before termination
  sends a second message (harmless, INFERRED).
- Guard the call: `window.webkit?.messageHandlers?.controller?.postMessage(…)`.
  Upstream would throw a `ReferenceError` without `webkit` (harness, Chrome,
  unit tests); the new page must not throw there.
- Do not `await` the return value (plain `WKScriptMessageHandler`, no reply;
  `VC:14, 45`).
- Do not show a spinner/"waiting" state that depends on a reply: none comes;
  the app quits.

### 5.4 Everything else the upstream page does: nothing

Audit inventory of `JS:1-22`, `HTML:1-19`, `CSS:1-45` (grep for
`addEventListener`, `on*=`, `postMessage`, `storage`, `localStorage`,
`sessionStorage`, `indexedDB`, `cookie`, `BroadcastChannel`, `fetch`,
`XMLHttpRequest`, `setTimeout`, `setInterval`, `location`, `history`,
`window.open`): the upstream page registers **exactly one** listener
(`click` on `button.open-preferences`, `JS:22`, attached once at script
evaluation), posts **exactly one** kind of message (§5.1), and uses no storage,
no timers, no network, no navigation, no `BroadcastChannel`, no
`window.postMessage`. There is no extension API (§1) and no permission request.
`SafariWebExtensionHandler.swift:13-40` (native messaging of the extension)
only echoes and has no link to the window.

The new page may add only: the `prefers-color-scheme` `change` listener
(§8), a `window` `error` listener for the mount fallback (§11.2.11), and the
listeners React/the library attach internally. It must not use
`localStorage`/`sessionStorage`/IndexedDB/cookies (they would persist in the
app's sandbox container, which upstream never touches), timers that poll,
`fetch`/XHR, `BroadcastChannel`, or any navigation (§9). React's scheduler
uses `MessageChannel.port.postMessage(null)` internally (present in the
scaffold build) — that is not a message to Swift and is allowed; the only call
on `webkit.messageHandlers` must be §5.1.

---

## 6. States and exact texts

### 6.1 Upstream markup (`HTML:12-18`)

```html
<img src="../Icon.png" width="128" height="128" alt="Blocker Icon">
<p class="state-unknown">…</p>
<p class="state-on">…</p>
<p class="state-off">…</p>
<button class="open-preferences">…</button>
```

The icon (128×128 CSS px, 512 px source) and the button are visible in every
state. Exactly one of the three paragraphs is visible.

### 6.2 Visibility rules (`CSS:31-41`)

| `body` classes | Visible paragraph | Rule |
|---|---|---|
| neither `state-on` nor `state-off` (initial; also after `show(<non-boolean>, …)`) | `.state-unknown` | `CSS:31-33` hides `.state-on`/`.state-off` |
| `state-on` | `.state-on` | `CSS:35-37` |
| `state-off` | `.state-off` | `CSS:39-41` |

### 6.3 Texts (exact; `’` = U+2019, `…` = U+2026; the files are UTF-8)

| State | Preferences wording (initial; `useSettings` falsy) | Settings wording (`useSettings` truthy) |
|---|---|---|
| unknown | `You can turn on Blocker’s extension in Safari Extensions preferences.` (`HTML:14`) | `You can turn on Blocker’s extension in the Extensions section of Safari Settings.` (`JS:5`) |
| on | `Blocker’s extension is currently on. You can turn it off in Safari Extensions preferences.` (`HTML:15`) | `Blocker’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.` (`JS:3`) |
| off | `Blocker’s extension is currently off. You can turn it on in Safari Extensions preferences.` (`HTML:16`) | `Blocker’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.` (`JS:4`) |
| button (all states) | `Quit and Open Safari Extensions Preferences…` (`HTML:17`) | `Quit and Open Safari Settings…` (`JS:6`) |
| image alt | `Blocker Icon` (`HTML:13`) | same |

VERIFIED (probe P2, upstream files in WKWebView): before `show` the visible
text is the unknown/Preferences pair; after `show(true, true)` it is
"…currently on… Extensions section of Safari Settings." + "Quit and Open Safari
Settings…"; `show(false, false)` gives the off/Preferences pair; with no call
the unknown/Preferences pair stays.

Observable upstream quirk: on macOS 13+ the page first paints the
**Preferences** wording and switches to **Settings** wording when `show`
arrives (§4.1 steps 3-6). If the state lookup fails, the Preferences wording
stays although the OS uses "Settings". Parity = keep this behaviour (initial
wording Preferences); do not guess the OS version in JavaScript.

### 6.4 Localisation

There is none upstream: the strings are hard-coded English in `HTML`/`JS`,
the project has only `Base`/`en` (`PBX:252-255`), and the page has no
`browser.i18n` and no `_locales` (it is not an extension page). Therefore
ARCHITECTURE §6.7 (`t()`, `getMessage`) **cannot apply** here: the new page
must hard-code the 8 strings above verbatim (plus the alt text). `tNew` is not
available either. No RTL handling is needed (English only). The page has no
`lang` attribute upstream (`HTML:2`); adding `lang="en"` does not change behaviour.

---

## 7. CSP, `file://` origin, and what is allowed

`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`
(`HTML:5`) precedes the stylesheet and script (`HTML:9-10`), so it governs
everything the page loads. There is no `script-src`/`style-src`/`img-src`, so
every fetch directive falls back to `default-src 'self'`; there is no
`'unsafe-inline'` and no `'unsafe-eval'`.

The page URL is `file:///…/Contents/Resources/Base.lproj/Main.html`;
`location.origin` is `"file://"` (VERIFIED P1). `'self'` lets the page load
the sibling `file:` resources `../Style.css`, `../Script.js`, `../Icon.png`
(VERIFIED P1/P2: they load, no violation).

Results of probe P1 (real WKWebView, same CSP, same folder layout, same
`loadFileURL`/`allowingReadAccessTo` call as `VC:25`):

| What | Result | Violation reported |
|---|---|---|
| classic `<script src="../Script.js" defer>` | runs | — |
| `<script type="module" src="../x.js">` | **does not run** (cause not recorded; consistent with the file:// module-CORS issue noted in the research notes) | none |
| dynamic `import('../x.js')` from the classic script | **rejects** `TypeError: Importing a module script failed.` (audit A1) | none |
| `eval("…")`, `new Function(…)` | **throws `EvalError`** | `script-src eval` |
| inline event-handler attribute (`setAttribute('onclick', …)`) | **blocked** | `script-src-attr inline` |
| runtime `<style>` element (`createElement('style')`) | **ignored** | `style-src-elem inline` |
| `el.setAttribute('style', 'width:12px')` (also a CSS variable via the attribute) | **ignored** | `style-src-attr inline` |
| CSSOM `el.style.width = '13px'` | **applied** | none |
| CSSOM `el.style.setProperty('--x', '14px')` (CSS custom property) | **applied** (and `var(--x)` in Style.css resolves) | none |
| CSSOM `el.style.cssText = 'width:15px'` | **applied** | none |
| constructable sheet `new CSSStyleSheet().replaceSync(…)` + `document.adoptedStyleSheets` | **applied** | none |
| `document.styleSheets[0].insertRule(…)` on `../Style.css` | **throws `SecurityError: Not allowed to insert rule into cross-origin stylesheet`** (audit A1) | — |
| reading `document.styleSheets[0].cssRules` of `../Style.css` | **throws `SecurityError`** (audit A1) | — |
| `<img src="data:…">` | **blocked** (error event) | `img-src data` |
| CSS `background-image: url("data:…")` in Style.css | **blocked** | `img-src data` |
| `@font-face { src: url("data:…") }` | **blocked** | `font-src data` |
| `<img src="blob:…">` | **blocked** | `img-src blob` |
| `<img src="../Icon.png">` | loads (naturalWidth 512) | — |
| `fetch('../Style.css')` | **rejects** (`TypeError: Load failed`) | — |
| `webkit.messageHandlers.controller.postMessage("…")` | delivered to Swift | — |
| Swift `evaluateJavaScript("show(true, true)")` | runs (not subject to `'unsafe-eval'`) | — |

Audit A1 (Appendix C, a fresh tool that adds the handler exactly as `VC:23`
does) re-ran every row above except `@font-face data:` and got the same result
for each, with the violation list `script-src eval` ×2, `script-src-attr
inline`, `style-src-elem inline`, `style-src-attr inline`, `img-src data`,
`img-src blob`, `img-src data` (CSS `background-image`). Measured widths: runtime
`<style>` and `style` attribute not applied (element keeps its auto width);
`style.width` 13px, `setProperty('--x')` 14px, `cssText` 15px, adopted sheet
16px applied.

What this means for a React page (binding):

- React applies the `style` prop through the CSSOM (`style[prop] = v` /
  `style.setProperty` for custom properties), which is **allowed**. React
  never writes the `style` attribute as a string on the client. So inline
  styles written by React and by the library's runtime helpers work.
  (ARCHITECTURE §6.1 says CSSOM inline styles are not allowed in the container
  window; probe P1 shows they are. Treat the probe as authoritative, but do not
  need them: see §11.)
- Anything that injects a `<style>` element, sets the `style` *attribute*, or
  uses `dangerouslySetInnerHTML` with `<style>` fails **silently** (only a CSP
  violation event; no exception). In the pinned dependencies this is:
  `react-style-singleton` (used by `react-remove-scroll`, which
  `@radix-ui/react-dialog`, `-popover`, `-select` and `-menu` import directly —
  VERIFIED audit, grep of each `dist/index.mjs` — and therefore also
  `-alert-dialog` (built on dialog), `-dropdown-menu`, `-context-menu` and
  `-menubar` (built on menu)), `@radix-ui/react-scroll-area`
  (`dist/index.mjs:134-136`, `jsx("style", { dangerouslySetInnerHTML })`) and
  `@radix-ui/react-select` (`dist/index.mjs:733-735`, same pattern). In the
  library this means the `Popover`, `Menu` and `Select` components
  (`@openai/apps-sdk-ui/dist/es/components/{Popover,Menu,Select}/*.js` import
  those Radix parts from `radix-ui`). `@radix-ui/react-tooltip`,
  `-tabs`, `-radio-group`, `-switch`, `-checkbox` contain neither
  `react-remove-scroll` nor a `"style"` element (audit grep), but were not run
  in WebKit.
  React DOM's hoistable `<style precedence>` support is present in the bundle
  but is only used if a component renders `<style href precedence>`; do not.
- No `data:`/`blob:` URLs anywhere (images, fonts, CSS). Vite's
  `assetsInlineLimit: 0` in `vite.container.config.ts:42` already prevents
  inlining.
- No ES modules, no dynamic `import()`, no code splitting, no `fetch`/XHR of
  local files.
- Do not read `document.styleSheets[*].cssRules` or call `insertRule` on
  `Style.css` (both throw). The library's `dist/es` contains no `insertRule`,
  `cssRules`, `CSSStyleSheet`, `adoptedStyleSheets` or `"style"` element
  (audit grep), and the scaffold `Script.js` contains none of these strings.
- CSS custom properties defined in `Style.css` (the library tokens) work
  normally; they are not affected by CSP.
- The CSP `<meta>` must stay exactly `default-src 'self'`. Relaxing it
  (`'unsafe-inline'`, `data:`) is possible because `Main.html` is ours, but is
  not needed and is not recommended.

---

## 8. Light / dark appearance inside the WKWebView

- Upstream `CSS:7-8` declares `:root { color-scheme: light dark; }` and sets
  no colours; text and button are drawn with system colours and the web view's
  default background follows the appearance. `html`/`body` computed
  background is transparent in both modes; root text colour is
  `rgb(0,0,0)` in light and `rgb(255,255,255)` in dark (VERIFIED P1;
  re-VERIFIED audit A1 with `:root{color-scheme:light dark}`). **Without** a
  `color-scheme` declaration the root text stays `rgb(0,0,0)` under `.darkAqua`
  (VERIFIED audit A1), i.e. dark-mode text colours depend on that declaration.
- `matchMedia('(prefers-color-scheme: dark)')` reflects the AppKit appearance
  of the web view's window (VERIFIED P1: `false` with `.aqua`, `true` with
  `.darkAqua`).
- A live appearance change fires a `change` event on that media query and the
  page can re-theme without reload (VERIFIED probe P3: switching the window
  from `.aqua` to `.darkAqua` after load → `change` with `matches: true`; the
  scaffold placeholder flipped `html[data-theme]` to `dark` and its body
  background to `rgb(33,33,33)`). Re-VERIFIED audit A3 (`flip.swift`,
  Appendix C note): before `{mq:false, theme:"light", bg:"rgb(255, 255, 255)"}`,
  1 s after `win.appearance = .darkAqua` `{mq:true, theme:"dark",
  bg:"rgb(33, 33, 33)", changes:[true]}`.
- In the real app the window does not set an appearance (`SB:80-88`), so it
  follows the system appearance (INFERRED).
- `public/ui/theme-init.js` is **not** available to this page (only the four
  files ship); `Script.js` must set `html[data-theme]` itself, synchronously at
  evaluation, and subscribe to the media query `change` event. Because the
  script is `defer`, the very first paint can happen before `data-theme` is
  set (INFERRED; not observed). Upstream covers that with
  `:root { color-scheme: light dark; }` (`CSS:7-8`).
- **The scaffold build does not have it.** VERIFIED audit (grep of a fresh
  `vite build --config vite.container.config.ts` into a temporary folder): `Style.css`
  declares `color-scheme` only as `[data-theme=light]{color-scheme:light}` and
  `[data-theme=dark]{color-scheme:dark}`, and the library's untheme'd defaults
  are the **light** tokens (`:where(:root),:where([data-theme=light])` defines
  `--gray-0:#fff`; dark values only under `:where([data-theme=dark])`). So
  before `Script.js` runs, a dark-appearance window would get light tokens and
  black text. The container implementer must therefore add, in a
  container-only stylesheet imported by `src/container/main.tsx` (not in the
  shared `src/styles/app.css`): `:root { color-scheme: light dark; }` and a
  pre-theme fallback such as `html:not([data-theme]), html:not([data-theme])
  body { background: Canvas; color: CanvasText; }`; after `data-theme` is set,
  the page background comes from the surface token (`bg-surface`,
  ARCHITECTURE §6.8). With `data-theme` set, the scaffold page's body
  background is `rgb(255,255,255)` light / `rgb(33,33,33)` dark (VERIFIED
  audit A3).

---

## 9. Other environment facts for implementers

- No `uiDelegate` is set (`VC:18-26` sets only `navigationDelegate`), so
  `alert`/`confirm`/`prompt`, `window.open`, `target=_blank` and file inputs do
  nothing (INFERRED from the WKWebView contract). Do not use them.
- No `decidePolicyFor` delegate method exists (`VC:14-57`), so a clicked link
  navigates the web view away from the page (INFERRED); after that navigation
  `didFinish` calls `show` on the new document. **The page must contain no
  links and must never navigate**: no `<a href>`, no `<form>`, no
  `location.assign/replace/reload`, no `location.href =`/`location.hash =`, no
  `history.pushState`. (Unlike the popup, ARCHITECTURE §6.9, there is no
  classic page to fall back to — only the three files ship — so a failed mount
  is handled in place, §11.2.11, never by navigating.) A reload would also
  show the unknown state until Swift answers again (§4.1 steps 4-7).
- Upstream disables text selection and dragging and uses the arrow cursor for
  everything (`CSS:1-5`: `-webkit-user-select: none; -webkit-user-drag: none;
  cursor: default`), so the icon cannot be dragged out and text cannot be
  selected. Keep these three behaviours (they are behaviour, not look).
- Body font upstream is `font: -apple-system-short-body` (`CSS:27`), a
  WebKit-only system font keyword (other engines ignore it).
- Keyboard: the button is a native `<button>`. Whether Tab reaches it in this
  WKWebView depends on the system "Keyboard navigation" setting: **UNKNOWN**
  (not probed). Space/Return on a focused `<button>` activate it (standard).
- `document.title` is unused (window title is static, §3.1).
- Character encoding: `HTML:4` declares UTF-8; on `file://` there is no HTTP
  charset, so `Script.js` is decoded with the document's encoding. The bundle
  contains `’` and `…`; keep the UTF-8 `<meta>` (VERIFIED P2/P4: the
  scaffold's UTF-8 `Script.js` renders `Blocker’s` correctly).

---

## 10. Safari differences

This page never runs inside Safari or as an extension page: it runs in the
system WebKit of the host OS via `WKWebView`. Differences from the extension
pages (popup/dashboard), all binding:

| Topic | Extension pages | Container page |
|---|---|---|
| Origin | `safari-web-extension://<uuid>` | `file://` (opaque for CSSOM access, §7) |
| CSP | manifest `script-src 'self'` (styles free) | meta `default-src 'self'` (styles restricted, §7) |
| Browser API | `browser.*` via `src/lib/ext.ts` | **none**; do not import `src/lib/ext.ts`, `src/lib/bridge.ts`, `src/lib/i18n.tsx` or anything that touches `browser`/`chrome` |
| Strings | `browser.i18n` | hard-coded English (§6.4) |
| Theme init | `ui/theme-init.js` | inside `Script.js` (§8) |
| Script format | ES module chunks allowed | one classic IIFE (`type=module` does not run, §7) |
| Extension state | messages to background | only `show()` from Swift (§4) |

---

## 11. Implementation recommendation

### 11.1 Decision: React IIFE, with a hard "no-mount" fallback

Use a **React IIFE** (as the scaffold set up) built from `src/container/main.tsx`
with library `Button` (and optionally `Badge`), because:

- The library styles are CSS Modules (`@openai/apps-sdk-ui/dist/es/components/
  Button/Button.module.css`, class names hashed at build time); plain DOM
  could not reuse the library's Button look without copying hashed class names.
- Probe P4 shows the scaffold's React IIFE (230 KB `Script.js`, 95 KB
  `Style.css`) running in a real WKWebView under this exact CSP with
  **zero CSP violations and zero errors**, `show` defined at `didFinish`, the
  state updating after `show(true, true)`, the button posting
  `"open-preferences"`, and light/dark both rendering.
- Size is irrelevant (local file).

Plain DOM + compiled token stylesheet is the fallback only if a later build
shows CSP violations or errors in probe P4 that cannot be removed.

### 11.2 Rules for the React IIFE

1. **Entry order in `src/container/main.tsx`:** the module that defines
   `window.show`, the store and the theme initialisation must be evaluated
   before React/library code runs. In a single IIFE, ES-module evaluation
   order follows import order, so put the store in its own module
   (e.g. `src/container/native.ts`) with **no imports**, and import it
   **first** — before `@/styles/app.css` (CSS import is a no-op in JS, but keep
   the rule simple), React, the library. Do not put `window.show` inside a
   component, an effect, or after `createRoot`.
2. Store shape and semantics (parity with §4.4):

   ```ts
   type ContainerState = { enabled: boolean | undefined; useSettings: boolean };
   let state: ContainerState = { enabled: undefined, useSettings: false };
   const listeners = new Set<() => void>();
   window.show = (enabled?: unknown, useSettingsInsteadOfPreferences?: unknown): void => {
       try {
           state = {
               enabled: typeof enabled === 'boolean' ? enabled : undefined,
               useSettings: state.useSettings || Boolean(useSettingsInsteadOfPreferences), // one-way, JS:2-7
           };
           listeners.forEach((fn) => { try { fn(); } catch { /* keep going */ } });
       } catch { /* never throw into evaluateJavaScript */ }
   };
   ```

   (The scaffold placeholder `src/container/main.tsx:34-40` sets
   `useSettings` to the latest value instead of one-way, tests `=== true`
   instead of truthiness, has no `try/catch`, and calls listeners without
   isolating their errors; fix all four.)
3. Render with `useSyncExternalStore(subscribe, () => state)`.
4. Button: native `<button>` (library `Button`, `type="button"`),
   `onClick={() => window.webkit?.messageHandlers?.controller?.postMessage('open-preferences')}`.
   Never pass the event or an object to `postMessage`.
5. Visible content per state = §6.3 texts verbatim, the icon `<img
   src="../Icon.png" alt="Blocker Icon">` (128×128 CSS px upstream), the button
   label. Render only the active paragraph (do not render all three and hide
   two with CSS), so text checks can use `textContent`.
6. Status changes must be announced: wrap the status paragraph in a
   `role="status"` / `aria-live="polite"` region (ARCHITECTURE §6.10).
7. Allowed library pieces: `Button`, `Badge`, `Alert`, `Icon`/inline SVG
   icons. **Forbidden here** (in addition to ARCHITECTURE §6.3): anything built
   on Radix Dialog/AlertDialog/Popover/Select/Menu/DropdownMenu/ContextMenu/
   Menubar (they import `react-remove-scroll` → `react-style-singleton`, §7),
   i.e. the library's `Popover`, `Menu`, `Select` components, or ScrollArea
   (runtime `<style>` injection, silently broken by CSP); Tooltip is not known
   to inject styles but is unverified here — avoid it too,
   any `<style>` element, any `style` *attribute* string, `dangerouslySetInnerHTML`,
   any link.
8. Theme: at evaluation set `document.documentElement.dataset.theme` from
   `matchMedia('(prefers-color-scheme: dark)')` and update on `change` (the
   scaffold does this at `src/container/main.tsx:47-53`). **Add**
   `color-scheme: light dark` on `:root` plus the pre-theme fallback of §8 (the
   scaffold's `Style.css` lacks both) and give `body` the surface background.
9. Fit: all states, both wordings, must fit 425 × 325 CSS px without scroll
   (`scrollHeight <= 325`, `scrollWidth <= 425`). Longest paragraph: the
   Settings "on"/"off" sentences (102 characters); longest button label: the
   Preferences one (44 characters).
10. Keep `-webkit-user-select: none; -webkit-user-drag: none; cursor: default`
    on all elements (`CSS:1-5`); the button keeps the default cursor too.
11. Mount failure: wrap the tree in an error boundary and add a
    `window.addEventListener('error', …)` before mounting; on failure render
    plain DOM into `#root` with `textContent` only (icon, the §6.3 paragraph
    for the current store state, a `<button>` posting `"open-preferences"`),
    and keep listening to the store. `show` must keep working even if React
    never mounts (it is defined before React runs, rule 1).
12. `container/Main.html`: keep `HTML:1-11` byte-for-byte (charset meta, CSP
    meta, viewport meta, `<link rel="stylesheet" href="../Style.css">`,
    `<script src="../Script.js" defer></script>`), body = `<div id="root"></div>`
    (class names on `<body>` are fine; no `style=""`). The scaffold's
    `container/Main.html` already matches.
13. Build: `vite.container.config.ts` as it is (IIFE, `codeSplitting: false`,
    `assetsInlineLimit: 0`, guard that the output is exactly Script.js +
    Style.css + Base.lproj/Main.html, no `data:`/remote `url()`, no `@import`).
    Do not import `katex.min.css` (remote fonts) — `src/styles/app.css`
    already excludes it.
14. Do not import `src/lib/ext.ts`, `src/lib/bridge.ts`, `src/lib/i18n.tsx` or
    `src/dev/*` from the container entry.

### 11.3 Build pipeline (for `platforms/safari/package.sh`)

After the converter and before `xcodebuild`, copy as in the table in §2.2.
Then verify, before `xcodebuild`:
`cmp ui/dist/container/Script.js build/xcode/safari-macos/Blocker/Blocker/Resources/Script.js`
(and the same for `Style.css`, `Base.lproj/Main.html`); `Icon.png` must still
equal `PRISTINE/img/icon_512.png`. After `xcodebuild`, the same three files
must be byte-identical in
`build/xcode/safari-macos/DerivedData/Build/Products/<Configuration>/Blocker.app/Contents/Resources/`
(`Base.lproj/Main.html`, `Script.js`, `Style.css`).

`platforms/safari/install-container.mjs` implements the §2.2 copy table and
compares each copy by hash; `platforms/safari/package.sh` runs it after the
converter and before `patch-pbxproj.mjs`/`xcodebuild`. Note that
`package.sh` then installs `assets/icons/app-window/Icon.png` (by default the
same image as `PRISTINE/img/icon_512.png`) as the window picture.

---

## 12. Acceptance checks (none launches the Blocker app)

### 12.1 Static (Node, on `dist/container/`)

1. Files: exactly `Base.lproj/Main.html`, `Script.js`, `Style.css` (nothing
   else, no `.map`).
2. `Main.html` contains the literal
   `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`,
   `href="../Style.css"`, `<script src="../Script.js" defer></script>`, and no
   `type="module"`, no `<style`, no ` style=`, no ` on[a-z]+=`, no `<a `,
   no inline `<script>` body, no `http://`/`https://`/`data:`/`blob:` URL
   (`findHtmlViolations()` in `vite.shared.ts:68-85` covers most of this).
3. `new vm.Script(Script.js)` parses (classic script; no `import`/`export`/
   `import.meta`).
4. `Script.js` does not contain `eval(`, `new Function(`, `import(`,
   `react-style-singleton`, `RemoveScroll`, `cdn.openai.com`; and at most the
   one ``createElement(`style`)`` that React DOM's hoistable-style code contains
   (present in the scaffold build; any additional occurrence is a finding).
5. `Style.css` contains no `url(` with `data:`, `http`, `//`, no `@import`, no
   `@font-face` (or only ones whose `src` points at none), and defines
   `color-scheme` including `light dark` on `:root` (regex
   `:root[^{}]*\{[^}]*color-scheme:\s*light dark`). (The first, placeholder
   build failed this item, §8.)
6. `Script.js` contains each of the 8 §6.3 strings verbatim (search for the
   UTF-8 bytes of `’`/`…`, or for the JS escapes `\u2019`/`\u2026` if the
   minifier escapes them; the current Vite/rolldown build keeps the raw
   UTF-8 characters, audit) and the literal `open-preferences` (the button and
   the §11.2.11 fallback should share one function posting it).
7. `Script.js` contains no `localStorage`, `sessionStorage`, `indexedDB`,
   `document.cookie`, `BroadcastChannel`, `fetch(`, `XMLHttpRequest`,
   `location.reload`, `location.replace`, `location.assign`, `insertRule`,
   `adoptedStyleSheets`, `.cssRules` (§5.4, §7, §9; the scaffold build has
   none of them, audit).

### 12.2 Synchronous `show` + behaviour (happy-dom, Node)

Load the built `Main.html` body into a happy-dom `Window` (strip the
`<script>`/`<link>` tags), install a stub
`window.webkit = { messageHandlers: { controller: { postMessage: m => posted.push(m) } } }`,
evaluate `Script.js` with `window.eval(code)`, then — in the same synchronous
turn, before any `await` — assert `typeof window.show === 'function'`. Then:

| Step | Expected `document.body.textContent` contains (after flushing timers) |
|---|---|
| no call | unknown/Preferences text + Preferences button |
| `show(true, true)` (call immediately after eval, before awaiting) | on/Settings + `Quit and Open Safari Settings…` |
| `show(false, true)` | off/Settings |
| `show(true, false)` | on/**Settings** (one-way wording, §4.4.4) |
| fresh window: `show(false, false)` | off/Preferences |
| fresh window: `show(undefined, false)` / `show("x", false)` | unknown/Preferences |
| click the button | `posted` deep-equals `["open-preferences"]` (string, once) |
| fresh window without `window.webkit`, click | no exception |
| fresh window: `show(true, true)`, `show(false, true)`, `show(true, true)` in a row | each step shows the matching paragraph, the icon `<img alt="Blocker Icon">` and exactly one `<button>` are still present, no exception (§4.4.5; upstream breaks here, §4.3) |
| after every step above | `document.querySelectorAll('button').length === 1` and `document.querySelectorAll('a, form, style').length === 0` |
| fresh window: `show()`, `show({}, {})`, `show(Symbol(), 1)`, `show(null, 0)` | no exception; each returns `undefined`; text = unknown paragraph (wording Settings after the truthy `{}`/`1`) |
| after any call | the visible state sentence is inside an element with `role="status"` or `aria-live="polite"`; `body.textContent` contains exactly one of the three state sentences of the current wording |

A working prototype of the first rows is Appendix B (run with `node`; it
takes the folder holding `Base.lproj/Main.html` + `Script.js`); it passed
against the scaffold build and the upstream files (`syncType: "function"`,
`posted: ["open-preferences"]`).
Note: happy-dom does not apply `Style.css`, so text hidden by CSS still
counts — another reason for rule §11.2.5.

### 12.3 Chrome (playwright-core, headless system Chrome)

Serve the folder `Contents/Resources`-shaped (`Base.lproj/Main.html` next to
`../Script.js`, `../Style.css`, `../Icon.png` copied from
`PRISTINE/img/icon_512.png`) and open it at 425×325 in light and dark:
register a `securitypolicyviolation` listener with `page.addInitScript`,
expect **zero** violations and zero console errors/page errors; evaluate the
§12.2 sequence via `page.evaluate('show(true, true)')`; assert
`document.documentElement.scrollHeight <= 325` and `scrollWidth <= 425` for all
six state×wording combinations; assert computed `-webkit-user-select` (or
`user-select`) is `none` and `cursor` is `default` on `img`, `p` and `button`,
and `-webkit-user-drag` is `none` on `img` (WebKit only; Chrome may not report
it); assert `html[data-theme]` follows
`page.emulateMedia({ colorScheme })` without reload. (Chrome enforces the same
meta CSP; it is a proxy for WebKit, not a substitute.)

Notes from running this check (audit A4, Appendix D): Chrome requests
`/favicon.ico` and logs a console error for a 404; the test server must answer
it (e.g. 204) or the check must ignore that one URL. Do not drive the
**upstream** files through the whole sequence in one page: they throw at the
second Settings-wording call (§4.3). Audit A4 result for the scaffold build:
zero violations, zero page errors, `scrollHeight 325` / `scrollWidth 425` for
all seven calls in light and dark, `data-theme` followed `emulateMedia`
without reload.

### 12.4 Real WebKit without the app (optional but recommended): probe P4

Compile the Swift tool in Appendix A in a temporary folder (`xcrun swiftc -O -o
render-bin render.swift`) and run it on a folder shaped like
`Contents/Resources`:

```
./render-bin <ResourcesDir> light "true, true"  out-on-light.png
./render-bin <ResourcesDir> dark  "false, true" out-off-dark.png
./render-bin <ResourcesDir> light none          out-unknown.png
```

It loads the page exactly as `VC:21-25` does, injects a document-start user
script that records `securitypolicyviolation`, `error` and
`unhandledrejection`, calls `show(<args>)` at `didFinish` the way `VC:37`
does, prints `typeof show`, `innerText`, `data-theme`, scroll size and the
recorded problems, clicks the first `<button>`, prints the message Swift
receives, and saves a snapshot. Pass criteria: `typeofShow` is `"function"`
at `didFinish`; `violations: []`, `errors: []`; `innerText` matches §6.3;
`MESSAGE type=__NSCFString value=open-preferences`; `scrollH <= 325`,
`scrollW <= 425`; snapshot looks right in both appearances. It does not touch
Safari or the Blocker app and needs no signing. (Results for upstream and the
scaffold build are in §13.)

---

## 13. Probe log (what was actually run, 2026-10-04)

The P1 and P3 tool sources were temporary and are not reproduced here
(Appendix C is an equivalent of P1). P2, P4 and P5 were re-run with the exact
code of Appendices A and B (compiled/run verbatim from this file) and gave the
same results.

- **P1** (`SCRATCH/probe.swift` + `probe/Resources/*`): CSP
  capability matrix of §7, timing of §4.1 step 3, origin, viewport, dark media
  query, message delivery. Light and dark runs.
- **P2** (`render-bin` on a copy of the upstream `HTML`/`JS`/`CSS`/`ICON`):
  states and texts of §6.3 for `show(true,true)`, `show(false,false)` and no
  call; no violations, no errors; `scrollH 325`, `scrollW 425`; message
  received as string; snapshots `up-*.png` show icon, text and button
  correctly in light and dark.
- **P3** (`flip-bin` on the scaffold build): live light→dark change fires the
  media-query `change` event; `data-theme` and background follow.
- **P4** (`render-bin` on a fresh scaffold build made with
  `npx vite build --config vite.container.config.ts --outDir SCRATCH/scaffold-build`
  plus `Icon.png`): `typeof show === "function"` at `didFinish`; zero
  violations/errors in light and dark; after `show(true, true)` the
  placeholder shows "On" and Settings wording; button posts
  `open-preferences`. The scaffold placeholder's TEXTS do not match §6.3 (it
  shows a heading "Blocker", a badge and a merged sentence, no icon); that is
  expected of a placeholder and must be replaced.
- **P5** (Appendix B, happy-dom): `show` is defined synchronously
  after evaluation for both upstream `Script.js` and the scaffold build.

### Re-check probes A1-A6 (2026-10-04)

The sources of the tools that matter are reproduced in Appendices C and D. Scaffold build made with
`npx vite build --config vite.container.config.ts --outDir
SCRATCH/build --emptyOutDir` (Script.js 230 536 B, Style.css
105 036 B, Base.lproj/Main.html 443 B) plus `Icon.png`; upstream = a copy of
`build/xcode/safari-macos/Blocker/Blocker/Resources/`.

- **A1** (`probe.swift`, Appendix C; light and dark, plus a variant whose
  `Style.css` starts with `:root{color-scheme:light dark}`): handler added as
  `VC:23` does → present at evaluation; event order 8 → 10 → 13 → `didFinish`
  15 ms; `origin "file://"`, 425×325, DPR 2; full CSP matrix of §7 (same
  results, plus dynamic `import()` and the separate `insertRule`/`cssRules`
  messages); `show(true, true)` via `evaluateJavaScript` reaches the page as
  two booleans; the body types Swift receives for string/number/object/null/
  array/boolean (§5.2); root text colour with and without `color-scheme`
  (§8).
- **A2** (Appendix A `render-bin`, compiled verbatim from this file): upstream
  `show(false, true)` in dark and no-call in light reproduce P2 (no
  violations, `scrollH 325`, `scrollW 425`, `MESSAGE type=__NSCFString
  value=open-preferences`); scaffold build `show(true, true)` in dark
  reproduces P4 (`theme "dark"`, `bodyBg rgb(33, 33, 33)`); the three
  double-call sequences of §4.3 break the upstream page (`WKErrorDomain
  Code=4`, `Script.js:4`).
- **A3** (`flip.swift`, same as Appendix A's P3 note): live `.aqua` →
  `.darkAqua` on the scaffold build; result in §8.
- **A4** (Appendix D, headless system Chrome via `playwright-core`, page served
  over `http://127.0.0.1:<random port>`): scaffold build passes §12.3; the
  upstream files throw `Cannot set properties of undefined (setting
  'innerText')` at `Script.js:4` at the second Settings-wording call.
- **A5** (Appendix B, happy-dom, run verbatim): upstream `{"syncType":
  "function", … "posted":["open-preferences"]}`; scaffold the same.
- **A6** (static): grep of the scaffold `Script.js`/`Style.css` for the §12.1
  patterns — one ``createElement(`style`)`` (React DOM hoistable styles), no
  `eval(`/`new Function(`/`import(`/`react-style-singleton`/`RemoveScroll`/
  `cdn.openai.com`, no `@font-face`, no `url(`, and **no
  `:root{color-scheme:light dark}`** (§8).

---

## 14. UNKNOWN / not determined

| # | Item | Why it matters |
|---|---|---|
| U1 | Delay between `didFinish` and the `show(…)` call (`getStateOfSafariExtension` latency) | how long the unknown state is visible |
| U2 | Whether `--force` deletes the project folder first or only overwrites (the template itself is now known: `TPL`, §2.3) | only the copy order matters (§2.3) |
| U3 | Window's initial on-screen position | none for the page |
| U4 | Whether the WKWebView context menu offers *Reload* (re-running §4.1) | page must tolerate repeated `show` anyway |
| U5 | Whether Tab focuses the button in this WKWebView (system keyboard-navigation setting) | accessibility acceptance must not assume it |
| U6 | What *Help → Blocker Help* shows | none for the page |
| U7 | Behaviour of the real app under failure of `getStateOfSafariExtension` (does it happen on first launch?) | the unknown state may be final |

---

## 15. Disagreements with research / ARCHITECTURE (upstream source and probes win)

1. ARCHITECTURE §6.1: "CSSOM inline styles are … NOT [allowed] in the
   container window". Probe P1: CSSOM writes (`style.prop`, `setProperty`,
   `cssText`) and constructable stylesheets **are applied** under
   `default-src 'self'` in WKWebView; only the `style` attribute, `<style>`
   elements, `data:`/`blob:` and eval are blocked. React's `style` prop is
   therefore safe. (The research notes' claim that the CSP "blocks …
   inline style attributes", is right only for the attribute form.)
   Re-VERIFIED by audit A1 with a fresh tool.
2. ARCHITECTURE §5: "`dist/container/` with `Main.html`". Actual (scaffold,
   and required by the bundle layout): `dist/container/Base.lproj/Main.html`.
3. ARCHITECTURE §6.7 (all text via `browser.i18n`): impossible on this page;
   strings are hard-coded English (§6.4).
4. The original plan's verification step ("launch Blocker.app")
   is replaced here by checks that do not launch the app (§12), per
   ARCHITECTURE §7.
5. The research notes suggested ES modules could work
   "unless a private preference is set in Swift" and offers relaxing the CSP;
   neither applies: Swift is never edited (ARCHITECTURE §2) and the CSP stays
   `default-src 'self'` (§7). The research notes' description of the page
   ("reads extension state once; it does not refresh") agrees with §4.1 step 8.

---

## 16. PARITY CHECKLIST (each line is a test; "where" names the check that covers it)

| # | Requirement | Pass condition | Where |
|---|---|---|---|
| 1 | `show` exists synchronously | `typeof window.show === 'function'` immediately after evaluating `Script.js`, before any `await` | §12.2, Appendix B |
| 2 | `show` exists at `didFinish` in WebKit | `typeofShow: "function"` in the `[didFinish]` line | §12.4 (`render-bin`) |
| 3 | Initial state | no call → text = unknown/Preferences sentence (`HTML:14`) + `Quit and Open Safari Extensions Preferences…`; icon `img[src="../Icon.png"][alt="Blocker Icon"]` 128×128 CSS px | §12.2 row 1, §12.4 |
| 4 | On, Settings | `show(true, true)` → `JS:3` sentence + `Quit and Open Safari Settings…` | §12.2, §12.3, §12.4 |
| 5 | Off, Settings | `show(false, true)` → `JS:4` sentence + Settings button | §12.2, §12.3, §12.4 |
| 6 | Unknown, Settings | `show(undefined, true)` → `JS:5` sentence + Settings button | §12.3 |
| 7 | Preferences wording | fresh page `show(true, false)` → `HTML:15`; fresh `show(false, false)` → `HTML:16` | §12.2, §12.3 |
| 8 | Non-boolean `enabled` | `show(undefined, x)`, `show("x", x)`, `show(1, x)`, `show(null, x)` → unknown paragraph | §12.2 |
| 9 | One-way wording | after any truthy second argument, `show(b, false)`/`show(b)` keeps the Settings texts | §12.2 row 4 |
| 10 | No OS guessing | with no `show` call the Preferences wording stays (WebKit on macOS 27 and Chrome) | §12.3, §12.4 `none` |
| 11 | `show` never throws, returns `undefined` | `show()`, `show({}, {})`, `show(Symbol(), 1)`, `show(null, 0)` → no exception, return value `undefined` | §12.2 |
| 12 | Call before mount is kept | `show(false, true)` right after eval, before any await → off/Settings after flushing | Appendix B |
| 13 | Repeated calls safe (deviation from upstream, §4.3) | `show(true,true)`, `show(false,true)`, `show(true,true)` → matching paragraph each time, exactly 1 `<button>`, icon present | §12.2, §12.3 |
| 14 | Only the active paragraph is in the DOM | `body.textContent` contains exactly one of the three state sentences of the current wording | §12.2 |
| 15 | Status is announced | the paragraph sits inside an element with `role="status"` or `aria-live="polite"` | §12.2 |
| 16 | Button message | one click → `posted` deep-equals `["open-preferences"]`, `typeof posted[0] === 'string'`; two clicks → two entries; Swift log `MESSAGE type=__NSCFString value=open-preferences` | §12.2, §12.4 |
| 17 | Nothing else posted | `webkit.messageHandlers` used only for `controller.postMessage('open-preferences')`; no other handler name; no object/number/null body ever (crash, §5.2) | §12.1.6, code review |
| 18 | No `webkit` → no throw | click in a window without `window.webkit` → no exception | §12.2 last rows |
| 19 | No storage/network/navigation/BroadcastChannel | static check §12.1.7 passes; `a`, `form` count 0 | §12.1.7, §12.2 |
| 20 | Files | `dist/container/` = exactly `Base.lproj/Main.html`, `Script.js`, `Style.css` | §12.1.1 |
| 21 | Head unchanged | `Main.html` lines 1-11 byte-equal to `HTML:1-11` (CSP `default-src 'self'`, `../Style.css`, `<script src="../Script.js" defer>`) | §12.1.2 |
| 22 | Classic script | `new vm.Script(Script.js)` parses; no `import(`/`eval(`/`new Function(` | §12.1.3-4 |
| 23 | No CSP violations, no errors | `violations: []`, `errors: []` in WebKit (light+dark) and Chrome (light+dark) | §12.3, §12.4 |
| 24 | Fits the window | `scrollHeight <= 325`, `scrollWidth <= 425` for all 6 state×wording combos, light and dark | §12.3, §12.4 |
| 25 | Theme | `html[data-theme]` set at evaluation from `prefers-color-scheme`; follows a live change without reload | §12.3 (`emulateMedia`), audit A3 tool |
| 26 | Pre-theme colours | `Style.css` has `:root{color-scheme:light dark}` and the §8 `html:not([data-theme])` fallback | §12.1.5 |
| 27 | Upstream behaviour CSS | computed `-webkit-user-select: none`, `cursor: default` on `img`, `p`, `button`; `-webkit-user-drag: none` on `img` | §12.3 |
| 28 | No forbidden library parts | `Script.js` has no `RemoveScroll`/`react-style-singleton`; ≤ 1 ``createElement(`style`)`` | §12.1.4 |
| 29 | Mount failure | with `createRoot` forced to throw (vitest `vi.mock('react-dom/client')`), `#root` holds plain DOM: icon, the §6.3 sentence for the current store state, one `<button>` posting `"open-preferences"`; later `show` calls still update it | unit test |
| 30 | Pipeline | after converter and before `xcodebuild` the three files are byte-equal to `dist/container/`; `Icon.png` equals `PRISTINE/img/icon_512.png`; after `xcodebuild` the three are byte-equal inside `Blocker.app/Contents/Resources/` | §11.3 |

---

## Appendix A — `render.swift` (probe P2/P4 tool; build it in a temporary folder)

```swift
// usage: render <Resources dir> <light|dark> <show-args or "none"> <out.png>
import Cocoa
import WebKit

let a = CommandLine.arguments
let res = URL(fileURLWithPath: a[1])
let appearance = NSAppearance(named: a[2] == "dark" ? .darkAqua : .aqua)
let showArgs = a[3]
let outPng = a[4]

let probeJS = """
window.__probe = { violations: [], errors: [] };
document.addEventListener('securitypolicyviolation', e => window.__probe.violations.push(e.effectiveDirective + ' ' + e.blockedURI + ' ' + (e.sourceFile||'') + ':' + (e.lineNumber||'')));
window.addEventListener('error', e => window.__probe.errors.push(String(e.message) + ' @' + e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => window.__probe.errors.push('unhandledrejection ' + String(e.reason)));
"""

final class D: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
        print("MESSAGE type=\(type(of: m.body)) value=\(m.body)")
    }
    func dump(_ wv: WKWebView, _ label: String, _ then: @escaping () -> Void) {
        wv.evaluateJavaScript("JSON.stringify({typeofShow: typeof show, text: document.body.innerText, theme: document.documentElement.getAttribute('data-theme'), bodyBg: getComputedStyle(document.body).backgroundColor, scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth, probe: window.__probe})") { r, e in
            print("[\(label)] \(r as? String ?? "nil \(String(describing: e))")")
            then()
        }
    }
    func webView(_ wv: WKWebView, didFinish navigation: WKNavigation!) {
        dump(wv, "didFinish") {
            let call = showArgs == "none" ? "1" : "show(\(showArgs))"
            wv.evaluateJavaScript(call) { _, e in
                print("show call error: \(String(describing: e))")
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self.dump(wv, "after show") {
                        wv.evaluateJavaScript("(document.querySelector('button')||{click(){}}).click(); 1") { _, _ in
                            wv.takeSnapshot(with: nil) { img, err in
                                if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                                   let png = rep.representation(using: .png, properties: [:]) {
                                    try? png.write(to: URL(fileURLWithPath: outPng)); print("snapshot -> \(outPng)")
                                } else { print("snapshot failed \(String(describing: err))") }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
                            }
                        }
                    }
                }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)            // no Dock icon, no window shown
let d = D()
let cfg = WKWebViewConfiguration()
cfg.userContentController.add(d, name: "controller")   // as VC:23
cfg.userContentController.addUserScript(WKUserScript(source: probeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 425, height: 325), configuration: cfg)   // SB:83,106
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 425, height: 325), styleMask: [.titled, .closable], backing: .buffered, defer: false)
win.appearance = appearance
win.contentView = wv
wv.navigationDelegate = d
wv.loadFileURL(res.appendingPathComponent("Base.lproj/Main.html"), allowingReadAccessTo: res)   // as VC:25
DispatchQueue.main.asyncAfter(deadline: .now() + 20) { print("TIMEOUT"); exit(2) }
app.run()
```

To add a live light→dark check (probe P3), after `didFinish` set
`win.appearance = NSAppearance(named: .darkAqua)`, wait ~1 s, and read
`matchMedia('(prefers-color-scheme: dark)').matches` and
`document.documentElement.dataset.theme`.

---

## Appendix B — `sync-show-check.mjs` (happy-dom check of §12.2, first rows)

```js
// usage: node sync-show-check.mjs <dir containing Base.lproj/Main.html and Script.js>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'ui/node_modules/happy-dom/lib/index.js';
const dir = process.argv[2];
const html = readFileSync(join(dir, 'Base.lproj/Main.html'), 'utf8').replace(/<script\b[^>]*><\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const code = readFileSync(join(dir, 'Script.js'), 'utf8');
const w = new Window({ url: 'file:///app/Contents/Resources/Base.lproj/Main.html', width: 425, height: 325 });
w.document.write(html);
const posted = [];
w.webkit = { messageHandlers: { controller: { postMessage: (m) => posted.push(m) } } };
w.eval(code);
const syncType = typeof w.show; // must be 'function' right after evaluation, before any await
w.show(false, true);            // called before any framework had a chance to mount
await new Promise((r) => setTimeout(r, 200));
await w.happyDOM.waitUntilComplete();
const text = w.document.body.textContent;
w.document.querySelector('button')?.click();
console.log(JSON.stringify({ syncType, text: text.replace(/\s+/g, ' ').trim(), posted }));
await w.happyDOM.close();
```

---

## Appendix C — probe A1 (`probe.swift` + test page; build it in a temporary folder)

Layout: `Res/Base.lproj/Main.html`, `Res/Script.js`, `Res/Style.css`,
`Res/x.js`, `Res/Icon.png` (copy of `ICON`). Build and run:
`xcrun swiftc -O -o probe-bin probe.swift && ./probe-bin <abs path>/Res light`
(and `dark`). Prints `didFinish perfNow=…`, one `RESULT {json}` line and one
`MESSAGE type=… value=… isString=…` line per posted body.

`Res/Base.lproj/Main.html` — the upstream head (`HTML:1-10`) plus
`<script type="module" src="../x.js"></script>`; body:
`<div id="t1"></div>` … `<div id="t6"></div><div id="bg"></div><button id="b">b</button>`.

`Res/Style.css`:

```css
#t1,#t2,#t3,#t4,#t5,#t6{height:1px}
#t4{width:var(--x)}
#bg{width:1px;height:1px;background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")}
```

`Res/x.js`: `window.__mod = 1;`

`Res/Script.js`:

```js
var R = window.__r = { t0: performance.now() };
R.ctrlAtEval = typeof (window.webkit && webkit.messageHandlers && webkit.messageHandlers.controller);
R.origin = location.origin; R.href = location.href;
R.iw = innerWidth; R.ih = innerHeight; R.dpr = devicePixelRatio;
R.dark = matchMedia('(prefers-color-scheme: dark)').matches;
try { eval('1'); R.eval = 'ran'; } catch (e) { R.eval = e.name; }
try { new Function('return 1')(); R.newFunction = 'ran'; } catch (e) { R.newFunction = e.name; }
var b = document.getElementById('b'); window.__oc = 0; b.setAttribute('onclick', 'window.__oc=1'); b.click(); R.inlineHandler = window.__oc ? 'ran' : 'blocked';
var st = document.createElement('style'); st.textContent = '#t1{width:11px}'; document.head.appendChild(st);
document.getElementById('t2').setAttribute('style', 'width:12px');
document.getElementById('t3').style.width = '13px';
document.getElementById('t4').style.setProperty('--x', '14px');
document.getElementById('t5').style.cssText = 'width:15px';
try { var cs = new CSSStyleSheet(); cs.replaceSync('#t6{width:16px}'); document.adoptedStyleSheets = [cs]; R.adopted = 'set'; } catch (e) { R.adopted = e.name; }
try { document.styleSheets[0].insertRule('#t1{color:red}', 0); R.insertRule = 'ok'; } catch (e) { R.insertRule = e.name + ': ' + e.message; }
try { R.cssRules = document.styleSheets[0].cssRules.length; } catch (e) { R.cssRules = e.name; }
function img(src, k) { var i = new Image(); i.onload = function () { R[k] = 'load ' + i.naturalWidth; }; i.onerror = function () { R[k] = 'error'; }; i.src = src; }
img('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'imgData');
img(URL.createObjectURL(new Blob(['x'], { type: 'image/png' })), 'imgBlob');
img('../Icon.png', 'imgIcon');
fetch('../Style.css').then(function () { R.fetch = 'ok'; }, function (e) { R.fetch = e.name + ': ' + e.message; });
try { import('../x.js').then(function () { R.dynImport = 'ok'; }, function (e) { R.dynImport = 'rejected ' + e.name + ': ' + e.message; }); } catch (e) { R.dynImport = 'threw ' + e.name; }
document.addEventListener('DOMContentLoaded', function () { R.dcl = performance.now(); });
window.addEventListener('load', function () { R.load = performance.now(); });
function show(a, b) { R.show = [a, b, typeof a, typeof b]; }
R.showIsWindowProp = typeof window.show;
R.tEnd = performance.now();
```

`probe.swift` (mirrors `VC:21-25`: the web view exists first, the handler is
added through `wv.configuration.userContentController` afterwards):

```swift
import Cocoa
import WebKit
let a = CommandLine.arguments
let res = URL(fileURLWithPath: a[1])
let dark = a[2] == "dark"
let probeJS = """
window.__v = [];
document.addEventListener('securitypolicyviolation', e => window.__v.push(e.effectiveDirective + ' ' + e.blockedURI));
"""
final class D: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var t0 = Date()
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
        print("MESSAGE type=\(type(of: m.body)) value=\(m.body) isString=\(m.body is String)")
    }
    func webView(_ wv: WKWebView, didFinish navigation: WKNavigation!) {
        wv.evaluateJavaScript("performance.now()") { r, _ in
            print("didFinish perfNow=\(String(describing: r))")
            wv.evaluateJavaScript("show(true, true)")   // like VC:37, no completion handler
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                wv.evaluateJavaScript("""
                  (function(){ var R = window.__r; var w = id => getComputedStyle(document.getElementById(id)).width;
                   R.t1_styleElem = w('t1'); R.t2_styleAttr = w('t2'); R.t3_cssom = w('t3'); R.t4_setProperty = w('t4'); R.t5_cssText = w('t5'); R.t6_adopted = w('t6');
                   R.bgImage = getComputedStyle(document.getElementById('bg')).backgroundImage.slice(0,30);
                   R.mod = window.__mod; R.violations = window.__v; R.darkNow = matchMedia('(prefers-color-scheme: dark)').matches;
                   R.rootColor = getComputedStyle(document.documentElement).color; R.bodyBg = getComputedStyle(document.body).backgroundColor;
                   return JSON.stringify(R); })()
                """) { r, e in
                    print("RESULT \(r as? String ?? "nil \(String(describing: e))")")
                    wv.evaluateJavaScript("webkit.messageHandlers.controller.postMessage('open-preferences'); webkit.messageHandlers.controller.postMessage(1); webkit.messageHandlers.controller.postMessage({a:1}); webkit.messageHandlers.controller.postMessage(null); webkit.messageHandlers.controller.postMessage(['x']); webkit.messageHandlers.controller.postMessage(true); 1") { _, e in
                        if let e = e { print("post error \(e)") }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
                    }
                }
            }
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let d = D()
// Same order as VC:21-25: web view exists first (storyboard), handler added through webView.configuration afterwards.
let cfg = WKWebViewConfiguration()
cfg.mediaTypesRequiringUserActionForPlayback = []   // SB:109
let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 425, height: 325), configuration: cfg)
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 425, height: 325), styleMask: [.titled, .closable], backing: .buffered, defer: false)
win.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
win.contentView = wv
wv.navigationDelegate = d
wv.configuration.userContentController.addUserScript(WKUserScript(source: probeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
wv.configuration.userContentController.add(d, name: "controller")   // exactly VC:23 (via webView.configuration)
wv.loadFileURL(res.appendingPathComponent("Base.lproj/Main.html"), allowingReadAccessTo: res)
DispatchQueue.main.asyncAfter(deadline: .now() + 20) { print("TIMEOUT"); exit(2) }
app.run()
```

Expected (macOS 27.0.1, audit run): `ctrlAtEval "object"`, `origin
"file://"`, `iw 425`, `ih 325`, `eval`/`newFunction` `"EvalError"`,
`inlineHandler "blocked"`, `t1_styleElem`/`t2_styleAttr` = full width (not
11px/12px), `t3_cssom "13px"`, `t4_setProperty "14px"`, `t5_cssText "15px"`,
`t6_adopted "16px"`, `insertRule "SecurityError: Not allowed to insert rule
into cross-origin stylesheet"`, `cssRules "SecurityError"`, `imgData`/`imgBlob`
`"error"`, `imgIcon "load 512"`, `fetch "TypeError: Load failed"`, `dynImport
"rejected TypeError: Importing a module script failed."`, `mod` absent,
`show [true,true,"boolean","boolean"]`, violations as listed under §7.

The P3/A3 live-appearance check is the same harness with a `didFinish` that
reads `{mq, theme, bg}`, sets `win.appearance = NSAppearance(named:
.darkAqua)`, waits 1 s and reads again (a document-start user script records
`matchMedia('(prefers-color-scheme: dark)')` `change` events).

---

## Appendix D — check A4 (`chrome-check.mjs`, §12.3 in headless Chrome)

```js
// usage: node chrome-check.mjs <dir shaped like Contents/Resources: Base.lproj/Main.html, Script.js, Style.css, Icon.png>
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'ui/node_modules/playwright-core/index.mjs';
const dir = process.argv[2];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  if (path === '/favicon.ico') { r.writeHead(204); return r.end(); }   // Chrome-only request
  const p = join(dir, path);
  if (!existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); r.end(readFileSync(p));
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));   // random free port
const url = `http://127.0.0.1:${srv.address().port}/Base.lproj/Main.html`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 425, height: 325 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  await page.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.effectiveDirective + ' ' + e.blockedURI)); });
  await page.goto(url, { waitUntil: 'load' });
  const rows = [];
  for (const call of ['0', 'show(true, false)', 'show(false, false)', 'show(undefined, false)', 'show(true, true)', 'show(false, true)', 'show(undefined, true)']) {
    await page.evaluate(call); await page.waitForTimeout(50);
    rows.push(await page.evaluate((c) => ({ c, h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth,
      buttons: document.querySelectorAll('button').length, text: document.body.innerText.replace(/\s+/g, ' ') }), call));
  }
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.emulateMedia({ colorScheme: scheme === 'light' ? 'dark' : 'light' }); await page.waitForTimeout(50);
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  out.push({ scheme, violations: await page.evaluate(() => window.__v), errors, themeBefore, themeAfter, rows });
  await ctx.close();
}
await browser.close(); srv.close();
console.log(JSON.stringify(out, null, 1));
// pass: violations [] and errors [] in both schemes; every row h <= 325, w <= 425, buttons === 1;
// themeBefore === scheme and themeAfter === the other scheme; row texts match §6.3 for the call.
```

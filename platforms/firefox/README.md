# Firefox (desktop and Android)

`./scripts/build.sh firefox` builds one add-on package for Firefox on the desktop and Firefox for Android: `dist/blocker-firefox-<version>.xpi`.

The `.xpi` is **not signed**. Release and Beta versions of Firefox only install add-ons that addons.mozilla.org (AMO) has signed. To try a build, load it as a temporary add-on (below). To use it every day, sign it on AMO.

Minimum versions, taken from upstream's manifest: Firefox 128 and Firefox for Android 128.

## What happens

After the shared steps (upstream build, "Blocker" rename, UI build, stage, safety gate), `package.sh`:

1. checks the stage folder: `manifest.json` exists, the add-on id is valid and not an upstream id, `log.txt` is gone, and there are no symlinks;
2. zips `build/stage/firefox` with `manifest.json` at the root of the archive (`zip -X -D`, files sorted by path);
3. checks the archive: `unzip -t` passes and it lists exactly the files of the stage folder;
4. writes `dist/blocker-firefox-<version>.xpi` and prints its sha256.

`BLOCKER_FIREFOX_LINT=1 ./scripts/build.sh firefox` also runs the linter (see [Lint](#lint)) before zipping.

## The add-on id

Firefox and AMO identify an add-on by `browser_specific_settings.gecko.id`. Upstream uses `uBOLiteRedux@raymondhill.net` (store builds) and `uBOLite.dev@raymondhill.net` (local `make` builds). A fork must not reuse either one:

- AMO ties an id to the account that first signed it, so you could not sign the build;
- Firefox treats two add-ons with the same id as one, so Blocker would replace uBlock Origin Lite or be replaced by it.

`scripts/make-pristine.mjs` therefore sets the id while it makes `build/pristine/firefox`. It takes the first of these that is set:

| Source | Example |
|---|---|
| `BLOCKER_GECKO_ID` environment variable | `BLOCKER_GECKO_ID=blocker@my-domain.example ./scripts/build.sh firefox` |
| `"geckoId"` in `signing.local.json` (or in the file named by `BLOCKER_SIGNING_CONFIG`) | `{ "geckoId": "blocker@my-domain.example" }` |
| default | `blocker@example.org`, a placeholder. The build warns until you set your own. |

A valid id is e-mail-like (`name@domain`) or a GUID in braces (`{01234567-89ab-cdef-0123-456789abcdef}`), up to 80 characters. Pick a domain you control. Once you have signed an id on AMO, keep it: Firefox only updates an add-on when the id stays the same. `node platforms/firefox/gecko-id.mjs` prints the id a build would use.

Upstream's Firefox manifest has the literal name `"uBO Lite"`, while the other platforms use `__MSG_extName__`. make-pristine sets it to `__MSG_extName__` too, so Firefox shows the localized name "Blocker".

### What the safety gate accepts

`scripts/verify-stage.mjs` requires `manifest.json` in the stage folder to be byte-identical to the one in PRISTINE (check 2 in [architecture.md](../../docs/architecture.md#the-safety-gate)). It also compares the PRISTINE manifest with the raw upstream build (check 3, reported as `pristine-manifest`). PRISTINE may differ from upstream **only** in these keys:

- `short_name`, which must be `"Blocker"` (all platforms);
- `browser_specific_settings.gecko.id`, which must be a valid id that is not an upstream `*@raymondhill.net` id (Firefox only);
- `name`, which must be `"__MSG_extName__"` (Firefox only).

Any other difference is a `pristine-manifest` violation. On Firefox the gate also rejects a missing, malformed or upstream add-on id (`gecko-id`), whether or not the raw upstream build is present. If the raw upstream build is missing, or was rebuilt with another version after make-pristine ran, that comparison (check 3) only prints a warning. `node scripts/selftest-verify-stage.mjs --platform firefox` covers these cases.

## Install on Firefox desktop

### Temporary install (any Firefox, unsigned)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `dist/blocker-firefox-<version>.xpi`, or `build/stage/firefox/manifest.json`.
3. Blocker stays installed until Firefox quits. Click **Reload** on the same page after a rebuild.

During development, `npx web-ext run -s build/stage/firefox` starts a separate Firefox profile with the add-on loaded and reloads it when the folder changes. Add `--firefox=deved` or `--firefox=nightly` to use another installed edition.

### Permanent install of an unsigned build

This works only in Firefox Developer Edition, Nightly, or an unbranded build. Release, Beta and ESR always require a signature on macOS and Windows.

1. In `about:config`, set `xpinstall.signatures.required` to `false`.
2. Open `about:addons`, click the gear menu, choose **Install Add-on From File…**, and pick the `.xpi`.

For everything else, sign the add-on (see [Signing on AMO](#signing-on-amo)).

### Site access

Firefox treats the host permissions of a Manifest V3 add-on (`<all_urls>`) as permissions the user can withhold. If Blocker cannot filter some sites, open `about:addons` → Blocker → **Permissions** and allow **Access your data for all websites**. The Optimal and Complete filtering modes ask for this access when you select them.

## Install on Firefox for Android

The same `.xpi` works on Android. Chrome for Android has no extensions, so Firefox for Android is the way to use Blocker on an Android device.

### From your computer with web-ext (unsigned, temporary)

Requirements: `adb` (Android platform tools), and on the device:

- developer options with **USB debugging** turned on;
- in Firefox for Android, **Settings → Remote debugging via USB** turned on.

```sh
adb devices                                   # note the device serial
npx web-ext run -t firefox-android \
    --android-device <serial> \
    --firefox-apk org.mozilla.firefox \
    -s build/stage/firefox
```

For `--firefox-apk`, use `org.mozilla.firefox` for Release, `org.mozilla.firefox_beta` for Beta, or `org.mozilla.fenix` for Nightly. web-ext installs Blocker as a temporary add-on and reloads it when the folder changes. Blocker is removed when you stop web-ext or Firefox restarts.

### Permanent install (signed)

- **Listed on AMO**: install it from its addons.mozilla.org page, like any other add-on.
- **Signed `.xpi` file**: in Firefox for Android, open **Settings → About Firefox** and tap the Firefox logo five times to enable the debug menu. Then **Settings → Install add-on from file** installs a signed `.xpi` you copied to the device. Recent Nightly and Beta versions have this option; check yours.
- **Custom add-on collection**: in the same debug menu, **Custom Add-on collection** takes your AMO user id and the name of a collection. Only add-ons that are listed on AMO can be in a collection, so this works for a listed Blocker, not for a self-distributed one.

On Android the toolbar popup opens as a full-width sheet, not as a small panel. See [Known UI issues](#known-ui-issues).

## Signing on AMO

You need an AMO account and API credentials from <https://addons.mozilla.org/developers/addon/api/key/>. Keep the credentials out of the repository: pass them through the environment or your CI's secret store.

Before you submit:

- Set your own add-on id (see [The add-on id](#the-add-on-id)). `blocker@example.org` will not work.
- Use a name that does not suggest the add-on is uBlock Origin or uBlock Origin Lite. AMO's policies cover confusing names.
- Upstream already declares `browser_specific_settings.gecko.data_collection_permissions` as `{ "required": ["none"] }`, which AMO requires for new add-ons.

**Self-distribution (unlisted)**: AMO signs the package without listing it. Everyone you give the file to can install it.

```sh
AMO_JWT_ISSUER=... AMO_JWT_SECRET=... \
npx web-ext sign --channel unlisted -s build/stage/firefox \
    --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET" \
    --artifacts-dir dist/signed
```

**Listed on addons.mozilla.org**: use `--channel listed` or the Developer Hub. Reviewers ask for the source code of every minified or bundled file they cannot match to a known library. Two kinds are in this package:

- `ui/*.js`, Blocker's UI, built by Vite from `ui/src`;
- upstream's `lib/codemirror/cm6.bundle.ubol.min.js` and the generated `rulesets/scripting/**` files.

Upload a source archive of this repository at the commit you built, with its submodules. Add these build instructions: Node 22 (`.nvmrc`), `scripts/bootstrap.sh`, then `./scripts/build.sh firefox`. The filter lists are downloaded at build time, so a rebuild days later gives different rulesets. Say so in the reviewer notes, or keep `upstream/dist/build/mv3-data` from your build and hand it over with `BLOCKER_MV3_DATA_SEED`.

Every new version needs a higher `version` than the last one AMO signed. The version is upstream's build-time stamp (`YYYY.MDD.HMM`), set when the upstream extension is built. `make` skips that step while its output is current, so a rebuild that only changed the UI keeps the old version. Before an AMO upload, build with fresh filter lists and a new version: `rm -rf upstream/dist/build/mv3-data && BLOCKER_UPSTREAM_FORCE=1 ./scripts/build.sh firefox` (see [Versions](../../docs/building.md#versions)).

## Lint

```sh
./scripts/build.sh firefox --ui-only        # stage + gate, no package
bash platforms/firefox/lint.sh              # web-ext lint on build/stage/firefox
bash platforms/firefox/lint.sh --strict     # also fail on warnings in our files
```

`lint.sh` runs `npx --yes web-ext@10.7.0 lint`, the same addons-linter AMO runs on upload. Set `BLOCKER_WEB_EXT_VERSION=latest` to try a newer version. It saves the JSON report in `build/logs/` and groups the messages into three kinds of file:

- **ours**: `ui/**`, `popup.html`, `dashboard.html`, `css/default.css`;
- **manifest**: `manifest.json`;
- **upstream**: everything else.

It fails on an error in our files or in the manifest. Messages about upstream files are listed but never fail the run.

Result for upstream `01092d95` and web-ext 10.7.0: 0 errors, 29 warnings, 1 notice. Linting PRISTINE, the upstream build without our UI, gives 26 warnings and the same notice. The extra messages all come from library code in our bundle:

| Owner | Code | Where | Why it is accepted |
|---|---|---|---|
| ours | `UNSAFE_VAR_ASSIGNMENT` ×2 | `ui/LevelMeter-*.js` | React DOM's `dangerouslySetInnerHTML` support (`e.innerHTML = n`). Blocker's code never uses `dangerouslySetInnerHTML`. |
| ours | `DANGEROUS_EVAL` ×1 | `ui/LevelMeter-*.js` | `lodash.debounce` (via `usehooks-ts`, a dependency of `@openai/apps-sdk-ui`): `… \|\| Function("return this")()`, a global-object fallback that is never reached in an extension page. The safety gate lists it as an allowed warning. |
| ours | minified files | `ui/mount-*.js`, `ui/popup-*.js`, `ui/LevelMeter-*.js` | Vite output. Hand in the source for a listed AMO submission. |
| manifest | `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`, `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` | `manifest.json` | upstream key `gecko.data_collection_permissions` (Firefox 140 / Android 142) with `strict_min_version` 128. Older versions ignore the key. |
| manifest | `PERMISSION_FIREFOX_UNSUPPORTED_BY_MIN_VERSION` (notice) | `manifest.json` | upstream optional permission `userScripts` (Firefox 136+). |
| upstream | `INCOMPATIBLE_API` / `ANDROID_INCOMPATIBLE_API` / `UNSUPPORTED_API` | `js/background.js`, `js/compiled-filters.js`, `js/ext.js` | `userScripts.*`, guarded at run time by upstream |
| upstream | `UNSUPPORTED_API` | `js/scripting/css-procedural-api.js` | `dom.openOrClosedShadowRoot`, feature-detected by upstream |
| upstream | `DANGEROUS_EVAL`, `UNSAFE_VAR_ASSIGNMENT` | scriptlets, `web_accessible_resources/noeval-silent.js`, `js/strictblock.js` | scriptlets that are injected into pages to neutralize them |
| upstream | `COINMINER_USAGE_DETECTED` | `rulesets/**/fra-0*.json`, `rulesets/**/easyprivacy*.json` | filter rules that **block** coin-miner scripts |

## Firefox specifics

These are handled by upstream code and need no change in our build:

- **Background**: an event page (`background.scripts`, `type: module`), not a service worker.
- **No offscreen API**: upstream's `platform/mv3/firefox/ext-offscreen.js` emulates `offscreen` with an iframe in the background page. As a result `supportsCompiledFilters` is true on Firefox, so custom lists imported by URL and the "custom filters" sandbox are available. They are not available on Safari.
- **`browser.*`**: the UI resolves `globalThis.browser ?? globalThis.chrome` (`ui/src/lib/ext.ts`) and only uses the promise form of the API, so it works the same on Firefox.
- **Strict blocking** is offered on Firefox, as on Chromium. Safari hides it.

## Known UI issues

The UI was designed for Safari, then adapted for touch screens and for the Chromium and Firefox
capabilities. Status for Firefox:

- **Android popup**: on touch screens the popup fills the width of the sheet Firefox for Android
  opens, with 44 px touch targets and the full hostname visible. This was checked in Chrome with
  touch emulation only, not yet on a real Android device.
- **Custom list import**: the Filter lists pane has upstream's "Add filter list…" (import by URL)
  and the remove/undo control for imported lists. "Import from text" is part of the Custom
  filters pane, which is upstream's own page.
- **Hover-only details**: some details that desktop browsers show in tooltips are shown inline on
  touch screens instead (rule counts in Filter lists, the full hostname in the popup).

## Files

| File | Purpose |
|---|---|
| `package.sh` | checks, zip and archive checks. `scripts/build.sh` calls it as `package.sh firefox <stageDir> <distDir> <version>`. |
| `gecko-id.mjs` | resolves and validates the add-on id. Used by make-pristine, verify-stage and package.sh. |
| `lint.sh`, `lint-summary.mjs` | runs `web-ext lint` and groups the results by owner |

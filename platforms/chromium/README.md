# Chrome, Chromium, Brave, Opera and Edge

Two build targets come from this folder:

| Target | Browsers | Output |
|---|---|---|
| `chromium` | Google Chrome, Chromium, Brave, Opera (other Chromium-based browsers should work but are untested) | `dist/blocker-chromium-<version>.zip` |
| `edge` | Microsoft Edge | `dist/blocker-edge-<version>.zip` |

Both packages need Chromium 122 or later (`minimum_chrome_version` in upstream's manifest).
Chrome for Android cannot run extensions. Android users can use Firefox for Android instead
(see `platforms/firefox/`).

## Build

```sh
./scripts/bootstrap.sh          # once: submodules + npm ci in ui/
./scripts/build.sh chromium     # or: ./scripts/build.sh edge
```

`scripts/build.sh` runs the shared steps 1-5 (upstream build, "Blocker" rename, UI build,
stage, safety gate). It then calls `platforms/chromium/package.sh <target> <stage> <dist> <version>`:

1. **Package folder.** `prepare-package.mjs` copies `build/stage/<target>` to `build/package/<target>`.
   With the default `release` profile it makes the same two changes upstream makes for its tagged
   store builds (`tools/make-mv3.sh`):
   - it deletes `rulesets/debug/`, which holds debug copies of every ruleset (about 50 MB);
   - it removes the `declarativeNetRequestFeedback` permission. Upstream adds that permission
     only to local builds, to enable DNR rule debugging.

   Then it checks that the folder equals the verified stage except for exactly these changes.
2. **Store checks.** `check-package.mjs` validates the folder against the store rules (details below).
3. **Zip.** It writes `dist/blocker-<target>-<version>.zip`. Files are sorted and get a fixed
   timestamp, so the same content always gives a byte-identical zip. `manifest.json` sits at the
   zip root. The zip never contains `log.txt`, `.DS_Store` or `rulesets/debug/`.
4. **Zip check.** The zip must list exactly the files of `build/package/<target>`.

`<version>` is the version of upstream's manifest for that build. Upstream stamps it from the build
time, for example `2026.1004.1854`, when the upstream extension is built. `make` skips that step
while its output is current, so a rebuild that only changed the UI keeps the old version
(see [Versions](../../docs/building.md#versions)).

### Release and dev profiles

| | `release` (default) | `dev` (`BLOCKER_CHROMIUM_PROFILE=dev`) |
|---|---|---|
| Content | stage minus `rulesets/debug/`, without `declarativeNetRequestFeedback` | the stage, unchanged |
| "Show matched rules" in the popup (Developer mode) | no | yes |
| Upstream debug log buffer | off | on |
| Zip name | `blocker-<target>-<v>.zip` | `blocker-<target>-<v>-dev.zip` |
| For | stores, everyday use | debugging filters, loading unpacked |

The release profile matches the uBlock Origin Lite builds that upstream publishes on the Chrome Web
Store and Edge Add-ons. It also keeps a permission the extension does not need at runtime out of
the store review.

### Why Edge is a separate build

Edge Add-ons cannot update an extension whose declared DNR rulesets are not at the package root
([upstream note](https://learn.microsoft.com/answers/questions/918426/cant-update-extension-with-declarative-net-request)).
For Edge, upstream's `make-mv3.sh edge` moves `rulesets/main/*.json` to the package root and
rewrites the manifest paths. Everything else matches the `chromium` build. `check-package.mjs --target edge`
fails if any ruleset path contains a `/`. The Edge package also loads in Chrome, and the smoke
test below runs it there.

## Load unpacked (for testing)

Load the **folder**, not the zip. Chromium browsers install `.crx` files only from their stores. To
use the zip, unzip it into a folder first.

| Browser | Steps |
|---|---|
| Chrome / Chromium | Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, then choose `build/package/chromium`. |
| Brave | Same steps at `brave://extensions`, with `build/package/chromium`. |
| Opera | Open `opera://extensions`, turn on **Developer mode**, click **Load unpacked**, then choose `build/package/chromium`. |
| Edge | Open `edge://extensions`, turn on **Developer mode** (left pane), click **Load unpacked**, then choose `build/package/edge`. |

After a rebuild, click the reload icon on the extension's card. Notes:

- **User scripts.** The custom-filter sandbox needs user scripts to apply cosmetic and scriptlet
  filters. To allow them, open the extension's **Details** and turn on **Allow user scripts**.
  In browsers older than Chrome 138, Developer mode allows them instead. Upstream's help text says
  "uBO Lite" here; in the browser, the extension is called **Blocker**.
- **Site access.** Optimal and Complete modes need permission to read and change all sites. Chrome
  grants this at install unless you restrict it under **Site access**. If you do, the dashboard
  asks again when you pick one of these modes.
- **Remove the other one.** Do not run Blocker next to uBlock Origin Lite or uBlock Origin. Two
  content blockers with the same lists only do the work twice.

## Package for the stores (manual; nothing in this repo uploads)

The zips in `dist/` are ready to upload as they are. Before your first submission:

1. **Use your own listing.** The stores need a unique name, icons, screenshots and a privacy policy.
   Say clearly that Blocker is an independent fork of uBlock Origin Lite and not made by its
   authors. The manifest `author` field still says "Raymond Hill", because `manifest.json` is
   upstream's and is never edited (it is part of the upstream credit).
2. **Explain each permission** in the "Privacy practices" form:

   | Permission | Why |
   |---|---|
   | `declarativeNetRequest` | blocks requests with the bundled filter lists |
   | host permission `<all_urls>` | cosmetic filtering and scriptlets in Optimal/Complete mode |
   | `scripting` | injects the cosmetic filters and the element zapper/picker |
   | `userScripts` | applies the user's own custom filters |
   | `activeTab` | the popup acts on the current tab |
   | `storage`, `unlimitedStorage` | settings and compiled filter data |
   | `alarms` | deferred maintenance tasks of the service worker |
   | `offscreen` | compiles imported filter lists outside the service worker |

3. **No remote code.** All code ships in the package. `scripts/verify-stage.mjs` rejects remote
   scripts and fonts in our UI.
4. **Source code (GPLv3).** Publish the source of every uploaded version: a link to this repository
   at the matching tag. The upstream submodule commit pins the uBlock Origin Lite source.
5. **Upload:**
   - Chrome Web Store: open the developer dashboard, create a new item, and upload
     `dist/blocker-chromium-<v>.zip`. Brave and other Chromium browsers install from the Chrome Web
     Store. Opera does too, through its "Install Chrome Extensions" add-on.
   - Opera add-ons (optional, untested): upload `dist/blocker-chromium-<v>.zip`.
   - Microsoft Edge Add-ons: open Partner Center, create a new extension, and upload
     `dist/blocker-edge-<v>.zip`.

Each upload must have a higher version than the previous one. Before you upload, build with fresh
filter lists and a new version: `rm -rf upstream/dist/build/mv3-data && BLOCKER_UPSTREAM_FORCE=1
./scripts/build.sh chromium` (and `edge`). Without `BLOCKER_UPSTREAM_FORCE=1` a rebuild can reuse
the previous upstream output and its version.

## Checks you can run by hand

```sh
# store rules for a package folder (exit 0 pass, 1 errors, 2 usage)
node platforms/chromium/check-package.mjs --target chromium --dir build/package/chromium
node platforms/chromium/check-package.mjs --target edge --dir build/package/edge [--json]

# load the package into a throw-away headless Chrome and exercise the popup and the dashboard
node platforms/chromium/smoke-test.mjs --dir build/package/chromium [--screenshots DIR]
node platforms/chromium/smoke-test.mjs --dir build/package/edge --channel msedge   # needs Edge installed
```

`check-package.mjs` checks the following:

- **Manifest.** `manifest_version` is 3, and every key is one Chromium knows. Firefox and Safari keys
  (such as `browser_specific_settings`) and `key` are rejected. Name, short name and description
  resolve in every locale and fit the store limits (75, 12 and 132 characters). The version format
  is valid.
- **Files.** Every file the manifest names exists. Icons are PNGs of the declared size, with a
  128 px icon present. Rulesets are valid JSON and their ids are unique.
- **Rulesets.** At most 100 are declared and at most 50 are enabled by default.
- **Edge.** Every ruleset sits at the package root.
- **Release profile.** There is no `declarativeNetRequestFeedback` permission and no `rulesets/debug/`.
- **Content.** There is no `log.txt` or `.DS_Store`, and no reserved top-level `_` name.

`smoke-test.mjs` needs `ui/node_modules` (playwright-core) and an installed Google Chrome. The test:

- starts Chrome with a temporary profile, which it deletes afterwards;
- loads the folder through the DevTools protocol (`Extensions.loadUnpacked`), because branded Chrome
  ignores `--load-extension`;
- checks that the service worker starts and the default rulesets are on;
- renders the popup for a local test page and the "not a website" state;
- opens the Settings, Filter lists, Custom filters and About panes;
- fails on any page error or console error.

### Engine test (real blocking)

```sh
node platforms/chromium/engine-test.mjs [--dir build/stage/chromium] [--screenshots DIR] [--headed]
```

`engine-test.mjs` goes further than the smoke test: it drives the UI against the real extension
engine and checks that blocking follows what the user does. Same requirements and the same
temporary profile. Chrome resolves every host name to `127.0.0.1` (`--host-resolver-rules`), so the
"ad" requests of its test page reach a local server and never the internet.

- The toolbar popup is opened for real with `chrome.action.openPopup()`, so it finds its tab as it
  does for a user. A second DevTools connection drives it.
- The test page loads one script from itself and three from hosts that one list blocks:
  `ad.doubleclick.net` (default lists), `180hits.de` (Peter Lowe's list only) and `appconsent.io`
  (cookie notices only, off by default). A probe counts as blocked only if Chrome reports
  `net::ERR_BLOCKED_BY_CLIENT` and the server never saw the request.
- Popup: "no filtering" reloads the tab and nothing is blocked; "complete" blocks again and generic
  cosmetic filtering hides an ad slot; back to "optimal". Each step is checked in the service
  worker's stored modes.
- Dashboard, opened from the popup: Filter lists (Peter Lowe's off, cookie notices on, then the
  enabled rulesets and the page are checked); Settings (default mode, strict blocking with
  `strictblock.html`, developer mode with the popup's matched-rules window); Custom filters (a
  cosmetic filter added in the classic editor hides the page heading).
- Popup tools: the zapper and picker overlays open on the page; "Report an issue" opens
  `report.html` for the site.
- It fails on any page error or console error.

Use the stage folder (the default) for everything. The release package (`--dir build/package/chromium`) works too, but it
has no `declarativeNetRequestFeedback`, so the developer-mode and matched-rules steps are skipped.

## Environment

| Variable | Meaning |
|---|---|
| `BLOCKER_CHROMIUM_PROFILE=release\|dev` | see [Release and dev profiles](#release-and-dev-profiles) (default `release`) |
| `BLOCKER_PACKAGE_DIR=DIR` | package folder (default `build/package/<target>`) |

All variables of `scripts/build.sh` apply as well.

## Known gaps on Chromium

The UI was first built for Safari. On Chrome and Edge it works: the smoke test passes, and the
strict-blocking setting and the Develop pane appear as upstream intends. The Filter lists pane
offers upstream's "Add filter list…" import by URL, the remove/undo control for imported lists
and the user-scripts hint, and its messages name no browser. One upstream limitation remains:

- **Upstream: Develop → ruleset viewer on Edge.** Upstream's `getRulesetRules` and its
  matched-rules debug view read `/rulesets/main/<id>.json`, but the Edge build moves those files to
  the package root. As a result, the Develop pane shows only the regex rules of a list on Edge (for
  EasyList, 19 rules on Edge against 3726 in the Chrome build). This is upstream behaviour and the
  same in uBlock Origin Lite for Edge.

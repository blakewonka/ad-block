# Building Blocker

Each browser gets its own build. They all come from the same command:

```sh
./scripts/build.sh <target> [options]
```

| Target | Browsers | Output in `dist/` | Host system |
|---|---|---|---|
| `chromium` | Chrome, Chromium, Brave, Opera | `blocker-chromium-<version>.zip` | macOS, Linux, Windows (WSL) |
| `edge` | Microsoft Edge | `blocker-edge-<version>.zip` | macOS, Linux, Windows (WSL) |
| `firefox` | Firefox desktop and Firefox for Android | `blocker-firefox-<version>.xpi` | macOS, Linux, Windows (WSL) |
| `safari-macos` | Safari on macOS | `Blocker-safari-macos-<version>.zip` (contains `Blocker.app`) | macOS with Xcode |
| `safari-ios` | Safari on iPhone and iPad | `Blocker-safari-ios-<version>.zip` (contains `Blocker.app`) | macOS with Xcode |
| `all` | every target above, in that order | all of the above | macOS with Xcode |

`<version>` is the version upstream gives its build: a time stamp such as `2026.1004.1913`
(UTC), taken when the upstream extension is built (step 1). Step 1 is skipped while its
output is current, so a build that only changes the UI keeps the previous version. Stores
reject an upload whose version is not higher than the last one: before a store or AMO
upload, force a new upstream build with `BLOCKER_UPSTREAM_FORCE=1` (see
[Versions](#versions)).

Contents:
[Prerequisites](#prerequisites) ·
[Get the source](#get-the-source) ·
[What a build does](#what-a-build-does) ·
[Options](#options) ·
[Chrome, Brave, Opera](#chrome-chromium-brave-opera) ·
[Edge](#microsoft-edge) ·
[Firefox](#firefox-desktop-and-android) ·
[Safari on macOS](#safari-on-macos) ·
[Safari on iOS and iPadOS](#safari-on-ios-and-ipados) ·
[Signing and bundle ids](#signing-and-bundle-identifiers) ·
[Versions](#versions) ·
[CI and releases](#ci-and-releases) ·
[Troubleshooting](#troubleshooting)

## Prerequisites

| Tool | Needed for | Notes |
|---|---|---|
| Git | everything | to clone the repository and its submodules |
| Node.js 22.12 or later, with npm | everything | `.nvmrc` says 22. Tested with Node 26 and npm 11. |
| `bash`, `make`, `jq` | upstream build | `make` and `jq` come with macOS (jq since macOS 15) |
| `zip`, `unzip` | `chromium`, `edge`, `firefox` | |
| `shasum` or `sha256sum` | `chromium`, `edge`, `firefox` | prints the checksum of the package |
| Xcode (full app, not only the command-line tools) | `safari-macos`, `safari-ios` | tested with Xcode 27 on macOS 27 |
| Google Chrome | optional | browser tests of the UI and the Chromium smoke test drive the installed Chrome headlessly |
| Network | first build | GitHub (submodules), the npm registry, and the filter-list servers |

Per host system:

- **macOS** can build every target. The build commands in this document were run on
  macOS 27 (Apple silicon); browser and device steps follow the vendors' documentation.
- **Linux** should build `chromium`, `edge` and `firefox` with the tools above (on Debian
  or Ubuntu, for example, `sudo apt install git make jq zip unzip` plus Node.js 22 or
  later). The scripts are written for it, but no Linux build has been run yet.
- **Windows:** use WSL 2 with a Linux distribution and follow the Linux notes; run the
  build inside the WSL file system (for example `~/blocker`), not under `/mnt/c`. Native
  Windows shells are not supported: the build scripts are Bash. Not tested yet.

## Get the source

```sh
git clone --recursive https://github.com/<you>/blocker.git
cd blocker
npm --prefix ui ci
```

`--recursive` fetches `upstream/` (uBlock Origin at the pinned commit) and its submodules.
It downloads the whole uBlock Origin history and took about 2.5 minutes on a fast
connection; `git clone --recursive --shallow-submodules` is quicker if you do not need that
history.
The build needs two of them, `codemirror-ubol` and `s14e-serializer`; the third,
`publish-extension`, comes along but is not used. `npm ci` installs the exact versions in
`ui/package-lock.json` and never runs install scripts (`ui/.npmrc`).

If you cloned without `--recursive`, or after you switch branches, run:

```sh
./scripts/bootstrap.sh
```

It initialises `upstream/` and the two submodules the build needs, then runs `npm ci` in
`ui/`. It is safe to run again.

## What a build does

`./scripts/build.sh <target>` runs six steps and stops at the first failure:

| Step | Script | Result |
|---|---|---|
| 1. upstream | `scripts/upstream-build.sh <platform>` | `make -C upstream dist/build/uBOLite.<platform>`: the original uBlock Origin Lite. Downloads the filter lists on the first run. |
| 2. pristine | `scripts/make-pristine.mjs` | `build/pristine/<platform>`: that build renamed to "Blocker" (the name in all 71 languages and `short_name`; on Firefox also the add-on id) |
| 3. ui | `npm --prefix ui run build:ext`, `build:container`, `build:legacy-css` | `ui/dist/`: the new pages, the Safari app window, the re-coloured `css/default.css` |
| 4. stage | `scripts/stage.mjs` | `build/stage/<platform>`: pristine plus the new pages |
| 5. verify | `scripts/verify-stage.mjs` | the safety gate: everything outside the new pages must be byte-identical to pristine |
| 6. package | `platforms/<dir>/package.sh` | the zip, xpi or app in `dist/` |

`<platform>` is `chromium`, `edge`, `firefox` or `safari` (both Safari targets share it).
Each run writes a log to `build/logs/build-<target>-<time>.log`; `build/logs/latest.log`
points at the newest one. Nothing is uploaded, installed or launched.

### Filter lists

The first build of a platform downloads every filter list (under a minute per platform
on a fast connection; `./scripts/build.sh all` took about 6 minutes from a fresh clone)
and caches them in `upstream/dist/build/mv3-data/`. Later builds reuse that cache, so their
rules stay the same, however old the lists get. `BLOCKER_UPSTREAM_FORCE=1` rebuilds the
upstream extension (and gives it a new version) but still from the same cache.

**To get current filter lists**, delete the cache and force the upstream build. Do this
before every release or store upload:

```sh
rm -rf upstream/dist/build/mv3-data
BLOCKER_UPSTREAM_FORCE=1 ./scripts/build.sh <target>     # or: all
```

(`upstream/dist/` is ignored by upstream's `.gitignore`; deleting it changes no tracked
file.) To start a new clone from an existing cache, point `BLOCKER_MV3_DATA_SEED` at an
`mv3-data` folder; it is copied once if the clone has none.

## Options

| Option | Effect |
|---|---|
| `--ui-only` | steps 1-5 only: build, stage and run the safety gate, no package |
| `--skip-upstream` | reuse `build/pristine/<platform>` (skip steps 1-2) |
| `--skip-ui` | reuse `ui/dist` (skip step 3) |
| `--no-xcode` | Safari: generate the Xcode project but do not build it |
| `--help` | the full option and environment list |

For example, after changing only the UI:

```sh
./scripts/build.sh chromium --skip-upstream
```

The environment variables (`BLOCKER_*`) are listed by `./scripts/build.sh --help` and in
each platform's README.

## Chrome, Chromium, Brave, Opera

```sh
./scripts/build.sh chromium
```

| Output | Use |
|---|---|
| `build/package/chromium/` | the folder to load unpacked |
| `dist/blocker-chromium-<version>.zip` | the same files, zipped for a store upload |

The package is the release profile: like upstream's store builds, it leaves out the debug
copies of the rulesets and the `declarativeNetRequestFeedback` permission. Requires
Chromium 122 or later.

**Install for testing** (Chromium browsers install packed extensions only from their
stores, so load the folder):

1. Open `chrome://extensions` (`brave://extensions`, `opera://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `build/package/chromium`.
4. Optional: in the extension's **Details**, turn on **Allow user scripts**. Custom filters
   need it to apply cosmetic and scriptlet filters.

After a rebuild, click the reload button on the extension's card. Remove uBlock Origin or
uBlock Origin Lite first; running two content blockers only doubles the work.

**Check without a browser**, and optionally in a throw-away headless Chrome:

```sh
node platforms/chromium/check-package.mjs --target chromium --dir build/package/chromium
node platforms/chromium/smoke-test.mjs --dir build/package/chromium
```

**Publishing** to the Chrome Web Store (or Opera add-ons) is up to you: upload the zip
under your own developer account, name and privacy policy, and link the source.
[platforms/chromium/README.md](../platforms/chromium/README.md) lists what the stores ask
for (permission justifications, the dev profile, the end-to-end engine test).

## Microsoft Edge

```sh
./scripts/build.sh edge
```

Output: `build/package/edge/` and `dist/blocker-edge-<version>.zip`. It is the Chromium
build with the rulesets moved to the package root, which Edge Add-ons requires for updates.

**Install for testing:** open `edge://extensions`, turn on **Developer mode** (left pane),
click **Load unpacked** and choose `build/package/edge`.

**Publishing:** upload the zip in Microsoft Partner Center under your own account. Known
upstream limit on Edge: the Develop pane's ruleset viewer shows only regex rules.

## Firefox (desktop and Android)

```sh
./scripts/build.sh firefox
node platforms/firefox/gecko-id.mjs          # prints the add-on id the build uses
```

Output: `dist/blocker-firefox-<version>.xpi`, for Firefox 128 or later on the desktop and
on Android. The stage folder `build/stage/firefox/` holds the same files unpacked.

**Add-on id.** Firefox identifies an add-on by its id. The default, `blocker@example.org`,
is a placeholder and the build warns about it. Before you sign or share a build, use an id
on a domain you control, either per build:

```sh
BLOCKER_GECKO_ID=blocker@my-domain.example ./scripts/build.sh firefox
```

or as `"geckoId"` in `signing.local.json` (see [Signing](#signing-and-bundle-identifiers)).
Never reuse upstream's `*@raymondhill.net` ids; the safety gate rejects them.

**Install for testing** (Mozilla's documented workflow for temporary add-ons):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose the `.xpi`.
3. Blocker stays until Firefox quits.

The `.xpi` is **unsigned**. Release and Beta versions of Firefox install only add-ons signed
by addons.mozilla.org (AMO). For everyday use, sign it on AMO (listed or unlisted). Firefox
Developer Edition and Nightly can install unsigned add-ons after setting
`xpinstall.signatures.required` to `false` in `about:config`.

**Firefox for Android** uses the same `.xpi`. Chrome for Android has no extensions, so this
is the way to use Blocker on Android. Install a signed `.xpi`, or load it temporarily from
your computer with `web-ext run -t firefox-android` over USB (needs `adb` and a
device).

All of this, including AMO signing commands, the lint step and the source upload AMO
reviewers ask for, is in [platforms/firefox/README.md](../platforms/firefox/README.md).

## Safari on macOS

```sh
./scripts/build.sh safari-macos
```

| Output | |
|---|---|
| `build/xcode/safari-macos/DerivedData/Build/Products/Release/Blocker.app` | the app, which contains the Safari extension |
| `dist/Blocker-safari-macos-<version>.zip` | the same app, zipped |
| `build/xcode/safari-macos/Blocker/Blocker.xcodeproj` | the generated Xcode project (regenerated on every build) |

Step 6 converts the staged extension into an Xcode project with Apple's
`safari-web-extension-converter`, installs the new app window, sets bundle ids and
signing, adds the icons from `assets/icons/app/`, builds with `xcodebuild`, and checks
that the extension inside the app equals the verified stage.

The app runs on macOS 13 (Ventura) or later, the oldest macOS that gets Safari 18.6.
`BLOCKER_MACOS_DEPLOYMENT_TARGET` changes that minimum; step 6 checks it in the built app.
Release builds are stripped, and step 6 fails if an executable still contains a folder path
of the build machine.

**Signing.** Without a signing config the app is signed ad hoc with the placeholder bundle
id `org.example.blocker`, and the build prints a warning. That is enough to try it, but
Safari then shows the extension only while **Allow unsigned extensions** is on (see step 4
below), and Safari turns that off whenever it quits. Sign with your own Apple team to avoid
this: see [Signing and bundle identifiers](#signing-and-bundle-identifiers).

**Install** (desktop steps; the build never launches the app or Safari):

1. Move `Blocker.app` wherever you like, for example `~/Applications`, and open it once.
   This registers the extension with Safari. Keep only one copy of the app.
2. Safari → **Settings → Extensions**: tick **Blocker**.
3. Allow it on all websites (Safari asks, or use **Edit Websites…**). The Optimal and
   Complete modes need this.
4. Unsigned (ad hoc) build only: in Safari → **Settings → Advanced**, turn on **Show
   features for web developers**; then in the new **Developer** tab of Settings, turn on
   **Allow unsigned extensions**. This is Apple's documented place since Safari 17; older
   versions had it in the **Develop** menu. Safari turns it off when it quits.

Safari limits how many rules one extension can enable at once. The dashboard dims lists
that would go over the limit; enable only the regional lists you need.

Xcode registers every app it builds with macOS, so Safari may already list a freshly built
Blocker. To undo that for the app you just built, without rebuilding:

```sh
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -u build/xcode/safari-macos/DerivedData/Build/Products/Release/Blocker.app
```

To have every future test build unregister itself, build with
`BLOCKER_SAFARI_UNREGISTER=1 ./scripts/build.sh safari-macos`. Spotlight can register an
app under your home folder again later; run the command above again if it reappears.

### First launch of a downloaded app

A `Blocker.app` you built yourself opens normally. One downloaded from a GitHub release
is signed ad hoc and not notarized, so macOS Gatekeeper blocks the first launch ("cannot
be opened" or "Apple could not verify…"):

1. Unzip it, move `Blocker.app` to `~/Applications` (or `/Applications`) and try to open
   it once; dismiss the warning with **Done** or **Cancel**.
2. Open **System Settings → Privacy & Security**, scroll to **Security**, and click
   **Open Anyway** next to the message about Blocker. Confirm with your password.
3. Continue with step 2 of **Install** above, including step 4 (it is an unsigned build).

Only do this for a download whose checksum matches `SHA256SUMS.txt` of the release. For
everyday use, build and sign the app with your own Apple team instead.

More options (Debug configuration, Xcode folder, icons): [platforms/safari/README.md](../platforms/safari/README.md).

## Safari on iOS and iPadOS

```sh
./scripts/build.sh safari-ios
```

One universal app for iPhone and iPad, iOS / iPadOS 18.6 or later. What it builds depends
on `BLOCKER_IOS_SDK`:

| `BLOCKER_IOS_SDK` | Builds | Product |
|---|---|---|
| `auto` (default) | `device` if your signing config has a `developmentTeam`, else `simulator` | |
| `simulator` | unsigned build for the iOS Simulator | `build/xcode/safari-ios/DerivedData/Build/Products/Release-iphonesimulator/Blocker.app` |
| `device` | signed build for real devices; needs your team in Xcode → Settings → Accounts, and contacts Apple for a provisioning profile | `…/Release-iphoneos/Blocker.app` |

Either way the app is zipped to `dist/Blocker-safari-ios-<version>.zip`. Without a team,
that zip holds the simulator app, which does not run on a device.

**Try the simulator build** (a throw-away simulator device, so your own simulators stay
untouched; the device type must have iOS 18.6 or later, see `xcrun simctl list runtimes`):

```sh
BLOCKER_SIGNING_CONFIG=none ./scripts/build.sh safari-ios
xcrun simctl create "Blocker test" "iPhone 17"
xcrun simctl boot "Blocker test"
xcrun simctl install "Blocker test" build/xcode/safari-ios/DerivedData/Build/Products/Release-iphonesimulator/Blocker.app
xcrun simctl launch "Blocker test" org.example.blocker     # or your bundleIdPrefix
open -a Simulator
```

In the simulator, turn the extension on under **Settings → Apps → Safari → Extensions**.
When you are done: `xcrun simctl delete "Blocker test"`.

**On your own iPhone or iPad:** set `developmentTeam`, build with
`BLOCKER_IOS_SDK=device ./scripts/build.sh safari-ios`, open
`build/xcode/safari-ios/Blocker/Blocker.xcodeproj` in Xcode, pick your device and click
Run. A device build contacts Apple to create (or reuse) a development provisioning profile
for your bundle ids and registers the device with your team. App Store or TestFlight
distribution needs an archive and a distribution certificate; this repository does not
automate it.

## Signing and bundle identifiers

Personal settings live in `signing.local.json` at the repository root. Git ignores it.
Start from the template, then **fill in your own values**:

```sh
cp signing.example.json signing.local.json
```

The template's values are empty strings, which mean "unset": copied unchanged, it gives the
same result as no file (placeholder ids, ad-hoc signing, with warnings). A filled-in file
looks like this:

```json
{
  "developmentTeam": "<your 10-character team id>",
  "bundleIdPrefix": "net.your-domain.blocker",
  "geckoId": "blocker@your-domain.net"
}
```

| Key | Used by | Meaning |
|---|---|---|
| `developmentTeam` | Safari | your 10-character Apple team id. See [Finding your team id](#finding-your-apple-team-id). |
| `bundleIdPrefix` | Safari | an identifier you own. The app is `<prefix>`, the extension `<prefix>.Extension`. Default: `org.example.blocker` (a placeholder; **change it**). Any `*.example.*` prefix gets the same warning. |
| `geckoId` | Firefox | the add-on id, see [Firefox](#firefox-desktop-and-android). Default: `blocker@example.org` (a placeholder); ids on `example.com/org/net` get a warning. |

All keys are optional. Remove the `$comment` line or keep it, as you like. To check what
a build would use:

```sh
node platforms/safari/signing.mjs
node platforms/firefox/gecko-id.mjs
```

For a single build, `BLOCKER_SIGNING_CONFIG=<file>` uses another file and
`BLOCKER_SIGNING_CONFIG=none` ignores `signing.local.json` (unsigned Safari build, default
ids).

### Finding your Apple team id

The team id is the 10-character **Team ID** of your Apple developer account. Any of these
shows it:

- [developer.apple.com/account](https://developer.apple.com/account) → **Membership
  details** → **Team ID**;
- Xcode → **Settings → Accounts**, select your Apple Account and the team;
- the `OU` field of your "Apple Development" certificate:

  ```sh
  security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
  ```

Do not use the value in parentheses that `security find-identity -v -p codesigning`
prints after the certificate name: that is your personal certificate id, not the team id.
`find-identity` is still useful to check that an "Apple Development" certificate is
installed at all.

## Versions

Two numbers identify a Blocker build:

| | Example | Where you see it |
|---|---|---|
| **Release version** | `0.1.0` (tag `v0.1.0`) | the git tag, [CHANGELOG.md](../CHANGELOG.md), the title of a GitHub release |
| **Package version** | `2026.1004.1913` | `manifest.json`, the About pane, the package file names |

The package version is upstream's build stamp (UTC time of step 1), so each platform of
one release has its own value, a few minutes apart. The GitHub release lists the package
files of its tag, which links the two. When you report a problem, give the package file
name or the About pane's version, and the release tag if you downloaded it.

Because step 1 is skipped while its output is current, rebuilding only the UI keeps the
package version. **Before every store or AMO upload**, build with fresh filter lists and a
new version:

```sh
rm -rf upstream/dist/build/mv3-data
BLOCKER_UPSTREAM_FORCE=1 ./scripts/build.sh <target>
```

## CI and releases

Two GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Runs on | Does |
|---|---|---|
| `ci.yml` | every push and pull request, or by hand (**Run workflow**, optionally with fresh filter lists) | job `ui`: typecheck, unit tests, UI build, the Safari stage and safety gate, browser tests (Ubuntu). Job `extensions`: `chromium`, `edge`, `firefox` builds with the gate self-test and the Firefox linter (Ubuntu). Job `safari`: `safari-macos` and `safari-ios`, unsigned (macOS). Uploads the packages as workflow artifacts. Filter lists are cached per upstream commit and ISO week. |
| `release.yml` | a pushed tag `v*` | runs `ci.yml` with freshly downloaded filter lists, then creates a GitHub release with every package and `SHA256SUMS.txt` |

**Cutting a release** (maintainers):

1. Move the "Unreleased" entries of `CHANGELOG.md` under the new version and commit.
2. Optional, once per repository: set the repository variable `BLOCKER_GECKO_ID`
   (Settings → Secrets and variables → Actions → Variables) to your Firefox add-on id;
   without it the `.xpi` carries the placeholder `blocker@example.org`.
3. Tag and push:

   ```sh
   git tag -a v0.2.0 -m "Blocker 0.2.0"
   git push origin v0.2.0
   ```

   A tag with a hyphen, such as `v0.2.0-rc.1`, makes a pre-release. Running the workflow
   again for an existing release replaces its assets.
4. Check the release page: five packages and `SHA256SUMS.txt`.

Release packages are not store-signed: the Safari app is ad hoc and not notarized (see
[First launch of a downloaded app](#first-launch-of-a-downloaded-app)), the iOS zip is a
Simulator build, and the `.xpi` is unsigned. Sign and upload store builds yourself from a
local build. Do not attach Safari zips built on your own Mac to a release by hand: a
signed one carries your Apple team and name in its signature.

## Troubleshooting

When a build fails, the last line names the step and the log file. `build/logs/latest.log`
always has the newest log.

| Symptom | Cause and fix |
|---|---|
| `upstream/ is empty` or `upstream's own submodules are missing` | Cloned without `--recursive`. Run `./scripts/bootstrap.sh`. |
| `npm ci` reports 2 vulnerabilities in `lodash` | Known and not shipped; see [SECURITY.md](../SECURITY.md#known-npm-audit-findings). |
| `ui/node_modules missing` | Run `npm --prefix ui ci`. |
| `jq not found`, `zip not found` | Install the tool with your package manager (`brew`, `apt`, …). |
| Step 1 is slow or fails while downloading | The first build downloads every filter list. Check your network and run the build again; finished lists stay cached. |
| `FAILED at step: 5/6 verify` | A file outside the new pages differs from the original extension. The log names each file. Undo the change, or rebuild without `--skip-upstream`. See [architecture.md](architecture.md#the-safety-gate). |
| `--skip-upstream but build/pristine/<platform> does not exist` | Run that target once without `--skip-upstream`. |
| The converter or `xcodebuild` is not found | Xcode must be selected, not only the command-line tools: check `xcode-select -p`. To switch, run `sudo xcode-select -s /Applications/Xcode.app` (needs admin rights). |
| Signing errors from `xcodebuild` | Check `developmentTeam` in `signing.local.json` ([finding your team id](#finding-your-apple-team-id)), and that an "Apple Development" certificate is installed: `security find-identity -v -p codesigning`. Or build unsigned with `BLOCKER_SIGNING_CONFIG=none`. |
| `"developmentTeam" is the example value ABCDE12345` | An old copy of the template. Put your own team id, or `""` for an ad-hoc build. |
| Store or AMO rejects the upload: version not higher | Step 1 was skipped, so the version did not change. Rebuild with `BLOCKER_UPSTREAM_FORCE=1` (see [Versions](#versions)). |
| macOS says the downloaded `Blocker.app` cannot be opened | It is not notarized. See [First launch of a downloaded app](#first-launch-of-a-downloaded-app). |
| Blocker is not in Safari's Extensions list | Open `Blocker.app` once. For an unsigned build, turn on **Allow unsigned extensions** in Safari Settings → Developer (again after every Safari restart). |
| Two "Blocker" entries in Safari | Two copies of the app, or two bundle ids. Keep one app; delete old builds. |
| Safari still shows the old icon | macOS caches icons. Quit and reopen Safari, or log out and in. |
| A filter list cannot be turned on in Safari | Safari's rule limit is reached. Turn another list off. |
| Chrome: "Manifest file is missing or unreadable" | You chose the zip or a parent folder. Choose `build/package/chromium`, or unzip the zip first. |
| Firefox refuses the `.xpi` ("could not be verified" / "corrupt") | Release Firefox needs a signed add-on. Use **Load Temporary Add-on**, or sign it on AMO. |
| Firefox build warns about `blocker@example.org` | Set your own id (`BLOCKER_GECKO_ID` or `geckoId`). |

# Safari (macOS, iOS and iPadOS)

| Target | Result |
|---|---|
| `./scripts/build.sh safari-macos` | `Blocker.app` for macOS, which contains the Safari web extension, zipped into `dist/Blocker-safari-macos-<version>.zip` |
| `./scripts/build.sh safari-ios` | `Blocker.app` for iPhone and iPad, which contains the same extension, zipped into `dist/Blocker-safari-ios-<version>.zip`. Without a `developmentTeam` this is an unsigned **iOS Simulator** build (see [iOS and iPadOS](#ios-and-ipados)). |

Both targets package the same verified `build/stage/safari`, built from upstream's Safari output.

## What happens

After the shared steps (upstream build, "Blocker" rename, UI build, stage, safety gate), `package.sh` runs:

| Step | Tool | Result |
|---|---|---|
| a. signing | `signing.mjs` | bundle ids and signing mode (see below) |
| b. converter | `xcrun safari-web-extension-converter --macos-only` (or `--ios-only`) `--swift --copy-resources` | Xcode project in `build/xcode/<target>/Blocker/`, regenerated from scratch every time. The copied extension must equal `build/stage/safari`. |
| c. container page | `install-container.mjs` | macOS: the app window page from `ui/dist/container/` replaces the converter's `Main.html`, `Script.js`, `Style.css`. iOS: `ios-container/` replaces `Main.html` and `Style.css` (see below) |
| d. project patch | `patch-pbxproj.mjs` | bundle ids and signing set in every build configuration of both targets, checked with `plutil` |
| e. icons | macOS `assets/icons/app/mac-icon-*.png`, iOS `assets/icons/app/universal-icon-1024@1x.png`; `assets/icons/app-window/Icon.png` | app icon set and the picture in the app window |
| f. build | `xcodebuild clean build` (Release, stripped; macOS deployment target 13.0, iOS 18.6) | macOS: `build/xcode/safari-macos/DerivedData/Build/Products/Release/Blocker.app`; iOS: `build/xcode/safari-ios/DerivedData/Build/Products/Release-iphonesimulator/Blocker.app` (or `Release-iphoneos`) |
| g. checks | `diff -r`, `PlistBuddy`, `grep`, `codesign --verify` | the extension inside the app must equal `build/stage/safari` (on iOS, apart from the appex's own `Info.plist`, executable and signature); iOS also checks the installed app screen; macOS checks `LSMinimumSystemVersion`; no executable may contain a folder path of the build machine |
| h. zip | `ditto -c -k --norsrc --keepParent` | `dist/Blocker-<target>-<version>.zip` (no `__MACOSX/` entries) |

The app is never launched. Xcode registers every app it builds with LaunchServices, so Safari may list the freshly built extension. Set `BLOCKER_SAFARI_UNREGISTER=1` to undo that registration after the build, or undo it for an existing build without rebuilding:

```sh
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -u build/xcode/safari-macos/DerivedData/Build/Products/Release/Blocker.app
```

**Minimum macOS.** The converter's project would require the macOS version of the build machine. `package.sh` passes `MACOSX_DEPLOYMENT_TARGET=13.0` (Ventura, the oldest macOS with Safari 18.6) to `xcodebuild`; change it with `BLOCKER_MACOS_DEPLOYMENT_TARGET`.

**Release zips.** Release builds are stripped (`DEPLOYMENT_POSTPROCESSING=YES`, `STRIP_INSTALLED_PRODUCT=YES`), so the executables carry no debug map with the build machine's folders. A build signed with your team still carries your team id and certificate name in its signature: do not publish one you did not mean to sign.

## Signing and bundle identifiers

Copy `signing.example.json` to `signing.local.json` at the repository root (it is gitignored) and fill in your own values. The template's empty strings mean "unset", so an unchanged copy behaves like no file. Example:

```json
{ "developmentTeam": "<your 10-character team id>", "bundleIdPrefix": "net.your-domain.blocker" }
```

| Key | Effect |
|---|---|
| `bundleIdPrefix` | App id `<prefix>`, extension id `<prefix>.Extension`. Default `org.example.blocker`, a placeholder: the build warns about it (and about any `*.example.*` prefix) until you set your own. |
| `developmentTeam` | Signs with your "Apple Development" certificate (`CODE_SIGN_STYLE = Manual`). How to find the team id: [docs/building.md](../../docs/building.md#finding-your-apple-team-id). The example value of older templates, `ABCDE12345`, is rejected. |

Without `developmentTeam` the app is signed ad hoc ("Sign to Run Locally"). Safari then shows the extension only while **Allow unsigned extensions** is on (Safari → Settings → Advanced → **Show features for web developers**, then Settings → **Developer**; older Safari versions had it in the **Develop** menu), and Safari turns that setting off every time it quits.

`BLOCKER_SIGNING_CONFIG=<file>` uses another config file for one build; `BLOCKER_SIGNING_CONFIG=none` ignores `signing.local.json`.

Keep one copy of the app per bundle id. Two apps with the same extension id confuse Safari's extension list.

## iOS and iPadOS

`./scripts/build.sh safari-ios` builds one universal app (iPhone and iPad) in one of two kinds, chosen by `BLOCKER_IOS_SDK`:

| `BLOCKER_IOS_SDK` | Builds | Needs |
|---|---|---|
| `auto` (default) | `device` when the signing config has a `developmentTeam`, otherwise `simulator` | |
| `simulator` | `generic/platform=iOS Simulator`, not signed (`CODE_SIGNING_ALLOWED=NO`) | nothing; runs only in the iOS Simulator |
| `device` | `generic/platform=iOS`, `CODE_SIGN_STYLE = Automatic` with your team, `xcodebuild -allowProvisioningUpdates` | `developmentTeam` in `signing.local.json` and that team's Apple Account in Xcode → Settings → Accounts. Xcode creates or reuses a development provisioning profile for `<prefix>` and `<prefix>.Extension` (this contacts Apple). |

To try a simulator build, follow [Safari on iOS and iPadOS](../../docs/building.md#safari-on-ios-and-ipados) in docs/building.md: it builds, creates a throw-away simulator device, installs and launches the app, and deletes the device afterwards.

To run it on your own iPhone or iPad, set `developmentTeam`, build with `BLOCKER_IOS_SDK=device`, and install the app from Xcode (open `build/xcode/safari-ios/Blocker/Blocker.xcodeproj`, choose your device, Run), or with Xcode's Devices window. Distributing through the App Store or TestFlight needs an archive and a distribution certificate; this repository does not automate that.

Details:

- **Deployment target.** The build raises `IPHONEOS_DEPLOYMENT_TARGET` to the manifest's `browser_specific_settings.safari.strict_min_version` (currently 18.6). Safari on iOS is part of the OS, so an older iOS could install the app but never load the extension.
- **App screen.** The converter's iOS template is not the macOS one: it has no `Script.js`, and its `ViewController.swift` neither reports whether the extension is on nor handles the "open Safari settings" message (iOS has no API for either). Our macOS container page would show a status it never learns and a button that does nothing, so the iOS app uses its own static page, `ios-container/Base.lproj/Main.html` and `ios-container/Style.css`: icon, name, and the steps to turn the extension on. It keeps the template's Content-Security-Policy, has no script, follows light/dark mode and the safe areas, and fits on an iPhone in landscape (the template's web view does not scroll). English only, like the macOS window.
- **App icon.** iOS wants one opaque 1024 × 1024 square; the system draws the rounded corners. `assets/icons/app/universal-icon-1024@1x.png` was made from `mac-icon-512@2x.png` with `swift platforms/safari/tools/make-ios-icon.swift assets/icons/app/mac-icon-512@2x.png assets/icons/app/universal-icon-1024@1x.png`. Run it again after you change the macOS icon, or replace the file with your own opaque PNG. The same image is used for the dark and tinted home-screen styles.
- **Popup and dashboard.** The extension pages are the same as on macOS. Safari on iPhone shows the popup as a sheet at the width of the screen; on iPad, as a popover.

## Options

| Variable | Default | |
|---|---|---|
| `BLOCKER_XCODE_CONFIGURATION` | `Release` | or `Debug` |
| `BLOCKER_XCODE_DIR` | `build/xcode/<target>` | must be inside `build/` or a temp folder (it is deleted first) |
| `BLOCKER_IOS_SDK` | `auto` | `safari-ios` only: `device` or `simulator` (see above) |
| `BLOCKER_MACOS_DEPLOYMENT_TARGET` | `13.0` | `safari-macos` only: the oldest macOS the app runs on |
| `BLOCKER_SAFARI_UNREGISTER` | `0` | `1`: remove the built app from LaunchServices after the build |
| `BLOCKER_ICONS_DIR` | `assets/icons` | `none` keeps the converter's and upstream's icons |

`./scripts/build.sh safari-macos --no-xcode` (or `safari-ios --no-xcode`) stops after step e, leaving an Xcode project you can open.

## Files

| File | Purpose |
|---|---|
| `package.sh` | steps a-h, called by `scripts/build.sh` as `package.sh <target> <stageDir> <distDir> <version>` |
| `signing.mjs` | resolves the signing config; `node platforms/safari/signing.mjs` prints the result |
| `patch-pbxproj.mjs` | structural, idempotent edit of `project.pbxproj` (`--check` only reports) |
| `install-container.mjs` | installs the app window page (`--variant macos` from `ui/dist/container`, `--variant ios` from `ios-container/`) |
| `ios-container/` | the static app screen of the iOS app |
| `tools/make-ios-icon.swift` | derives the opaque iOS app icon from the macOS one |

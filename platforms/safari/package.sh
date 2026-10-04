#!/usr/bin/env bash
# platforms/safari/package.sh — Xcode project, app build and zip for the Safari targets.
# Called by scripts/build.sh as step 6 (after stage + safety gate):
#
#   platforms/safari/package.sh <target> <stageDir> <distDir> <version>
#
#   target     safari-macos | safari-ios
#   stageDir   build/stage/safari (verified by scripts/verify-stage.mjs)
#   distDir    dist/
#   version    upstream manifest version, used in the zip name
#
# Steps:
#   a. signing      platforms/safari/signing.mjs (BLOCKER_SIGNING_CONFIG, signing.local.json or
#                   the defaults: org.example.blocker + ad-hoc signature, with a warning)
#   b. converter    xcrun safari-web-extension-converter --macos-only | --ios-only
#                   -> build/xcode/<target>/Blocker/
#                   (the folder is deleted first; the extension Resources must equal stageDir)
#   c. container    platforms/safari/install-container.mjs: macOS = our React app window page
#                   (ui/dist/container), iOS = the static page in platforms/safari/ios-container
#   d. pbxproj      platforms/safari/patch-pbxproj.mjs (bundle ids + signing, every configuration)
#   e. icons        macOS: assets/icons/app/mac-icon-*.png, iOS: assets/icons/app/universal-icon-*.png
#                   -> AppIcon.appiconset; assets/icons/app-window/Icon.png -> Resources/Icon.png
#   f. xcodebuild   clean build into build/xcode/<target>/DerivedData (skipped with BLOCKER_NO_XCODE=1)
#   g. check        the built extension must equal stageDir; minimum OS version; no build-machine
#                   paths in the executables; codesign --verify (signed builds)
#   h. zip          dist/Blocker-<target>-<version>.zip (ditto --norsrc: keeps the signature,
#                   adds no __MACOSX/ entries)
#
# safari-ios builds one of two kinds (BLOCKER_IOS_SDK):
#   device      generic/platform=iOS, Automatic signing with your developmentTeam and
#               -allowProvisioningUpdates (Xcode creates or reuses a development profile;
#               needs that team's Apple account in Xcode > Settings > Accounts).
#   simulator   generic/platform=iOS Simulator, CODE_SIGNING_ALLOWED=NO (no account needed;
#               runs only in the iOS Simulator: xcrun simctl install <device> Blocker.app).
#   auto        (default) device when signing has a developmentTeam, otherwise simulator.
# The iOS deployment target is raised to the manifest's Safari strict_min_version (Safari
# on iOS ships with the OS, so an older iOS could install the app but never load the extension).
# The macOS deployment target is BLOCKER_MACOS_DEPLOYMENT_TARGET (default 13.0, the oldest
# macOS that runs Safari 18.6); without it the converter's project would require the macOS
# version of the build machine.
# Release builds are stripped (DEPLOYMENT_POSTPROCESSING=YES, STRIP_INSTALLED_PRODUCT=YES) so
# the executables carry no debug-map paths of the build machine; step g checks that.
#
# Environment:
#   BLOCKER_SIGNING_CONFIG=FILE|none   see platforms/safari/signing.mjs
#   BLOCKER_XCODE_DIR=DIR              project folder (default build/xcode/<target>)
#   BLOCKER_XCODE_CONFIGURATION        Debug | Release (default Release)
#   BLOCKER_NO_XCODE=1                 stop after step e (project only, no app, no zip)
#   BLOCKER_SAFARI_UNREGISTER=1        after the build, remove the built app from LaunchServices
#                                      (Xcode registers every app it builds; this keeps a test
#                                      build out of Safari's extension list)
#   BLOCKER_ICONS_DIR=DIR|none         icon folder (default assets/icons)
#   BLOCKER_IOS_SDK=auto|device|simulator   safari-ios only, see above (default auto)
#   BLOCKER_MACOS_DEPLOYMENT_TARGET=X.Y     safari-macos only (default 13.0)
#
# Never launches the app or Safari, never quits a running app, never uses sudo.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${BLOCKER_REPO:-$(cd "$HERE/../.." && pwd)}"
NAME="package-safari"
APP_NAME="Blocker"

if [ $# -ne 4 ]; then
    echo "$NAME: usage: platforms/safari/package.sh <safari-macos|safari-ios> <stageDir> <distDir> <version>" >&2
    exit 2
fi
TARGET="$1"
STAGE="$(cd "$2" && pwd)"
mkdir -p "$3"
DIST="$(cd "$3" && pwd)"
VERSION="$4"

case "$TARGET" in
    safari-macos)
        IOS=0
        CONVERTER_PLATFORM=(--macos-only)
        DESTINATION="platform=macOS,arch=$(uname -m)"
        ;;
    safari-ios)
        IOS=1
        CONVERTER_PLATFORM=(--ios-only)
        ;;
    *)
        echo "$NAME: unknown target $TARGET" >&2
        exit 2
        ;;
esac

XCODE="${BLOCKER_XCODE_DIR:-$REPO/build/xcode/$TARGET}"
CONFIGURATION="${BLOCKER_XCODE_CONFIGURATION:-Release}"
LOG_DIR="${BLOCKER_LOG_DIR:-$REPO/build/logs}"
STAMP="${BLOCKER_LOG_STAMP:-$(date +%Y%m%d-%H%M%S)}"
XCODE_LOG="$LOG_DIR/xcodebuild-$TARGET-$STAMP.log"
ICONS="${BLOCKER_ICONS_DIR:-$REPO/assets/icons}"
mkdir -p "$LOG_DIR"

case "$CONFIGURATION" in Debug|Release) ;; *) echo "$NAME: BLOCKER_XCODE_CONFIGURATION must be Debug or Release" >&2; exit 2 ;; esac

# The project folder is deleted and regenerated: only accept a folder under build/ or a temp folder.
case "$XCODE" in
    "$REPO"/build/?*|/private/tmp/?*|/tmp/?*|"${TMPDIR:-/nonexistent}"?*) ;;
    *) echo "$NAME: refusing to use BLOCKER_XCODE_DIR=$XCODE (must be inside build/ or a temp folder)" >&2; exit 1 ;;
esac
command -v xcrun >/dev/null || { echo "$NAME: xcrun not found (install Xcode)" >&2; exit 1; }

sub() { echo "--- $NAME: $1"; }
r() { echo "${1#"$REPO"/}"; }

# ------------------------------------------------------------------ a. signing
sub "a. signing"
SIGN_VARS="$(BLOCKER_SAFARI_TARGET="$TARGET" node "$HERE/signing.mjs" --shell)"
eval "$SIGN_VARS"
echo "$NAME: config $SIGN_SOURCE"
echo "$NAME: app id $SIGN_APP_ID, extension id $SIGN_EXT_ID"
XCODEBUILD_EXTRA=()
PRODUCTS_SUFFIX=""
if [ "$IOS" = 1 ]; then
    IOS_SDK="${BLOCKER_IOS_SDK:-auto}"
    case "$IOS_SDK" in
        auto)      if [ "$SIGN_MODE" = team ]; then IOS_SDK=device; else IOS_SDK=simulator; fi ;;
        device)    if [ "$SIGN_MODE" != team ]; then
                       echo "$NAME: BLOCKER_IOS_SDK=device needs \"developmentTeam\" in the signing config (iOS devices run signed apps only)" >&2
                       exit 1
                   fi ;;
        simulator) ;;
        *) echo "$NAME: BLOCKER_IOS_SDK must be auto, device or simulator, got $IOS_SDK" >&2; exit 2 ;;
    esac
    # iOS: a team signs with Automatic style (Xcode manages the development profile);
    # without a team the project keeps the ad-hoc values and the build does not sign.
    if [ "$SIGN_MODE" = team ]; then SIGN_STYLE=Automatic; fi
    if [ "$IOS_SDK" = device ]; then
        DESTINATION="generic/platform=iOS"
        PRODUCTS_SUFFIX="-iphoneos"
        XCODEBUILD_EXTRA+=(-allowProvisioningUpdates)
        echo "$NAME: iOS device build: Automatic signing, team $SIGN_TEAM (-allowProvisioningUpdates)"
    else
        DESTINATION="generic/platform=iOS Simulator"
        PRODUCTS_SUFFIX="-iphonesimulator"
        XCODEBUILD_EXTRA+=(CODE_SIGNING_ALLOWED=NO)
        echo "$NAME: iOS Simulator build, not signed (CODE_SIGNING_ALLOWED=NO); it does not run on a device"
    fi
    # Safari on iOS is part of the OS: raise the deployment target to the manifest's minimum Safari.
    MIN_SAFARI="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=m.browser_specific_settings?.safari?.strict_min_version;process.stdout.write(typeof v==="string"&&/^[0-9]+(\.[0-9]+){0,2}$/.test(v)?v:"")' "$STAGE/manifest.json")"
    if [ -n "$MIN_SAFARI" ]; then
        XCODEBUILD_EXTRA+=("IPHONEOS_DEPLOYMENT_TARGET=$MIN_SAFARI")
        echo "$NAME: iOS deployment target $MIN_SAFARI (manifest safari strict_min_version)"
    fi
else
    if [ "$SIGN_MODE" = team ]; then
        echo "$NAME: signing: Apple Development, team $SIGN_TEAM"
    else
        echo "$NAME: signing: ad hoc (Sign to Run Locally)"
    fi
    # The converter's project inherits the build machine's macOS as the app's minimum.
    MACOS_MIN="${BLOCKER_MACOS_DEPLOYMENT_TARGET:-13.0}"
    if ! [[ "$MACOS_MIN" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
        echo "$NAME: BLOCKER_MACOS_DEPLOYMENT_TARGET must be a version such as 13.0, got $MACOS_MIN" >&2
        exit 2
    fi
    XCODEBUILD_EXTRA+=("MACOSX_DEPLOYMENT_TARGET=$MACOS_MIN")
    echo "$NAME: macOS deployment target $MACOS_MIN (oldest macOS with Safari 18.6 is 13)"
fi
if [ "$CONFIGURATION" = Release ]; then
    # strip local symbols and the debug map (object-file paths of this machine) from the executables
    XCODEBUILD_EXTRA+=(DEPLOYMENT_POSTPROCESSING=YES STRIP_INSTALLED_PRODUCT=YES)
fi

# ------------------------------------------------------------------ b. converter
sub "b. converter -> $(r "$XCODE")"
rm -rf "$XCODE"
mkdir -p "$XCODE"
xcrun safari-web-extension-converter "$STAGE" \
    --project-location "$XCODE" --app-name "$APP_NAME" --bundle-identifier "$SIGN_APP_ID" \
    "${CONVERTER_PLATFORM[@]}" --swift --copy-resources --no-open --no-prompt --force
PROJECT="$XCODE/$APP_NAME/$APP_NAME.xcodeproj"
EXT_RES="$XCODE/$APP_NAME/$APP_NAME Extension/Resources"
[ -d "$PROJECT" ] || { echo "$NAME: converter did not create $(r "$PROJECT")" >&2; exit 1; }
# --copy-resources snapshots STAGE into the project: it must be an exact copy
if ! diff -rq "$STAGE" "$EXT_RES"; then
    echo "$NAME: converter Resources differ from STAGE" >&2
    exit 1
fi
echo "$NAME: converter Resources == STAGE"
VC="$XCODE/$APP_NAME/$APP_NAME/ViewController.swift"
# (the iOS ViewController does not name the extension: it cannot query its state)
if [ "$IOS" = 0 ] && [ -f "$VC" ] && ! grep -q "\"$SIGN_EXT_ID\"" "$VC"; then
    echo "$NAME: WARNING: ViewController.swift does not reference $SIGN_EXT_ID"
fi

# ------------------------------------------------------------------ c. container page
sub "c. container page"
if [ "$IOS" = 1 ]; then
    node "$HERE/install-container.mjs" --project-dir "$XCODE" --variant ios
else
    node "$HERE/install-container.mjs" --project-dir "$XCODE" --variant macos
fi

# ------------------------------------------------------------------ d. pbxproj
sub "d. pbxproj (bundle ids, signing)"
node "$HERE/patch-pbxproj.mjs" --project "$XCODE" \
    --app-id "$SIGN_APP_ID" --ext-id "$SIGN_EXT_ID" --team "$SIGN_TEAM" \
    --identity "$SIGN_IDENTITY" --style "$SIGN_STYLE"

# ------------------------------------------------------------------ e. icons
sub "e. app icons"
if [ "$ICONS" = none ]; then
    echo "$NAME: icons: overrides disabled (BLOCKER_ICONS_DIR=none)"
else
    ICONSET="$XCODE/$APP_NAME/$APP_NAME/Assets.xcassets/AppIcon.appiconset"
    # macOS icon set: mac-icon-<size>@<n>x.png; iOS: one opaque universal-icon-1024@1x.png
    if [ "$IOS" = 1 ]; then ICON_GLOB="universal-icon-*.png"; else ICON_GLOB="mac-icon-*.png"; fi
    n=0
    for f in "$ICONS"/app/$ICON_GLOB; do
        [ -f "$f" ] || continue
        b="$(basename "$f")"
        if [ ! -f "$ICONSET/$b" ]; then echo "$NAME: icons: ignoring app/$b (not in AppIcon.appiconset)"; continue; fi
        want="$(sips -g pixelWidth "$ICONSET/$b" | awk '/pixelWidth/{print $2}')"
        got="$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')"
        [ "$want" = "$got" ] || echo "$NAME: icons: WARNING app/$b is ${got}px wide, Xcode expects ${want}px"
        if [ "$IOS" = 1 ] && [ "$(sips -g hasAlpha "$f" | awk '/hasAlpha/{print $2}')" = yes ]; then
            echo "$NAME: icons: WARNING app/$b has an alpha channel; iOS app icons must be opaque"
        fi
        cp "$f" "$ICONSET/$b"
        n=$((n + 1))
    done
    echo "$NAME: icons: $n app icon file(s) ($ICON_GLOB) from $(r "$ICONS")/app"
    WIN="$XCODE/$APP_NAME/$APP_NAME/Resources/Icon.png"
    if [ -f "$ICONS/app-window/Icon.png" ] && [ -f "$WIN" ]; then
        cp "$ICONS/app-window/Icon.png" "$WIN"
        echo "$NAME: icons: app window picture from $(r "$ICONS")/app-window/Icon.png"
    fi
fi

if [ "${BLOCKER_NO_XCODE:-0}" = 1 ]; then
    echo
    echo "$NAME: --no-xcode: project ready, not built: $(r "$PROJECT")"
    exit 0
fi

# ------------------------------------------------------------------ f. xcodebuild
sub "f. xcodebuild $CONFIGURATION (log: $(r "$XCODE_LOG"))"
# `clean build`: an incremental build keeps resources that are no longer in the
# project (e.g. old hashed ui/* chunks) inside the built appex.
DERIVED="$XCODE/DerivedData"
if ! xcodebuild -project "$PROJECT" -scheme "$APP_NAME" -configuration "$CONFIGURATION" \
        -destination "$DESTINATION" -derivedDataPath "$DERIVED" ${XCODEBUILD_EXTRA[@]+"${XCODEBUILD_EXTRA[@]}"} \
        clean build > "$XCODE_LOG" 2>&1; then
    tail -40 "$XCODE_LOG"
    echo "$NAME: xcodebuild failed; full log: $(r "$XCODE_LOG")" >&2
    exit 1
fi
tail -2 "$XCODE_LOG"
APP="$DERIVED/Build/Products/$CONFIGURATION$PRODUCTS_SUFFIX/$APP_NAME.app"
[ -d "$APP" ] || { echo "$NAME: $(r "$APP") not found after xcodebuild" >&2; exit 1; }

# ------------------------------------------------------------------ g. checks
sub "g. checks"
if [ "$IOS" = 0 ]; then
    APPEX="$APP/Contents/PlugIns/$APP_NAME Extension.appex"
    APPEX_RES="$APPEX/Contents/Resources"
    if ! diff -rq "$STAGE" "$APPEX_RES"; then
        echo "$NAME: built appex Resources differ from STAGE" >&2
        exit 1
    fi
    echo "$NAME: built appex Resources == STAGE"
    PLIST_DIR=Contents
else
    # iOS bundles are flat: the extension files sit next to the appex's own Info.plist,
    # executable and signature. Everything else must be exactly STAGE.
    APPEX="$APP/PlugIns/$APP_NAME Extension.appex"
    [ -d "$APPEX" ] || { echo "$NAME: $(r "$APPEX") not found" >&2; exit 1; }
    for own in Info.plist "$APP_NAME Extension" _CodeSignature embedded.mobileprovision PkgInfo; do
        if [ -e "$STAGE/$own" ]; then echo "$NAME: STAGE has a top-level $own, which collides with the appex bundle" >&2; exit 1; fi
    done
    DIFF="$(diff -rq "$STAGE" "$APPEX" || true)"
    EXTRA="$(printf '%s\n' "$DIFF" | grep -v -x -F \
        -e "Only in $APPEX: Info.plist" -e "Only in $APPEX: $APP_NAME Extension" \
        -e "Only in $APPEX: _CodeSignature" -e "Only in $APPEX: embedded.mobileprovision" \
        -e "Only in $APPEX: PkgInfo" | grep -v '^$' || true)"
    if [ -n "$EXTRA" ]; then
        printf '%s\n' "$EXTRA"
        echo "$NAME: built appex differs from STAGE" >&2
        exit 1
    fi
    echo "$NAME: built appex == STAGE (plus its Info.plist, executable and signature)"
    for f in Base.lproj/Main.html Style.css; do
        if ! cmp -s "$HERE/ios-container/$f" "$APP/$f"; then
            echo "$NAME: $(r "$APP")/$f is not platforms/safari/ios-container/$f" >&2
            exit 1
        fi
    done
    echo "$NAME: app screen == platforms/safari/ios-container"
    PLIST_DIR=.
fi
for b in "$APP" "$APPEX"; do
    id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$b/$PLIST_DIR/Info.plist")"
    if [ "$IOS" = 1 ]; then
        id="$id, iOS $(/usr/libexec/PlistBuddy -c 'Print :MinimumOSVersion' "$b/$PLIST_DIR/Info.plist") or later"
    else
        min="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$b/$PLIST_DIR/Info.plist")"
        if [ "$min" != "$MACOS_MIN" ]; then
            echo "$NAME: $(basename "$b") requires macOS $min, expected $MACOS_MIN" >&2
            exit 1
        fi
        id="$id, macOS $min or later"
    fi
    echo "$NAME: $(basename "$b"): $id"
done
# The executables must not name folders of the build machine (debug map, OSO stabs).
if [ "$CONFIGURATION" = Release ]; then
    LEAKS=0
    while IFS= read -r -d '' exe; do
        if grep -aqF "$REPO/" "$exe" || grep -aqF "$HOME/" "$exe"; then
            echo "$NAME: $(r "$exe") contains a path of this machine" >&2
            LEAKS=1
        fi
    done < <(find "$APP" -type f -perm -u+x -print0)
    [ "$LEAKS" = 0 ] || exit 1
    echo "$NAME: executables carry no paths of this machine"
fi
if [ "$IOS" = 1 ] && [ "$IOS_SDK" = simulator ]; then
    echo "$NAME: codesign: not signed (simulator build, CODE_SIGNING_ALLOWED=NO)"
elif codesign --verify --deep --strict "$APP" 2>&1; then
    echo "$NAME: codesign --verify: OK ($(codesign -dvv "$APP" 2>&1 | awk -F= '/^Authority=/{print $2; exit} /^Signature=/{print "signature " $2; exit}'))"
else
    echo "$NAME: codesign --verify failed" >&2
    exit 1
fi

# ------------------------------------------------------------------ h. zip
sub "h. zip"
ZIP="$DIST/$APP_NAME-$TARGET-$VERSION.zip"
rm -f "$ZIP"
ditto -c -k --norsrc --keepParent "$APP" "$ZIP"
echo "$NAME: $(r "$ZIP") ($(du -h "$ZIP" | cut -f1 | tr -d ' '))"
if [ "$IOS" = 1 ] && [ "$IOS_SDK" = simulator ]; then
    echo "$NAME: note: this zip holds an iOS Simulator app (xcrun simctl install <device> $APP_NAME.app); a device build needs developmentTeam"
fi

if [ "${BLOCKER_SAFARI_UNREGISTER:-0}" = 1 ]; then
    # Xcode's own registration can land late, so check the database and retry.
    LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
    for attempt in 1 2 3; do
        if [ "$IOS" = 1 ]; then
            # an iOS build is usually not registered at all (lsregister then reports -10814)
            "$LSREGISTER" -u "$APP" >/dev/null 2>&1 || true
        else
            "$LSREGISTER" -u "$APP" || true
        fi
        sleep 2
        if ! "$LSREGISTER" -dump 2>/dev/null | grep -F "$APP (" | grep -q '^path:'; then break; fi
        [ "$attempt" = 3 ] && echo "$NAME: WARNING: $(r "$APP") is still registered with LaunchServices"
    done
    echo "$NAME: removed $(r "$APP") from LaunchServices (BLOCKER_SAFARI_UNREGISTER=1)"
fi
echo "$NAME: app: $(r "$APP") (not launched)"

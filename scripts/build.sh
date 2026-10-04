#!/usr/bin/env bash
# build.sh — the one entry point for every Blocker build.
#
#   scripts/build.sh <target> [options]
#
# Targets:
#   chromium       Chrome, Chromium, Brave, Opera  -> dist/blocker-chromium-<version>.zip
#   edge           Microsoft Edge                  -> dist/blocker-edge-<version>.zip
#   firefox        Firefox desktop and Android     -> dist/blocker-firefox-<version>.xpi
#   safari-macos   Safari on macOS (Blocker.app)   -> dist/Blocker-safari-macos-<version>.zip
#   safari-ios     Safari on iOS / iPadOS          -> dist/Blocker-safari-ios-<version>.zip
#   all            every target above, in that order (stops at the first failure)
#
# Options:
#   --ui-only        build, stage and run the safety gate only (no packaging)
#   --skip-upstream  reuse the existing build/pristine/<platform> (skip steps 1-2)
#   --skip-ui        reuse the existing ui/dist (skip step 3)
#   --no-xcode       Safari targets: generate the Xcode project, skip xcodebuild and the zip
#   -h, --help       this text
#
# Steps for one target (platform = chromium | edge | firefox | safari):
#   1. upstream   scripts/upstream-build.sh <platform>   -> upstream/dist/build/uBOLite.<platform>
#   2. pristine   scripts/make-pristine.mjs              -> build/pristine/<platform>  ("Blocker" rename)
#   3. ui         npm --prefix ui run build              -> ui/dist/{extension,container,legacy}
#   4. stage      scripts/stage.mjs                      -> build/stage/<platform>
#   5. verify     scripts/verify-stage.mjs               (safety gate against build/pristine/<platform>)
#   6. package    platforms/<dir>/package.sh <target> <stageDir> <distDir> <version>
#                 (chromium, edge -> platforms/chromium; firefox -> platforms/firefox;
#                  safari-macos, safari-ios -> platforms/safari)
#
# Environment (all optional):
#   BLOCKER_SIGNING_CONFIG=FILE   Safari signing config instead of ./signing.local.json
#                                 ("none" = behave as if there were no config: unsigned build)
#   BLOCKER_MV3_DATA_SEED=DIR     seed for upstream's filter-list cache (see scripts/upstream-build.sh)
#   BLOCKER_UPSTREAM_FORCE=1      rebuild the upstream extension even when make thinks it is current
#   BLOCKER_ICONS_DIR=DIR|none    icon folder with extension/, app/, app-window/ (default assets/icons)
#   BLOCKER_REQUIRE_LEGACY_CSS=0  stage the upstream css/default.css when build:legacy-css fails
#   BLOCKER_XCODE_DIR=DIR         Safari: Xcode project folder (default build/xcode/<target>)
#   BLOCKER_XCODE_CONFIGURATION   Safari: Debug or Release (default Release)
#   BLOCKER_IOS_SDK=auto|device|simulator   safari-ios: device needs a developmentTeam; auto (default)
#                                 = device with a team, else an unsigned iOS Simulator build
#   BLOCKER_MACOS_DEPLOYMENT_TARGET=X.Y   safari-macos: oldest macOS for the app (default 13.0)
#   BLOCKER_SAFARI_UNREGISTER=1   Safari: remove the built app from LaunchServices afterwards
#
# Logs: build/logs/build-<target>-<timestamp>.log; build/logs/latest.log points at the newest.
# Nothing is launched, installed or signed with anything but the configured identity; no sudo.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="build"
ALL_TARGETS=(chromium edge firefox safari-macos safari-ios)

usage() { sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'; }

TARGET=""
UI_ONLY=0
SKIP_UPSTREAM=0
SKIP_UI=0
NO_XCODE=0
for arg in "$@"; do
    case "$arg" in
        --ui-only)       UI_ONLY=1 ;;
        --skip-upstream) SKIP_UPSTREAM=1 ;;
        --skip-ui)       SKIP_UI=1 ;;
        --no-xcode)      NO_XCODE=1 ;;
        -h|--help)       usage; exit 0 ;;
        -*)              echo "$NAME: unknown option: $arg (try --help)" >&2; exit 2 ;;
        *)
            if [ -n "$TARGET" ]; then echo "$NAME: only one target allowed (got $TARGET and $arg)" >&2; exit 2; fi
            TARGET="$arg" ;;
    esac
done
case "$TARGET" in
    chromium|edge|firefox|safari-macos|safari-ios|all) ;;
    "") usage >&2; exit 2 ;;
    *) echo "$NAME: unknown target: $TARGET (chromium | edge | firefox | safari-macos | safari-ios | all)" >&2; exit 2 ;;
esac

if [ "$TARGET" = all ]; then
    PASS=()
    for t in "${ALL_TARGETS[@]}"; do
        ARGS=("$t")
        [ "$UI_ONLY" = 1 ] && ARGS+=(--ui-only)
        [ "$SKIP_UPSTREAM" = 1 ] && ARGS+=(--skip-upstream)
        [ "$NO_XCODE" = 1 ] && ARGS+=(--no-xcode)
        # the UI is the same for every target: build it once
        if [ "$SKIP_UI" = 1 ] || [ "${#PASS[@]}" -gt 0 ]; then ARGS+=(--skip-ui); fi
        bash "$REPO/scripts/build.sh" "${ARGS[@]}"
        PASS+=("$t")
    done
    echo
    echo "$NAME: all targets done: ${PASS[*]}"
    exit 0
fi

case "$TARGET" in
    safari-macos|safari-ios) PLATFORM=safari; PKG_DIR=safari ;;
    chromium|edge)           PLATFORM="$TARGET"; PKG_DIR=chromium ;;
    firefox)                 PLATFORM=firefox; PKG_DIR=firefox ;;
esac

PRISTINE="$REPO/build/pristine/$PLATFORM"
STAGE="$REPO/build/stage/$PLATFORM"
DIST="$REPO/dist"
LOG_DIR="$REPO/build/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/build-$TARGET-$STAMP.log"
ln -sfn "$(basename "$LOG")" "$LOG_DIR/latest.log"
exec > >(tee -a "$LOG") 2>&1

T0=$(date +%s)
STEP=""
step() { STEP="$1"; echo; echo "=== [$(date +%H:%M:%S)] $TARGET: $1"; }
on_exit() {
    local code=$?
    if [ $code -ne 0 ]; then
        echo
        echo "$NAME: FAILED at step: ${STEP:-startup} (exit $code). Log: ${LOG#"$REPO"/}"
    fi
}
trap on_exit EXIT

command -v node >/dev/null || { echo "$NAME: node not found" >&2; exit 1; }
command -v npm >/dev/null || { echo "$NAME: npm not found" >&2; exit 1; }
echo "$NAME: target=$TARGET platform=$PLATFORM ui-only=$UI_ONLY skip-upstream=$SKIP_UPSTREAM skip-ui=$SKIP_UI"
echo "$NAME: node $(node --version), npm $(npm --version)"
echo "$NAME: log ${LOG#"$REPO"/}"
cd "$REPO"

# ------------------------------------------------------------- 1-2. upstream + pristine
if [ "$SKIP_UPSTREAM" = 1 ]; then
    step "1/6 upstream (skipped: --skip-upstream)"
    step "2/6 pristine (skipped: --skip-upstream)"
    [ -f "$PRISTINE/manifest.json" ] || { echo "$NAME: --skip-upstream but ${PRISTINE#"$REPO"/} does not exist" >&2; exit 1; }
else
    step "1/6 upstream build (scripts/upstream-build.sh $PLATFORM)"
    bash "$REPO/scripts/upstream-build.sh" "$PLATFORM"
    step "2/6 pristine (scripts/make-pristine.mjs --platform $PLATFORM)"
    node "$REPO/scripts/make-pristine.mjs" --platform "$PLATFORM"
fi
VERSION="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version))' "$PRISTINE/manifest.json")"
echo "$NAME: version $VERSION"

# ------------------------------------------------------------- 3. ui
export BLOCKER_SKIP_LEGACY_CSS=0
if [ "$SKIP_UI" = 1 ]; then
    step "3/6 ui (skipped: --skip-ui; using the existing ui/dist)"
else
    step "3/6 ui build (npm --prefix ui run build:ext, build:container, build:legacy-css)"
    if [ ! -d "$REPO/ui/node_modules" ]; then
        echo "$NAME: ui/node_modules missing; run: npm --prefix ui ci --ignore-scripts" >&2
        exit 1
    fi
    npm --prefix "$REPO/ui" run --silent build:ext
    npm --prefix "$REPO/ui" run --silent build:container
    if npm --prefix "$REPO/ui" run --silent build:legacy-css; then
        echo "$NAME: legacy css built"
    elif [ "${BLOCKER_REQUIRE_LEGACY_CSS:-1}" != 0 ]; then
        echo "$NAME: build:legacy-css failed (set BLOCKER_REQUIRE_LEGACY_CSS=0 to stage the upstream css/default.css instead)" >&2
        exit 1
    else
        echo "$NAME: WARNING: build:legacy-css failed; staging the upstream css/default.css"
        export BLOCKER_SKIP_LEGACY_CSS=1
    fi
fi

# ------------------------------------------------------------- 4-5. stage + gate
step "4/6 stage (scripts/stage.mjs --platform $PLATFORM)"
node "$REPO/scripts/stage.mjs" --platform "$PLATFORM"

step "5/6 verify (scripts/verify-stage.mjs --platform $PLATFORM)"
node "$REPO/scripts/verify-stage.mjs" --platform "$PLATFORM"

if [ "$UI_ONLY" = 1 ]; then
    echo
    echo "$NAME: --ui-only: $TARGET staged and verified in $(( $(date +%s) - T0 )) s: ${STAGE#"$REPO"/}"
    exit 0
fi

# ------------------------------------------------------------- 6. package
PKG="$REPO/platforms/$PKG_DIR/package.sh"
step "6/6 package (platforms/$PKG_DIR/package.sh $TARGET)"
if [ ! -f "$PKG" ]; then
    echo "$NAME: packaging for $TARGET is not implemented yet (platforms/$PKG_DIR/package.sh missing)" >&2
    exit 1
fi
mkdir -p "$DIST"
export BLOCKER_REPO="$REPO" BLOCKER_LOG_DIR="$LOG_DIR" BLOCKER_LOG_STAMP="$STAMP" BLOCKER_PRISTINE="$PRISTINE"
export BLOCKER_NO_XCODE="$NO_XCODE"
bash "$PKG" "$TARGET" "$STAGE" "$DIST" "$VERSION"

echo
echo "$NAME: $TARGET done in $(( $(date +%s) - T0 )) s."

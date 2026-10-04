#!/usr/bin/env bash
# platforms/firefox/lint.sh — Mozilla's add-on linter (web-ext lint, the same
# addons-linter that addons.mozilla.org runs on upload) on the staged extension.
#
#   platforms/firefox/lint.sh [stageDir] [--strict]
#
#   stageDir   default build/stage/firefox (run ./scripts/build.sh firefox --ui-only first)
#   --strict   also fail on warnings in our files (default: fail on errors only)
#
# Runs `npx --yes web-ext@$BLOCKER_WEB_EXT_VERSION lint --output json` (downloads
# web-ext from the npm registry on first use; nothing is installed globally),
# saves the raw report to build/logs/web-ext-lint-firefox-<stamp>.json and prints
# every message grouped by owner:
#   ours      ui/**, popup.html, dashboard.html, css/default.css (the Blocker overlay)
#   manifest  manifest.json (upstream keys; we only change gecko.id, name, short_name)
#   upstream  everything else (unmodified uBO Lite files; listed, not fixed here)
# Exit 1 when there is an error in "ours" or "manifest" (or, with --strict, any
# warning in "ours"); upstream messages never fail the run.
# The known messages and why they are accepted: platforms/firefox/README.md#lint.
#
# Environment:
#   BLOCKER_WEB_EXT_VERSION   web-ext version for npx (default 10.7.0; "latest" works too)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${BLOCKER_REPO:-$(cd "$HERE/../.." && pwd)}"
NAME="lint-firefox"
WEB_EXT_VERSION="${BLOCKER_WEB_EXT_VERSION:-10.7.0}"

STAGE=""
STRICT=0
for arg in "$@"; do
    case "$arg" in
        --strict) STRICT=1 ;;
        -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) echo "$NAME: unknown option $arg" >&2; exit 2 ;;
        *) STAGE="$arg" ;;
    esac
done
STAGE="${STAGE:-$REPO/build/stage/firefox}"
[ -f "$STAGE/manifest.json" ] || { echo "$NAME: no extension at $STAGE (run ./scripts/build.sh firefox --ui-only)" >&2; exit 1; }
STAGE="$(cd "$STAGE" && pwd)"
command -v npx >/dev/null || { echo "$NAME: npx not found" >&2; exit 1; }

LOG_DIR="${BLOCKER_LOG_DIR:-$REPO/build/logs}"
mkdir -p "$LOG_DIR"
REPORT="$LOG_DIR/web-ext-lint-firefox-${BLOCKER_LOG_STAMP:-$(date +%Y%m%d-%H%M%S)}.json"

echo "$NAME: web-ext@$WEB_EXT_VERSION lint ${STAGE#"$REPO"/} (this takes a minute or two)"
set +e
npx --yes "web-ext@$WEB_EXT_VERSION" lint --source-dir "$STAGE" --output json --no-input --no-config-discovery > "$REPORT" 2> "$REPORT.stderr"
CODE=$?
set -e
if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$REPORT" 2>/dev/null; then
    echo "$NAME: web-ext did not produce a JSON report (exit $CODE):" >&2
    tail -20 "$REPORT.stderr" >&2
    exit 1
fi
rm -f "$REPORT.stderr"
echo "$NAME: report ${REPORT#"$REPO"/}"

node "$HERE/lint-summary.mjs" "$REPORT" $([ "$STRICT" = 1 ] && echo --strict)

#!/usr/bin/env bash
# upstream-build.sh — build the unmodified uBlock Origin Lite extension for one
# platform from the upstream submodule:
#
#   scripts/upstream-build.sh <chromium|edge|firefox|safari>
#
# Runs `make -C upstream dist/build/uBOLite.<platform>` (the file target, not
# `mv3-<platform>`, so the committed CodeMirror bundle is used as is and no npm
# install happens inside upstream). make skips the build when the output is
# newer than its inputs. Output: upstream/dist/build/uBOLite.<platform>/
# (ignored by upstream's .gitignore; tracked upstream files are never edited).
#
# Filter lists: upstream caches every downloaded list in
# upstream/dist/build/mv3-data/. When that folder does not exist yet and
# BLOCKER_MV3_DATA_SEED names an existing mv3-data folder (for example from an
# earlier checkout), it is copied there first, so nothing is downloaded again
# and the rulesets stay the same. Without a cache the lists are downloaded.
#
# Environment:
#   BLOCKER_MV3_DATA_SEED=DIR    seed for upstream/dist/build/mv3-data (copied once, if absent)
#   BLOCKER_UPSTREAM_FORCE=1     delete the previous output first (forces a rebuild)
#
# Needs: bash, make, node, jq, git. UBO_VERSION is unset for the build (when
# set, upstream would fetch another uBO version from GitHub).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$REPO/upstream"
NAME="upstream-build"

PLATFORM="${1:-}"
case "$PLATFORM" in
    chromium|edge|firefox|safari) ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "$NAME: usage: scripts/upstream-build.sh <chromium|edge|firefox|safari>" >&2; exit 2 ;;
esac

for tool in make node jq git; do
    command -v "$tool" >/dev/null || { echo "$NAME: $tool not found" >&2; exit 1; }
done

if [ ! -f "$UPSTREAM/Makefile" ] || [ ! -f "$UPSTREAM/tools/make-mv3.sh" ]; then
    echo "$NAME: upstream/ is empty (cloned without --recursive?); run: ./scripts/bootstrap.sh" >&2
    echo "  (it runs git submodule update --init upstream, initialises upstream's two needed submodules and npm ci in ui/)" >&2
    exit 1
fi
CM="$UPSTREAM/platform/mv3/extension/lib/codemirror/codemirror-ubol/dist/cm6.bundle.ubol.min.js"
S14E="$UPSTREAM/platform/mv3/extension/lib/s14e-serializer/s14e-serializer.js"
if [ ! -f "$CM" ] || [ ! -f "$S14E" ]; then
    echo "$NAME: upstream's own submodules are missing; run: ./scripts/bootstrap.sh" >&2
    echo "  (or by hand: git -C upstream submodule update --init platform/mv3/extension/lib/codemirror/codemirror-ubol platform/mv3/extension/lib/s14e-serializer)" >&2
    exit 1
fi

echo "$NAME: upstream $(git -C "$UPSTREAM" rev-parse --short HEAD) ($(git -C "$UPSTREAM" log -1 --format=%cs))"

DATA="$UPSTREAM/dist/build/mv3-data"
if [ ! -d "$DATA" ] && [ -n "${BLOCKER_MV3_DATA_SEED:-}" ]; then
    if [ ! -d "$BLOCKER_MV3_DATA_SEED" ]; then
        echo "$NAME: BLOCKER_MV3_DATA_SEED is not a folder: $BLOCKER_MV3_DATA_SEED" >&2
        exit 1
    fi
    mkdir -p "$UPSTREAM/dist/build"
    cp -R "$BLOCKER_MV3_DATA_SEED" "$DATA"
    echo "$NAME: seeded the filter-list cache from BLOCKER_MV3_DATA_SEED"
fi
if [ -d "$DATA/$PLATFORM" ]; then
    echo "$NAME: filter-list cache: $(find "$DATA/$PLATFORM" -type f | wc -l | tr -d ' ') cached list(s) for $PLATFORM"
else
    echo "$NAME: filter-list cache: none for $PLATFORM; the lists will be downloaded"
fi

OUT="$UPSTREAM/dist/build/uBOLite.$PLATFORM"
if [ "${BLOCKER_UPSTREAM_FORCE:-0}" = 1 ] && [ -d "$OUT" ]; then
    rm -rf "$OUT"
    echo "$NAME: BLOCKER_UPSTREAM_FORCE=1: removed the previous output"
fi

T0=$(date +%s)
env -u UBO_VERSION make -C "$UPSTREAM" "dist/build/uBOLite.$PLATFORM"

if [ ! -f "$OUT/manifest.json" ]; then
    echo "$NAME: $OUT/manifest.json missing after make" >&2
    exit 1
fi
# The build must not have touched tracked upstream files.
DIRTY="$(git -C "$UPSTREAM" status --porcelain --untracked-files=no --ignore-submodules=none)"
if [ -n "$DIRTY" ]; then
    echo "$NAME: WARNING: tracked files in upstream/ differ from the pinned commit:" >&2
    echo "$DIRTY" >&2
fi
echo "$NAME: uBOLite.$PLATFORM version $(jq -r .version "$OUT/manifest.json") ready in $(( $(date +%s) - T0 )) s: upstream/dist/build/uBOLite.$PLATFORM"

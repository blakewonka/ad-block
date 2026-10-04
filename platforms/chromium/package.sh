#!/usr/bin/env bash
# platforms/chromium/package.sh — zip for Chrome / Chromium / Brave / Opera and for Edge.
# Called by scripts/build.sh as step 6 (after stage + safety gate):
#
#   platforms/chromium/package.sh <chromium|edge> <stageDir> <distDir> <version>
#
#   target     chromium | edge
#   stageDir   build/stage/<target> (verified by scripts/verify-stage.mjs)
#   distDir    dist/
#   version    upstream manifest version, used in the zip name
#
# Steps:
#   a. prepare   platforms/chromium/prepare-package.mjs: STAGE -> build/package/<target>;
#                release profile: drop rulesets/debug/ and the declarativeNetRequestFeedback
#                permission (what upstream does for its tagged store builds), then prove the
#                folder equals STAGE except for exactly those two changes
#   b. check     platforms/chromium/check-package.mjs (manifest and files, store rules)
#   c. zip       dist/blocker-<target>-<version>.zip (dev profile: ...-<version>-dev.zip),
#                files sorted, fixed timestamps, no extra attributes, manifest.json at the
#                zip root (same content -> byte-identical zip)
#   d. verify    the zip lists exactly the files of build/package/<target>
#
# Environment:
#   BLOCKER_CHROMIUM_PROFILE=release|dev   default release. dev = package STAGE unchanged
#                                          (keeps upstream's local-build debugging: the
#                                          "matched rules" view, the debug log, rulesets/debug)
#   BLOCKER_PACKAGE_DIR=DIR                package folder (default build/package/<target>)
#
# Needs: node, zip, unzip. Never uploads anything anywhere.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${BLOCKER_REPO:-$(cd "$HERE/../.." && pwd)}"
NAME="package-chromium"

if [ $# -ne 4 ]; then
    echo "$NAME: usage: platforms/chromium/package.sh <chromium|edge> <stageDir> <distDir> <version>" >&2
    exit 2
fi
TARGET="$1"
case "$TARGET" in
    chromium|edge) ;;
    *) echo "$NAME: unknown target $TARGET (chromium | edge)" >&2; exit 2 ;;
esac
[ -d "$2" ] || { echo "$NAME: stage folder not found: $2" >&2; exit 1; }
STAGE="$(cd "$2" && pwd)"
mkdir -p "$3"
DIST="$(cd "$3" && pwd)"
VERSION="$4"
PROFILE="${BLOCKER_CHROMIUM_PROFILE:-release}"
case "$PROFILE" in release|dev) ;; *) echo "$NAME: BLOCKER_CHROMIUM_PROFILE must be release or dev" >&2; exit 2 ;; esac
PKG="${BLOCKER_PACKAGE_DIR:-$REPO/build/package/$TARGET}"

for tool in node zip unzip; do
    command -v "$tool" >/dev/null || { echo "$NAME: $tool not found" >&2; exit 1; }
done

MF_VERSION="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version))' "$STAGE/manifest.json")"
if [ "$MF_VERSION" != "$VERSION" ]; then
    echo "$NAME: version mismatch: STAGE manifest says $MF_VERSION, build.sh passed $VERSION" >&2
    exit 1
fi

SUFFIX=""
[ "$PROFILE" = dev ] && SUFFIX="-dev"
ZIP="$DIST/blocker-$TARGET-$VERSION$SUFFIX.zip"

echo "--- $NAME: a. package folder ($PROFILE profile)"
node "$HERE/prepare-package.mjs" --target "$TARGET" --stage "$STAGE" --out "$PKG" --profile "$PROFILE"

echo "--- $NAME: b. store checks"
node "$HERE/check-package.mjs" --target "$TARGET" --dir "$PKG" --profile "$PROFILE"

echo "--- $NAME: c. zip"
rm -f "$ZIP" "$ZIP.tmp"
LIST="$(mktemp)"
trap 'rm -f "$LIST" "$ZIP.tmp"' EXIT
( cd "$PKG" && find . -type f ! -name '.DS_Store' | sed 's|^\./||' | LC_ALL=C sort ) > "$LIST"
# -X: no extra file attributes (uid/gid, macOS metadata); -D: no directory entries;
# file names come from the sorted list so the zip is the same on every run.
# Every file gets the same timestamp (2000-01-01 00:00 UTC), so the same content
# always gives a byte-identical zip.
( cd "$PKG" && TZ=UTC find . -exec touch -h -t 200001010000 {} + )
( cd "$PKG" && TZ=UTC zip -X -D -q -9 "$ZIP.tmp" -@ < "$LIST" )
mv "$ZIP.tmp" "$ZIP"

echo "--- $NAME: d. verify the zip"
if ! unzip -tq "$ZIP" >/dev/null; then
    echo "$NAME: zip test failed: $ZIP" >&2
    exit 1
fi
if ! diff <(unzip -Z1 "$ZIP" | LC_ALL=C sort) "$LIST" >/dev/null; then
    echo "$NAME: the zip does not list exactly the files of ${PKG#"$REPO"/}" >&2
    diff <(unzip -Z1 "$ZIP" | LC_ALL=C sort) "$LIST" | head -20 >&2 || true
    exit 1
fi
# (the checks below read the listing proven equal to the zip; grep -q on a pipe
# would trip pipefail with SIGPIPE)
if ! grep -qx 'manifest.json' "$LIST"; then
    echo "$NAME: manifest.json is not at the zip root" >&2
    exit 1
fi
if grep -Eq '(^|/)(log\.txt|\.DS_Store)$|^__MACOSX/' "$LIST"; then
    echo "$NAME: the zip contains log.txt, .DS_Store or __MACOSX" >&2
    exit 1
fi
if [ "$PROFILE" = release ] && grep -q '^rulesets/debug/' "$LIST"; then
    echo "$NAME: the release zip contains rulesets/debug/" >&2
    exit 1
fi

COUNT="$(wc -l < "$LIST" | tr -d ' ')"
SIZE="$(( $(wc -c < "$ZIP") / 1024 )) KB"
SHA="$(shasum -a 256 "$ZIP" 2>/dev/null | cut -d' ' -f1 || sha256sum "$ZIP" | cut -d' ' -f1)"
echo "$NAME: ${ZIP#"$REPO"/}: $COUNT files, $SIZE, sha256 $SHA"
if [ "$PROFILE" = dev ]; then
    echo "$NAME: dev profile: for loading unpacked / sideloading only, not for a store upload"
fi
case "$TARGET" in
    chromium) echo "$NAME: load unpacked from ${PKG#"$REPO"/} (chrome://extensions, brave://extensions, opera://extensions); store upload: the zip (see platforms/chromium/README.md)" ;;
    edge)     echo "$NAME: load unpacked from ${PKG#"$REPO"/} (edge://extensions); store upload: the zip (see platforms/chromium/README.md)" ;;
esac

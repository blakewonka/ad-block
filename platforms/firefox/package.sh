#!/usr/bin/env bash
# platforms/firefox/package.sh — the .xpi for Firefox desktop and Firefox for Android.
# Called by scripts/build.sh as step 6 (after stage + safety gate):
#
#   platforms/firefox/package.sh firefox <stageDir> <distDir> <version>
#
#   stageDir   build/stage/firefox (verified by scripts/verify-stage.mjs)
#   distDir    dist/
#   version    upstream manifest version, used in the file name
#
# Output: <distDir>/blocker-firefox-<version>.xpi — a plain zip of stageDir with
# manifest.json at the root, files in byte order of their paths, no directory
# entries and no extra attributes (zip -X -D), so the same STAGE gives the same
# file list and content. The same .xpi installs on Firefox desktop and on
# Firefox for Android (the manifest has gecko and gecko_android settings).
#
# The .xpi is NOT signed. Release Firefox only installs add-ons signed by
# addons.mozilla.org (AMO); see platforms/firefox/README.md for temporary
# installs, Developer Edition / Nightly, Android and AMO signing.
#
# Checks before zipping: manifest.json present, add-on id is not an upstream id
# (platforms/firefox/gecko-id.mjs), no log.txt, no symlinks. After zipping:
# the archive lists exactly the files of stageDir and `unzip -t` passes.
#
# Environment:
#   BLOCKER_FIREFOX_LINT=1   also run platforms/firefox/lint.sh on stageDir (needs the
#                            npm registry the first time: npx web-ext); the build fails
#                            when the linter reports an error in one of OUR files.
#
# Never launches Firefox, never signs or uploads anything.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${BLOCKER_REPO:-$(cd "$HERE/../.." && pwd)}"
NAME="package-firefox"

if [ $# -ne 4 ]; then
    echo "$NAME: usage: platforms/firefox/package.sh firefox <stageDir> <distDir> <version>" >&2
    exit 2
fi
TARGET="$1"
[ "$TARGET" = firefox ] || { echo "$NAME: unknown target $TARGET (expected firefox)" >&2; exit 2; }
[ -d "$2" ] || { echo "$NAME: stage folder not found: $2" >&2; exit 1; }
STAGE="$(cd "$2" && pwd)"
mkdir -p "$3"
DIST="$(cd "$3" && pwd)"
VERSION="$4"
case "$VERSION" in
    ''|*/*|*' '*) echo "$NAME: bad version string: '$VERSION'" >&2; exit 2 ;;
esac

for tool in zip unzip node; do
    command -v "$tool" >/dev/null || { echo "$NAME: $tool not found" >&2; exit 1; }
done

OUT="$DIST/blocker-firefox-$VERSION.xpi"
echo "$NAME: stage   ${STAGE#"$REPO"/}"
echo "$NAME: output  ${OUT#"$REPO"/}"

# ------------------------------------------------------------------ checks
[ -f "$STAGE/manifest.json" ] || { echo "$NAME: $STAGE has no manifest.json" >&2; exit 1; }
[ ! -e "$STAGE/log.txt" ] || { echo "$NAME: log.txt is still in the stage folder" >&2; exit 1; }
if [ -n "$(find "$STAGE" -type l -print -quit)" ]; then
    echo "$NAME: the stage folder contains symlinks:" >&2
    find "$STAGE" -type l >&2
    exit 1
fi
node --input-type=module -e '
    import fs from "node:fs";
    import { pathToFileURL } from "node:url";
    const [here, stage, version] = process.argv.slice(1);
    const { geckoIdProblem } = await import(pathToFileURL(`${here}/gecko-id.mjs`).href);
    const m = JSON.parse(fs.readFileSync(`${stage}/manifest.json`, "utf8"));
    const id = m.browser_specific_settings?.gecko?.id;
    const problem = geckoIdProblem(id);
    if (problem !== null) { console.error(`package-firefox: add-on id ${JSON.stringify(id)}: ${problem}`); process.exit(1); }
    if (String(m.version) !== version) { console.error(`package-firefox: manifest version ${m.version} != ${version}`); process.exit(1); }
    if (m.manifest_version !== 3) { console.error(`package-firefox: manifest_version ${m.manifest_version}, expected 3`); process.exit(1); }
    const g = m.browser_specific_settings.gecko, a = m.browser_specific_settings.gecko_android ?? {};
    console.log(`package-firefox: add-on id ${id}; Firefox >= ${g.strict_min_version ?? "?"}, Firefox for Android >= ${a.strict_min_version ?? g.strict_min_version ?? "?"}`);
' "$HERE" "$STAGE" "$VERSION"

if [ "${BLOCKER_FIREFOX_LINT:-0}" = 1 ]; then
    bash "$HERE/lint.sh" "$STAGE"
fi

# ------------------------------------------------------------------ zip
WORK="$(mktemp -d "${TMPDIR:-/tmp}/blocker-xpi.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
LIST="$WORK/files.txt"
( cd "$STAGE" && find . -type f ! -name .DS_Store | sed 's|^\./||' | LC_ALL=C sort ) > "$LIST"
COUNT="$(wc -l < "$LIST" | tr -d ' ')"
[ "$COUNT" -gt 0 ] || { echo "$NAME: nothing to package" >&2; exit 1; }
( cd "$STAGE" && zip -X -D -q -9 "$WORK/out.xpi" -@ < "$LIST" )

# ------------------------------------------------------------------ verify the archive
unzip -tqq "$WORK/out.xpi" >/dev/null || { echo "$NAME: unzip -t failed on the new archive" >&2; exit 1; }
unzip -Z1 "$WORK/out.xpi" | LC_ALL=C sort > "$WORK/zipped.txt"
if ! cmp -s "$LIST" "$WORK/zipped.txt"; then
    echo "$NAME: the archive does not list exactly the stage files:" >&2
    diff "$LIST" "$WORK/zipped.txt" >&2 || true
    exit 1
fi
grep -qx 'manifest.json' "$WORK/zipped.txt" || { echo "$NAME: manifest.json is not at the archive root" >&2; exit 1; }

rm -f "$OUT"
mv "$WORK/out.xpi" "$OUT"
SIZE="$(du -h "$OUT" | cut -f1 | tr -d ' ')"
if command -v sha256sum >/dev/null; then SUM="$(sha256sum "$OUT" | cut -d' ' -f1)"; else SUM="$(shasum -a 256 "$OUT" | cut -d' ' -f1)"; fi
echo "$NAME: $COUNT files, $SIZE, sha256 $SUM"
echo "$NAME: wrote ${OUT#"$REPO"/} (unsigned; see platforms/firefox/README.md to install or sign it)"

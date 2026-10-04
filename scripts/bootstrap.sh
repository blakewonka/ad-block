#!/usr/bin/env bash
# bootstrap.sh — prepare a fresh clone for building:
#
#   scripts/bootstrap.sh
#
#   1. git submodule update --init upstream          (gorhill/uBlock at the pinned commit)
#   2. upstream's two submodules the build needs     (codemirror-ubol, s14e-serializer;
#                                                     not publish-extension)
#   3. npm --prefix ui ci --ignore-scripts           (exact versions from ui/package-lock.json)
#
# Safe to run again. Network: github.com and the npm registry.

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "bootstrap: submodule upstream"
git submodule update --init upstream
echo "bootstrap: upstream's submodules (codemirror-ubol, s14e-serializer)"
git -C upstream submodule update --init \
    platform/mv3/extension/lib/codemirror/codemirror-ubol \
    platform/mv3/extension/lib/s14e-serializer
echo "bootstrap: npm ci in ui/ (no install scripts)"
npm --prefix ui ci --ignore-scripts
echo "bootstrap: done. Next: ./scripts/build.sh --help"

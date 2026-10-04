# Changelog

All notable changes to Blocker are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Blocker's own version (below,
tagged `v<version>`) is the version of this repository. Each package carries a second
number, upstream's build stamp, in its manifest, its About pane and its file name (for
example `blocker-chromium-2026.1004.1913.zip`); it differs per platform. The GitHub release
of a tag lists its package files. See [Versions](docs/building.md#versions).

## [Unreleased]

## [0.1.0] - initial release

Built on uBlock Origin Lite from upstream commit
`01092d95dbc7d91599a5ad017d5b98aba1118659` (gorhill/uBlock, 1.75.1b1 plus 3 commits).

### Added

- New user interface for uBlock Origin Lite, built with React, Tailwind CSS 4 and
  OpenAI's Apps SDK UI:
  - toolbar popup with the site's filtering level, a four-step level control and the
    zapper, picker, unpicker and report tools; falls back to the original popup if it
    cannot start;
  - dashboard with new Settings, Filter lists and About panes, and upstream's Custom
    filters and Develop editors embedded and re-coloured;
  - importing filter lists by URL and removing imported lists on Chrome, Edge and
    Firefox;
  - re-coloured picker, zapper, report and other upstream pages;
  - macOS app window and an iOS / iPadOS setup screen for the Safari app;
  - light and dark mode, right-to-left languages, keyboard navigation, touch layouts,
    and upstream's 71 translations.
- Builds for Chrome / Chromium / Brave / Opera (zip), Microsoft Edge (zip), Firefox
  desktop and Firefox for Android (xpi), Safari on macOS (`Blocker.app`) and Safari on
  iOS / iPadOS, all from `./scripts/build.sh <target>`.
- Safety gate (`scripts/verify-stage.mjs`) that fails the build unless every file outside
  Blocker's pages is byte-identical to the upstream build, plus a self-test for it.
- Placeholder identities for fresh clones (`org.example.blocker`,
  `blocker@example.org`) and an ignored `signing.local.json` for personal signing
  settings.
- Unit tests, browser tests in headless Chrome against a mock extension API, behaviour
  specs with citations into upstream, and documentation.

[Unreleased]: https://github.com/<you>/blocker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<you>/blocker/releases/tag/v0.1.0

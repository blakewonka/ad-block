# Updating upstream

Blocker builds uBlock Origin Lite from the `upstream/` git submodule
(<https://github.com/gorhill/uBlock>), pinned to one commit. Moving to a newer upstream
version is a submodule bump followed by a rebuild and the parity checks. Upstream files
are never edited: if something does not fit, the fix goes into `ui/` or the scripts.

All commands run from the repository root.

## 1. See what changed

```sh
git submodule status upstream                      # the commit Blocker uses now
git -C upstream fetch origin
git -C upstream log --oneline HEAD..origin/master  # newer upstream commits
git -C upstream diff --stat HEAD origin/master -- platform/mv3 src/css/themes
```

Pick a commit, usually a tagged uBlock Origin Lite release (`git -C upstream tag
--sort=-creatordate`). The files Blocker depends on most:

| Upstream path | Why it matters | What to check |
|---|---|---|
| `platform/mv3/extension/popup.html`, `js/popup.js` | the popup Blocker replaces | messages sent, new buttons or tools ([specs/popup.md](specs/popup.md)) |
| `platform/mv3/extension/dashboard.html`, `js/dashboard.js`, `js/settings.js`, `js/filter-lists.js` | the dashboard panes Blocker replaces; `dashboard.html` is also embedded for Custom filters and Develop | new settings, changed messages ([specs/settings.md](specs/settings.md), [specs/filter-lists.md](specs/filter-lists.md), [specs/dashboard-shell.md](specs/dashboard-shell.md)) |
| `platform/mv3/extension/js/background.js`, `mode-manager.js`, `ruleset-manager.js`, `config.js` | the message handlers the new pages call | names, payloads and answers of every message ([specs/messaging.md](specs/messaging.md)) |
| `platform/mv3/extension/_locales/*/messages.json` | the strings Blocker reuses | renamed or removed keys used by `t('…')` |
| `platform/mv3/extension/css/`, `src/css/themes/default.css` | colour variables the generated `css/default.css` maps | new or renamed variables ([specs/legacy-tokens.md](specs/legacy-tokens.md)) |
| `platform/mv3/*/manifest.json`, `tools/make-mv3.sh` | how each platform is built and named | new permissions, moved files, a changed `name` |

## 2. Move the submodule

```sh
git -C upstream checkout <commit>
git -C upstream submodule update --init \
    platform/mv3/extension/lib/codemirror/codemirror-ubol \
    platform/mv3/extension/lib/s14e-serializer
```

## 3. Rebuild and run the safety gate

```sh
BLOCKER_UPSTREAM_FORCE=1 ./scripts/build.sh safari-macos --ui-only
node scripts/selftest-verify-stage.mjs --platform safari
```

`BLOCKER_UPSTREAM_FORCE=1` makes sure the upstream extension is rebuilt from the new
source. The filter lists come from the cache in `upstream/dist/build/mv3-data/`; delete
that folder if you also want fresh lists.

The gate compares the stage with the new pristine build, so it passes as long as
Blocker's overlay still fits. It fails if, for example, upstream renamed `popup.html`,
added a new top-level page that the overlay now shadows, or changed the manifest in a
way make-pristine does not expect. Read the named file in the log and adapt `ui/` or
the scripts, never the upstream files.

## 4. Check the test fixtures

The mock extension uses copies of the Safari pristine build's manifest, ruleset list and
71 locale files (`ui/src/dev/fixtures/`). They are pinned test data: many unit and
browser tests assert values from them (the version, rule counts), so **do not overwrite
them wholesale** after a bump. The browser test "mock fixtures match PRISTINE"
(`ui/tests/e2e/harness.smoke.mjs`, part of step 5) compares them with the new
`build/pristine/safari`, ignoring the version and the rule counts, and names what differs.

Only when it fails, update the file it names, for example a locale whose strings
changed:

```sh
cp build/pristine/safari/_locales/de/messages.json ui/src/dev/fixtures/locales/de.json
```

A new or removed ruleset, a new language, or a manifest change also needs the tests that
pin those values updated, and usually a look at the matching spec. A trial bump from
`01092d95` to `4676ec1f` needed no fixture change at all.

## 5. Run the tests

```sh
npm --prefix ui run typecheck
npm --prefix ui test
npm --prefix ui run build:harness
npm --prefix ui run e2e
```

The browser tests include the **parity tests** (`ui/tests/e2e/*.parity.mjs`): they
record the messages and browser-API calls the new pages make and compare them with what
upstream's pages do, as written in the specs. They run against the mock, so they catch
changes in Blocker, not in upstream. That is why step 1 matters: when upstream changes
a message or adds a feature to a page Blocker replaces, update the spec and the mock
(`ui/src/dev/mock-ext.ts`), then the UI, then the tests.

The legacy-CSS checks in the same run fail when upstream's pages use a colour variable
that the generated `css/default.css` does not define.

## 6. Build every target

```sh
./scripts/build.sh all
```

Then try the result by hand in at least one browser (see [building.md](building.md)):
the popup on a normal site, each filtering level, the dashboard panes, and the element
picker. With Chrome installed you can also run
`node platforms/chromium/smoke-test.mjs --dir build/package/chromium`.

## 7. Update the line numbers in the specs (when needed)

The specs cite upstream as `file:line` at the old commit
(`docs/specs/README.md` names it). After a bump, citations into changed files can drift.
Update the commit named in `docs/specs/README.md`, and fix the citations in the specs
whose upstream files changed; for an unchanged file the old citations stay valid.

## 8. Commit

```sh
git add upstream
git commit -m "Update uBlock Origin Lite to <version> (<commit>)"
```

Add a line to [CHANGELOG.md](../CHANGELOG.md) with the new upstream commit, and mention
the upstream changes users will notice.

## If the update goes wrong

Before you commit the bump, this goes back to the commit the repository records:

```sh
git submodule update --init upstream
```

(After a commit, `git revert` it, then run the same command.) Rebuild with
`BLOCKER_UPSTREAM_FORCE=1` afterwards.

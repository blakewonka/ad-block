# Security policy

## Supported versions

Blocker has no release branches. Security fixes go to the default branch and the next
release. Please check that a problem still exists on the latest commit before you report
it.

## What is in scope

- Blocker's own pages: the toolbar popup, the dashboard (Settings, Filter lists, About),
  the Safari app window and the iOS app screen (`ui/`, `platforms/safari/ios-container/`).
- The build and packaging scripts (`scripts/`, `platforms/`), including the safety gate
  (`scripts/verify-stage.mjs`): for example a way to get a modified upstream file, a
  remote script or an inline script past it.
- Anything in this repository that could leak a contributor's or user's data, such as
  signing identities.

## What is not in scope here

- The blocking engine, background code, content scripts and rulesets. They are the
  unmodified uBlock Origin Lite code. Report those to the upstream project
  ([uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home)), privately if the issue
  is sensitive.
- Filter lists, which belong to their maintainers.
- Builds that someone else modified or published under another name.

## How to report

Please **do not open a public issue** for a vulnerability.

Use GitHub's private vulnerability reporting: open this repository's **Security** tab
and click **Report a vulnerability**. (Maintainers: turn it on under Settings → Code
security → Private vulnerability reporting.)

Please include:

- what an attacker can do, and under which conditions;
- the browser and version, the Blocker build (the package version from the package file
  name or the About pane, and the release tag if you downloaded it; see
  [Versions](docs/building.md#versions)) and the upstream commit
  (`git submodule status upstream`);
- steps to reproduce, or a proof of concept.

We aim to acknowledge a report within a week and to agree on a disclosure date with you.
Blocker is maintained by volunteers, so please allow time for a fix. We are happy to
credit you in the changelog unless you prefer otherwise.

## Design notes for reviewers

- The extension pages run under the Manifest V3 policy `script-src 'self'`. The build
  rejects inline scripts, inline event handlers, `eval`, `new Function` and remote script
  or font URLs in Blocker's pages.
- The pages make no network requests of their own; everything ships in the package.
- Every file outside Blocker's pages must be byte-identical to the upstream build, which
  the safety gate checks on every build. See [docs/architecture.md](docs/architecture.md#the-safety-gate).
- npm dependencies are pinned to exact versions, installed with `npm ci`, and their
  install scripts are disabled (`ui/.npmrc`).

## Known npm audit findings

`npm --prefix ui ci` reports **2 vulnerabilities (1 moderate, 1 high)**. Both are `lodash`
up to 4.17.23 (GHSA-r5fr-rjxr-66jc in `_.template`, GHSA-f23m-r3pf-42rh and
GHSA-xxjr-mmjv-4gpg in `_.unset` / `_.omit`), pulled in by `@openai/apps-sdk-ui`; npm
reports no fix. They do not reach the extension: only that library's `Slider` component
imports `lodash` (`lodash/clamp`, `lodash/round`), Blocker does not use `Slider`, and the
built pages contain no `lodash` code. The separate `lodash.debounce` package that is shipped
is not affected. Re-check with `npm --prefix ui audit` when you update dependencies.

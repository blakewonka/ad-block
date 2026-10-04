# Screenshots

Blocker's pages, rendered in headless Chrome from the mock harness
([../mock-harness.md](../mock-harness.md)) with test data (`www.example.com`,
`.mock-ad-*`), mostly at 2x pixel density (the Custom filters one is 1x). The
same pages ship to every browser; browser and window chrome are not shown.
Version numbers and rule counts come from the harness fixtures (for example the
About pane shows the fixture version `2026.1003.1243`), not from a release.

| File | Page |
|---|---|
| `popup-light.png`, `popup-dark.png` | toolbar popup |
| `popup-rtl-arabic-light.png` | toolbar popup in Arabic (right-to-left) |
| `dashboard-settings-light.png`, `dashboard-settings-dark.png` | dashboard, Settings |
| `dashboard-filter-lists-light.png`, `dashboard-filter-lists-dark.png` | dashboard, Filter lists |
| `dashboard-custom-filters-light.png` | dashboard, Custom filters (upstream page, re-coloured) |
| `dashboard-develop-light.png` | dashboard, Develop (upstream page, re-coloured; shown when developer mode is on) |
| `dashboard-about-light.png`, `dashboard-about-dark.png` | dashboard, About |
| `macos-app-light.png`, `macos-app-dark.png` | window of the macOS container app |
| `phone-popup-light.png` | toolbar popup on a touch screen (390 x 844, as Safari on iPhone and Firefox for Android show it: a full-width sheet) |
| `phone-dashboard-filter-lists.png` | dashboard, Filter lists on a touch screen (rule counts shown under each name) |

`npm --prefix ui run e2e` writes fresh screenshots to `build/screenshots/`.

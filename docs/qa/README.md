# Synthetic visual verification

These screenshots use **isolated synthetic records**, not production data. They compare the preserved original frontend with the crew upgrade against the same local Worker. The illustrated total is fixture data and must not be presented as the live total.

| Viewport                    | Before                                   | After                               |
| --------------------------- | ---------------------------------------- | ----------------------------------- |
| Desktop, 1440 × 1050        | [Original dashboard](before-desktop.png) | [Crew dashboard](after-desktop.png) |
| Mobile emulation, 390 × 844 | [Original dashboard](before-mobile.png)  | [Crew dashboard](after-mobile.png)  |

Chromium, Firefox and WebKit have rendered the built candidate with the repository base path. Physical devices have not been tested. Live baseline screenshots and raw operational evidence are kept privately outside Git.

The final comparison uses the same synthetic state in both versions: 68 total, 40 parent entries and 47 allocations. All four screenshots were visually inspected; no horizontal overflow was observed. The mobile headline includes its corrected spacing.

Saved occasion and recap exports were exercised in Chromium: both produced valid 1200×630 PNGs (62,992 and 65,476 bytes). Copy-link output matched the respective saved hash routes, names were unchecked by default, and no share operation occurred automatically. These read-only/export checks left every synthetic count and revision unchanged.

The repeatable six-case Worker/D1 run is recorded in [browser-report.json](browser-report.json). WebKit screenshot-helper CSP diagnostics are counted separately from application errors; CSP was not weakened.

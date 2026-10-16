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

## Apple design review — October 13, 2026

Reviewed the dashboard, community routes, recording dialogs, member search, sharing, and feedback against the `apple-design` skill. The implementation keeps the existing amber/cream identity and collective ledger behavior.

| Finding                                                              | Implemented change                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Dense header, repetitive brand copy, and weak navigation persistence | Compact linked wordmark, bounded reading width, sticky translucent navigation with a clear current location               |
| Small functional text and crowded mobile layouts                     | Platform typography, larger labels and body text, consistent 44px controls, narrow-screen navigation and wrapping         |
| Totals could outgrow their card                                      | Container-relative number sizing, including 1,000,000 at 320px                                                            |
| Incomplete immediate feedback and accessibility preferences          | Press feedback, visible pending states, reduced motion/transparency and increased contrast treatments                     |
| Skip link changed routes; dialogs and async pages lost focus         | Route-preserving skip navigation, inert modal background, retained login/editor return target, async detail heading focus |
| Chart lacked readable scale and individual values                    | Date/scale labels, descriptive chart semantics, expandable keyboard-accessible daily totals, empty state                  |
| Search and failed loading left people without a clear next step      | Stale-result protection, scoped Escape, focus after selection, local retry and result announcements                       |
| Correction confirmation and sharing feedback were inconsistent       | In-dialog correction review, inline validation, pending/completion/error states, focused copy-link fallback               |

Final synthetic screenshots: [desktop](apple-design/desktop.png), [mobile](apple-design/mobile.png), [mobile login](apple-design/login-mobile.png). The illustrated total of 68 is fixture data, not a live count.

Verification: 101 frontend tests; web typecheck/production build; repository lint and formatting; and all six Chromium/Firefox/WebKit desktop/mobile cases in the [isolated Worker/D1 browser report](apple-design/browser-report.json). The suite now also verifies skip-link route preservation and keyboard focus after login → editor → close. Additional Chromium checks covered 320, 390, 768 and 1440px widths, a synthetic 1,000,000 total, reduced motion, reduced transparency, and increased contrast. No horizontal page or navigation overflow was observed. Physical devices were not tested. Deployment status is tracked by the GitHub Pages workflow and the live `release.json`.

## October 16 full release

All examples below are synthetic fixtures, not live totals or audience claims.

- [Three-format share card baseline](next-release/card-baseline.png) reproduces clipping; [landscape](next-release/card-landscape.png), [square](next-release/card-square.png) and [story](next-release/card-story.png) use bounded regions and visible truncation. Maximum text, Unicode/emoji and 25 names were visually inspected.
- [Recovered memory](next-release/recovered-memory.png) shows saved text after deliberate reauthentication/save; [mobile recap](next-release/recap-mobile.png) shows period navigation and the public archive controls.
- [Full browser report](next-release/full-browser-report.json): six passing Chromium/Firefox/WebKit desktop/mobile emulation cases against isolated Worker/D1. Covers contextual recording, actual member creation after 401, saved groups, default reset, metadata expiry, correction refresh, 55-record CSV/JSON export, cancellation, history navigation, three-format matching preview/export pixels and installation base paths. Chromium includes 320px checks. Full-page captures scroll to the top before capture to avoid sticky-nav capture artifacts.
- Early expanded harness runs identified Firefox/WebKit navigation-cancel diagnostics; final results count those separately from application or unexpected network errors. Deliberate response loss/session expiry and WebKit screenshot-helper diagnostics are also explicit in the report. No failed engine is counted as passing.

Source/unit checks additionally cover privacy redaction first discovered through reconciliation, metadata conflicts, stale pagination, export revision changes, Unicode/formula-safe CSV and in-flight image invalidation on data change/unmount. Native share behavior uses test doubles; no physical-device or real OS share-sheet testing is claimed. See [release checkpoint](../next-release-plan.md) for the completed Worker/Pages release and data-preservation evidence. The [full live read-only report](next-release/live-full-read-only-report.json) records six passing browser cases on runtime `8f1245f`; this public verification used no editor session, production writes or live screenshots. Live JSON/CSV checks covered one complete selected day containing one record; the isolated suite and private rehearsal cover multiple batches.

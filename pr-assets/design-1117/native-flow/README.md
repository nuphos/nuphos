# Bot Tasks native flow study

Design review material for #2983, not a production patch or implementation approval.

The screenshots use actual SwiftUI components with offline fictional data. “Before” is main at `4c7e2cba6bbda31563490a0d93f48ef4f7432d59`; “after” is the same checkout with the isolated prototype and the `-design-bot-tasks` launch argument. No live workspace data was used. The images were placed in Paper as native screenshot frames with editable flow annotations, then exported to sRGB. They are not claims that the SwiftUI UI was recreated as editable Paper component layers.

## Artboards

- iPhone — Before and own Task
- iPhone — Child Task and return
- Duo compact — Before and own Task
- Duo compact — Child Task and return
- Wide control (iPad) — Before and own Task
- Wide control (iPad) — Child Task and return

The last two boards are an iPad mini control for the native wide-navigation pattern. **They are not expanded Duo screenshots.** Black outlines in some iPad screenshots are the system's keyboard-focus indication, not a new row decoration.

Paper page: https://app.paper.design/file/01M7CPBMJNTG3M66PDH9V3EXNG/p-3-1

`flow-and-pattern-audit.md` contains the current Desktop/mobile routes, the existing patterns, the prior draft's failures, the proposed transition contract and explicit remaining gaps.

## Reproduce the local prototype

In an isolated checkout of the fixed main commit:

1. Apply `prototype.patch`.
2. Copy `DesignBotTasksUITests.swift` to `apps/ios/UITests/`.
3. Copy `design-bot-tasks.json` to `apps/ios/tests/fixtures/`.
4. Run `DesignBotTasksUITests` with Xcode's iOS UI test target. The test launches the app with its offline fixture; no production login is needed. `TEST_RUNNER_NUPHOS_SHOTS` can name a screenshot output directory.

This source is supplied only to reproduce the study. The fixture covers one accessible Bot, its own Task and two direct children. Production access, pagination, deep-tree folding and unavailable states are not implemented by this prototype.

## Verification

Both current-route and proposed-route UI tests passed on iPhone 18 Pro / iOS 27.0, compact iPhone Duo / iOS 27.1, and iPad mini / iOS 27.0. Proposed-route checks cover own Task → Back, reopen → child Task → Back, reopen → Done/cancel, and return to the list where compact. No physical device was used.

Paper exports were visually inspected and compared with headless Chrome rendering of the same screenshot-board source. `verification.json` records the mean absolute RGB differences (0–255): complete boards 0.3544–1.3259; individual native screenshot regions at most 0.1814. This checks export fidelity only. Two initial exports contained not-yet-loaded images; they were re-exported and rechecked before publication.

Actual Duo expanded layout and folding continuity are still required before another approval request. Also not covered: keyboard/draft retention, long titles, larger text, real permission failures, complete paginated lists, and a runtime Desktop open beside the Task. No Android UI is captured in this study.

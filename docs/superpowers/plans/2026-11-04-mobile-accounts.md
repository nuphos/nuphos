# Mobile Accounts Implementation Plan

**Goal:** Implement #1525 on iOS and Android with retained sessions and one active identity.
**Architecture:** Atomic secure account registries; authentication generations gate asynchronous state changes. Existing identity reset mechanisms rebuild signed-in navigation.
**Tech Stack:** Swift/SwiftUI/Keychain; Kotlin/Compose/EncryptedSharedPreferences.

Execution is inline in the current isolated worktree; the design has been approved.

- [x] Add registry behavior tests for retaining two accounts, scoped removal, active selection, migration, persistence failure and origin separation.
- [x] Implement iOS secure registry and migration; use the registry's active token for notification replies.
- [x] Integrate iOS add/cancel/select/remove with generation checks on restore/login/consent/profile, fresh root identity and ordered push handoff.
- [x] Add iOS Account and login selection controls; test delayed responses and canceled additions.
- [x] Implement equivalent Android registry and migration using encrypted persistence with synchronous checked commits.
- [x] Integrate Android identity transitions, cleanup barriers and account controls; test registry behavior and compile affected screens.
- [ ] Run iOS test runner and simulator compilation, Android JVM tests/lint/compilation sequentially. Review isolation and failure paths before publishing.
- [ ] Update #1525, publish signed commits and ready PR under the repository-mandated identity, request the designated reviewer, resolve findings and check CI.

## Validation recorded

- Full iOS test runner passed, including account registry, delayed auth/consent/profile replies, push cleanup barrier, draft and observation isolation, and token-origin collision rejection.
- iOS simulator build passed.
- Android: 559 JVM tests passed; lint, debug APK and instrumentation APK compilation passed.
- Backend: 35 notification tests passed; syntax/style lint on changed files passed with existing warnings. Full type-aware lint and full TypeScript checking exceeded the local 1536 MiB heap budget and remain for CI.
- Five offline login UI tests passed, including adding/canceling an account and resetting the login form. Synthetic screenshots and recordings verify account/team selection in the simulator. Production authentication and APNs delivery remain outside this fixture validation.
- Independent static review found no remaining P1/P2 issues after fixes.
- The iOS/backend changes are being published separately. Android changes remain local for a follow-up; CI and formal PR review are pending.

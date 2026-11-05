# Mobile account switching

Tracks #1525. Applies to iOS and Android; includes an additive APNs recipient field for notification isolation.

## Behavior

Account shows saved accounts with an active indicator, Add account, and per-account Sign out. The existing Workspace picker remains scoped to the active account. Adding an account retains existing sessions; cancel returns to the prior account. The login screen also lists saved accounts so signing out of one does not hide the others.

Only one account is active. Switching clears authenticated navigation immediately, validates the selected session, loads its consent, and builds fresh workspace/conversation stores. Relaunch restores the last selected valid account. A network failure keeps the saved session and offers retry; a 401 marks only that account as requiring sign-in. Never silently activate another account after a failed switch.

## Alternatives

1. Save several sessions and activate one (selected): meets the requirement while reusing existing single-active-session stores.
2. Run concurrent authenticated stores: adds background lifecycle, notification, and resource costs without a requested benefit.
3. Offer sign-out/sign-in shortcuts: does not preserve sessions and fails the core acceptance criterion.

## Storage

Use a registry keyed by canonical backend origin plus server-verified user ID. Obtain identity from currentUser, never from an email form or unverified token. Keep session tokens in iOS Keychain and Android encrypted storage. The registry stores display metadata, active identity and credential references. A storage failure must not fall back to plaintext for new credentials.

Migrate the existing session-token only after currentUser validates it and the new account record is durably saved. Keep the legacy credential recoverable if migration fails. Remove obsolete entries only after successful persistence. Profile refresh updates the saved display metadata.

## Lifecycle and isolation

Add an identity generation to the iOS AuthSession; use the existing Android generation. Every async authentication, consent and profile operation checks its captured generation before mutating state. Recreate signed-in views using account identity and generation, including when the same user signs in again.

Before transition: revoke AI access, invalidate old generation, cancel login and outgoing UI work, clear launch caches, drafts, pending account-scoped navigation, runtime selections and workspace state. Await existing shared-draft cleanup barriers. Switching must not call the server logout endpoint: retained sessions stay usable.

APNs alerts gain `accountId`, matching the existing Android field. iOS checks it before presenting, opening or replying; unscoped legacy alerts are not actionable when multiple accounts are saved.

Push registration must be transferred with explicit old/new token ownership and serialized cleanup, so an old unregister cannot remove a newly registered account. Late responses and notification targets cannot select or expose another account's private conversation.

Sign out removes and revokes only the chosen account. Inactive-account logout must not reset the active UI. Active logout lands on account selection/sign-in. Deleting an account removes its saved credential too. Failed secure writes leave the previous active session intact.

## Platform integration

- iOS: extend AuthSession and Keychain-backed account persistence; add account selection to ProfileSheet and LoginView; key RootView and push activation by identity generation rather than the signed-in Boolean alone.
- Android: extend TokenStore with encrypted account persistence and AuthSession with add/switch/remove transitions; integrate ProfileSheet and LoginScreen; reuse beginIdentity and its cleanup barrier. Key signed-in navigation by generation, not only token/store recreation.
- Keep existing provider and email login flows. Account addition must support both and cancel without signing out the previous account.

## Verification

Add deterministic storage and session lifecycle tests: migration success/failure, two accounts, duplicate account replacement, canceled addition, active/inactive sign-out, revoked/expired session, transient network failure, last-active restoration, and secure-storage errors. Use suspended requests to prove stale profile/consent/login results cannot mutate the active account. Cover same-user new sessions and backend origin separation.

Run existing iOS test scripts and a simulator build, Android JVM tests/lint/build sequentially. Verify Account and login flows with synthetic data, including large text, light/dark themes and push transition ordering. Do not use real account tokens in fixtures.

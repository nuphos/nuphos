# System sharing through the existing conversation flow

The Share Extension receives text, HTTP(S) URLs, images and files and supplies them to `NewChatComposer`, `ComposerControls` and `ChatComposerBar`. Explicit Send creates the normal `ChatSession` and opens `ConversationView`; uploads, image fitting, request construction, streaming and error/retry handling use the containing app's existing implementations. There is no synthetic authentication, Runtime selector or accepted-Send path.

## Authentication boundary

Both targets declare `$(AppIdentifierPrefix)ai.nuphos.ios.shared-auth` in their Keychain access groups and expose that non-secret group identifier through Info.plist. The main app keeps its existing private token item and, only after server verification, publishes an authenticated shared Keychain record. The record contains the token, verified account, backend origin, login/lease identifiers and selected workspace/Runtime/credential/permission context. Nothing is stored in App Group files or UserDefaults as a credential.

The extension verifies the shared token with the same backend, checks account identity, AI consent and workspace membership, and loads only the selected workspace's Runtime/credential configuration. It does not fall back to the first workspace. A captured lease is rechecked before session creation, upload completion and each chat request. Logout revokes the record; account/workspace/configuration changes rotate its lease. Conditional Keychain updates cannot recreate a deleted session. Retry cannot rebind the captured payload to another lease.

## File lifecycle

Each invocation owns a separate protected temporary directory. Incoming files and the original composer's file/photo/paste copies use that directory. Cancel cancels an outstanding upload and deletes owned copies. Old abandoned operation directories are reclaimed on a later invocation after ten minutes only if their cross-process operation lock can be acquired. This is temporary transfer cleanup, not a retention or recovery feature. There is no inbox, draft library, persistence across restart, Review or Save page.

## Verification and signing

The Simulator build uses the existing developer-team prefix to exercise the shared entitlement. Inspect `*-Simulated.xcent` for simulated entitlements; an ad-hoc Simulator signature is not device or distribution provisioning evidence. For device/distribution builds, the main `ai.nuphos.ios` and extension `ai.nuphos.ios.share` App IDs and matching profiles must permit the shared Keychain group. Do not assume profiles exist or run automatic provisioning updates without authorization.

For synthetic end-to-end testing without loading existing conversations, launch the DEBUG Simulator main app with `-share-verification`. It uses the real login/consent/workspace/Runtime/composer flows but does not fetch conversation history or favorites. The person signs in and explicitly selects the test workspace and Runtime. Do not send until that test scope is confirmed. Only new conversations containing synthetic text/files are in scope; no existing private chats or command execution is required.

The PR remains draft until real authentication, delivery, response, failure and duplicate-admission verification has been recorded. No merge, release, physical-device authorization or developer-account mutation is implied by this implementation.

### Additional isolated integration checks

`bash tests/run-share-keychain-integration.sh` exercises the production Keychain read/login/context-update/revoke methods against a UUID-namespaced macOS Keychain service containing synthetic values only. A test-only compilation condition substitutes that service (without the application's access group) and inserts a barrier immediately before the real conditional `SecItemUpdate`. Separate writer processes verify that a stale read cannot overwrite relogin, recreate a revoked record, or undo a concurrent context update. The test service is removed afterwards. This is real Security.framework storage coverage; it does not establish iOS two-target access-group provisioning.

The same command tests the production `SubmissionAdmission.prepare` boundary with a held, cancellation-insensitive upload and real synthetic Keychain lease changes. Scope change, logout and cancellation prevent the transport spy from being called; unchanged context admits once. Synthetic attachment cleanup in this harness verifies its test operation lifetime, not the full Extension provider/controller cleanup path. That device-level cancellation case remains part of end-to-end validation.

# Nuphos Android

Native Android client built with Kotlin and Jetpack Compose. This contribution
contains the app, Gradle wrapper, JVM tests, and isolated device fixture tests.
It does not contain credentials, APK files, IDE settings, or personal test data.


### Password sign-in

The welcome screen also supports existing accounts with an email and a password
(12–128 characters), using the same `/auth/password/sign-in` endpoint as iOS.
Google sign-in remains available. Passwords are not saved; only a validated
session token is passed to the existing token store. This option does not create
accounts or set/reset passwords. Store review credentials belong in Play Console,
never in the repository.


## Requirements

- Android Studio or Android SDK command-line tools.
- JDK 21 to start Gradle. Gradle uses a JDK 17 Kotlin toolchain.
- Android SDK platform 37 and platform-tools. Accept the SDK licenses first.
- Android 14 (API 34) or later on a device or emulator.
- Python 3.10 or later for the optional live-test runner.

Set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to the Android SDK directory.
Alternatively, set `sdk.dir` in an untracked `local.properties` file.
Open this directory in Android Studio, or run:

```sh
cd apps/android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
adb -s DEVICE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
```

The Gradle toolchain resolver can download JDK 17. Gradle downloads build tools
once the SDK licenses are accepted. The debug APK is for development and uses a
local debug signing key. It is not a signed store release. An installed APK must
use the same signing key to update without removing app data.

For repeat device builds, keep an existing development key in a stable local
`ANDROID_USER_HOME` and set that directory explicitly for every build. Verify
that the key exists and that its certificate matches the installed APK before
building or updating. Stop if it is missing or different; do not generate a
replacement key, replace a global keystore, uninstall the app, or clear its data
to bypass a signing mismatch. Keep private keys outside Git and public artifacts.
Play app signing and CI upload keys remain separate from this development key.

## Service support

The current app connects to `api.nuphos.ai`. Sign-in opens `nuphos.ai` in a
browser and returns to the app. A Nuphos Cloud account is required. This version
does not expose a custom API endpoint or native email sign-in. Desktop and iOS
support self-hosted endpoints; Android support remains separate future work.

The app supports conversations, shared history, attachment transfers, runtime
controls, permissions, Plans, Connectors, account settings, read-only Monitoring,
and read-only stored Trigger runs. Availability depends on team permissions,
connected providers, and backend capabilities. Android notifications are local;
remote push requires a separate backend and transport integration.

No backend or iOS changes are needed for this contribution. The public backend
contains the API contracts used by the app. Managed cloud operations remain
service-dependent and are not added to the self-hosted backend by this client.

### Composer drafts and Agent usage

Text drafts persist in app-private storage, separately for each account, workspace,
existing conversation, and the new-conversation composer. Sending clears only the
submitted draft; sign-out, identity replacement and consent withdrawal remove
that account's drafts. Attachments remain temporary and are not restored after
leaving the composer or restarting the process. Draft preferences are explicitly excluded from cloud backup, device-to-device
transfer, and legacy full backup by the XML backup rules.

The Agent chip remains visible beside Send. New conversations open the Agent
picker; existing conversations show their assigned Agent and open its usage details
and a Switch agent list. Owners and managers can switch idle conversations; only
owners can select local or self-hosted agents. Moving to a personal computer
requires confirmation. Signed-out, disabled, and deleting agents cannot be chosen.
Same-provider Cloud moves try to preserve the workspace, falling back to history
only for `workspace_unavailable`; cross-provider and local moves use history.
Drafts and history remain in the same conversation. Failed moves keep the current
agent until a server refresh confirms its placement.
Usage uses the shared `GET /teams/:id/agent-runtimes/quota` snapshot, refreshed every
minute only while the screen is resumed. Missing or failed quota reads show
`Usage unavailable` and never prevent sending.

## Tests

### Unlinking an existing child chat

The history list offers **Unlink** only for a loaded child whose API metadata
reports `isOwner == true` and `readOnly != true`, in the selected workspace.
Android asks for confirmation (iOS currently runs its context-menu action directly).
Cancel sends no request. Confirm uses the existing owner-scoped
`DELETE /agent/conversations/:id/parent?teamId=...` contract; it never deletes
a chat or changes sharing permissions. Pending requests cannot repeat. Errors
keep the original tree and allow retry. Confirmed success removes only the
child's parent, preserving descendants, loaded pages, pins and drafts; all list
sections and thread counts recompute together. Reads started before success are
discarded, as are mutation results after workspace/account capability changes.

`ConversationUnlinkTest` checks the HTTP contract and acknowledgement handling.
`ConversationUnlinkFixtureDeviceTest` uses intercepted synthetic transport for
confirmation/cancel, successful root promotion, denied/malformed responses,
owner/read-only/root/workspace restrictions, duplicate submission, late results
and account invalidation. It restores preferences and in-memory auth state.
It does not exercise a successful mutation against a real account.

### Conversation App Links

The app accepts `https://nuphos.ai/teams/{teamId}/agent/{conversationId}` with
an optional single trailing slash. Team IDs must be 24 hexadecimal characters;
conversation IDs contain 1–128 ASCII letters, digits, `_` or `-`, starting with a
letter or digit. Queries, fragments, explicit ports, encoded paths and other
hosts are rejected. OAuth and connector custom-scheme callbacks stay separate.

A link supplies only a destination. The app retains it through login and Activity
recreation, checks current-account membership and conversation access, then
switches to the authorized workspace. It never submits a message or approves a
computer permission from a link. Invalid links are ignored. Inaccessible destinations show
a generic unavailable/access-denied state without displaying another account's data.

The website verification endpoint is maintained by `zeabur/nuphos-landingpage`.
Its approved certificate list must match the actual installed APK signer; the
Play app-signing certificate is distinct from the upload certificate. An empty
`assetlinks.json` document trusts no signer and cannot verify the domain.

`ConversationLinksFixtureDeviceTest` uses synthetic, intercepted HTTP responses
and requires a disposable emulator with no installed account. It refuses physical
devices and is disabled unless explicitly opted in:

```sh
adb -s EMULATOR_SERIAL shell am instrument -w \
  -e isolatedConversationLinks true \
  -e class ai.nuphos.android.ConversationLinksFixtureDeviceTest \
  ai.nuphos.android.test/androidx.test.runner.AndroidJUnitRunner
```

These tests verify intent handling, screens and navigation. Explicit Activity
launches do not prove automatic OS domain verification. Final acceptance still
requires the hosted signer statement, `pm get-app-links` reporting `verified`,
and real link taps in Chrome and a messaging app. Keep signed-out and app-absent
acceptance on a disposable emulator; never log out, uninstall or clear data on
a personal phone for these tests.

JVM tests use synthetic inputs and intercepted HTTP responses. They do not need
an account or a live server. CI runs Python runner tests and JVM tests, checks
Android lint, and builds both APKs. CI does not execute device instrumentation
or live-account acceptance tests.

Device fixture tests use synthetic data and request interceptors. Run them on a
clean emulator or a dedicated test device; instrumentation can replace app
state. Do not run the full fixture suite on a signed-in personal phone.

```sh
./gradlew :app:connectedDebugAndroidTest
```

Live tests tied to private accounts, device serials, team IDs, screenshots, and
provisioning scripts are excluded from this contribution. Installed-state
account and Trigger lifecycle fixtures now create synthetic tokens after HTTP
interception and restore the original state afterward. They need no real login.
Earlier private-device results do not prove that this public checkout passed
every live operation.
Do not place tokens, signing keys, test-account data, or screenshots in Git.

## Configured live tests

Use a dedicated account and test team. Existing-session mode preserves the
installed token and selected workspace, including on a personal phone. Password
mode is for a dedicated device with an empty token store; it refuses to replace
an existing session. Both modes verify the expected account, team membership and
current AI consent. Accept consent interactively before testing; the harness
does not accept it for you.

Copy `.env.e2e.example` to the ignored `.env.e2e.local` and replace the device,
expected email and team placeholders. Open the app once and install the debug
test APK with a matching signing key. The runner does not build, install,
uninstall, clear data or switch accounts on your device.

```sh
python3 scripts/e2e_runner.py --validate
adb -s DEVICE_SERIAL install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
python3 scripts/e2e_runner.py
```

The live smoke test reads identity, membership, consent and the first page of
the configured team's own conversation history. Missing configuration, an
expired session or an unexpected identity fails explicitly. Default device
fixture runs report this live test as skipped. Password mode adds one real
`/auth/password/sign-in` request; the remaining calls are GET requests.

For a clean dedicated device, set `NUPHOS_E2E_LOGIN_MODE=password` and
`NUPHOS_E2E_ALLOW_LOGIN=true`. Supply `NUPHOS_E2E_PASSWORD` through a secret
environment variable or a local config file with mode `0600`. The account must
already have a password and current consent. The runner sends config through
stdin to a uniquely named app-private file. The test and runner remove that
file; credentials are never adb/Gradle arguments or report contents. A successful
password bootstrap leaves the verified session on that dedicated device.

This API bootstrap checks post-login behavior. It does not verify the browser
sign-in UI or callback. Verify browser login, cancellation, restart restore and
sign-out separately on a dedicated test device. Keep live credentials out of
public PR CI; live tests require explicit opt-in. Do not automatically log in a
personal phone or run data-changing tests against a personal account.

For signed AAB artifact CI, version inputs and administrator prerequisites, see
[Android release artifacts](RELEASE.md).

### Android push development

Place your Firebase Android client configuration at `app/google-services.json` (ignored by Git).
The package must be `ai.nuphos.android`. Without this file contributor and fixture builds remain
available with push disabled. Only Firebase Messaging is included; Analytics is not enabled.

Backend: set `FCM_PROJECT_ID` to the matching Firebase project and provide Application Default
Credentials using `GOOGLE_APPLICATION_CREDENTIALS` when running outside the default ADC location.
Never put sender credentials in this app. FCM uses data messages so the client can reject stale
account bindings before display. Notifications require permission, an enabled channel, and a
registered signed-in account that accepted AI consent. Only the conversation actively being read suppresses system notifications; other conversations
can notify while the app is in the foreground. Sign-out clears local binding and attempts server unregister; notifications carry
account/team/session IDs and still use guarded interactive conversation navigation on tap. Consent revocation
synchronously clears the persisted push opt-in before any later background display.

After sign-in and AI consent, the app asks once for notification permission. A denied permission
can be changed in Android's app notification settings; the app does not repeatedly prompt.

For local push acceptance, a debug build can use
`-PnuphosDebugPushBaseUrl=http://127.0.0.1:18767` with `adb reverse tcp:18767 tcp:18767`.
Only the exact registration/unregistration routes can carry credentials to that loopback port;
all other APIs retain the production endpoint. Release builds always use the production push
endpoint. The local test service must verify the signed-in account and keep tokens out of logs.
This tests the push transport independently; it does not make the entire app use a local backend.

For the full isolated backend path, debug builds accept
`-PnuphosDebugApiBaseUrl=http://127.0.0.1:18768` and `adb reverse tcp:18768 tcp:18768`.
The push endpoint defaults to this API origin. Release builds cannot use this override.
Use a clean dedicated test installation and a local fixture account; do not restore a cloud
login into this build. The browser sign-in page still targets Nuphos Cloud, so local acceptance
must bootstrap a local account through the isolated backend's authentication APIs.
`LocalPushBootstrapDeviceTest` is disabled unless `localPushBootstrap=true`, requires a loopback
debug build and an `@example.test` account, verifies `/auth/me`, and refuses a different saved
login. Its input is the app-private `files/local-fcm-bootstrap.json`; transfer it through stdin,
never through adb arguments. The test deletes the input file and retains the verified fixture
login. Accept AI sharing interactively before issuing real Agent requests.

Verify on a physical device: allow notification permission, sign in and accept consent, background
the app, complete an agent turn or request an approval, check phone receipt and tap routing. Also
check denied permissions, process recreation, token refresh and account switching. A successful
FCM send response does not prove phone delivery; force-stopped apps require a subsequent manual
launch before Android permits delivery again.

Android receives the shared unread conversation count with alerts and debounced, account-bound
badge-only FCM updates after reads. Existing notifications update without another sound; zero
clears conversation notifications. Launcher dots/counts depend on the launcher and require an
active notification; Android does not offer APNs-style independent numeric app badges.
`PushParityDeviceTest` is opt-in (`localPushParity=true`) and requires the loopback debug build
and its existing fixture binding. It checks same-conversation suppression, other-conversation
foreground display, badge updates, zero-count clearing and rejection of another account's update.

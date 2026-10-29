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
that account's drafts. Picker and clipboard attachments remain temporary and are not restored after
leaving the composer or restarting the process. Shared attachment drafts follow
the Sharesheet lifecycle described below. Draft preferences are explicitly excluded from cloud backup, device-to-device
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

### Sent attachments

User uploads render as attachment cards in existing conversation history, including
legacy transfer instructions and structured `data-attachment` / `transfer-upload`
parts. This is a display projection; the original prompt and wire instructions
remain available to the agent. Cards refresh team-scoped download links, open
supported images in the existing zoomable pager, and save files through Android's
document picker. Expired or inaccessible groups retain file names with a retry
action. Storage downloads carry no account credentials, follow no redirects, stream
with size limits, and stop when access is revoked. Temporary previews are removed
when the card leaves the conversation.

`SentAttachmentsTest` covers transcript projection and wire preservation;
`TransferDownloadsTest` covers metadata identity/expiry checks and storage failures.
`SentAttachmentsFixtureDeviceTest` uses synthetic storage and an intercepted document
picker result, without touching a real account. Run it in a separate fixture package.

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

### Conversation model settings

The composer opens Model settings after choosing an Agent. New conversations read
that runtime's model-config catalog; choosing a model reloads its supported effort
and fast controls. The first chat POST carries only confirmed initialSessionConfig
alongside the existing credentialAccess and runtime binding. Resumed turns omit it.
Existing conversations read and PATCH their own team-scoped model-config. Only the
owner can change controls; runtime-advertised IDs and values define availability.
Busy or streaming sessions retain the latest choice per control and show pending
changes, with cancellation. Once idle, the model applies first and subsequent
choices are checked against the returned capabilities. A failed write retains the
choice for explicit retry or cancellation; offline and unsupported states disable
editing. Leaving the session invalidates its outstanding requests and pauses its
pending choices. Returning reads the server state before applying choices that
remain valid, skipping settings the server already confirmed. Changing
Agent/provider or withdrawing consent discards those choices. Workspace/account
changes cannot apply a previous screen's result. An already sent PATCH may still
complete on the server; the next visit reads the server's confirmed state.

`ModelSettingsStoreTest`, `ModelSettingsSessionTest` and `ModelSettingsApiTest` use
synthetic state/transport to cover legal combinations, ordering, streaming/busy,
retry/cancel, scope invalidation, Agent changes and initial wire data.
`ModelSettingsFixtureDeviceTest` renders standalone light-mode controls with
synthetic data, without reading auth/preferences or calling live endpoints.
It must run in an isolated fixture package on a personal device, never over the
installed Play application. These fixtures do not prove a real inference or
production runtime setting change.

### New conversation credential defaults

Each app launch and workspace switch starts a fresh in-memory credential draft.
The first successful catalog load selects usable providers and online computers;
Resend stays opt-in. The composer loads this catalog before the first send.
A failed load permits sending with the current selection, matching iOS, and a
later successful retry still supplies defaults. A successful empty catalog counts
as loaded. Subsequent refreshes only prune IDs no longer offered, preserving
manual deselection, explicit Resend opt-in, and selected computers that went
offline. Old `nuphos.credentialSelection.<teamId>` preferences are no longer read
or written. Existing conversations retain their server-provided credential access.

`CredentialDraftTest` covers defaults, all provider identifiers, refresh and failure
semantics, empty catalogs, request ordering, resets, and existing wire keys.

New drafts send explicit empty arrays for unselected connector kinds. This matters
because the backend treats omitted legacy connector keys as team-wide reach.
That wire mode is limited to fresh drafts; stored conversation parsing and its
original wire keys are unchanged. The new draft catalog includes the 30 provider
kinds supported by iOS, including the eight connector kinds absent from Android's
legacy catalog.

`CredentialDefaultsFixtureDeviceTest` requires the separate
`ai.nuphos.android.credentialfixture` installation. It intercepts every API read,
uses a separate preference file, restores consent state and callbacks, and checks
old preferences, new/stored sessions, exact catalog GETs, failed/empty catalogs,
and late results after team, account or consent invalidation. It never opens an
Activity or modifies a live integration. Default device runs skip this fixture.

### Chat list refresh fixture

Chat history supports the Material pull-to-refresh gesture on populated, empty,
search and failed states. A gesture refreshes the current history filters and
pinned shortcuts, keeps existing successful data on failure, and prevents
pagination until refresh finishes. It does not reset the composer or tree folds.
Returning to the list or resuming the app reloads history and pins with the current
filters. A pre-background read cannot replace this newer snapshot. Reads are
scoped to the resumed list; there is no background polling.

`HistoryRefreshTest` covers the refresh lifecycle on the JVM.
`PullRefreshFixtureDeviceTest` intercepts all network requests and exercises real
Compose swipe gestures, retries, filter retention, duplicate suppression and
late workspace responses, app resume, navigation return and pre-background
in-flight reads. It refuses any application ID that does not end in
`.refreshfixture` or `.listrefresh1319`. Build a separate local fixture variant with that application
ID suffix and run only this test class; do not install a debug build over the
Play application or clear its data. Keep `FLAG_SECURE` enabled.

### Conversation watching

On servers that return `watching`, readable conversations offer Watch/Unwatch in
history and the conversation menu, including shared read-only conversations.
Servers without that optional field hide the control. Unwatch also affects
nested threads: Android reloads server state rather than inferring descendants
from a partial history page. This preference does not grant notification
permission, accept AI consent, or bypass active-chat suppression.

`ConversationWatchFixtureDeviceTest` intercepts every HTTP request and uses
synthetic identities. It requires both `isolatedWatch=true` and a separately
built `ai.nuphos.android.watchfixture` installation; it refuses the production
package. Never replace, uninstall or clear a Play installation to run it.
Its API/UI/cascade checks and screenshots do not establish real subscription
changes or FCM delivery. JVM tests cover optional model decoding, scoped
PUT/DELETE confirmation, retry, shared-reader access and stale detail reads.

### Verified message attribution

Transcript sender labels come from versioned server metadata, never metadata-like
text in a message. Agent-token messages show the bot and its `via` identity.
Session/resource notifications use a compact, expandable event row; attachments
remain accessible inside the expansion through the same scoped attachment reader.
Unknown sources or inconsistent sender types remain ordinary messages. This only
changes presentation; original metadata and attachment instructions stay on the wire.

`MessageAttributionTest` covers source/type validation, token labels, quoted text,
and attachment/metadata round trips. `MessageAttributionFixtureDeviceTest` renders
synthetic light-theme event rows without signing in or making network requests.
Run that fixture in a separately suffixed debug package when a Play installation
is present; never replace or clear the signed store app for a fixture test.

## Adaptive layout fixtures

The home screen uses Material adaptive panes and the window size class, including
folding-feature exclusions. At medium width and above, history and detail share
the window; compact width shows the selected pane. Resizing retains one NavHost
and moves the existing new-chat composer without replacing its local state.

For physical-device synthetic tests, build with
`-PnuphosIsolatedAdaptiveFixture=true`. This debug-only option changes the
application ID to `ai.nuphos.android.adaptivefixture`; it never updates the store
app. Run `AdaptivePanesFixtureDeviceTest` for an in-flight load and draft across
pane collapse, and `ConversationLinksFixtureDeviceTest` with
`-e isolatedConversationLinks true` for the real HomeRoute lifecycle. The latter
refuses physical devices unless this isolated application ID is installed and
requires an empty token store. HTTP is intercepted before a synthetic identity
is created. `-e captureSynthetic true` writes synthetic UI captures to the
fixture application's external files directory. Window resizing is distinct
from a physical fold; record the device state and restore any test overrides.

### Chat list ordering

The chat filter menu offers Date created (the default, matching iOS) and Recent
activity. The selected order stays in the signed-in store across workspace,
search, scope, archive, refresh and navigation changes; a new account/store starts
with Date created. It is not saved to preferences, matching iOS. Both first-page
and cursor requests send the selected server order. Switching order invalidates
old reads, clears the old cursor and cancels a pending search debounce, while
retaining pins, tree folds and composer drafts. Duplicate rows across pages are
merged by session ID. Trigger runs and generic API readers keep activity order.

`ConversationSortTest` checks the query contract. The isolated
`PullRefreshFixtureDeviceTest` includes synthetic created/activity ordering,
menu selection, cursor reset, duplicate suppression, filtered refresh/navigation,
and held first-page/cursor response races across a sort change. Use its existing
isolated package restriction and optionally `-e refreshEvidence true` for captures.

### Native email sign-in fixture

Email codes create accounts only after verification. The optional password control
uses the same email code to set or reset a password. Existing Google and password
sign-in remain available. The backend owns code validity and rate limits; the UI
shows its 60-second resend cooldown and 10-minute expiry. Cancellation invalidates
local results; an already accepted reset cannot be undone by canceling the UI.
Only email and non-secret delivery progress survive saved-state restoration;
codes and passwords must be entered again. Nothing sends automatically on restore.

`AccountApiTest` covers unauthenticated wire contracts and invalid responses.
`EmailLoginFixtureDeviceTest` uses synthetic Compose content and an injected
transport/clock, without live sign-in or email delivery. Build using
`-PnuphosIsolatedEmailFixture=true` and run only that class on the separately
installed `ai.nuphos.android.emailfixture1335` package. Keep the Play app, its data,
keys and `FLAG_SECURE` unchanged. These tests do not establish real mail delivery
or server-side password/session revocation; those require a separately approved
isolated-account test plan.
`EmailSessionFixtureDeviceTest` intercepts every request while testing duplicate
submission, cancellation, token persistence and consent loading in the same isolated package.

### Composer rich content

The composer receives content-provider attachments through native paste, keyboard
rich content and drag/drop, using Compose's state-based text field. Plain text
continues through the text field; the receiver consumes only `content://` items.
No clipboard polling or clipboard listener is installed. Photos and Files remain
available, including videos through Files. Rich content uses the same bounded
retention, image conversion and submission pipeline as selected files. Source
permission payloads remain reachable until the app-owned copy is complete; no
persistable URI permission or broad storage permission is requested.

`ContentInputFixtureDeviceTest` requires the isolated
`ai.nuphos.android.contentinput1337` package.
Build it with `-PnuphosIsolatedContentFixture=true`. Its test-only provider serves
fixed synthetic PNG/TXT data. It covers native clipboard paste, mixed text/file queueing, IME `commitContent`, exact retained
bytes, invalid images, denied reads, empty files, count/size limits and cancellation
when switching drafts during delayed reads. `ContentDropFixtureDeviceTest` uses
a real Android drag gesture with synthetic content in the fixture window.
The IME fixture uses an already readable synthetic provider: it does not prove a third-party IME's
temporary permission grant or cross-app drag/drop. Verify those separately on
a dedicated device with a third-party source app.
Run existing composer draft, mention and voice fixtures after changing the text
field implementation. Never install the fixture over the Play package.

### Image sharing and saving

The full-screen message image pager offers Share image and Save image. Both use
original bytes, never the sampled display bitmap. Inline data images are decoded
locally; transfer images refresh their scoped group and use the existing
credential-free storage downloader. Unsupported remote inline URLs remain
unavailable; they are never sent to another app as a fallback.

Sharing uses a read-only FileProvider URI and Android's chooser. Only the
`image-exports` cache directory is exposed; copies expire after 24 hours and are
pruned on a later export, with at most 20 pending copies. Saving uses a pending
MediaStore Images entry under Pictures/Nuphos and deletes it on write failure.
No storage permission is requested. Existing transfer Save file remains available.

`ImageExportsFixtureDeviceTest` requires a separate application ID ending in
`.imageexport1336` (`-PnuphosIsolatedImageExportFixture=true`). It uses synthetic images to check original SHA-256, detected
MIME, MediaStore publication, URI grants, expiry and failed downloads. It deletes
its own saved images and never launches a share receiver or reads account data.

Enable only one `nuphosIsolated*` flag per build; configuration rejects multiple
true flags before selecting a suffix. Before installing a fixture, inspect the
built application and androidTest APK manifests and record their SHA-256, actual
package IDs, instrumentation runner, targetPackage and signing certificate in the
validation evidence. Expected image fixture values are
`ai.nuphos.android.imageexport1336`, its separate test package and
`androidx.test.runner.AndroidJUnitRunner`; build properties alone are not proof.

### Receive from the Android Sharesheet

Share text, URLs, images or files to Nuphos, choose a workspace and a new or
existing agent, then review the editable draft. Sharing never sends a message.
Existing text is preserved and shared text is appended. Binary inputs must be
content-provider URIs; at most 20 attachments, 100 MiB per file and 500 MiB total
are accepted, using the composer's existing image conversion and size limits.
Shared text and the resulting merged draft are limited to 100,000 characters.

Pending shares and imported drafts survive process death and normal app restart.
Payloads live in the app-private [no-backup directory](https://developer.android.com/identity/data/autobackup); metadata has an explicit
version, bounded parsing, validation and atomic replacement. Only our copies are
restored, never provider URIs or persisted read grants. JPEGs remain file-backed
and are streamed for upload. Only an explicit Send generates the existing inline
JPEG wire representation, one file at a time; it is never persisted in metadata. No credentials or tokens are written to this journal.
The old process-local directory is discarded once on upgrade because it had no
recoverable metadata; existing text drafts remain compatible.

Each saved record expires seven days after its last modification, checked at app
startup. Across all shared drafts and one pending share the limits are 64 draft
records, 128 retained payloads, 500 MiB of payload bytes and 1,000,000 text characters;
metadata is limited to 8 MiB. Expiry, permission loss and send cleanup also erase
older text preferences. An empty journal tombstone is kept if that erase fails,
and expiry cleanup retries the erase at a later startup before that tombstone
can be retired. Independent per-address authority markers survive journal loss;
only confirmed legacy-text erasure allows an orphan marker to be retired at startup.
Each marker contains an address and transaction epoch/revision, never text or payloads;
at most 256 markers of 2 KiB each are accepted. A prepared marker whose publication
never committed is distinguished by the prior journal revision, preserving ordinary drafts.
Malformed markers suppress legacy fallback without deleting unidentified preferences. Physical quota checks also count in-flight and
unreferenced copies, so repeated interrupted imports cannot grow storage without bound. Per-draft attachment limits still apply. Incomplete
copies and unreferenced payloads are pruned at the next process start. Invalid,
unknown-version, expired, missing or changed payload metadata fails closed. No
metadata-derived pathname is trusted; symlinks are not followed during cleanup.
If storage cannot publish a cancellation/identity deletion, the journal is
unlinked to prevent canceled content reappearing; other saved shared drafts may
then be discarded too. Import/edit failures retain the prior committed snapshot.

After restart a pending share requires explicit destination selection again and
fresh access checks. Already imported text and attachments are one transaction:
a crash before updating older text preferences cannot append the share twice.
Subsequent edits update that shared draft journal. A single IO actor owns journal,
authority and legacy-preference IO; UI callbacks read immutable projections.
Typing updates an optimistic in-memory value and coalesces only the trailing edit,
never across a consumption/deletion/identity barrier. Consumption and send preflight
wait for durable IO before updating the composer or accepting submission. Pending
cancellation is acknowledged after its ordered deletion; identity changes immediately
hide the previous account while its IO cleanup remains ordered ahead of any new bind.
Logout acknowledges completion only after that cleanup barrier succeeds; a failed
fire-and-forget cleanup is reported by the barrier and retried before a new bind.
Workspace pruning and pending cancellation carry their original account/share scope.
If a write fails, unsaved text remains visible with an error and Send retries that
value before handoff. Startup also retires already-loaded in-memory legacy text on
Main before exposing the restored projection. Ordinary picker attachments
remain temporary until they are merged with a system share, when the whole
combined attachment draft is retained. Selecting another workspace never moves
content between draft keys. Membership removal, denied/read-only/archived agent
access, sign-out, account replacement and AI consent withdrawal remove affected
saved copies. A newly captured unowned share may be claimed by the first sign-in;
identified content is never restored to a different account.

Cancel removes the pending share. Removing an attachment removes its saved copy.
Explicit Send transfers ownership to the existing local submission workflow and
writes an empty draft tombstone, preventing older text preferences from restoring
it. In-flight uploads/submissions are not resumed automatically after process
death; this journal is a draft store, not a durable message outbox. All restored
content remains editable and nothing sends automatically.

Build the isolated persistence fixture with
`-PnuphosIsolatedPersistentShareFixture=true` (receiver
`ai.nuphos.android.sharepersist1359`, test package with `.test`, sender
`ai.nuphos.sharepersist1359.sender`). Preserve installed Play/preview apps.
`IncomingShareFixtureDeviceTest` still covers cold/warm receive and Activity
recreation. `PersistentShareProcessDeviceTest` is explicitly phase-driven; run
one phase per instrumentation invocation with `-e persistentSharePhase PHASE`,
force-stop **only** its receiver and synthetic sender between phases, and require
different recorded target PIDs. Sequence: `seedPending`, `consumeExisting`,
`verifyExisting`, `verifyEditedAndWarmCancel`, `consumeNew`, `verifyNewAndHandoff`,
`verifyNoReplay`; additional independent sequences cover pending cancel,
account replacement, membership removal and denied conversation access.
`verifyNewAndHandoff` simulates the accepted local-submission boundary without a
backend message; it is not evidence of a real successful server send. All HTTP
uses synthetic intercepted responses and rejects non-GET requests. These tests
must not run against an installed real account or package.

With only these isolated packages installed, run the full process sequence from
an available device slot:

```sh
python3 scripts/verify_share_persistence.py --serial DEVICE_SERIAL --evidence-dir /tmp/share-process-evidence
```

The driver force-stops only the named persistence receiver/sender, checks they
have no process, requires a new recorded PID per phase, and stops on the first
failed instrumentation result. It does not install, uninstall, clear app data,
change accessibility settings, or start a real backend message.

### Conversation row actions fixture

Conversation rows expose actions through a 48dp More button, long press, and a
swipe-to-reveal rail. A full swipe only reveals buttons; it never changes a chat.
Back, an outside tap, scrolling, reordering, or switching workspaces closes the
rail. Watch and Unlink retain their permission, busy, error, and confirmation
rules. Pin and Archive read fresh conversation metadata before writing, without
opening the chat or resuming its active turn. Archive requires confirmation.

For narrow rows or large fonts, the rail shows two actions and More; the menu
always contains every available action. TalkBack custom actions provide the same
operations without a swipe. Horizontal reveal follows layout direction.

Build a separate installation using `-PnuphosIsolatedRowActionsFixture=true`
(`ai.nuphos.android.rowactions1357`), then run
`ConversationRowActionsFixtureDeviceTest`, `ConversationUnlinkFixtureDeviceTest`,
`ConversationWatchFixtureDeviceTest`, and `ConversationNestingFixtureDeviceTest`.
The row fixture renders synthetic Compose content only. It checks real click,
long press, full swipe, Back, outside tap, disabled actions, RTL/large text, and
accessibility actions. Its screenshots are `row-actions-*.png` in the fixture
app's external files directory. Never install it over the Play application.

### Website conversation handoff

Android accepts the website's `nuphos://open?url=<encoded HTTPS URL>&path=<encoded path>`
conversation handoff as well as verified HTTPS conversation links. The optional `path`
must agree with the inner URL. Only one `url` and at most one `path` are accepted;
unknown or duplicate fields, nested envelopes, fragments, external hosts and encoded
conversation paths are rejected. The outer query is decoded once, then the existing
strict HTTPS parser and fresh account/workspace/conversation access checks apply.
OAuth return hosts remain separate.

This fallback does not verify the HTTPS domain, prove browser launch success, or
change Android's link defaults. The website must separately trust the installed
Play signing certificate (including the applicable signing lineage/platform), and
Chrome may require an explicit user tap. An installed development APK's verified
state does not establish Play verification. No link sends a message.

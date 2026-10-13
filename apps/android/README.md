# Nuphos Android

Native Android client built with Kotlin and Jetpack Compose. This contribution
contains the app, Gradle wrapper, JVM tests, and isolated device fixture tests.
It does not contain credentials, APK files, IDE settings, or personal test data.

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

## Tests

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

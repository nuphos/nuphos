# What Nuphos sends, and how to turn it off

This page lists the telemetry that the Nuphos apps and backend send: what is
sent, when, where it goes, and how to turn it off. It describes what the code in
this repository does. It is not a legal privacy policy. The policy for Nuphos
Cloud is at [nuphos.ai/privacy](https://nuphos.ai/privacy).

The short version:

- Connected to a **self-hosted** backend, no client sends usage data to Nuphos.
  Desktop crash reports go to your own backend. The backend sends nothing to
  Nuphos unless its operator turns on health telemetry.
- Connected to **Nuphos Cloud**, Desktop and iOS send usage data to Nuphos's
  product analytics (PostHog), and Desktop sends crash reports. Each app has a
  setting to turn this off.
- Usage events and health reports are built to leave out the text of messages,
  prompts, files and memories. A Desktop crash report is a memory snapshot, so
  it can contain fragments of such content (see below).

## Desktop

**Usage data.** Packaged builds send product events to PostHog, from the
renderer ([`apps/desktop/src/lib/analytics.ts`](../apps/desktop/src/lib/analytics.ts))
and from the Electron main process
([`apps/desktop/electron/analytics.ts`](../apps/desktop/electron/analytics.ts)):

- named events for feature use, such as a message sent, with the backend user
  id and the active team id
- on sign-in, the account's email, name, username and language, attached to
  the user's analytics profile
- clicks, through PostHog autocapture, without the element's text or attributes
- page leave events, app lifecycle and update events, and JavaScript errors

There is no session replay. Usage data is sent only while the app is connected
to Nuphos Cloud. Point it at another backend and it stops, also mid-session.
Development builds (`bun run dev`) have no analytics key and send nothing.

**Crash reports.** When a packaged build crashes natively (for example a V8
out-of-memory abort), Crashpad uploads a minidump to the connected backend's
`/desktop/crash-reports`
([`apps/desktop/electron/crash-reporter.ts`](../apps/desktop/electron/crash-reporter.ts)).
The backend keeps main-process dumps only, with an allowlist of metadata such as
the app version, OS, architecture and memory figures, and stores them in its own
S3 storage ([`apps/backend/src/lib/crash-reports.ts`](../apps/backend/src/lib/crash-reports.ts)).
A minidump is a snapshot of process memory and can contain fragments of what
was on screen. Crash reports go to whichever backend the app is connected to,
so on a self-hosted instance they stay with you.

**Turn it off:** **Settings › Privacy › Send crash reports and usage data**. It
is on by default and saved on that computer only. Usage data stops right away.
Crash reports stop being sent after Nuphos restarts.

## iOS

Release builds send product events to PostHog
([`apps/ios/nuphos-ios/Services/Analytics.swift`](../apps/ios/nuphos-ios/Services/Analytics.swift)):

- named events such as sign-in, sign-out, a message sent or queued, a team
  switched, and the app coming to the foreground
- the name of the screen shown (for example `chat` or `inbox`) and the team id

Events carry the backend user id, never the email or name. There is no
automatic screen or tap capture, no session replay and no crash reporting.
Nothing is sent from Debug builds or while the app is connected to a
self-hosted backend.

**Turn it off:** **Settings › Privacy › Send usage data**. It is on by default
and saved on that device. Turning it off stops sending right away and clears
the analytics identity.

## Android

The Android app has no analytics or crash reporting SDK. It uses Firebase Cloud
Messaging only to receive push notifications from Nuphos Cloud. A self-hosted
session gets no push notifications.

## Backend

**Product analytics and errors.** The backend sends events and unexpected
exceptions to PostHog only when `POSTHOG_API_KEY` is set
([`apps/backend/src/lib/posthog.ts`](../apps/backend/src/lib/posthog.ts)).
Nuphos Cloud sets it. A self-hosted instance sends nothing to PostHog unless its
operator sets the key to their own project. The client runs with privacy mode on
and GeoIP lookup off.

**Health telemetry (self-hosted).** A self-hosted instance can send Nuphos a
small numeric health report every 5 minutes. It is off unless
`NUPHOS_TELEMETRY_KEY` is set, and `nuphos-admin telemetry off` stops it
without a restart. The full list of fields, and how to inspect the last report,
is in the [health telemetry section](../deploy/compose/README.md#health-telemetry-optional-off-by-default)
of the Compose guide.

## Changing what is sent

A change that adds a new kind of telemetry, a new destination or new fields
should update this page in the same pull request.

# Nuphos iOS

SwiftUI client for api.nuphos.ai. Open `nuphos-ios.xcodeproj` in Xcode 26.2 or later.

## Run on a simulator

```sh
xcodebuild -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

## Transcript regression checks

After installing a Debug simulator build, run:

```sh
bash tests/scroll-simulator.sh booted
```

This opens an offline fixture with long Markdown answers and tests initial
positioning, a new send, streaming growth, unchanged snapshots, and returning
to the latest message. Initial positioning and sending are sampled each display
frame; the test fails on drift rather than checking only the final offset.
It also checks a locally updated asynchronous card: its measured height must
match the allocated cell height, and the following message must sit below it.
Step expansion is sampled for title drift, and new sends must install their
short presentation-only arrival animation without changing the scroll geometry.
Relaunch without `-scroll-regression` to return to the signed-in app.

The iOS transcript uses ChatLayout 2.5.2 and self-sizing UIKit cells hosting
SwiftUI rows. The controller owns reading position, applies changed rows only,
and treats `lastSubmittedRowID` as explicit local-send intent. Server updates
preserve the visible row; sends extend the layout to place the new question near
the top. Dragging takes over from automatic following. Markdown must be populated
before a fresh cell is measured. The existing SwiftUI transcript remains the
fallback on other platforms.

## Run on a device

```sh
xcodebuild -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Debug \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates build
xcrun devicectl device install app --device <udid> <DerivedData>/Build/Products/Debug-iphoneos/nuphos-ios.app
xcrun devicectl device process launch --device <udid> ai.nuphos.ios
```

## TestFlight

`.github/workflows/release-ios.yml` archives, signs with the team's App Store
Connect API key (cloud-managed distribution certificate) and uploads to
TestFlight. It runs when the version in `apps/ios/package.json` changes on
`main`, or from the Actions tab. The build number is the workflow run number;
`MARKETING_VERSION` in the
project only matters for local builds.

Locally, with an API key at `~/.private_keys/AuthKey_<id>.p8`:

```sh
xcodebuild -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/nuphos.xcarchive \
  -allowProvisioningUpdates -authenticationKeyPath ~/.private_keys/AuthKey_<id>.p8 \
  -authenticationKeyID <id> -authenticationKeyIssuerID <issuer> \
  CURRENT_PROJECT_VERSION=<build> archive
xcodebuild -exportArchive -archivePath build/nuphos.xcarchive -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export -allowProvisioningUpdates -authenticationKeyPath ~/.private_keys/AuthKey_<id>.p8 \
  -authenticationKeyID <id> -authenticationKeyIssuerID <issuer>
```

## Product analytics

Release builds using the default Nuphos Cloud endpoint send curated events to
PostHog project 439957, using the same backend user ID as Desktop. Debug builds
(including preview fixtures), signed-out sessions and self-hosted endpoints do
not capture events. PostHog Swift is pinned to 3.89.1. Automatic screen/tap
capture, lifecycle events, feature flag preloading, surveys and replay are disabled;
only explicitly named screens and properties are sent. No prompts, message
text, attachment names/content, access tokens or backend URLs are recorded.

- `app_active`: a verified signed-in user enters the foreground, or their
  session finishes restoring while already in the foreground.
- `$screen`: top-level page or chat screen changes, including a fresh screen
  when returning from the background. Repeated rendering is deduplicated.
- `login` / `logout`: fresh sign-in completion / sign-out (restore is not login).
- `team_switched`, `agent_message_sent`, `agent_message_queued`,
  `agent_chat_started`, `agent_plan_approved`, `agent_plan_rejected`.

All events carry `platform` (`ios` on iPhone/iPad) and `client=nuphos-ios`;
the SDK supplies app version/build and OS properties. Team-specific events
carry explicit `team_id`. A send event means dispatch intent, not a completed
agent response. A steering send is recorded only after the server accepts it.

For iOS DAU, count unique persons per day for `$screen`, filtered to
`platform=ios`. The existing PostHog DAU insight is
https://us.posthog.com/project/439957/insights/BkJ3h8vU — its unfiltered series
also includes website pageviews and must not be presented as app-only DAU.
For foreground-active users, use `app_active`; compare with screen/action
activity when defining an engagement metric. Existing Desktop events do not
all carry `platform`, so they need their own screen/URL filter until aligned.

`bash tests/run.sh` covers identity switches, foreground deduplication, screen
re-entry, team attribution and Debug/self-hosted isolation without sending any
production events. The simulator build validates the real SDK integration.
After release, verify real `$screen` events with `platform=ios`, user identity,
team ID and the released app version in PostHog before relying on iOS DAU.

Navigation regression: track root screens from `pageContent.onAppear`, not
`NavigationStack.onAppear` (the stack stays mounted while a chat is pushed).
With the offline `tests/fixtures/push-responses.json` simulator fixture, open
chat A, pop to Agent, then open chat B. The actual screen callback sequence
must be `agent → chat → agent → chat`. Returning to the list and foregrounding
must retain the list name. Repeat from Plans when a plan-linked chat is present.
Wrapper tests cover foreground emission and same-team chat re-entry for both
root names; those tests do not replace checking SwiftUI navigation callbacks.
The Agent callback sequence was checked on iOS 26.3 using temporary local
logging before the Debug telemetry gate, without sending production events.

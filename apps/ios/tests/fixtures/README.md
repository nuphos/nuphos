# Offline by construction

Preview mode (a `-preview-*` argument or `NUPHOS_PREVIEW_RESPONSES`) cannot reach a
real backend. The API moves to `api.preview.invalid`, answered from the fixture.
Every other host is refused and logged as `preview_blocked`, except this machine:
`127.0.0.1`, `localhost` and files still work, so point local assets at those.
A web view's subresources are out of reach of this, so the dock opens only local pages.

# Simulator notification regression

Build Debug and install `ai.nuphos.ios` into an iOS simulator. Launch it with
`SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES` set to the absolute path of
`push-responses.json`, and pass `-preview-home` to `simctl launch`.
The fake responses apply only to api.nuphos.ai; no real account or provider is used.
The simulator remembers the fixture path for OS-initiated cold launches.
Remove the simulator app to clear that opt-in. Release builds omit the transport.

1. Allow notifications, open chat A, and send `push-b.apns` with `simctl push`.
   Tap its banner. Verify “Hello from push-b”.
2. Put the app in the background, send a notification, and tap it.
   Verify the process survives and shows the requested conversation.
3. Terminate the app, send a notification, and tap it. Verify cold-launch routing
   waits for workspace loading and opens the requested conversation.
4. From the push-opened chat B, send and tap `push-a.apns`.
   Verify the transcript changes to “Hello from push-a”.

Before the callback fix, step 2 reproducibly aborted in the async delegate's
Objective-C completion with `NSInternalInconsistencyException: Call must be made
on main thread`, via UIApplication's state-restoration snapshot methods.
Explicit delegate completion handlers now execute on MainActor. The destination
is keyed by the target's team/session identity so step 4 replaces its ChatSession.

Validated on iPhone 17 Pro Max / iOS 26.3 simulator. Device testing remains useful
for APNs delivery itself; the fixture exercises the system notification delegate
and navigation, not production provider execution.

# Chats fixture

`channel-responses.json` serves two chats (one unread), their posts from people
and an agent, pushed and uploaded images, the loop guard's paused line, and an
agent in a turn that answers `chat-release` (its `channelIds`), so the typing
bubble shows there. Launch a Debug build with it:

```sh
SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES="$PWD/tests/fixtures/channel-responses.json" \
  xcrun simctl launch booted ai.nuphos.ios -preview-home \
  -open-links https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/chat-release
```

Add `-channel-send "text"` to post a few seconds after the chat opens. The
fixture never returns that post, so it stays in its sending state.
A fixture key may end in `?name=value` to answer only requests with that query
item. `$FIXTURE_DIR` in a body is replaced with the fixture's folder, so transfer
links can point at local images (`file://$FIXTURE_DIR/…`).

# Bot desktop fixture

`bot-desktop-responses.json` serves two Bots and their 1:1 chats. "Sign-in helper"
runs where its runtime reports `canOpenDesktop`, so its chat header has the desktop
button; "Release notes" has none. `BotDesktopUITests` taps the button and expects the
desktop viewer, which cannot connect offline and shows its error with Close.

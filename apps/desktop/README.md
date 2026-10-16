# Nuphos

Electron desktop app for Nuphos — multi-cloud BYOS infra control plane.

## Releases

Release notes and version history are published on
[GitHub Releases](https://github.com/zeabur/nuphos/releases).

## Develop

Run the complete local development environment from the repository root:

```bash
bun run dev
```

The launcher starts the local stack, backend, runtime, and Electron Desktop.
It configures the backend URL and gives each worktree an isolated Desktop
profile, sign-in, ports and single-instance lock, so multiple worktrees can run
side by side (see [Parallel instances](../../README.md#parallel-instances)).
Each profile has its own login state. Do not launch Desktop separately.

### Computer Use with local Codex

Local Codex automatically exposes `cua_repl` when the OpenAI App has installed
an enabled `unified-computer-use` MCP manifest in the owner's Codex plugin cache.
It uses the App's existing runtime, so that App and its Computer Use permissions
must remain available; Nuphos does not download or install Computer Use itself.
New or resumed conversations discover the installed runtime automatically.

The agent keeps its isolated Codex home. Only the CUA server is imported, not
the owner's other MCP servers, config or plugins. Codex supplies native turn
metadata and routes App access prompts through the existing permission flow.
On macOS the native service socket uses the OS user's home rather than the
conversation's shell home. Users without a usable CUA installation can continue
using local Codex normally.

Other runtimes, including cloud ones, reach the same installation through the
`local_cua` tool. Desktop runs the App's `cua_repl` on the Mac for the
conversation and relays each call over the device tunnel; the App's per-app
approval prompts appear as the conversation's approval card, and an app allowed
once stays allowed for that conversation.

### Box desktops and snapshots

On a Linux Box every conversation gets a `nuphos-desktop` MCP server
(`local-runtime/desktop-session.mjs`). It claims a display from the pool on its
first tool call, not when the session starts. Agents open apps from the XFCE
panel's launchers; their desktop guidance is in the backend runtime prompt, so a
snapshot's `AGENTS.md` needs none. A Box snapshot is built by hand:

1. Create a Box from the current snapshot (`NUPHOS_BOX_TEMPLATE`).
2. Run `nuphos update` on it and check the runtime bundle version under `~/.local/share/nuphos/runtime`.
3. Run instabox `createSnapshot` on that machine.
4. Point `NUPHOS_BOX_TEMPLATE` at the new id, dev before prod.

## Local production build (unsigned)

```bash
pnpm electron:build
open release/mac-arm64/Nuphos.app
```

The unsigned `.app` works on the build machine, but macOS Gatekeeper will block
it on other users' machines. Use the signed release flow below for distribution.

## Release with auto-update (Stage 1: scaffolded; Stage 2: needs Apple Dev cert)

The app uses `electron-updater` (`autoUpdater.checkForUpdates()` runs on startup
and every 6 hours). Updates are downloaded silently and installed on next quit.

### One-time setup

1. **Apple Developer Program** ($99/yr) — enroll at
   [developer.apple.com](https://developer.apple.com/account).

2. **Developer ID Application certificate** — Certificates → `+` →
   `Developer ID Application` → upload CSR → download → double-click to install
   in Keychain.

3. **Notarize credential** — App Store Connect → Users and Access → Integrations
   → API Keys → Generate. Save the `.p8` file. Note the issuer ID and key ID.

4. **Edit `package.json` `build.mac`** to enable signing:

   ```json
   "mac": {
     "identity": null,           // → remove this line, or set to the cert name
     "hardenedRuntime": false,   // → change to true
     ...
   }
   ```

   And add:

   ```json
   "entitlements": "build/entitlements.mac.plist",
   "entitlementsInherit": "build/entitlements.mac.plist"
   ```

   `entitlements.mac.plist` already exists.

5. **Set env vars** before running release:

   ```bash
   export CSC_NAME="Developer ID Application: <your name> (TEAM_ID)"
   export APPLE_API_KEY=/path/to/AuthKey_XXXXX.p8
   export APPLE_API_KEY_ID=XXXXX
   export APPLE_API_ISSUER=00000000-0000-0000-0000-000000000000

   # S3 upload uses the BYOS connector creds (same bucket as cloudformation.yaml)
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   ```

6. **Bump version** in `package.json` (`0.1.0` → `0.1.1` etc.). `electron-updater`
   compares `version` to decide whether to download.

7. **Release**:

   ```bash
   pnpm release
   ```

   This signs, notarizes, builds `.dmg` + `.zip`, generates `latest-mac.yml`,
   and uploads everything to `s3://nuphos-releases/desktop/`.

8. **Distribute** the `.dmg` URL for first-time installs:
   `https://nuphos-releases.s3.amazonaws.com/desktop/Nuphos-<ver>-arm64.dmg`

### What end-users see

After the first install, the app silently checks for updates on startup and
every 6 hours. New versions download in the background. On next quit + relaunch,
the new version is automatically installed — no UI prompt, no manual download.

## macOS auto-sleep prevention

In **Settings → Local agent**, choose **Prevent Mac auto-sleep**:

- **Off** (default): follow your macOS sleep settings.
- **While local tasks are running**: keep the Mac awake during pending agent
  prompts, remote command/Computer Use streams, and open remote terminals.
  Approval waits count as part of an unfinished prompt; an idle conversation or
  a control/file connection does not. All tasks must finish before the assertion
  is released. Closing a stream or disconnecting clears its tracked activity.
- **While signed in to Nuphos**: stay awake to receive new work, even while idle.

**Only while connected to power** is enabled by default. Battery/power changes
apply immediately. Preferences are stored in this Mac's Desktop app data, rather
than your team or account settings. Signing out or quitting releases the sleep
assertion. Closing a window keeps the policy only if Nuphos remains running.

The display may turn off and the screen may lock. This prevents **idle system
sleep**; it does not guarantee operation with the lid closed, after choosing Sleep,
or during low-battery shutdown. Keeping a computer awake increases energy use.

### Verification on macOS

Use `pmset -g assertions` to inspect Nuphos's `PreventUserIdleSystemSleep`
assertion (Electron may label it `NoIdleSleepAssertion`). Confirm it appears in host mode while signed in, disappears in Off
mode/on sign-out/quit, and follows the power condition. In task mode, test two
concurrent prompts and a failed/cancelled prompt, approval waits, a remote terminal,
and a tunnel disconnect. Confirm an idle conversation alone adds no assertion.
Lock the screen or let the display turn off, then verify a task continues and new
work reaches the host in host mode. Repeat on a MacBook and a desktop Mac, noting
the macOS version; reconnect the power supply and restart the app to check the
saved preferences. Do not use forced system sleep to test idle-sleep prevention.

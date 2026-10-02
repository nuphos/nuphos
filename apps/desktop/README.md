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
profile and single-instance lock, so multiple worktrees can run side by side.
Each profile has its own login state. Do not launch Desktop separately.

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

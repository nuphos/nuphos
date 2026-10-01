# Nuphos Monorepo

This repository contains the two Nuphos product surfaces:

- `apps/backend` - Bun/Hono API service for Nuphos cloud bindings, agent sessions, local tunnel coordination, and provider integrations.
- `apps/desktop` - Electron/Vite/React desktop app for the Nuphos user interface.

The apps are intentionally kept as separate packages. Shared code can be added later under `packages/`, but this initial monorepo import does not change product code.

## Relationship to Nuphos

This repository is the source for Nuphos's hosted product, not a standalone Kubernetes IDE. Several integrations are wired directly to Nuphos infrastructure and have no useful behavior without it:

- **Authentication.** The backend owns Nuphos users, teams, Google OAuth, and JWT sessions in MongoDB.
- **Default backends.** The shipped desktop binary points `NUPHOS_API_URL` at `https://api.nuphos.ai`. It can be overridden by env var — see `apps/backend/.env.example` and the _Desktop Against Local Backend_ section below.
- **BYOS connectors.** Cross-account assume-role flows for AWS and impersonation for GCP require Zeabur's connector identities to be the trusted principals on the customer side.
- **Skills bucket.** Default path is hosted Nuphos + a Zeabur-owned S3 bucket (`ATLAS_SKILLS_*` on the backend), with team isolation under `teams/<teamId>/`. Self-host uses the same env vars on your own bucket; seed with `cd apps/backend && bun run skills:upload -- --scope global --dir <skills-root>`. Spec and Mode 1/2/3 notes: [`apps/backend/docs/skills-store.md`](apps/backend/docs/skills-store.md).

You can run the code without hosted Nuphos infrastructure, but expect to provide local auth configuration and stub out (or repoint) the integrations above.

## Repository Layout

```text
apps/
  backend/   # backend app, includes the static admin UI
  desktop/   # desktop app
```

## Current Import State

The initial monorepo import preserves the app contents under their new folders:

- Backend source lives under `apps/backend`.
- Desktop source lives under `apps/desktop`.
- Existing app-level scripts still expect to be run from the app directory.
- The desktop release workflow imported at `apps/desktop/.github/workflows/release.yml` is historical/reference material in the monorepo. GitHub Actions only runs workflows from root `.github/workflows`, so release CI must be ported before relying on it from this repository.

## Prerequisites

- Bun for `apps/backend`.
- Node.js 22 and pnpm 10 for `apps/desktop`.
- Docker (Docker Desktop, or Docker Engine with Compose v2.24+) and `openssl` for the local stack `bun run dev` runs on.
- Google OAuth credentials and `NUPHOS_JWT_SECRET` for Nuphos auth flows.

## Formatting and Linting

Prettier is configured once at the repo root (`.prettierrc.json`), with per-app
overrides so each app keeps the semicolon/quote style it already uses. ESLint is
per-app, because each app has a different package manager and framework preset.

```bash
bun install          # at the repo root — installs Prettier
bun run format       # rewrite
bun run format:check # report only (what CI runs)
```

```bash
cd apps/backend  && bun run lint   # type-aware: no-floating-promises, no-misused-promises
cd apps/admin    && bun run lint   # eslint-config-next
cd apps/desktop  && pnpm lint      # react-hooks / react-refresh
```

### Optional pre-commit hook

A format-only hook lives in `.githooks/`. It is opt-in — enable it once per
clone:

```bash
git config core.hooksPath .githooks
```

It runs `prettier --check` on staged files only. It deliberately does not run
ESLint: the backend config is type-aware, so a lint pass builds a full
TypeScript program and is far too slow for a commit hook. Use
`git commit --no-verify` to bypass it.

> The repo-wide format sweep has not landed yet, so the hook (and the CI
> `format` job) will flag pre-existing files. Both are non-blocking until it
> does.

## Local Development

The root launcher starts a complete local stack with a live dashboard,
dependency preflight, free-port selection, supervised processes, and raw logs:

```bash
bun run dev           # backend + Electron desktop
bun run dev --admin   # backend + Admin website
bun run dev --managed # also managed agents on OrbStack Kubernetes (below)
```

What it starts:

- **Local data plane** — `mongo`, `rustfs` and `runtime` from
  [`deploy/compose`](deploy/compose/README.md), layered with
  `docker-compose.dev.yml` (compose project `nuphos-dev`). Mongo is published on
  `127.0.0.1:27117` and the runtime on `127.0.0.1:18180`. The stack is shared by
  every worktree and keeps running after the launcher quits.
- **Backend** on the host with hot reload. The launcher points it at the local
  Mongo and RustFS, forces `NODE_ENV=development`, turns Redis and (without
  `--managed`) the Kubernetes runtime provisioner off, and prints email sign-in
  codes to the dashboard instead of sending them. These values are set in the process
  environment, so they win over `apps/backend/.env`: that file still supplies
  secrets and integration keys, but it is no longer the source of Mongo or S3
  for dev. `bun run dev` never touches production data stores.
- **Local runtime, added to a team by hand** — the launcher never connects the
  runtime to a team. Add it in Settings › Agents › **Add agent** › **Self-hosted Cloud Agent** with the
  address `ws://localhost:18180/acp` and the runtime's password: `p` on the
  dashboard copies it (macOS), or `bun run dev:runtime-password` prints it.
  Sign the runtime in to Claude once with **Sign in** on the runtime's card, or
  from the terminal with `bun run dev:login` (it runs `claude auth login` inside
  the container); the login is kept on the runtime-home volume in
  `/home/node/.claude`.
- **Desktop** (or Admin) pointed at the local backend, with an Electron profile of
  its own (`Nuphos Dev (<worktree> local)`), so tabs and teams saved while dev
  pointed elsewhere never load against the local database. Desktop keeps its
  sign-in in `~/.config/nuphos/cli.dev.yaml`, separate from the installed app.

First run: the launcher generates `deploy/compose/.env` with `init-env.sh` if it
is missing, and the first `docker compose up` pulls the images (the runtime image
is amd64-only and runs under emulation on Apple Silicon, so it starts slowly).
The local database starts empty: sign in with any email and read the code from
the dashboard.

Quitting: `q` opens a menu (↑/↓ to move, Enter to choose, Esc or `q` to go back):

1. **Stop dev processes, keep the local stack running** (default). Stops the
   backend and Desktop or Admin (with vite and Electron). Next start is fast.
2. **Stop everything, keep data.** Also runs `docker compose stop` on the stack.
3. **Stop everything and wipe local data.** Also runs `docker compose down -v`,
   which deletes the local database and buckets; it asks for a second Enter
   (or `y`).

Options 2 and 3 leave the stack running when another worktree's launcher still
uses it, and say so. A tunnel is stopped only when this launcher started it:
always for a quick tunnel, and for the named tunnel only when no other launcher
is left. Ctrl-C, closing the terminal, and SIGTERM/SIGHUP never prompt; they
act as option 1. After quitting, the launcher prints what it stopped and what
is still running, with the command to stop it.

Managing the stack outside the launcher:

```bash
bun run dev:ps               # status
bun run dev:logs [service]   # follow logs, e.g. bun run dev:logs runtime
bun run dev:stop             # stop the containers, keep data
bun run dev:reset [--yes]    # wipe Mongo, RustFS and runtime data (asks unless --yes)
bun run dev:login            # sign the runtime in to Claude (interactive)
bun run dev:runtime-password # print the runtime's password, for Settings › Agents
bun run dev --reset          # wipe, then start as usual
```

`dev:reset` and `--reset` refuse while another worktree's launcher still uses
the stack. When the stack predates the current setup (for example, runtime
secrets encrypted under an old key), the dashboard says so and suggests
`bun run dev:reset`. If the runtime regenerated its password (a new runtime
volume), update it on the runtime's card in Settings.

### Test managed agents locally (OrbStack)

`bun run dev --managed` also runs the Kubernetes provisioner, so
**Add agent › Nuphos Managed Cloud Agent** deploys a real managed agent into
OrbStack's built-in Kubernetes instead of a cloud cluster:

```bash
orbctl start k8s      # once: turns on OrbStack's Kubernetes (context "orbstack")
bun run dev --managed
```

- The `managed` row checks OrbStack, its Kubernetes, the `orbstack` context and
  the `openab-runtimes-local` namespace (created if missing), then lists each
  managed agent's pod. A failed check names the fix, leaves the provisioner off
  and never blocks the rest of the stack; fix it and press `r`.
- The backend runs in kubectl mode against a kubeconfig holding only that one
  context (`~/.cache/nuphos-dev/managed-kubeconfig.json`), written only after
  the context proves to be a cluster on this machine. `--managed=<context>`
  picks another local cluster (`docker-desktop`, `minikube`, `kind-*`); any
  other context is refused.
- Agents run the release the backend defaults to (`NUPHOS_RUNTIME_VERSION` in
  `apps/backend/.env` overrides it). The images are amd64-only; OrbStack runs
  them under Rosetta. The backend reaches each pod through a
  `kubectl port-forward` it opens on first use, and pods reach the backend at
  `host.docker.internal`.
- Quit option 2 and `bun run dev:stop` scale managed agents to zero and keep
  their volumes; option 3, `bun run dev:reset` and `--reset` delete the
  namespace. `orbctl stop k8s` turns Kubernetes off again.

The app-level commands below remain useful when only one process is needed.

### Backend API

```bash
cd apps/backend
bun install
cp .env.example .env
```

Minimum required local environment:

```bash
MONGODB_URI=mongodb://user:password@host:port
```

Common local defaults:

```bash
PORT=3000
MONGODB_DB=atlas
NUPHOS_AUTH_BASE_URL=http://localhost:3000
NUPHOS_JWT_SECRET=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Run the backend:

```bash
bun run dev
```

Check the backend:

```bash
bun run typecheck
bun run build
```

The backend listens on `http://localhost:$PORT`; if `PORT` is unset, it uses `3000`.

### Desktop App

```bash
cd apps/desktop
pnpm install
```

Run the full Electron app:

```bash
pnpm electron:dev
```

Run the renderer in a normal browser:

```bash
pnpm dev:web
```

Check and package locally:

```bash
pnpm build
pnpm electron:build
```

### Desktop Against Local Backend

The desktop app reads `NUPHOS_API_URL`, falling back to `ATLAS_API_URL` for local compatibility. When unset, the Electron main process falls back to `https://api.nuphos.ai` and the Vite dev server falls back to `http://localhost:3717`. To run the full Electron app against a local backend, set `NUPHOS_API_URL` explicitly in both layers as shown below.

```bash
cd apps/backend
bun run dev
```

In another terminal:

```bash
cd apps/desktop
NUPHOS_API_URL=http://localhost:3000 pnpm electron:dev
```

For local Google login, Electron opens the Nuphos landing page and expects it on `http://localhost:3100/login` when `NUPHOS_API_URL` points to localhost. Override that with `NUPHOS_LOGIN_URL` or `NUPHOS_WEB_URL` if needed.

Browser-only mode also works with the local backend:

```bash
cd apps/desktop
NUPHOS_API_URL=http://localhost:3000 NUPHOS_AUTH_TOKEN=<jwt> pnpm dev:web
```

The browser-only mode proxies `/atlas-api/*` to `NUPHOS_API_URL` and injects `NUPHOS_AUTH_TOKEN` when provided.

### Admin Website

The admin site is served by the backend and authenticates with a Nuphos JWT. Open `/admin` on whichever backend you want to use — locally that is `https://local.zeabur.com:3000/admin`, in production it is `https://api.nuphos.ai/admin`. The backend validates the JWT locally and checks the returned user id against the admin allowlist.

## Backend Deployment

Deploy backend independently with the **Deploy Backend** GitHub Actions workflow.
Backend production deploys are tag-triggered and version-controlled by
`apps/backend/package.json`.

Preflight:

```bash
cd apps/backend
bun install
bun run typecheck
bun run build
```

Runtime command:

```bash
bun run start
```

Build command, if the platform wants a build artifact:

```bash
bun run build
```

The build outputs to `apps/backend/dist/`.

Required runtime environment:

```bash
MONGODB_URI=...
```

Important optional or feature-gating runtime environment:

```bash
PORT=3000
MONGODB_DB=atlas
NUPHOS_AUTH_BASE_URL=https://api.nuphos.ai
NUPHOS_JWT_SECRET=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
POSTHOG_API_KEY=...
POSTHOG_HOST=https://us.i.posthog.com
AWS_BYOS_OIDC_PRIVATE_KEY_BASE64=...
AWS_BYOS_OIDC_ISSUER=https://nuphos.ai
GCP_BYOS_WIF_PROJECT_NUMBER=...
GCP_BYOS_WIF_POOL_ID=nuphos
GCP_BYOS_WIF_PROVIDER_ID=nuphos-oidc
GITHUB_APP_ID=...
GITHUB_APP_SLUG=...
GITHUB_APP_PRIVATE_KEY_BASE64=...
GITHUB_APP_SETUP_REDIRECT=...
GITHUB_APP_WEBHOOK_SECRET=...
AWS_BEDROCK_REGION=us-east-1
AWS_BEDROCK_ACCESS_KEY_ID=...
AWS_BEDROCK_SECRET_ACCESS_KEY=...
AGENT_MODEL_ID=...
AGENT_FALLBACK_MODEL_ID=... # optional: model to switch to when a turn-loop round exhausts retries on throttling/5xx
NUPHOS_BACKEND_URL=http://nuphos-backend.<namespace>.svc.cluster.local:3000
VERCEL_ACCESS_TOKEN=...
VERCEL_TEAM_ID=...
VERCEL_PROJECT_ID=...
VERCEL_SANDBOX_SNAPSHOT_ID=...
RAG_API_KEY=...
TAVILY_API_KEY=...
FIRECRAWL_API_KEY=...
ATLAS_ADMIN_USER_IDS=<zeabur_user_id>,<zeabur_user_id>
```

`ATLAS_ADMIN_USER_IDS` is an optional comma-separated list of Zeabur user IDs. Whitespace around entries is ignored.

Deployment checklist:

1. Merge backend changes to the monorepo main branch.
2. Update `apps/backend/package.json` to the backend version you want to ship.
3. Push a matching release tag named `backend-v<version>`, for example `backend-v0.2.0`.
4. Confirm the workflow builds and pushes `nuphos-backend:v<version>` to ECR.
5. Confirm the workflow rolls out `deployment/nuphos-backend` in the EKS `production` namespace.
6. Smoke test `GET /health`.

The backend workflow rejects tag/version mismatches. If `apps/backend/package.json`
contains `"version": "0.2.0"`, the production release tag must be
`backend-v0.2.0`.

## Desktop Release

Release desktop independently from `apps/desktop`.

Preflight:

```bash
cd apps/desktop
pnpm install
pnpm build
pnpm electron:build
```

Unsigned local build:

```bash
pnpm electron:build
open release/mac-arm64/Nuphos.app
```

Release command:

```bash
pnpm release
```

The release command runs `vite build && electron-builder --publish always`. It builds macOS zip and dmg artifacts, signs and notarizes when credentials are present, writes updater metadata, and publishes to `s3://zeabur-aws-integration/atlas/`.

Required release credentials:

```bash
CSC_LINK=...
CSC_KEY_PASSWORD=...
APPLE_API_KEY=/path/to/AuthKey.p8
APPLE_API_KEY_ID=...
APPLE_API_ISSUER=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Release checklist:

1. Update `apps/desktop/package.json` version.
2. Run `pnpm install` if dependency metadata changed.
3. Run `pnpm build`.
4. Run `pnpm electron:build` for a local packaging check.
5. Run `pnpm release` with signing, notarization, and S3 credentials configured.
6. Create or verify a GitHub Release tag named `v<version>`.
7. Verify the first-install DMG URLs:

```text
https://zeabur-aws-integration.s3.amazonaws.com/atlas/Nuphos-<version>-arm64.dmg
https://zeabur-aws-integration.s3.amazonaws.com/atlas/Nuphos-<version>-x64.dmg
```

## GitHub Actions Status

The desktop repo's previous workflow was imported at:

```text
apps/desktop/.github/workflows/release.yml
```

That file documents the old release automation, but GitHub will not execute workflows from that nested location. Before relying on CI releases in this monorepo, port it to:

```text
.github/workflows/desktop-release.yml
```

When porting it, update commands and cache paths so they run from `apps/desktop`, for example:

```yaml
defaults:
  run:
    working-directory: apps/desktop
```

Also update any version-detection logic that previously read root `package.json`; it must read `apps/desktop/package.json` in the monorepo.

## Working Guidelines

- Backend-only changes should be developed and checked from `apps/backend`.
- Desktop-only changes should be developed and checked from `apps/desktop`.
- Contract changes that affect both apps should be committed in one monorepo PR so the API and desktop client stay compatible.

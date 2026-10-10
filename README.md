![Nuphos — The Agent Workspace for your team.](https://cdn.zeabur.com/nuphos-banner.png)

# Nuphos

**The agent workspace for your team.**

<a href="https://nuphos.ai/download"><img alt="Download for macOS" src="assets/download-macos.svg" height="44"></a> <a href="https://apps.apple.com/app/nuphos/id6812533633"><img alt="Download on the App Store" src="assets/download-app-store.svg" height="44"></a> <a href="https://x.com/NuphosAI"><img alt="Follow on X" src="assets/follow-x.svg" height="44"></a> <a href="https://nuphos.ai/dc"><img alt="Join Discord" src="assets/join-discord.svg" height="44"></a>

Coding agents are single-player by default: one agent, on one laptop, in one
terminal, for one person. Nuphos is where a team runs them instead — across
people, across machines, and without the session ending when someone closes
their lid.

## Features

- **Use your existing agent.** Claude Code and Codex ship today, each behind an
  [ACP](https://agentclientprotocol.com) adapter. You keep the coding-plan
  subscription you already pay for — the runtime signs in with that account,
  and there is no extra model charge on top.
- **The session outlives your machine.** A runtime can be local, a remote
  machine you own, or one Nuphos manages. Close the laptop and the turn keeps
  going; pick it up from your phone in the iOS app.
- **A session is a room with your teammates.** Invite someone into a running
  session the way you would a Notion page. Several people talk to the same
  agent, see the same tool calls, and steer together.
- **Share and sync skills and tools across your team.** Grant a skill or an
  integration once and every agent on the team has it, synced, rather than each
  person pasting a token into their own machine.
- **Designed for professional users.** The desktop puts a real GUI beside the
  conversation: a Kubernetes GUI for the cluster, a Grafana GUI for dashboards,
  alerts, logs and traces, plus GitHub and Linear for repositories, pull
  requests and issues. GitLab, AWS including ECS, GCP, Cloudflare, Linode, and
  your MongoDB and SQL connections sit alongside them.
- **A browser in the workspace.** Open web pages in a desktop tab beside the
  conversation — docs, a dashboard, the app you are working on — with its own
  history, instead of switching windows.
- **Add the agent to Slack or Discord.** One step drops the same agent into a
  channel the team already uses.
- **Triggers.** A schedule or a webhook starts a turn on its own — a cron, or
  an incoming event — without anyone sitting in the chat.
- **Split the window.** ⌘D splits side by side and ⌘⇧D splits top and bottom,
  so you can watch several agent sessions at once.
- **Move the session between local, remote, and cloud.** The conversation you
  are in switches to this computer, another machine you own, or a cloud
  runtime, and keeps going.
- **Memory, with nothing to install.** Memory across the team, across agents,
  and across sessions is built in. There is no MCP server to add before one
  agent can recall what another learned.

## Apps

| Path           | What it is                                                              |
| -------------- | ----------------------------------------------------------------------- |
| `apps/backend` | Bun/Hono API: accounts, teams, sessions, runtime registry, integrations |
| `apps/desktop` | Electron/Vite/React client — the workspace itself                       |
| `apps/runtime` | Claude Code / Codex container images, adapters and independent releases |
| `apps/ios`     | SwiftUI client: pick a session back up away from your desk              |

There is an Android client too; it is not open source yet. The iOS app is the
one in here.

The agent runtime lives in [`apps/runtime`](apps/runtime) (Apache-2.0).
Its image executes a turn, and a self-hosted deployment registers its own.
See [`apps/runtime/README.md`](apps/runtime/README.md) for building, running
and independently releasing the runtime.

## Releases

Maintainers publish Desktop downloads and self-hosted Backend images through
component-specific release tags. See [the release guide](docs/releases.md) for
versioning, required approvals, and signing setup. Hosted-service deployment is
managed separately. Read it before planning or cutting any release; the runtime
has its own `runtime-vX.Y.Z` tags, covered in
[`apps/runtime/README.md`](apps/runtime/README.md). Automated releases may only
produce Patch or Minor versions — a Major needs an explicit manual `X.0.0`.

## Self-hosting

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/H9M7E7)
[![Railway deployment guide](https://railway.com/button.svg)](deploy/railway/README.md)
[![Docker Compose setup](https://img.shields.io/badge/Docker%20Compose-Setup-2496ED?logo=docker&logoColor=white)](deploy/compose/README.md)

The Zeabur button deploys the data stack. Then [deploy the agent runtime](https://zeabur.com/templates/AUECDT)
in a **separate project**. Railway currently uses the CLI deployment guide rather
than a published one-click template.

`deploy/compose` brings up a complete, minimal Nuphos with one
`docker compose up` — MongoDB, S3-compatible storage, the backend, and one agent
runtime. Start at [`deploy/compose/README.md`](deploy/compose/README.md).

For Zeabur, use [`deploy/zeabur/template.yaml`](deploy/zeabur/template.yaml);
see the [deployment inputs and setup guide](deploy/zeabur/README.md).
[Railway project templates](deploy/railway/README.md) are also available.

What to know before you plan around it:

- **One team per deployment.** Teams are the scope for everything — sessions,
  skills, memory, integrations — but the hosted product is where multiple teams
  in one instance live.
- **The runtime signs in to Claude itself**, once, from its own console. You
  supply your own account; there is no key to configure in Nuphos.
- **Point the clients at your backend from the sign-in screen.** Desktop and
  iOS both have a "Self-hosted? Set API endpoint" link there, and email
  sign-in works against any backend. A launch-time `NUPHOS_API_URL` (as
  `bun run dev` sets) is Desktop's starting endpoint and can still be changed.
  Google sign-in goes through the `nuphos.ai` web page, so it only works
  against Nuphos Cloud.

Not available self-hosted: managed runtime provisioning, managed backups, and
the operational tooling that comes with running this as a service.

## Connected accounts

The GUI panes are not screenshots — the agent operates the accounts behind
them. Cloud providers are the sharpest case: AWS access is a cross-account
assume-role and GCP is service-account impersonation, so _your_ deployment's
identity has to be the trusted principal on the other side. A self-hosted
instance binds accounts to itself, not to nuphos.ai.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CI runs on every pull request:
typecheck, tests, lint, import-cycle and format checks across the apps your
change touches.

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

## Local Development

From the repository root:

```bash
bun run dev
```

It starts the local stack, backend, runtime and Electron Desktop with isolated
configuration. Do not start Desktop on its own or use the web-only Vite server
as the default dev loop.

## Working Guidelines

`AGENTS.md` and `CLAUDE.md` point coding agents here, so this section is the
single source of repository rules for people and agents alike.

### Pull requests

- Open PRs ready for review. Use a draft only when the change is genuinely
  unfinished or a draft was asked for.
- Titles follow Semantic Commit Messages, e.g.
  `fix(agent): improve agent chat traces`, with no tool prefix such as
  `[codex]`.
- Develop and check backend-only changes from `apps/backend` and desktop-only
  changes from `apps/desktop`. A contract change that affects both lands in one
  PR so the API and the desktop client stay compatible.

### Backend environment variables

`apps/backend/src/config.ts` and the section files under
`apps/backend/src/config/` are the only place backend env vars are read and
documented. `src/config.env-sync.test.ts` enforces the rules below in CI.

- Read env only through the helpers in `src/config/env.ts` (`required()`,
  `optional()`, `bool()`, …), in the section that owns the feature. No other
  file under `src/` or `scripts/` may touch `process.env` or `Bun.env`; tests
  and the test's `BYPASS_ALLOWLIST` are the exceptions.
- Adding, removing or renaming a var updates `apps/backend/.env.example` in the
  same PR, with a comment and a sensible placeholder. Platform-injected vars
  (`HOSTNAME`, `GIT_SHA`, …) go in the test's `INFRA_ALLOWLIST` instead.

## License

[Apache-2.0](LICENSE).

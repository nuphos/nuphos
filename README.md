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
  going; pick it up from your phone.
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
| `apps/ios`     | SwiftUI client: pick a session back up away from your desk              |

There is an Android client too; it is not open source yet. The iOS app is the
one in here.

The agent runtime is a separate repository:
[`nuphos/nuphos-runtime`](https://github.com/nuphos/nuphos-runtime) (Apache-2.0).
That image is what actually executes a turn, and a self-hosted deployment
registers its own.

## Self-hosting

`deploy/compose` brings up a complete, minimal Nuphos with one
`docker compose up` — MongoDB, S3-compatible storage, the backend, and one agent
runtime. Start at [`deploy/compose/README.md`](deploy/compose/README.md).

Two things to know before you plan around it:

- **One team per deployment.** Teams are the scope for everything — sessions,
  skills, memory, integrations — but the hosted product is where multiple teams
  in one instance live.
- **The runtime signs in to Claude itself**, once, from its own console. You
  supply your own account; there is no key to configure in Nuphos.
- **The iOS client is compiled against `nuphos.ai`.** `NuphosWeb.siteURL` is a
  constant, not a setting, so pointing the app at your own deployment means
  editing it and building your own. The desktop client takes `NUPHOS_API_URL`
  and `NUPHOS_WEB_URL` at runtime; mobile has not caught up.

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

> The repo-wide format sweep has not landed yet, so the hook (and the CI
> `format` job) will flag pre-existing files. Both are non-blocking until it
> does.

## Local Development

From the repository root:

```bash
bun run dev
```

The local backend uses one HTTP port shared by Desktop and runtime callbacks;
no mkcert certificate or local TLS configuration is required. Tunnel public URLs
remain HTTPS. Legacy named tunnels with HTTPS origins are skipped in favor of
a quick tunnel.

## Working Guidelines

- Backend-only changes should be developed and checked from `apps/backend`.
- Desktop-only changes should be developed and checked from `apps/desktop`.
- Contract changes that affect both apps should be committed in one monorepo PR so the API and desktop client stay compatible.

## License

[Apache-2.0](LICENSE).

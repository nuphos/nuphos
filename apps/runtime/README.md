# Nuphos Runtime

The container image that runs a coding agent for [Nuphos](https://nuphos.ai).

A Nuphos runtime is a long-lived container with one coding agent inside it —
**Claude Code**, **Codex**, **Grok Build** or **Google Antigravity** — reachable over the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP). The Nuphos
backend does not run the agent itself; it opens an ACP session against a
runtime and streams the conversation through it. This repository builds the
image those runtimes run.

New images are published to `ghcr.io/nuphos/runtime`. Historical versions remain
available from `ghcr.io/zeabur/nuphos-runtime`.

## What is in the image

Three things, in layers:

1. **The OpenAB gateway.** [`openab`](https://github.com/openabdev/openab) is
   the process that owns the container: it accepts ACP over the network,
   supervises the agent, and keeps sessions alive across agent restarts. A
   short start script prepares the container and then becomes openab.
2. **The agent CLI and its ACP adapter.** For `claude-code`, that is
   `@agentclientprotocol/claude-agent-acp` with the Claude Code CLI that ships
   inside the Claude Agent SDK; for `codex`, `@openai/codex` with
   `@agentclientprotocol/codex-acp`. The adapter translates ACP into whatever
   the CLI actually speaks. Each image carries exactly one copy of each.
   Grok Build (`grok agent stdio`) and Antigravity (Google's `antigravity-acp`
   server) speak ACP themselves, so they take no adapter; `acp-shim.mjs` sits in
   front of them instead (see below). Both are proprietary and are not in the
   image: the pinned build installs on first use, and the container starts that
   install in the background as it boots.
3. **The Nuphos toolset layer**, built from [`image/`](image) in this
   repository: a set of patches to the adapters, a handful of helper programs,
   and the command-line tools an agent is expected to be able to reach for.

### The toolset layer

The adapters are patched at build time rather than forked. Each patch pins the
SHA-256 of the upstream bundle it edits, so an adapter upgrade fails the build
until someone re-reviews the patch.

| Path in the image                           | What it does                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/nuphos-claude-agent-acp`              | Claude adapter (0.74.0, Agent SDK 0.3.296), patched to publish session state and to bridge HTTP MCP servers                                                                                                                                                                                    |
| `/opt/nuphos-codex-acp`                     | Codex adapter (1.1.4, Codex CLI 0.161.0), patched for per-session instructions and environment, MCP bridging, and steering an active turn                                                                                                                                                      |
| `/usr/local/bin/nuphos-runtime-start`       | The entrypoint: checks a password set in the environment and derives the operator key from it, points openab's console at a password file from an earlier version, lays out `/workspace` the way a provisioned pod does, then becomes openab                                                   |
| `/etc/openab/config.toml`                   | The gateway config openab reads, so the container starts with nothing mounted; a mount at this path replaces it                                                                                                                                                                                |
| `/opt/runtime-defaults.mjs`                 | Applies a model, reasoning effort and fast-mode default to a new session                                                                                                                                                                                                                       |
| `/opt/nuphos-runtime/mcp-http-bridge.mjs`   | Relays a stdio MCP server to a bearer-authenticated HTTP endpoint, re-reading the token per request                                                                                                                                                                                            |
| `/opt/nuphos-runtime/runtime-guard.sh`      | Sourced via `BASH_ENV`; refreshes per-turn credentials into the shell environment and sets a memory ceiling                                                                                                                                                                                    |
| `/opt/nuphos-runtime/panel-job.mjs`         | The `panel` job OpenAB runs for `_openab/runtime/job`: writes the panel runner, script and params into a fresh directory and runs `node runner.mjs <dir>`, passing stdout and the exit code through                                                                                            |
| `/opt/nuphos-runtime/codex-login.mjs`       | Drives Codex's device-code login in an isolated `CODEX_HOME`                                                                                                                                                                                                                                   |
| `/opt/acp-shim.mjs`                         | The Nuphos layer for Grok Build and Antigravity: respawns the agent with the conversation's environment and CLI home, syncs skills, applies runtime defaults, bridges MCP credentials, and hands over Nuphos's instructions (Grok's `_meta.rules`; for Antigravity, ahead of the first prompt) |
| `/opt/nuphos-runtime/grok-login.mjs`        | Drives `grok login --device-auth` and reports the xAI device code                                                                                                                                                                                                                              |
| `/opt/nuphos-runtime/antigravity-login.mjs` | Drives Antigravity's Google sign-in: reports the authorize URL and delivers the loopback address the user pastes back to the listener in the container                                                                                                                                         |
| `/opt/nuphos-runtime/claude-login.mjs`      | Drives `claude auth login`: reports the authorize URL, passes back the code the user pastes, and leaves the credential in `~/.claude`                                                                                                                                                          |
| `/usr/local/bin/nuphos-sync-skills`         | Fetches the workspace's skill bundle and swaps it in atomically — pushed by the provisioner for a managed pod, run per session by `runtime-defaults.mjs` for a self-hosted one                                                                                                                 |
| `/usr/local/bin/nuphos-seed-codex-auth`     | Seeds Codex credentials from a mounted secret, once per credential revision                                                                                                                                                                                                                    |

`OPENAB_AGENT_COMMAND` names the patched adapter, and `claude` on `PATH` is the
same native CLI the Claude adapter runs.

### Command-line tools

The image ships only what the agent loop and the skills use on every turn:
`git`, `gh`, `jq`, `ripgrep`, `curl`, `python3` (with `venv`), `kubectl` and
`zeabur`. Every other tool a skill may reach for is a small shim on `PATH` that
installs the pinned release the first time it runs and then hands over to it, so
`aws s3 ls` works as it always did — the first call just takes longer and needs
network access.

| Tool                                | Commands                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------- |
| AWS CLI v2                          | `aws`                                                                       |
| Google Cloud CLI                    | `gcloud`, `gsutil`, `bq`, and `gke-gcloud-auth-plugin`                      |
| mongosh                             | `mongosh`                                                                   |
| PostgreSQL 17 client                | `psql`, `pg_dump`, `pg_dumpall`, `pg_restore`, `pg_isready`                 |
| MariaDB client                      | `mariadb`/`mysql`, `mariadb-dump`/`mysqldump`, `mariadb-admin`/`mysqladmin` |
| Hetzner, Volcengine, Aliyun, Linode | `hcloud`, `ve`, `aliyun`, `linode-cli`                                      |
| Helm, Tailscale                     | `helm`, `tailscale`, `tailscaled`                                           |
| C/C++ toolchain                     | `gcc`, `g++`, `cc`, `c++`, `make`, binutils                                 |

Versions, download URLs and SHA-256 checksums are pinned in
[`image/tools/manifest.json`](image/tools/manifest.json); a download that does not
match is discarded. The Debian packages (the database clients and the toolchain)
are fetched with `apt-get` as the unprivileged user and verified against the
archive's signatures, then unpacked rather than installed. `nuphos-tools list`
shows what is installed, and `nuphos-tools install <tool>` (or `--all`) fetches
ahead of time.

Tools install under `/home/node/.nuphos-runtime/tools` (override with
`NUPHOS_TOOLS_DIR`), so they last exactly as long as the home directory does:

- **Nuphos-provisioned pods** mount a persistent volume at `/home/node`, so a
  tool is fetched once per runtime and survives restarts and image upgrades. An
  image that pins a newer version installs it on first use and removes the old one.
- **A self-hosted container** keeps them across restarts only with a volume at
  `/home/node` (see [Running one](#running-one)). Without one, each new container
  fetches a tool again the first time it is used.

Concurrent first calls wait on a per-tool lock, so a tool is only ever fetched
once. Progress goes to stderr; stdout stays the tool's own.

Everything runs as uid/gid 1000 (`node`) with all capabilities dropped. Nothing
in the image requires root at runtime.

### What is not in the image

No credentials, and no prompts. The agent's system prompt, its MCP servers, its
skills and its per-turn credentials are all delivered at runtime by the backend
over ACP, or fetched at startup. An image is the same for every workspace.

## Building

Two builds, in order. The base is the gateway, built from the `openab`
submodule; the runtime image takes only the `openab` binary from it and builds
everything else on `node:22-trixie-slim`. `BASE_IMAGE` must be set — there is no
default, so nothing bakes a registry path into the published image.

```sh
git clone --recurse-submodules https://github.com/nuphos/nuphos.git
cd nuphos/apps/runtime

docker build -f third_party/openab/Dockerfile.unified --target agentcore \
  -t openab-base:local third_party/openab

docker build -f image/Dockerfile \
  --build-arg BASE_IMAGE=openab-base:local \
  --build-arg OPENAB_BUILD_SHA=$(git -C third_party/openab rev-parse --short=12 HEAD) \
  --build-arg RUNTIME_PROVIDER=codex \
  -t nuphos-runtime-codex:local image
```

For the other runtimes use `RUNTIME_PROVIDER=claude-code`, `grok` or `antigravity`. Any image built
from `Dockerfile.unified` works as `BASE_IMAGE`, including a published
`X.Y.Z-base-<provider>` tag.

Rebuilding the runtime image alone does not pick up a change to the gateway:
the `openab` binary comes from the base, so moving the submodule pointer only
reaches users through a rebuild of both.

## Running one

The following example uses an existing historical release. For a newly published
monorepo version, use `ghcr.io/nuphos/runtime:<version>-codex` instead.
Give it a persistent home and start it:

```sh
docker run -d --name nuphos-runtime -p 8080:8080 \
  -v nuphos-runtime-home:/home/node \
  ghcr.io/zeabur/nuphos-runtime:0.0.12-codex
```

Use `0.0.12-claude-code` for a Claude Code runtime.

Then open its base URL in a browser (`http://<host>:8080/`, or its `https://`
address once TLS is in front). A fresh volume shows a setup page: choose a console
password of 12 characters or more, or let the runtime generate one. A generated
password is shown once and also written to the container log; one you choose is
never logged. Setup stays open for 30 minutes after each start
(`OPENAB_RUNTIME_SETUP_WINDOW_SECS`); after that the page asks you to restart the
container to reopen it. Set the password right after deploying, because until then
whoever opens the page first chooses it.

From then on the same page is the runtime's console. Sign in with the password to:

- connect the runtime to a Nuphos team (see [Connecting it to Nuphos](#connecting-it-to-nuphos));
- see every connected team, who connected it, when it was connected and last
  used, and revoke any of them;
- sign the agent's provider account in;
- see which command-line tools are built in, installed, or install on first use;
- change the console password. This signs other browsers out and does not affect
  connected teams.

The console keeps its state in `/home/node/.nuphos-runtime`: `console.json` holds
the password hash and when the runtime was set up, `bindings.json` holds a SHA-256
digest of each team's keys (never the keys), and `instance-id` identifies the
runtime. **`/home/node` must be persistent**, so mount a volume there as above.

#### Forgotten console password

Stop the container, delete `.nuphos-runtime/console.json` (and
`.nuphos-runtime/auth-key`, if it exists) from the `/home/node` volume, then start
it again. Setup reopens for 30 minutes. Connected teams keep working; delete
`bindings.json` as well to disconnect all of them.

#### A password in the environment

Setting `OPENAB_ACP_AUTH_KEY` still works. The runtime starts already set up, `/acp`
accepts that value as a deployment key (the console lists it but cannot revoke
it; remove the variable to do that), and it is the console password until you change
it in the console. It must be at least 32 characters, using only letters, digits
and ``! # $ % & ' * + - . ^ _ ` | ~``. It travels in a WebSocket header, so spaces,
quotes, `/`, `=` and `:` cannot be used. `openssl rand -hex 32` always qualifies. A
shorter one stops the container at startup with an error.

#### Without the console

`OPENAB_RUNTIME_CONSOLE=false` restores the behaviour of 0.0.x. On first boot the
runtime generates a password, stores it in `/home/node/.nuphos-runtime/auth-key`
(mode `0600`) and prints it once. Every Nuphos team connects with that one password.
`OPENAB_ACP_AUTH_KEY_FILE` moves the file. With the console on,
`NUPHOS_RUNTIME_AUTOGEN_PASSWORD=true` still generates that file on first boot (the
local compose stack uses it), and the console takes it as its password and as a
connection.

The volume also keeps the account the runtime signs in with
(`/home/node/.claude` for Claude Code, `/home/node/.codex` for Codex) and the
command-line tools it installs on first use across container replacement.

ACP is then served at `ws://<host>:8080/acp`, and Nuphos connects to it over
**`wss://`** — put TLS in front of the port. Most hosts terminate TLS for you
(Zeabur, for one, gives every service an HTTPS domain), so this is usually
nothing more than using the address they hand you; on a bare VPS, a reverse
proxy such as Caddy does it in one line.

The page at the base URL answers in every state and always shows the runtime's
provider and version, never a password or key, so it doubles as a status page.

A team's key is the only thing standing in front of an agent that holds your
workspace's cloud credentials, so `/acp` refuses any upgrade that does not present
a connected team's key or the deployment key (`401`). Before the runtime is set up,
it refuses every upgrade. Everything else ACP needs is already set in the image. To
turn ACP off entirely, set `OPENAB_ACP_ENABLED=false`.

The image ships a default `/etc/openab/config.toml`, so nothing has to be
mounted for the container to start. openab reads that one path and merges
nothing, so your own file replaces the default outright:

```sh
-v ./config.toml:/etc/openab/config.toml:ro
```

The baked default holds only what is true of the image — the agent's working
directory, its MCP call timeouts, the `BASH_ENV` guard, and for Codex the
containerized `agent-full-access` mode. If you replace it, keep
`working_dir = "/workspace"` under `[agent]`: openab ignores the directory a
client asks for and otherwise runs the agent in `$HOME`, where the team's skills
never land. Anything sized to a particular deployment, such as
`[pool]` capacity or per-tool memory ceilings, is left to whoever knows the
container's limits. The agent command itself is not pinned there: it stays on
`OPENAB_AGENT_COMMAND`, which each variant's image sets. See
[OpenAB's documentation](https://github.com/openabdev/openab) for the rest of
`config.toml`.

### What each provider needs beyond the password

Each runtime owns its own login. Nuphos never stores the account and never sends
one to a runtime it did not provision; it only shows what the runtime reports.

| Variant       | Sign in on the host                                                                   | Credential                                          |
| ------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `claude-code` | `docker exec -it nuphos-runtime claude auth login` (or run `claude` and use `/login`) | `/home/node/.claude/.credentials.json`              |
| `codex`       | `docker exec -it nuphos-runtime codex login --device-auth`                            | `/home/node/.codex/auth.json`                       |
| `grok`        | `docker exec -it nuphos-runtime grok login --device-auth`                             | `/home/node/.grok/auth.json`                        |
| `antigravity` | Sign in from the app (below)                                                          | `/home/node/.gemini/antigravity-acp/acp_token.json` |

You can also sign in from the app once the runtime is connected (see below). Either
way the credential is written inside the container, so mount the `/home/node` volume
from the quick start to keep it.

For Claude Code there is a third option: set `CLAUDE_CODE_OAUTH_TOKEN` on the
container yourself, for example to a token from `claude setup-token`. That token
takes precedence over any stored login, so the runtime then turns off sign-in from
the app and does not report a sign-in state.

### Connecting it to Nuphos

In the console, press **Connect to Nuphos**. Nuphos Desktop opens, shows the
runtime's address and asks which team to connect it to. Only teams you administer
can be picked. Confirm, and that team gets its own key for this runtime. To add the
runtime to another team, press **Connect to Nuphos** again.

If Nuphos Desktop does not open, go to **Settings → Agent → Connect your own**,
choose the pairing code option, and enter the agent URL and pairing code the console
shows. A code works once and expires after 10 minutes. Plain `ws://` is accepted only
for an in-cluster `*.svc` host; anything reached over the internet has to be
`wss://`.

The URL Nuphos connects to is taken from the address you opened the console at. If
Nuphos reaches the runtime at a different address, set it under **Agent URL Nuphos
connects to** in the console, or with `OPENAB_RUNTIME_PUBLIC_URL`. The local compose
stack is one example: your browser uses `127.0.0.1`, but the backend uses
`ws://runtime:8080/acp`.

A team's connection shows as waiting until Nuphos first uses it. Revoking it in the
console closes its sessions at once, and Nuphos then reports the connection as
revoked until someone connects the runtime again. Removing the runtime from a team in
Nuphos revokes that team's key on the runtime as well.

Each team only sees its own conversations on the runtime: its session list, stop,
steering and approvals cover the sessions it started, and it cannot resume another
team's. A connection made with the runtime password from 0.0.x, or with
`OPENAB_ACP_AUTH_KEY`, still sees every session.

That is not isolation. All connected teams still share this one runtime: one
filesystem (an agent working for one team can read and change files another team's
agent wrote), one provider sign-in and account, and the same installed tools. Connect
it only to teams that may share them.

Nuphos conversations have separate CLI homes under
`~/.nuphos/session-homes/<sha256-conversation-id>`. Both adapters give shell tools
that conversation's `HOME`, XDG directories, and explicit config paths for gcloud,
gh, AWS, Kubernetes, Azure, Docker, Git, npm and GPG. Exactly four caches stay in
the runtime home and are shared by every conversation: `GOCACHE`, `GOMODCACHE`,
`BUN_INSTALL_CACHE_DIR` and `PLAYWRIGHT_BROWSERS_PATH`. `XDG_CACHE_HOME` remains
per conversation because some tools keep login state there. Go does not
re-authenticate cached modules, so a private module fetched with one
conversation's Git credentials is readable by every conversation on the runtime.
The home persists across
new/load/resume and token refresh; existing runtime-global credentials are never
copied into it. Re-run credential setup inside the conversation after upgrading.
The agent provider's own login remains runtime-owned so this does not require a
new Claude/Codex login. Desktop bundles use the same adapter behavior.

This prevents accidental configuration collisions, not access by another process
running as the same OS user. Shared workspaces, installed tools, provider settings
and OS credential stores remain shared. Skills should respect the session paths;
in particular, GitHub installation tokens must be stored in the session's gh
config directly, not through `gh auth login` (even `--insecure-storage` can touch a shared OS keychain). Changing runtime-global
settings is possible but strongly discouraged unless the user understands the
impact on other sessions and explicitly requests that scope. Use separate runtimes
when a filesystem security boundary is required.

Everything else a Nuphos-provisioned pod has always had is already in the image,
so the agent reaches Nuphos' own tools as soon as it is connected — the container
only has to be able to resolve and reach the backend they are served from. The
team's skills arrive the same way: for a runtime it did not provision, the backend
hands each session a short-lived bundle address, and the runtime fetches the bundle
itself.

`GATEWAY_ALLOWED_USERS` is baked as the gateway-wide trusted-sender list, not an ACP
switch. If you also enable Discord, Slack or LINE on the same container, **add**
their sender ids to it rather than replacing the baked value, or those platforms
are denied instead.

To rotate a team's key, revoke it in the console and connect again. A runtime
without the console rotates its password by changing `OPENAB_ACP_AUTH_KEY` (or
replacing the stored file and restarting) and then updating it in Nuphos.

#### Separate operator key

The operator credential is derived from the password unless you set
`OPENAB_ACP_CONTROL_KEY` yourself, in which case the runtime uses yours. Only a
Nuphos-provisioned pod needs that: the provisioner issues both keys from its own
Secret. A self-hosted runtime gains nothing from a second value — anyone holding
the password can already run code in the container through the agent.

#### Upgrading from 0.0.x to 0.1.0

0.1.0 turns the console on. A volume that already has
`/home/node/.nuphos-runtime/auth-key` needs no setup: that password becomes the
console password, and every team already connected with it keeps working. The
console lists them together as "Connected with the runtime password". To give each
team its own key, press **Connect to Nuphos**, choose to update the existing
connection in Nuphos, then revoke the password connection in the console. The
`auth-key` file is left in place and never rewritten. One-click connect needs a
Nuphos release that supports pairing codes; the password keeps working with earlier
ones.

#### Upgrading from 0.0.6 or earlier

Those images need more than the password. 0.0.5 and earlier carry none of the ACP
environment, so without `OPENAB_ACP_MCP_SERVERS=true` the agent gets no Nuphos
tools, and without `GATEWAY_ALLOWED_USERS=acp_client` the runtime accepts a session
and then refuses its first prompt. Before 0.0.7 none of them derive the operator
key, so a runtime connected with only its password gets no status and no Codex
sign-in, and none create `/workspace`, so skills never land. Moving to 0.0.7 needs
no change to how the runtime is connected.

#### Upgrading a Claude Code runtime from 0.0.12 or earlier

Nuphos used to store a pasted Claude Code token and send it with every session. It
no longer does. Before upgrading Nuphos, sign the runtime in with one of the options
above, or its sessions will fail with "sign in required".

### Signing in from the app

Once a runtime is connected, press **Sign in** on its card, or use **Agent sign-in**
in the runtime's console. Either way the provider's own sign-in runs inside the
container, so you don't need a shell on the host. Only one sign-in runs at a time:
starting one, in the console or from Nuphos, stops any sign-in already running.

- **Codex:** the app shows a device code to enter on the ChatGPT page.
- **Grok Build:** the app shows a device code to confirm on the xAI page.
- **Antigravity:** the app opens Google's sign-in page. Google then sends the browser
  to `http://127.0.0.1:<port>/…`, which does not load because that address is inside
  the container; paste the whole address into the app and it is delivered there.
- **Claude Code:** the app opens Claude's sign-in page. After you approve, that page
  shows a code; paste it into the app. The code reaches `claude auth login` in the
  container through the operator channel (`_openab/runtime/login/input`).

The credential the flow creates stays in the container. Only the device code, the
authorize link, and the pasted code cross the wire. Afterwards the runtime reports
whether it holds a credential, so the card stops asking. Keep the `/home/node`
volume, or the sign-in is lost with the container. Claude Code images up to v0.0.12
ship a gateway that cannot relay the pasted code; on those the app reports that and
you sign in on the host instead.

The published images carry the two settings that enable this: the sign-in command
and the credential path. A hand-built image has to pass them itself:

```sh
# Codex
--build-arg 'RUNTIME_LOGIN_COMMAND=node /opt/nuphos-runtime/codex-login.mjs --install' \
--build-arg RUNTIME_AUTH_FILE=/home/node/.codex/auth.json
# Claude Code
--build-arg 'RUNTIME_LOGIN_COMMAND=node /opt/nuphos-runtime/claude-login.mjs' \
--build-arg RUNTIME_AUTH_FILE=/home/node/.claude/.credentials.json
# Grok Build
--build-arg 'RUNTIME_LOGIN_COMMAND=node /opt/nuphos-runtime/grok-login.mjs' \
--build-arg RUNTIME_AUTH_FILE=/home/node/.grok/auth.json
# Antigravity
--build-arg 'RUNTIME_LOGIN_COMMAND=node /opt/nuphos-runtime/antigravity-login.mjs' \
--build-arg RUNTIME_AUTH_FILE=/home/node/.gemini/antigravity-acp/acp_token.json
```

Self-hosting the rest of Nuphos is in progress and not documented here.

## Versions and tags

The version in `package.json` is the image's version. To release, merge a pull
request that bumps it: the `Release runtime` workflow then tags that commit
`runtime-vX.Y.Z` and publishes every provider from the tag. A push that leaves the
version on an existing tag publishes nothing. Builds always run `main`'s workflow
definition against a commit reachable from `main`.

Each release publishes four tags per provider:

| Layer               | Semantic tag             | Revision tag                       |
| ------------------- | ------------------------ | ---------------------------------- |
| Runtime             | `X.Y.Z-claude-code`      | `commit-<runtime-sha>-claude-code` |
| Runtime             | `X.Y.Z-codex`            | `commit-<runtime-sha>-codex`       |
| Runtime             | `X.Y.Z-grok`             | `commit-<runtime-sha>-grok`        |
| Runtime             | `X.Y.Z-antigravity`      | `commit-<runtime-sha>-antigravity` |
| Base (gateway only) | `X.Y.Z-base-claude-code` | `<openab-sha12>-base-claude-code`  |
| Base (gateway only) | `X.Y.Z-base-codex`       | `<openab-sha12>-base-codex`        |

Runtime revision tags name the full monorepo commit, so SDK and toolset changes
get distinct tags even when OpenAB is unchanged. Base revision tags name the
pinned OpenAB commit. A blank `release_tag` publishes only revision tags; only
a matching `runtime-vX.Y.Z` publishes semantic version tags.

Nuphos pins runtimes by immutable digest, never by tag:

```text
ghcr.io/nuphos/runtime@sha256:...
```

Publishing an image rolls nothing out. Each runtime is moved to a new digest
deliberately.

Images published before this repository existed live under the earlier package
name `ghcr.io/zeabur/nuphos-openab-runtime`. That package is retained, read
only, so runtimes pinned to one of its digests keep resolving; everything new
is published here.

## Relationship to zeabur/openab

[`zeabur/openab`](https://github.com/zeabur/openab) is a fork of
[`openabdev/openab`](https://github.com/openabdev/openab), carried here as the
`third_party/openab` submodule and pinned to an exact commit. It supplies the
gateway binary and `Dockerfile.unified`, whose `agentcore` target is the
base the runtime image takes it from. This repository adds the Nuphos layer on top and owns the published
images. Fixes to the gateway or the ACP pool belong upstream or in the fork,
not here.

## Development

```sh
npm test                    # adapter and helper unit tests
```

The smoke tests exercise the real pinned adapters against an offline Codex App
Server fixture, so they need the adapter installed first:

```sh
npm ci --ignore-scripts --prefix image/codex-acp
node test/codex-acp-smoke.mjs image/codex-acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js
```

CI runs all of them on every pull request, builds both runtime images on a
published gateway base, and smoke-tests them, including a first-use install of
an archive tool, a Debian-package tool and the C toolchain. The gateway base is
a Rust build, so it is built only when an image is published.

The console needs a gateway built from the pinned submodule, so its smoke test
runs against a local build rather than in PR CI. Build the base and the image, start
the image on a free port, and drive it from the host:

```sh
docker build -f third_party/openab/Dockerfile.unified --target agentcore \
  -t nuphos-openab-base:local third_party/openab
docker build image --build-arg BASE_IMAGE=nuphos-openab-base:local \
  --build-arg RUNTIME_PROVIDER=claude-code -t nuphos-runtime:local
docker run -d --rm --name nuphos-console-smoke -p 127.0.0.1:48080:8080 nuphos-runtime:local
node test/console-smoke.mjs http://127.0.0.1:48080
```

To check an upgrade instead, start the image on a volume whose
`.nuphos-runtime/auth-key` holds a password and pass `--legacy <password>`.

## Licence

Apache-2.0 — see [LICENSE](LICENSE).

The images built from this repository bundle third-party software under its own
licences, including software that is not open source: `@anthropic-ai/claude-code`
and the Claude Agent SDK are distributed under Anthropic's commercial terms.
[NOTICE](NOTICE) lists what is included and under what terms. The Grok Build CLI
(xAI) and the Antigravity ACP server (Google) are not in the images; a runtime
downloads them from their vendors on first use, under the vendors' terms. Nuphos
and Zeabur are not affiliated with, endorsed by, or sponsored by Anthropic,
OpenAI, xAI or Google.

### Automatic Claude SDK updates

`Update Claude SDK` checks npm's stable `latest` daily at 06:23 UTC, with a
manual **Run workflow** option. A newer SDK in the same major updates the SDK
override, lockfile and Dockerfile assertion together. Helpers, patched Claude
adapter regressions, an image build and native model discovery must pass before
it opens (or refreshes) the `runtime/update-claude-sdk` pull request with the
update and a runtime patch bump. Merging that pull request releases it through
`Release runtime`. No change means no pull request; SDK major changes require
manual review.

main only takes signed commits through a reviewed pull request, so the workflow
creates its commit with the GitHub API and never pushes to main. The pull request
is opened with `GITHUB_TOKEN`, which needs **Allow GitHub Actions to create and
approve pull requests** enabled; such pull requests do not trigger CI, so the
workflow's own checks are the gate. If publication fails after tagging, rerun the
failed jobs, or run **Build runtime image** with that tag; do not create another
version merely to retry. Publishing does not update Nuphos's configured runtime
version or the Desktop's pinned runtime commit; those remain separate deployment
steps.

### Release changelogs

[GitHub Releases](https://github.com/nuphos/nuphos/releases?q=runtime-v) is the runtime
changelog. Tagged builds publish a release only after all requested provider images
succeed. Notes include commits since the previous tag (including automated SDK
updates), bundled SDK/CLI and adapter versions, image tags and a full comparison
link. Untagged builds do not create releases. Reruns preserve existing notes and
human edits. Every release, manual or automatic, uses this same path.

### Automatic Codex CLI updates

`Update Codex CLI` checks npm's stable `latest` daily at 07:23 UTC
and supports manual dispatch. It updates the pinned CLI and lockfile, runs the
Codex adapter, active-turn steering and real CLI environment-isolation regressions,
then builds and smoke-tests a candidate image including prompt-free model discovery.
Only passing updates open (or refresh) the `runtime/update-codex-cli` pull request
with a runtime patch bump; merging it releases. No change opens nothing; major CLI
changes require manual review. If both update pull requests are open, they bump
the same version: merge one, and the next scheduled run rebases the other.

Both ACP adapters remain pinned: Nuphos patches their bundles, so adapter upgrades
require a reviewed patch port and compatibility tests. CLI/SDK updates are automatic;
ACP adapter updates are not. Deployment to existing runtimes remains separate.

The Codex candidate-image probe runs without an account: an explicit native
`Authentication required` response is expected and recorded as such. Other errors
remain fatal. Model/session/config behavior is exercised separately against the
App Server fixture; CI never supplies a customer's credential or sends a prompt.

## Monorepo migration and publishing cutover

Runtime sources, tests and the pinned OpenAB gitlink live in `apps/runtime`.
Run the commands in this README from that directory. Workflows live at the
repository root as `.github/workflows/runtime-*.yml`; shell steps run here,
while Docker build contexts are explicitly relative to the repository root.
Runtime versions remain independent of Backend and Desktop versions. Runtime
releases use `--latest=false` so they do not take over the repository-wide
latest release used by other components.

Publishing is disabled until the repository variable `RUNTIME_PUBLISH_ENABLED`
is `true`. Before enabling it:

1. Finish the runtime CI (both provider images and adapter smoke tests).
2. The image-build job uses its `GITHUB_TOKEN` with `packages: write` to publish
   `ghcr.io/nuphos/runtime`; no separate GHCR username or token is required.
   If the package already exists, grant `nuphos/nuphos` Actions access to it.
   Make the package public before enabling managed-agent updates or documenting
   pulls: runtime hosts resolve manifests and pull images anonymously.
3. Freeze the old repository's manual and scheduled releases, wait for active
   publishes to finish, and reconcile `package.json` with its final version.
   Never run both repositories' publishers concurrently. Before tagging or publishing
   a semantic version, every workflow checks the public legacy tags and refuses
   a version that is not strictly newer than all legacy stable versions. Lookup
   failures stop the release. For example, legacy `v0.1.10` reserves `0.1.10`;
   reconcile the baseline to at least `0.1.10` before a patch release of `0.1.11`.
4. Enable publishing and dispatch **Release runtime** with a patch bump and
   both providers. Verify both images and the `runtime-vX.Y.Z` GitHub release.
   Deploying those images to existing runtimes is a separate operation.

Backend update discovery filters stable `runtime-vX.Y.Z` releases and follows
pagination past other components' releases. Until the first such release exists,
it uses the old repository's latest release. Existing image references and
self-hosted Compose installs keep their existing pinned legacy images. New
monorepo releases resolve only from `ghcr.io/nuphos/runtime`; explicit historical
version pins can still resolve from the legacy package. CI and candidate builds
retain their existing published gateway base until a new base is available.
Desktop's local adapter bundle retains its existing pinned source commit during
this migration; changing that bundle is a separate runtime upgrade.

The initial source snapshot is imported from
[`zeabur/nuphos-runtime@ce0cfc0`](https://github.com/zeabur/nuphos-runtime/commit/ce0cfc06112cacff63365d7cd0953f8ebc32e64c); its original
history remains available there. Preserve this directory's LICENSE and NOTICE.

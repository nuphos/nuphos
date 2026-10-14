# Box: one way to run agents anywhere

Status: proposal. Requested by Yuanlin Lin; direction approved 2026-10-14.
Tracking: NUPS-1154.

## Summary

A **Box** is anything that can run commands: a MacBook, a Mac mini, a VM, a
Docker container, a Nuphos-managed pod. Every Box runs the same host,
`nuphos agent`, which dials out to Nuphos and serves both the local agents
(Claude Code, Codex, ...) and the local tools (`local_exec`, `local_terminal`,
`local_cua`). Desktop embeds that host. The official runtime image runs it as its
entrypoint.

Ownership is a separate layer: a Box belongs to a user or to a team, and the
owner decides who may use it.

A Box joins with a **join token**. One API call issues a single-use, short-lived
token that is bound to an owner. One command on the machine uses it:

```sh
curl -fsSL https://nuphos.ai/install | sh
nuphos agent --join nbj_7Hq...   # registers the Box, then runs it
```

The CLI exchanges the token for a **Box credential**. It is scoped to that Box,
it is not a user session, and it can be revoked on its own.

Boxes replace two concepts:

| Today                                                                                                                                | Problem                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Devices**: Desktop or `nuphos agent`, outbound tunnel, `local_exec`, owner-only, signed in with the user's JWT                     | Personal only. The machine holds a 30-day user JWT that cannot be revoked by itself. A headless machine cannot sign in (PR #325). |
| **Agent runtimes**: URL + password, inbound WebSocket, team-shared, per-session homes; Nuphos-managed ones are pods behind a Service | A second transport, a second key system (password, operator key, pairing), and a second catalog. Runtimes have no `local_exec`.   |

After the change there is one transport (the tunnel), one registry, one
credential, and one catalog. Most of the work is deleting code.

## What exists today

The two halves are already closer than their names suggest.

**Devices.** `nuphos agent` (`apps/cli/src/agent.rs`) downloads a Node bundle
built from Desktop's `apps/desktop/electron/main/local-runtime/cli-host.ts` and
runs it. Desktop and the CLI share `LocalRuntimeController`,
`RuntimeTunnelClient`, `LocalExecStream` and the openab process code. The host:

- registers with `PUT /agent/devices` into `agent_devices`
  (`{userId, deviceId, label, platform, allowLocalExec}`, unique on
  `{userId, deviceId}`, no team);
- derives `deviceId` from the machine (`sha256("nuphos-device-v1\0<kind>\0<machineKey>")`,
  #295), so Desktop and the CLI on one machine are two devices;
- opens `GET /agent/devices/:deviceId/runtime-tunnel` with `Authorization:
Bearer <user JWT>`. Presence lives in Redis
  (`agent:device:runtime:presence:<userId>:<deviceId>`, 15 s TTL) and reports
  `agents`, `localExec`, `localTerminal` and `localCua`;
- runs openab on loopback for Claude Code and Codex. The backend reaches it as
  runtime `local_<userId>_<deviceId>[_codex]` through the tunnel's `transport`
  and `control` streams.

`allowLocalExec` is always sent as `true`. Local runtimes are visible only to
their owner, and `list_agent_runtimes` and `update_thread` exclude them. Once a
conversation is on a local runtime, any teammate who may reply in it drives the
owner's machine (`conversation-chat-route.ts`).

**Agent runtimes.** `claude_code_runtimes` rows hold `{teamId, url, provider,
label, status, hostedBy?, authKeyEnvelope, controlKeyEnvelope, pairing?}`. The
backend dials `url` with `openab.bearer.<key>`. External runtimes are added by
URL + password (`POST /agent-runtimes/external`) or by pairing code
(`/pair`). Managed runtimes are reconciled into a Deployment, Service, Secret,
two PVCs and a ConfigMap (`runtime-reconcile.ts`). The catalog
(`runtime-catalog.ts`) merges these rows, a development endpoint and the
caller's own devices, and computes `kind: managed | external | development |
local`.

**Per-conversation credentials are already uniform.** Every turn, on every
runtime kind including local ones, the backend mints a token for exactly that
conversation and team and sends it in ACP `_meta` (`NUPHOS_TOKEN`,
`NUPHOS_SESSION_ID`, the two MCP servers). A runtime never needs a user
identity of its own. This is what makes the merge cheap: the Box only has to
prove _which machine it is_, never _who is using it_.

**Per-session homes.** The adapters put each conversation in
`$HOME/.nuphos/session-homes/<sha256(sessionId)>` with its own `HOME`, `XDG_*`,
cloud CLI configs, `KUBECONFIG` and git config (`session-home.mjs`). The agent
provider login (`CLAUDE_CONFIG_DIR`) and six build caches stay shared. Homes of
archived conversations and expired trigger runs are reclaimed by an hourly
sweep through the runtime's `panel` job (#271, #277, #324). Local runtimes are
skipped by that sweep.

## Concepts

- **Box**: one running `nuphos agent` host on one machine, identified by a
  `boxId`. It serves zero or more agents (providers) and zero or more local
  tools. Which ones it serves is live presence, not stored configuration.
- **Owner**: a user or a team. Never changes after join, except through an
  explicit transfer (see Decisions).
- **Users of a Box**: who may place conversations on it and run tools on it.
- **Join token** (`nbj_...`): single use, short lived, carries the owner and
  the Box's initial settings.
- **Box credential** (`nbx_...`): long lived, one per Box, authenticates only the
  host of that Box.

## Data model

### `boxes`

```ts
type Box = {
  _id: string                     // boxId, UUID
  owner:
    | { kind: 'user'; userId: string }
    | { kind: 'team'; teamId: string }
  machineId?: string              // the #295 id reported by the host
  label: string
  platform?: string               // darwin | linux | ...
  client: 'desktop' | 'cli' | 'image'
  users: 'owner' | 'team' | { userIds: string[] }   // team Boxes only; user Boxes are always 'owner'
  isolation: 'machine' | 'session'
  credential?: { hash: string; issuedAt: Date }     // sha256 of nbx_...; absent = revoked
  hostedBy?: 'nuphos'             // managed Boxes: the provisioner owns the pod
  image?: { requested: string; error?: string }     // managed Boxes only
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
  lastSeenAt?: Date               // written on tunnel close, for pruning (NUPS-1126)
}
```

Indexes: `{ 'owner.userId': 1 }`, `{ 'owner.teamId': 1 }`, unique
`{ 'credential.hash': 1 }` (sparse).

What is deliberately _not_ stored: providers, models, login state and tool
capabilities. They come from the presence `status` frame exactly as today, so a
Box that adds Codex or loses its display needs no write.

A user-owned Box keeps today's device behavior: it follows its owner into every
team the owner is an active member of. A team-owned Box exists in one team.

### `box_join_tokens`

```ts
type BoxJoinToken = {
  _id: string                     // sha256 of nbj_...
  teamId: string                  // the team it was issued in (for audit and team owners)
  owner: Box['owner']
  boxId?: string                  // reconnect an existing Box instead of creating one
  label?: string
  users?: Box['users']
  isolation?: Box['isolation']
  issuedByUserId: string
  expiresAt: Date                 // TTL index
  usedAt?: Date
  usedByBoxId?: string
}
```

Redemption is one `findOneAndUpdate({ _id, usedAt: null, expiresAt: { $gt:
now } }, { $set: { usedAt, usedByBoxId } })`. A second redemption, an expired
token, or an owner who has since left the team fails with one generic error.

### Box ids

Ids are deterministic so that rejoining the same machine, and migrating old
rows, land on the same Box without a lookup table:

```
boxId = uuidv5(NS_BOX, `${ownerKey}\0${machineId}`)
ownerKey = `user:${userId}` | `team:${teamId}`
```

`machineId` already encodes the client kind (#295), so Desktop and the CLI on one
machine stay two Boxes, as they are two devices today.

- A rejoin with the same owner on the same machine reuses the Box, its
  conversations and its settings, and rotates its credential.
- A join token with `boxId` binds to that exact Box regardless of machine. This
  is the "Reconnect" button, and the migration path for external runtimes.
- A host with no readable machine key (most containers) stores a random
  `machineId` in its data directory, so it keeps its id while its volume
  survives.
- Known caveat, carried over from #295: VM clones that share
  `/etc/machine-id` collapse into one Box, and the second join supersedes the
  first. Cloud images normally regenerate the id on first boot. The fix for
  images that do not is `systemd-machine-id-setup` in the image, not a server
  change.

## Join tokens

### Issuing

One endpoint, used by the UI, the CLI and scripts:

```
POST /teams/:teamId/boxes/join-tokens
{
  "owner": "me" | "team",
  "label": "build-runner-1",          // optional; default is the hostname
  "users": "team",                    // team Boxes only; default "team"
  "isolation": "session",             // default: "machine" for user Boxes, "session" for team Boxes
  "boxId": "…",                       // optional: reconnect this Box
  "expiresInSec": 900                 // default 900, max 86400
}
→ 201 { "token": "nbj_…", "expiresAt": "…", "command": "nuphos agent --join nbj_…" }
```

- `owner: "me"`: any active member, for themselves.
- `owner: "team"` or a `boxId` of a team Box: `ADMINISTRATOR` only.
- The caller authenticates as a user (session JWT, or a conversation principal
  acting for its user). A Box credential cannot issue tokens.
- The token is returned once and only its hash is stored.

Surfaces:

- **UI**: "Add a Box" shows the command with a fresh token, plus copy-ready
  Docker and cloud-init snippets. A team Box's page has "Reconnect", which issues
  a token with its `boxId`.
- **CLI**: `nuphos box token [--team] [--label L] [--ttl 1h]` prints the token
  and the command. It uses the CLI's own user sign-in.
- **API / agent**: the same endpoint. An agent can provision a VM and pass the
  token in its user-data.

### Joining

```
nuphos agent --join nbj_…      # or NUPHOS_JOIN_TOKEN=nbj_… nuphos agent
                               # or nuphos agent --join -   (read from stdin)
```

1. The CLI calls `POST /boxes/join` with `{ token, machineId, platform,
hostname, client, version }`. No user session is involved.
2. The backend redeems the token, creates or reuses the Box, generates
   `nbx_…`, stores its hash and returns `{ boxId, credential }`.
3. The CLI writes `{ apiUrl, boxId, credential }` to
   `<dataDir>/box.json` (mode 0600) and continues as a plain `nuphos agent`.
4. Later runs of `nuphos agent` find `box.json` and start directly. A
   leftover `NUPHOS_JOIN_TOKEN` is ignored when `box.json` exists, so a
   systemd unit or container env can keep it harmlessly.

A token on a command line can appear in shell history and `ps`. It is single
use and expires in minutes, and the env and stdin forms avoid it entirely; the
UI shows the env form for scripts.

### Scripts and cloud-init

```yaml
#cloud-config
runcmd:
  - curl -fsSL https://nuphos.ai/install | sh
  - useradd -m nuphos
  - loginctl enable-linger nuphos
  - su - nuphos -c 'NUPHOS_JOIN_TOKEN=nbj_… ~/.local/bin/nuphos agent --install-service'
```

```sh
docker run -d --name box \
  -e NUPHOS_JOIN_TOKEN=nbj_… \
  -v box-home:/home/node \
  ghcr.io/nuphos/runtime:<version>-claude-code
```

`--install-service` (new, small) joins, writes a systemd user unit (macOS: a
LaunchAgent) that runs `nuphos agent`, and starts it. Without it the command
runs in the foreground. PR #325 chose a README unit instead; a join flow that
is meant to be one command needs the flag.

A script that creates many machines issues one token per machine. Tokens are
single use on purpose: a leaked user-data blob then cannot enroll more Boxes.
A multi-use enrollment token (for autoscaling groups) is listed under
Decisions.

## Box credential

- Format `nbx_` + 32 random bytes, base64url. Stored as a sha256 hash on the Box.
- Sent as `Authorization: Bearer nbx_…`. The auth middleware tells it from a
  JWT by its prefix and resolves a **Box principal** `{ boxId, owner }`, not a
  user.
- It authorizes only:
  - `GET /boxes/self/tunnel` (the tunnel upgrade),
  - `PATCH /boxes/self` (label, platform, version),
  - `DELETE /boxes/self` (leave: revoke itself on sign-out or uninstall).
    Every other route rejects a Box principal.
- Lookups are cached for at most 15 s, like runtime keys today.

**Revocation.** `DELETE /teams/:teamId/boxes/:boxId/credential` (owner, or an
admin for team Boxes) unsets `credential`, then publishes `supersede` on the
Box's holder channel. The tunnel closes with a new code 4003 ("revoked"). On
4003 the host stops its agents, deletes `box.json` and exits non-zero, so a
service manager does not loop on it. Reconnecting needs a new join token.
Deleting the Box does the same and removes the row.

This closes the gap found today: a lost laptop's machine access can be revoked
without resetting the owner's password. It does not make the user's own Desktop
session JWT revocable; that is a separate auth change, and after this design no
host keeps that JWT for machine access.

**What changes on Desktop.** On sign-in, Desktop issues itself an `owner: "me"`
token with the user session and redeems it immediately, the same as any other
Box. Since the id is deterministic, the existing device keeps its id. On
sign-out Desktop calls `DELETE /boxes/self`. Desktop's own UI keeps using the
user session; only the host uses the Box credential.

## Ownership and permissions

|                                                                            | User-owned Box                          | Team-owned Box                                        |
| -------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Created by                                                                 | any member, for themselves              | an admin                                              |
| Visible to                                                                 | the owner, in every team they belong to | members of the team who may use it, and admins        |
| May use (place conversations, `local_exec`, `local_terminal`, `local_cua`) | the owner                               | `users`: whole team, or listed members; admins always |
| May rename, change users, revoke, delete                                   | the owner                               | admins                                                |
| Default isolation                                                          | `machine`                               | `session`                                             |

"Use" is one permission on purpose. A conversation running on a Box already
has a shell there through its agent's own Bash tool. `local_exec` from a
conversation running elsewhere is the same power reached from outside, so
splitting "may run conversations" from "may run commands" would not protect
anything.

**The acting user.** Every turn and every tool call is checked against the
human who sent the message that started it (`sender.id` in the turn metadata),
not against the conversation's owner:

- On a user-owned Box, only turns sent by the owner run. A teammate's message
  in a conversation placed on someone's laptop gets a clear refusal instead of
  running as the owner. This closes today's gap in `conversation-chat-route.ts`.
- On a team Box, the sender must be in `users`.
- Agent-to-agent and trigger turns act for the user who created the thread or
  trigger, as they do today.

**Full Access.** It keeps its meaning: per conversation and per user, it
auto-approves the agent's permission prompts (`auto_mode_authorizations`).
Boxes add no second approval layer. `local_exec` on a team Box needs "may use"
and, without Full Access, goes through the same permission prompt as the
agent's other tools. The audit log (`agent_device_exec_audit`, renamed
`box_exec_audit`) records the acting user for every command on every Box.

**Selection.** `credentialAccess.deviceIds` becomes `credentialAccess.boxIds`.
A conversation can select any Box its sender may use. The default stays
"the sender's own online Boxes", so team Boxes are opt-in per conversation.

## Credentials on a Box

There are two sources, and the isolation mode decides which one a session sees.

1. **The machine's own logins**: whatever the OS user running `nuphos agent` has:
   `claude` / `codex` login, `gh`, `aws`, SSH keys, Keychain.
2. **Nuphos-injected, per conversation**: `NUPHOS_TOKEN` and the session env
   sent each turn, from which skills fetch the cloud credentials the
   conversation selected. Unchanged from today.

|                                           | `machine` isolation                         | `session` isolation                                              |
| ----------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| Agent provider login                      | the machine's                               | the Box's (shared by all sessions, as on managed runtimes today) |
| Tool logins (`gh`, `aws`, `kubectl`, git) | the machine's, plus Nuphos-injected         | Nuphos-injected only, inside the session home                    |
| `local_exec` env                          | the user's login shell, as on Desktop today | the conversation's session home                                  |
| Intended for                              | a person's own computer                     | anything more than one person uses                               |

On a `session` Box the provider login is set once per Box: during the join if
the terminal is interactive (the CLI host already runs `claude auth login` when
needed), or later through the existing runtime login flow
(`runtime_login_attempts`). Whose subscription pays is visible on the Box page.

## Isolation and home reclaim

Per-session homes move from "a runtime feature" to "a host feature": the same
`session-home.mjs` runs in every Box, and the mode only decides whether tool
logins and `local_exec` stay inside it.

- `local_exec` on a `session` Box runs with the conversation's session-home
  env. The backend already sends the session id with every exec (it is in the
  audit row); the exec stream applies it.
- The reclaim sweep (#271/#277/#324) drops its `local` skip and runs for every
  Box. It still needs the conversation to be dormant, still scans for live
  processes, and still renames before deleting. The host must expose the
  `panel` job that the sweep calls; Desktop's openab config does not declare it
  yet, so the host adds it once for Desktop, CLI and image.
- Pool size (`max_sessions`) and session TTL become host settings with today's
  values (8 sessions, 4 hours) as defaults.

The limit is stated plainly in the UI: a session home is not a security
boundary. All sessions on a Box run as the same OS user and can read each
other's homes. A team Box is for people who already trust each other with that
machine. Per-session OS users or per-session containers can come later inside
the host without changing this model.

## Migration

Every existing id keeps working.

**Devices → user Boxes.** A one-time backfill writes one Box per
`agent_devices` row with `_id = uuidv5(NS_BOX, "user:<userId>\0<deviceId>")`,
`machineId = deviceId`, `isolation: 'machine'`, no credential. Old hosts keep
working because the tunnel still accepts the user JWT for a Box owned by that
user, during a deprecation window. When a new host first joins, the
deterministic id lands on the same Box.

- `credentialAccess.deviceIds` is backfilled to `boxIds`. Until the backfill
  finishes, reads map `deviceIds` to Box ids with the same uuidv5.
- Runtime ids `local_<userId>_<deviceId>[_codex]` on conversations are
  rewritten to `{ runtimeId: <boxId>, agentRuntime: <provider> }`. The parser
  stays for one release for anything missed.
- Presence keys move to `box:presence:<boxId>`; hosts write the new key on their
  next connect.

**Managed runtimes → team Boxes, same id.** Each `hostedBy: 'nuphos'` row
becomes a Box with `_id = <runtime row _id>`, `owner: team`, `client: 'image'`,
`isolation: 'session'`, `users: 'team'`. Conversations' `runtimeId` is unchanged.
The provisioner writes a Box credential into the pod's Secret (it is the backend;
a join token would add nothing), the image entrypoint runs `nuphos agent`, and
the pod dials the in-cluster backend. The Service, the URL and the transport
keys go away. Home and workspace PVCs stay, so homes and workspaces survive.

**External runtimes → team Boxes, same id.** Each external row becomes a Box
with `_id = <runtime row _id>` and no credential, and it keeps working over URL +
password during the window. Its page shows "Convert to Box": a join token with
that `boxId`, to run in the runtime's container on the new image. Once that Box
connects, the backend stops dialing the URL.

**The development endpoint** becomes a dev Box joined with a token.

**Self-hosting.** Today `deploy/compose` connects its runtime with a password,
a runtime console and a pairing code, plus a `ws://runtime:8080/acp` address
the backend dials (`deploy/compose/README.md`). With Boxes it becomes: sign in,
press "Add a Box", put the token in `.env` as `NUPHOS_JOIN_TOKEN`, and
`docker compose up -d runtime`. The runtime dials `http://backend:3000`, so
`NUPHOS_LOCAL_STACK`'s internal-host exception for `ws://` URLs is no longer
needed. `smoke.py` issues the token through the API. The Zeabur and Railway
templates change the same way.

**Conversations in flight.** A move between Boxes uses today's runtime-move
path unchanged. Placement (`claudeCodePreview.runtimeUrl`) is matched by
`runtimeId` instead of URL.

## What is deleted

At the end of the last phase:

- **Inbound transport**: `openab-acp-connect.ts` URL dialing,
  `team-openab-runtime.ts`'s per-URL connection cache, `runtime-backend-url.ts`,
  `runtime-statusz.ts`, the managed runtime Service, and the image's network
  listener. The runtime console's connect and password pages go with it; its
  Claude sign-in page is already covered by the app's **Sign in** button.
- **Second key system**: `authKeyEnvelope`, `controlKeyEnvelope`, the
  Kubernetes-Secret key fallback, the HMAC operator-key derivation in backend
  and `runtime-start.sh`, `PUT …/keys`.
- **Pairing**: `runtime-pairing-client.ts`, `POST /agent-runtimes/pair`, the
  `/_openab/pairing` and `/_openab/bindings` calls.
- **Routes**: `POST /agent-runtimes/external`, `/probe-provider`, the legacy
  `/claude-code-runtimes` and `/codex-runtimes` routes, `PUT /agent/devices`,
  `GET /agent/devices/:deviceId/runtime-tunnel`.
- **Second catalog**: `local-runtime-catalog.ts` as a separate path, the
  computed `kind`, the `local_…` id scheme and `nuphos-device://` URLs, the
  "not to a computer" branch in `update_thread`, and the local-runtime
  exclusion in `list_agent_runtimes`.
- **Collections**: `agent_devices` and `claude_code_runtimes` (after the
  backfill and window); `allowLocalExec`, which is always true.
- **CLI host**: the user-JWT handling in `cli-host.ts` (reading `cli.yaml`,
  `unverifiedTokenSubject`, the 2-second poll for a changed subject), and the
  requirement to `nuphos login` before `nuphos agent`.
- **Reclaim special case**: the `local` skip in `runtime-session-home.ts`.

`local_terminal` and `local_cua` stay. They are capabilities a Box reports, not
separate concepts.

## PR #325 (headless login)

The join token makes PR #325 unnecessary for its stated goal, "let a headless
Linux server act as a Nuphos device". With Boxes the server never signs in as
a person, and it cannot hold a user JWT at all. #325's paste-back login would
also put a 30-day, non-revocable user JWT on a shared server, which is the gap
this design closes.

What #325 still covers is a person using the `nuphos` chat CLI over SSH. That
is a different, rarer need, and if it matters it is better served later by the
standard device-authorization grant (RFC 8628) than by pasting a localhost URL.
Recommendation: close #325 and fold its README section (systemd unit,
`enable-linger`) into the join docs of phase 1.

## Phases

Each phase ships alone and leaves the product consistent.

1. **Join tokens and Box credentials for user Boxes.** Add `boxes` and
   `box_join_tokens`, backfill devices, the issue/join/revoke endpoints,
   `nuphos agent --join` and `--install-service`, the Box principal, tunnel
   code 4003, and `nuphos box token`. The tunnel accepts both Box credentials
   and user JWTs. Devices list becomes Boxes list with "Revoke". Outcome: a
   headless VM becomes a personal Box with one command; #325 closes.
2. **Desktop joins as a Box.** Desktop redeems a self-issued token on sign-in,
   leaves on sign-out, and no longer sends its user JWT on the tunnel. Enforce
   the sender check on user Boxes. Outcome: no host anywhere uses a user JWT for
   machine access (old clients still work until the window ends).
3. **Team Boxes.** `owner: team`, `users`, `isolation: session`, session-home
   `local_exec`, the `panel` job in the host, reclaim for all Boxes, Boxes in
   the catalog, `list_agent_runtimes` and `update_thread`, and `boxIds`
   selection. Outcome: a team can share a Mac mini or a VM for both
   conversations and `local_exec`.
4. **Managed runtimes become Boxes.** Image entrypoint runs `nuphos agent`, the
   provisioner writes a Box credential instead of transport keys and drops the
   Service, rows are backfilled with the same id. Outcome: one transport for
   everything Nuphos runs.
5. **External runtimes convert; delete.** "Convert to Box" for external rows,
   a dated deprecation notice, then remove URL + password, pairing, the legacy
   routes, `agent_devices`, `claude_code_runtimes` and the user-JWT tunnel path.

## Decisions for Yuanlin

1. **Teams for user Boxes**: keep "follows the owner into every team"
   (today's device behavior, recommended), or bind each user Box to one team.
2. **Sender check on user Boxes**: refuse teammates' turns on someone's
   personal Box (recommended; closes a real gap), or keep today's behavior.
3. **One "use" permission** for team Boxes, covering conversations and
   `local_exec` alike (recommended), or a separate exec permission.
4. **Multi-use enrollment tokens** for autoscaling groups: not now
   (recommended), or a capped `maxUses` on the token.
5. **Token lifetime**: 15 minutes by default, 24 hours maximum.
6. **Transfer**: allow moving a user Box to the team (re-issues the
   credential), or require a fresh join. Recommended: fresh join, nothing to
   build.
7. **Deprecation window** for user-JWT tunnels and URL + password runtimes
   (proposed: two Desktop/CLI releases and 60 days for external runtimes).
8. **PR #325**: close it as above, or merge it for the SSH chat-CLI case.
9. **Session isolation strength**: ship team Boxes with session homes only
   (same OS user, stated in the UI, recommended), or block team Boxes until
   per-session OS users exist.

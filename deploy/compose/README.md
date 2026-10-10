# Nuphos local stack (docker compose)

One `docker compose up` brings up a complete, minimal Nuphos:

| Service   | Image                                   | Purpose                                                   |
| --------- | --------------------------------------- | --------------------------------------------------------- |
| `mongo`   | `mongo:8.0.32`                          | Single-node replica set (`rs0`), required by transactions |
| `rustfs`  | `rustfs/rustfs:1.0.0`                   | S3-compatible storage; initializes buckets on boot        |
| `backend` | built from `apps/backend/Dockerfile`    | Nuphos backend, one replica                               |
| `runtime` | `ghcr.io/nuphos/runtime:${RUNTIME_TAG}` | Claude Code agent runtime                                 |

All data lives in local volumes and **never touches production Mongo, Redis or S3**. There is no Redis: the backend runs in single-replica in-memory mode.

Mongo sits only on the internal `data` network, reachable by services on that network. The `runtime`, which executes agent code, is not on that network.

The runtime is connected the same way as any self-hosted agent: from its console, which hands Nuphos a single-use pairing code. The runtime signs in to Claude itself, once; the login lives on its `runtime-home` volume.

This page covers the full stack with no dev server. `bun run dev` at the repository root reuses the same service definitions through `docker-compose.dev.yml`: it starts only `mongo`, `rustfs` and `runtime` (compose project `nuphos-dev`, with volumes separate from this stack), publishes Mongo and the runtime on `127.0.0.1`, runs the backend on the host with hot reload, and never connects the runtime to a team: add it in Settings with the address `ws://localhost:18180/acp` and the password from `bun run dev:runtime-password`. Stop one stack before starting the other, since both bind RustFS to port 9000 (`bun run dev:stop` stops the dev one). See the root README.

## Prerequisites

- Docker Desktop (or Docker Engine with Compose v2.24+)
- `openssl`
- Apple Silicon: the runtime image is amd64 only and runs under emulation (enable Rosetta in Docker Desktop), so it starts slower
- `127.0.0.1:3000` (backend), `127.0.0.1:9000` (RustFS), and `127.0.0.1:18180` (runtime console) free on the host; otherwise change `BACKEND_PORT` / `RUSTFS_PORT` / `RUNTIME_PORT` in `.env` (changing `RUSTFS_PORT` breaks Desktop file transfers)

## Start

```sh
cd deploy/compose
./init-env.sh                 # writes .env with freshly generated secrets
docker compose up -d --build --wait --wait-timeout 600
docker compose ps             # wait until rustfs, backend and runtime are healthy
```

Without `init-env.sh`, copy `.env.example` to `.env` and fill each value with the `openssl` command noted on its line.

To change the runtime version, edit `RUNTIME_TAG` in `.env` (for example `0.1.18-claude-code`), then run `docker compose up -d runtime`.

## First sign-in

There is no mail service locally. The backend runs with `NUPHOS_DEV_EMAIL_OTP_LOG=true`, so sign-in codes are written to its log instead of being emailed (the setting has no effect when `NODE_ENV=production`).

1. On the Nuphos Desktop sign-in screen, enter any email (for example `me@example.com`) and request a code.
2. Read the code from the log:

   ```sh
   docker compose logs backend | grep auth.email_otp.dev_code
   ```

3. Enter the 6-digit `sign_in_code`. The first sign-in creates the user; then create a team when prompted.

## Point Nuphos Desktop at the stack

Desktop accepts plain http on localhost, so no TLS or self-signed CA is needed.

The simplest way is on the sign-in screen: click **Self-hosted? Set API endpoint**, enter `http://localhost:3000` and save; the app switches to the stack immediately and remembers it until you choose **Use Nuphos Cloud**. Alternatively, set the variable at launch:

Installed app (macOS):

```sh
NUPHOS_API_URL=http://localhost:3000 /Applications/Nuphos.app/Contents/MacOS/Nuphos
```

For development from source, run `bun run dev` from the repository root.
The development launcher starts and connects its own complete local stack;
it does not attach Desktop to this separately started compose stack.

The sign-in token is stored in `~/.config/nuphos/cli.yaml`, which the local stack shares with production. After signing in locally, you need to sign in again when switching back to production.

## Connect the runtime

1. Print the runtime password. This compose file sets `NUPHOS_RUNTIME_AUTOGEN_PASSWORD=true`, so the runtime generates it on first boot, logs it once, and keeps it on the `runtime-home` volume:

   ```sh
   docker compose logs runtime | grep 'runtime password'
   # or, at any time:
   docker compose exec -T runtime cat /home/node/.nuphos-runtime/auth-key
   ```

2. Open the runtime console and sign in with that password. Both stacks publish it at <http://127.0.0.1:18180> by default (`RUNTIME_PORT` in `.env`).

3. In the console, set the public URL to `ws://runtime:8080/acp`. That is the address the backend dials from inside the compose network, not the one your browser uses. Then choose **Connect to Nuphos**.

   Nuphos Desktop opens **Connect this agent to a team**: pick the team, then press **Connect agent**. A Desktop run from source handles `nuphos://` links only with `ATLAS_REGISTER_NUPHOS_PROTOCOL=1`. Without it, open Settings → Agent → **Add agent** → **Self-hosted Cloud Agent** and paste the address and pairing code the console shows. An image without the console connects the same way through **Use a password instead**, with the address `ws://runtime:8080/acp` and the password from step 1.

   The backend exchanges the code with the runtime for a key that belongs to this team alone, and detects that the runtime runs Claude Code. This compose file sets `NUPHOS_LOCAL_STACK=true` (ignored when `NODE_ENV=production`), so the backend treats a single-label host such as `runtime` as internal: plain `ws://` is accepted, and the runtime calls the backend back at `http://backend:3000`.

4. Sign the runtime in to Claude once, from the console or with:

   ```sh
   docker compose exec runtime claude auth login
   ```

   The login is stored in `/home/node/.claude/.credentials.json` on the `runtime-home` volume, so it survives restarts. The **Sign in** button on the runtime's card does the same from the app. An operator may instead set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) on the `runtime` service.

Cloud and database CLIs are not baked into the image: the runtime installs each one the first time the agent needs it, into the `runtime-home` volume, so later uses and restarts skip the download.

The console lists every team connection with who made it, and revoking one there disconnects only that team. Removing the runtime from Settings → Agent revokes its connection on the runtime too.

## Verify

With Python 3 installed, run `python3 smoke.py` after the stack is healthy.
It creates a test user/team, checks Mongo readiness and confirms Redis and cron are disabled, signs in using
an email OTP, registers the runtime with provider detection, checks its status,
and uploads/finalizes/downloads a file through RustFS. It does not require
model credentials or call a paid model. The Compose GitHub Actions workflow
runs this against fresh volumes, then the test restarts the services and verifies
the same sign-in, team, runtime credentials and stored file still work.
The test leaves its user/team and tiny file in this local database; use the
Reset procedure only when you want to erase all local data.

**Chat**: start a new conversation on the runtime you connected and send a message; a reply should arrive.

**Dashboards panel**: create a dashboard and add a panel (for example, ask the agent to build one in chat), then refresh it; the panel runs inside the `runtime` container as a `panel` job.

Checking with curl:

```sh
curl -s localhost:3000/health/ready
curl -s -X POST localhost:3000/auth/email/request-code \
  -H 'content-type: application/json' -d '{"email":"me@example.com"}'
CODE=$(docker compose logs backend | grep auth.email_otp.dev_code | tail -1 | sed -E 's/.*"sign_in_code":"([0-9]{6})".*/\1/')
TOKEN=$(curl -s -X POST localhost:3000/auth/email/verify-code \
  -H 'content-type: application/json' -d "{\"email\":\"me@example.com\",\"code\":\"$CODE\"}" | jq -r .token)
TEAM=$(curl -s -X POST localhost:3000/teams -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Local"}' | jq -r .team.id)
curl -s localhost:3000/teams/$TEAM/agent-runtimes -H "authorization: Bearer $TOKEN" | jq
```

After connecting the runtime, the last request lists it with `kind: "external"`.

## File transfers (optional)

File uploads and downloads use presigned URLs whose host is `rustfs`. To let Desktop reach them directly, add a hosts entry:

```sh
echo '127.0.0.1 rustfs' | sudo tee -a /etc/hosts
```

## Test managed agents locally (OrbStack)

Managed agents are the one thing this stack cannot run: they are Kubernetes
Deployments the backend's provisioner creates. `bun run dev --managed` at the
repository root adds them on top of the dev stack, using OrbStack's built-in
Kubernetes:

```sh
orbctl start k8s
bun run dev --managed
```

Then add **Nuphos Managed Cloud Agent** in Settings › Agents. Its pod lands in
the `openab-runtimes-local` namespace of the `orbstack` context; the launcher
refuses any context that is not a cluster on this machine. See the root README
for the details and cleanup.

## Reset

```sh
docker compose down -v        # remove the containers and every volume (Mongo, RustFS, runtime data)
rm .env                       # start over with new secrets too
```

## Known limitations

- No Redis: cron scheduling, background thread queues and audit journal sealing are disabled. Both Compose and `bun run dev` use single-replica in-memory mode.
- No Bedrock keys: the backend's own model calls (conversation titles, dashboard insights, the auto-mode judge) are unavailable. Chat on the runtime is unaffected.
- `/admin` is not configured.
- This is a development stack: `NODE_ENV=development`, secrets in a local `.env`, and every port bound to `127.0.0.1` only. Do not expose it publicly.

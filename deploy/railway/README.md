# Railway deployment templates

Railway [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)
replaces the deprecated `railway.json` format. This directory contains two project
specifications, with no Redis:

- `.railway/railway.ts`: backend, authenticated single-node MongoDB replica set,
  and RustFS, with persistent data volumes.
- `.railway/runtime.ts`: one Claude Code runtime in a **different project**.
  Its single home volume also stores `/workspace`; initialization drops root
  privileges before starting the agent.

The data spec reads the bootstrap scripts from `../zeabur/template.yaml`, so use
a checkout of this repository, not a standalone copy of this directory.
These are source templates, not published Railway marketplace template IDs.

## Deploy the data project

Prerequisites: Node 22.18+, the current Railway CLI with `railway config` support,
a Railway account with volume capacity, two custom domains whose DNS you control,
and a Zeabur Email API key with a verified sender. The default data volumes are
10 GiB each in `us-west2`; services are explicitly placed in the same region.
Keep service and volume regions aligned when customizing; changing an existing
volume region can require a destructive replacement. Review capacity and pricing before applying.

```sh
cd deploy/railway
npm ci
cp .env.example .env
chmod 600 .env
```

Edit `.env` with your domains (hostnames only), email settings, and three independent
random secrets. `openssl rand -hex 32` generates a suitable secret. Keep this file
private and stable across subsequent plans and redeploys; replacing Mongo's root
password in the environment does not rotate the password in an existing database.
The backend JWT secret must also remain stable.

In this shell, load the data inputs, authenticate, and link an **empty data project**:

```sh
set -a
. ./.env
set +a
railway login
railway link
railway config plan --file .railway/railway.ts
railway config apply --file .railway/railway.ts
```

Review the plan before approving it. Configure the DNS records Railway provides
for both custom domains. MongoDB has no public TCP proxy. The backend uses the
private Mongo hostname, while presigned S3 URLs use the public HTTPS storage
domain so Desktop and external agents can reach them. Mongo announces `localhost`
as its single-node replica identity, with `directConnection=true` on the private
client connection, so replacing a container does not invalidate replica membership.
RustFS uses `RAILWAY_RUN_UID=0` to write Railway's root-owned volume; the isolated
agent still drops to UID 1000.

Wait for `https://<API_DOMAIN>/health/ready` to return 200. Services restart automatically if backend startup races Mongo initialization. Confirm
`/health/redis` reports disabled. In Nuphos Desktop select **Self-hosted? Set API
endpoint**, enter the backend HTTPS origin, sign in by email, and create a team.

## Deploy the runtime project

Use a **separate shell and Railway project**, with no shared database, storage,
email or backend administrative credentials. Project separation also keeps the
agent out of the data project's private network.

```sh
cd deploy/railway
cp runtime.env.example runtime.env
chmod 600 runtime.env
# Edit runtime.env: supply a third hostname and a random password of 32+ characters.
set -a
. ./runtime.env
set +a
railway link
railway config plan --file .railway/runtime.ts
railway config apply --file .railway/runtime.ts
```

Verify that the CLI names the **runtime project**, not the data project, before
applying. The Dockerfile source defaults to `nuphos/nuphos` on `main`. To test an
unmerged branch or deploy a fork, set `NUPHOS_GITHUB_REPO` and
`NUPHOS_GITHUB_BRANCH` in this shell before planning. The source must contain
`deploy/railway/runtime/Dockerfile`. The spec explicitly selects the Dockerfile
builder. Verify the deployed commit before pairing the runtime.

Set the runtime domain's DNS record. Open its HTTPS console using
`RUNTIME_PASSWORD`, set the public URL to `wss://<RUNTIME_DOMAIN>/acp`, pair it with
your team using the single-use code, and sign in to your own Claude account.
Keep the home volume when redeploying: it contains credentials and workspaces.

To publish native marketplace templates later, use Railway's
[`railway templates create`](https://docs.railway.com/cli/templates) on each
verified project separately. Review and remove deployment-specific secrets before
publishing. This repository does not publish or create Railway resources in CI.

## Validation and scope

```sh
npm ci
npm run check
npm test
# Docker required: verifies the wrapper starts as uid 1000 and preserves home/workspace.
python3 smoke.py
```

CI evaluates both specs with the official SDK, checks service/credential
separation and shell syntax, tests the runtime wrapper across container
replacement, and tests the shared Mongo bootstrap in the Zeabur job.
Railway routing, DNS, email delivery and model inference require a real deployment
and are not exercised by these offline checks.

A live Railway deployment on 2026-10-08 verified backend readiness, Redis disabled,
Mongo transactions, public HTTPS S3 upload/download, and runtime UID 1000. Mongo,
S3 objects and runtime home/workspace files survived service restarts. This used
two isolated projects, generated Railway domains and 1 GiB test volumes. Email
sign-in, model inference and custom-domain DNS were not tested.

Keep one backend replica. Redis-backed cron, background thread queues and journal
sealing are disabled. Backend model features and Kubernetes-managed agents need
separate configuration. Volume snapshots/backups are the operator's responsibility.

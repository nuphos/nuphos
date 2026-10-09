# Render Blueprints

[`render.yaml`](render.yaml) creates the complete Redis-free data stack: a private,
authenticated MongoDB replica set, public HTTPS RustFS storage and the released
backend. [`runtime.yaml`](runtime.yaml) creates the agent runtime separately.
MongoDB runs on Render with a persistent disk; no external MongoDB is required.

## Deploy

1. Create a Blueprint from this repository and branch, using Blueprint Path
   `deploy/render/render.yaml`. Review the paid plans and three services before applying.
2. Provide a Zeabur Email API key (`ZSEND_API_KEY`) and verified sender
   (`NUPHOS_EMAIL_FROM`) when prompted. JWT, database and S3 secrets are generated
   by Render. Do not replace them on redeploy.
3. Wait for `/health/ready` on the backend's generated HTTPS URL to return 200.
   Mongo initialization can take a few minutes. `/health/redis` reports disabled.
4. Create a second Blueprint with Path `deploy/render/runtime.yaml`. Data uses
   **Oregon**, runtime uses **Ohio**: Render services share a private network in
   the same workspace and region, so a separate Blueprint alone is not isolation.
   Keep these regions different, or use separate workspaces. Do not attach data
   environment groups or database, storage or email credentials to the runtime.
5. Open the runtime's generated HTTPS URL. Its console password is the generated
   `OPENAB_ACP_AUTH_KEY` service variable. Set its public URL to
   `wss://<runtime-host>/acp` and use its single-use code to pair with your team.
6. In Nuphos Desktop choose **Self-hosted? Set API endpoint**, enter the backend
   HTTPS URL, sign in with the email code and create a team. Sign in to Claude
   from the runtime console before testing chat.
7. Upload/download a small file, redeploy the services and confirm the same
   account, file and runtime workspace still work.

The backend resolves service references at startup, because Blueprint YAML does
not support variable interpolation. Signed transfer URLs use the public storage
hostname, reachable by Desktop and the isolated runtime. Mongo has no public
endpoint. Mongo's replica identity is localhost; private clients connect directly.
The storage Dockerfile initializes a root-owned disk; the backend and agent run
as their upstream non-root users. Runtime reuses the already tested one-volume
wrapper, which persists both home and workspace and drops root before starting.

## Cost and scope

All four services use paid `1c-2g` compute plans. Mongo, storage and runtime each
have a 10 GB persistent disk. Review Render's current price estimate before
applying; these services keep incurring charges while retained. This is a
single-node deployment, with no database high availability. Disks prevent data
loss on redeploy, but are not a substitute for backups.

No Redis, cron scheduling, background thread queues or journal sealing. Backend
model features and Kubernetes-managed agents need separate configuration. Email
and model accounts are operator inputs. Auto-deploy is off for Git-built services.
Removing a service from a Blueprint does not delete the existing cloud resource.

## Validation

```sh
python3 -m pip install PyYAML==6.0.3
python3 deploy/render/check.py
python3 deploy/render/smoke.py  # Docker: backend env mapping; no cloud resources
# Optional official structure validation with an installed Render CLI:
render blueprints validate deploy/render/render.yaml
render blueprints validate deploy/render/runtime.yaml
```

CI checks references, persistence and network separation, shell syntax, and the
backend startup's environment mapping, readiness, authenticated Mongo transactions,
signed S3 writes/reads and disk persistence across container replacement. The Mongo
and storage bootstrap commands are the same scripts as the Zeabur template.
The existing Zeabur Mongo and runtime Docker tests exercise those shared paths.
This does not verify Render provisioning, domain assignment, production email
or model inference.

References: [Blueprint specification](https://render.com/docs/blueprint-spec),
[private networking](https://render.com/docs/private-network),
[persistent disks](https://render.com/docs/disks).

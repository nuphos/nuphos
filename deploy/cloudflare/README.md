# Cloudflare Containers + R2 template

This template runs the released Bun backend in a
[Cloudflare Container](https://developers.cloudflare.com/containers/) behind a
Worker. All requests route to one named instance; Redis is disabled. It requires
a Workers Paid plan with Containers enabled, Docker, and Node 22.18+.

**This is a backend template, not an all-in-Cloudflare installation.** Provide:

- An external, authenticated MongoDB **replica set** with TLS, reachable from
  Cloudflare Containers. Configure its network policy for the deployment and use
  a dedicated database credential. A standalone MongoDB cannot support transactions.
- An isolated persistent agent runtime, for example the
  [Railway runtime project](../railway/README.md#deploy-the-runtime-project) or
  [Zeabur runtime template](../zeabur/runtime-template.yaml). Do not pass the
  backend's MongoDB, R2, email or Cloudflare deployment credentials to the agent.
- A Zeabur Email API key and verified sender for production email sign-in.

Container disks are [ephemeral](https://developers.cloudflare.com/containers/faq/).
This template therefore keeps MongoDB and agent workspaces outside Containers;
R2 stores file transfers and skills. It does not attempt to run MongoDB or the
agent on an ephemeral disk or emulate POSIX persistence with an object bucket.

## Configure and deploy

```sh
cd deploy/cloudflare
npm ci
npx wrangler login
npx wrangler r2 bucket create nuphos-file-transfers
npx wrangler r2 bucket create nuphos-skills
cp secrets.json.example secrets.json
chmod 600 secrets.json
```

Edit the private `secrets.json` file:

- Set the external Mongo URI (including authentication, database and replica-set
  options supplied by your provider) and a stable random JWT secret of 32+ characters.
- Set `NUPHOS_PUBLIC_BACKEND_URL` to this Worker's HTTPS origin, normally
  `https://nuphos-backend.<your-workers-subdomain>.workers.dev`. If using a custom
  domain, configure that Worker route and use its origin instead.
- Fill in the production email key and verified sender.
- Create an [R2 S3 API token](https://developers.cloudflare.com/r2/api/tokens/)
  with Object Read & Write permissions scoped to the two buckets. Set its **S3
  access key ID and secret access key**, not a general Cloudflare API token.
  `R2_ENDPOINT` is `https://<account-id>.r2.cloudflarestorage.com` and the S3 region
  is `auto`. For jurisdiction-specific buckets use their matching S3 endpoint.
- If bucket names differ, update both bucket inputs. No public bucket or `r2.dev`
  access is required: downloads and uploads use signed S3 URLs.

Validate and deploy with the secret file (never commit it):

```sh
npm run check
npm test
npm run build
npm run deploy -- --secrets-file secrets.json
```

`npm run build` is a Wrangler dry run that also builds the container image. It
requires Docker but does not provision cloud resources. Keep the JWT and database
secrets unchanged across deployments. Worker bindings are explicitly mapped into
the backend process; unrelated Worker secrets are not forwarded.

## Connect and verify

1. Request `https://<backend-origin>/health/ready` and wait for 200. The first
   request can take longer while the container starts. `/health/redis` should
   report disabled.
2. In Nuphos Desktop choose **Self-hosted? Set API endpoint**, enter the origin,
   sign in with the email code and create a team.
3. Pair the external runtime over `wss://<runtime-domain>/acp` using its console's
   single-use code. Sign in to your own model provider account there.
4. Test a chat and a file upload/download, then redeploy backend and verify that
   sign-in and the same file still work.

## Lifecycle and scope

The instance stays awake after first use because conversations may continue
without inbound HTTP traffic. **Expect ongoing Container charges while it runs.**
Deployments and platform maintenance can still restart it; in-flight activity and
Redis-free in-memory state are not durable. Do not increase replica count or route
requests to multiple instance names. Redis-backed cron, background queues and
journal sealing remain disabled. Model credentials for backend-generated features
and Kubernetes-managed agents are separate configuration.

CI checks TypeScript, environment mapping, Wrangler configuration/bundling and the
container image build. It does not deploy Cloudflare resources or verify real R2,
MongoDB connectivity, email delivery or model inference.

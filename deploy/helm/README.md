# Helm chart

[`nuphos/`](nuphos) deploys Nuphos onto any Kubernetes cluster: authenticated single-node MongoDB, RustFS, the
released backend, and an optional Claude Code runtime. There is no Redis, so
the backend runs as one replica in in-memory mode.

## Prerequisites

- Kubernetes 1.27+ with a default StorageClass and an Ingress controller.
- Three DNS names with TLS: backend, storage and runtime. Presigned file URLs
  name the storage host, so Desktop and the runtime must reach it directly.
- Optional: a Resend API key and a sender on a domain verified in Resend, to
  email sign-in codes. Without them email sign-in is off and an operator issues
  codes with `nuphos-admin` (see [First user and team](#first-user-and-team)).
- Backend image v0.119.0 or newer, which ships `nuphos-admin`.

## Install

```sh
cat > values.local.yaml <<'EOF'
backend:
  url: https://api.nuphos.example.com
storage:
  url: https://storage.nuphos.example.com
runtime:
  url: https://runtime.nuphos.example.com
ingress:
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: '3600'
    nginx.ingress.kubernetes.io/proxy-send-timeout: '3600'
    nginx.ingress.kubernetes.io/proxy-body-size: 100m
  tls:
    - secretName: nuphos-tls
      hosts:
        - api.nuphos.example.com
        - storage.nuphos.example.com
        - runtime.nuphos.example.com
EOF
helm install nuphos deploy/helm/nuphos -n nuphos --create-namespace -f values.local.yaml
```

The install notes print the next steps: sign in from Desktop with
**Self-hosted? Set API endpoint**, read the runtime console password from the
Secret, set the runtime's public URL to `wss://<runtime-host>/acp`, pair it with
your team and sign in to Claude from the console.

## First user and team

`nuphos-admin` in the backend image creates them, with no email involved:

```sh
kubectl -n nuphos exec deploy/nuphos-backend -- \
  nuphos-admin bootstrap --email you@example.com --team Ops
```

It prints the team id, an `ATLAS_ADMIN_TEAM_ID=<id>` line and a sign-in code
valid for 10 minutes. Running it again reuses the same user and team. In Desktop,
choose **Self-hosted? Set API endpoint**, enter the backend URL, then **Continue
with email** with that address and the printed code. To turn on `/admin` for the
team, add the line to `backend.extraEnv` and upgrade:

```yaml
backend:
  extraEnv:
    - name: ATLAS_ADMIN_TEAM_ID
      value: '<id>'
```

Other commands:

- `nuphos-admin sign-in-code --email <email>` prints a code for anyone else.
  Without Resend, this is how people sign in. Run it just before they press
  **Continue with email**; the backend accepts the request because a code is
  already waiting, and sends nothing. After five wrong tries a code is locked;
  issue a new one.
- `nuphos-admin join-token --team <id> [--label <name>]` prints a one-time token
  that joins a server as the team owner's computer, with
  `NUPHOS_API_URL=<backend-url> nuphos agent --join -` on that server. It is the
  same token `POST /agent/devices/join-tokens` issues, so no browser or
  `nuphos login --device` is needed.

To email codes instead, set `email.resendApiKey` and `email.from` (a sender on a
domain verified in Resend), or add `RESEND_API_KEY` to `secrets.existingSecret`.

To offer **Continue with Google**, create a Google OAuth client of type Web
application with the redirect URI `<backend.url>/auth/social/google/callback`,
then set `google.clientId` and `google.clientSecret` (or add
`GOOGLE_OAUTH_CLIENT_SECRET` to `secrets.existingSecret`). Desktop and the mobile
apps show the button only when the server offers it.

To offer single sign-on through an OpenID Connect provider such as Logto, create
a Traditional Web application in Logto with the redirect URI
`<backend.url>/auth/social/oidc/callback`, then set `oidc.issuer` (the app's
issuer endpoint, e.g. `https://<tenant>.logto.app/oidc`), `oidc.clientId`,
`oidc.clientSecret` (or add `OIDC_CLIENT_SECRET` to `secrets.existingSecret`)
and `oidc.name`, the label on the "Continue with" button. A verified email
signs in to the existing account with that email, so the user `nuphos-admin
bootstrap` created can switch to SSO. Desktop and iOS show the button; Android
does not offer OIDC yet.

## Secrets

The chart generates the JWT secret, Mongo password, storage secret key, runtime
password and runtime token encryption key on first install, keeps them on
upgrade, and leaves the Secret behind on uninstall. Renderers without cluster
access (`helm template`, Argo CD, Flux with `--dry-run`) regenerate them on every
render. For those, set `secrets.existingSecret` to a Secret you manage with the
keys `NUPHOS_JWT_SECRET`, `MONGO_PASSWORD`, `STORAGE_SECRET_KEY`,
`RUNTIME_AUTH_KEY`, `RUNTIME_TOKEN_ENCRYPTION_KEY` and, optionally, `RESEND_API_KEY` and `GOOGLE_OAUTH_CLIENT_SECRET`. Keep the Mongo password
alphanumeric: it is placed in the connection URI as is.
`RUNTIME_TOKEN_ENCRYPTION_KEY` is base64 of 32 random bytes
(`openssl rand -base64 32`). It seals the runtime credentials the backend
stores, so changing it disconnects every runtime. `extraObjects` renders any manifest with the release, such
as an `ExternalSecret` that fills that Secret from a secrets manager, including
one reachable only inside your VPC: the backend reads plain environment
variables and never calls a secrets manager itself.

## Upgrading to 0.3.0

`email.resendApiKey` and `email.from` are optional. Existing values keep
emailing codes; nothing changes on upgrade.

## Upgrading to 0.2.0

Chart 0.2.0 removes ZSend (Zeabur Email); sign-in codes are sent only through
Resend. Before you upgrade, create a Resend API key and verify the domain of
`email.from` in Resend, then:

- set `email.resendApiKey`, and remove `email.provider` and `email.zsendApiKey`; or
- with `secrets.existingSecret`, add `RESEND_API_KEY` to that Secret.

With an unverified sender, sign-in codes are not delivered.

## Isolation

The runtime executes agent code. Its pod gets no service account token and
reads only its own password from the Secret, and a NetworkPolicy admits only
the backend to MongoDB. The policy needs a CNI that enforces NetworkPolicy. For
stronger separation, set `runtime.enabled=false` and run the runtime on other
infrastructure, for example with the
[Railway runtime project](../railway/README.md#deploy-the-runtime-project).

The Mongo container runs as root so it can own its keyfile, the same as the
official image's entrypoint. The release's namespace therefore cannot enforce
the `restricted` Pod Security Standard.

## Not included

Redis (cron, background thread queues, journal sealing), backend model
credentials, and managed agents. The backend pod mounts no service account
token, so it cannot run the managed-agent provisioner.

## Validation

```sh
helm lint deploy/helm/nuphos -f deploy/helm/ci-values.yaml --strict
helm template nuphos deploy/helm/nuphos -f deploy/helm/ci-values.yaml | kubeconform -strict -summary
```

CI runs both. It does not install the chart on a cluster.

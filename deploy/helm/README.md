# Helm chart

[`nuphos/`](nuphos) deploys Nuphos onto any Kubernetes cluster: authenticated single-node MongoDB, RustFS, the
released backend, and an optional Claude Code runtime. There is no Redis, so
the backend runs as one replica in in-memory mode.

## Prerequisites

- Kubernetes 1.27+ with a default StorageClass and an Ingress controller.
- Three DNS names with TLS: backend, storage and runtime. Presigned file URLs
  name the storage host, so Desktop and the runtime must reach it directly.
- A Zeabur Email or Resend API key and a sender on a domain verified with that
  provider. Production sign-in sends the code by email and never logs it.
- An amd64 node for the runtime image.

## Install

```sh
cat > values.local.yaml <<'EOF'
backend:
  url: https://api.nuphos.example.com
storage:
  url: https://storage.nuphos.example.com
runtime:
  url: https://runtime.nuphos.example.com
email:
  zsendApiKey: <zsend-api-key>
  # Or: provider: resend, with resendApiKey: <resend-api-key>
  from: Nuphos <noreply@example.com>
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

## Secrets

The chart generates the JWT secret, Mongo password, storage secret key, runtime
password and runtime token encryption key on first install, keeps them on
upgrade, and leaves the Secret behind on uninstall. Renderers without cluster
access (`helm template`, Argo CD, Flux with `--dry-run`) regenerate them on every
render. For those, set `secrets.existingSecret` to a Secret you manage with the
keys `NUPHOS_JWT_SECRET`, `MONGO_PASSWORD`, `STORAGE_SECRET_KEY`,
`RUNTIME_AUTH_KEY`, `RUNTIME_TOKEN_ENCRYPTION_KEY` and `ZSEND_API_KEY` or
`RESEND_API_KEY` (whichever `email.provider` selects). Keep the Mongo password
alphanumeric: it is placed in the connection URI as is.
`RUNTIME_TOKEN_ENCRYPTION_KEY` is base64 of 32 random bytes
(`openssl rand -base64 32`). It seals the runtime credentials the backend
stores, so changing it disconnects every runtime. `extraObjects` renders any manifest with the release, such
as an `ExternalSecret` that fills that Secret.

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

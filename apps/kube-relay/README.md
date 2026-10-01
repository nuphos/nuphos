# kube-relay

Our side of the on-prem Kubernetes tunnel. Customers who cannot expose their
cluster run `apps/kube-relay-agent` inside it; this service is what those pods
dial, and what an agent sandbox reaches them through.

Two listeners, joined by a pool of parked connections:

```text
kube-relay-agent  ──outbound TLS──▶  :8444  agents   ┐
                                                     ├── parked connection pool
agent sandbox     ──HTTP CONNECT──▶  :8443  proxy    ┘
                                     :8080  health/status (internal)
```

## Why a separate service

The backend runs several replicas. An agent's parked connection lands on one
process, a sandbox's `CONNECT` on another, and only the process holding the
socket can forward it — so this cannot be routes on the backend without
cross-replica socket forwarding. A kubeconfig `proxy-url` also cannot carry a
path, so it needs its own host:port regardless. `apps/tailscale-dialer` is the
same shape of thing for the same kind of reason.

Run it single-replica for now. Scaling out needs either a sticky agent→replica
mapping or a shared registry; neither is worth building before a second pilot
customer exists.

## Reconnection

The agent owns this; the relay only has to not make it worse.

- Each pool slot reconnects on its own, with exponential backoff from 1s to 30s
  and jitter, forever. A slot whose connection was handed a stream re-dials
  **immediately** (no backoff — nothing failed), so the pool refills as fast as
  it drains.
- The relay `PING`s every parked connection every 30s and drops one that does not
  answer within 10s; the agent independently gives up on a connection that has
  been silent for 90s. Between them, a connection killed off-path — an expired NAT
  mapping, a proxy that forgot it, a network partition — is noticed and replaced
  rather than sitting in the pool looking healthy.
- A `CONNECT` for a cluster with an empty pool waits up to 5s for a connection to
  appear instead of failing at once, so a relay restart or a rolling update of the
  customer's Deployment is absorbed rather than surfacing as "their cluster is
  down". Past that it is a real 503.
- Two agent replicas and four connections each, so a single pod restart never
  empties the pool in the first place.

What reconnection cannot save: **a stream already in flight**. If the relay
restarts mid-`kubectl exec`, that TCP connection dies and the command fails —
inherent to tunnelling TCP, the same as any VPN. Retrying works because the pool
is back within seconds.

Two failure modes that reconnection deliberately does _not_ paper over, because
they need a human:

- **An expired or revoked agent token.** The agent keeps retrying at 30s and logs
  `relay rejected the agent`, but it will never recover on its own. The token is
  injected from a Secret via `env`, so re-issuing it also needs a pod restart for
  the new value to be read.
- **A rotated `NUPHOS_RELAY_TOKEN_SECRET`.** Same symptom, every cluster at once.

## Authorisation

Entirely in the tokens (`token.go`): HMAC-SHA256, minted by the backend, so the
relay has no database, no callback, and holds no customer's credential.

- **agent token** — long-lived, lives in a Secret in the customer's cluster.
- **session token** — 12h, minted per agent session, rides in the kubeconfig
  `proxy-url` as the Basic username (which is how Go's HTTP transport sends a
  proxy URL's userinfo, so kubectl needs no client-side glue).

Both carry an opaque `k` (cluster key) — never a team id, so a leaked token
reveals nothing about whose it is.

Rotating a cluster's key re-keys it: new sessions are issued tokens for the new
key and can no longer reach anything parked under the old one. It is **not** an
instant cut-off, and nothing here should be described as one — authorisation is
stateless HMAC + expiry with no revocation list, so until the customer updates
the Secret and restarts the pod their agent keeps parking under the old key, and
session tokens already issued (≤12h) keep routing through those connections. The
instant cut-off is the customer's own: `kubectl scale … --replicas=0`.
Relay-side revocation would need state this service deliberately does not carry;
worth revisiting if a customer's security review asks for a server-side kill.

The wire format is a contract with `apps/backend/src/lib/byos/relay-token.ts`.
`token_vector_test.go` and `relay-token.test.ts` pin the same vector, so a change
to either side's encoding fails a test instead of failing every enrolled cluster.

The proxy never terminates the customer's TLS: `CONNECT` gives kubectl a raw
tunnel to their API server, so the API credential is theirs end-to-end and we
cannot read it in flight.

## Configuration

| Variable                         | Default             | Notes                                                                                                                                                                                                   |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUPHOS_RELAY_TOKEN_SECRET`      | required, ≥32 bytes | Identical to the backend's. `/status` takes a credential _derived_ from it, not the secret itself — that listener is plain HTTP, and a captured header should not be the key to every cluster's tokens. |
| `NUPHOS_RELAY_AGENT_ADDR`        | `:8444`             | Where agent pods connect.                                                                                                                                                                               |
| `NUPHOS_RELAY_PROXY_ADDR`        | `:8443`             | The CONNECT proxy.                                                                                                                                                                                      |
| `NUPHOS_RELAY_HEALTH_ADDR`       | `:8080`             | `/healthz` + authenticated `/status`. Internal only.                                                                                                                                                    |
| `NUPHOS_RELAY_TLS_CERT` / `_KEY` | required            | Both public listeners terminate TLS here.                                                                                                                                                               |
| `NUPHOS_RELAY_DEV_PLAINTEXT`     | unset               | Local development: serve both listeners without TLS.                                                                                                                                                    |

The authenticated `GET /status` route is also served by the TLS proxy listener.
Production backends should use `https://relay.nuphos.ai:8443` for
`NUPHOS_RELAY_STATUS_URL`; the plain `:8080` listener remains cluster-internal
for health probes and same-cluster diagnostics.

## Deploying it

**The relay and the backend ship together.** `/status` authentication is a
shared derivation over `NUPHOS_RELAY_TOKEN_SECRET`, and the token format is a
cross-language contract — so a rollout that updates one side and not the other
breaks the "is this cluster connected" answer until both are current. That is a
degraded enrolment screen rather than a broken tunnel (agent and proxy traffic
are unaffected), but it is avoidable: roll them in the same change, and treat
any future change to the token or credential derivation the same way.

## Production deployment

`deploy/gke.yaml` owns the single-replica Deployment, cert-manager Certificate,
L4 LoadBalancer and internal health Service. `.github/workflows/deploy-kube-relay.yml`
publishes to Artifact Registry and rolls it out from an immutable
`kube-relay-v<semver>` Git tag.

Before the first rollout:

1. Create `production/nuphos-kube-relay-env` with
   `NUPHOS_RELAY_TOKEN_SECRET`, byte-identical to the value in
   `production/nuphos-backend-env`. The workflow deliberately refuses to deploy
   if that key is absent.
2. Point `relay.nuphos.ai` at the IP allocated to
   `service/nuphos-kube-relay-public`. The existing `letsencrypt-dns01`
   ClusterIssuer then provisions the certificate.
3. Publish `apps/kube-relay-agent` using a `kube-relay-agent-v<semver>` tag and
   pin the reported `@sha256` digest in backend configuration.
4. Set the four backend values to `relay.nuphos.ai:8444`,
   `relay.nuphos.ai:8443`, the agent digest, and
   `https://relay.nuphos.ai:8443` respectively.

## Local development

Two panes, no customer and no certificates:

```sh
bun scripts/dev-onprem.ts relay          # plaintext relay on loopback
bun scripts/dev-onprem.ts agent nr1_…    # the token the enrolment wizard showed you
```

The relay prints the four env vars the backend needs; `apps/backend/.env` already
carries them for the default ports, so `bun run dev` picks them up. Enrol a
cluster in the desktop app, copy the token out of the install step, start the
agent with it, and the wizard's "waiting for the agent" step goes green.

The agent reaches whatever your machine reaches, so a kubeconfig for a local
kind / minikube / Docker Desktop cluster carries the whole flow through to the
permission readout. Without one, the readout still exercises its failure path and
says which leg broke.

`NUPHOS_RELAY_DEV_PLAINTEXT=1` on both sides is what makes this work without
certificates. Never set it anywhere else — the agent token would cross the wire
in the clear.

## Tests

```sh
go test ./...
```

Covers the full path (agent parks → `CONNECT` → dial → splice → half-close),
a cluster with no agent, a bad or wrong-purpose token, an unreachable target, a
refused agent, `/status` authentication, and the cross-language token vector.

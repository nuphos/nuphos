# kube-relay-agent

The pod a customer runs in an on-prem Kubernetes cluster that we cannot reach
from the outside — no route to the API server, no route to in-cluster services,
nothing dialable. It gives Nuphos a way **in** by only ever going **out**.

Its counterpart is `apps/kube-relay`, which runs on our side.

## Design rule: it does nothing but connect

The agent has no allow-list, no audit log, no k8s client, and no configuration
beyond "where is the relay, and what is my token". Everything else is done
behind it, on our side.

That is a deliberate trade, not an unfinished feature. The customer's security
review needs to bound and observe this, and the honest place for that is
primitives they already own and can read with `kubectl`:

| Question                              | Answered by                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| What can Nuphos reach?                | the egress `NetworkPolicy` on this pod (`deploy/networkpolicy-example.yaml`) |
| What can Nuphos do to the API server? | RBAC on the ServiceAccount whose token is in the kubeconfig they gave us     |
| How do we cut it off right now?       | `kubectl scale deploy/nuphos-relay-agent --replicas=0`                       |
| What exactly are we running?          | one stdlib-only static Go binary on `scratch`, ~600 lines with its tests     |

An allow-list of our own here would be one more thing they'd have to take on
trust, and would sit _inside_ the component they're least able to verify.

## Shape

- Outbound only. No Service, no Ingress, no listening socket at all.
- `automountServiceAccountToken: false` — the tunnel needs no cluster API rights.
- Unprivileged: non-root, read-only rootfs, all capabilities dropped, no host
  namespaces or mounts.
- Honours `HTTPS_PROXY` / `NO_PROXY`, so a cluster whose only egress is a
  corporate proxy works without special-casing.
- 10m CPU / 32Mi requested. Two replicas, purely for drain and rolling-update
  continuity — the relay treats every parked connection as interchangeable, so
  there is no leader election and nothing to coordinate.

## Protocol

The agent parks a pool of idle connections at the relay and never initiates
anything; the relay drives every stream.

```text
agent -> relay   NUPHOS-RELAY/1 AGENT <token>
relay -> agent   READY
relay -> agent   PING                          (idle keepalive)
agent -> relay   PONG
relay -> agent   OPEN <host>:<port>
agent -> relay   OK | ERR <reason>
                 ...raw TCP payload, both directions, until either end closes...
```

A connection that has been handed an `OPEN` is no longer idle, so its pool slot
immediately dials a replacement — that is the whole flow-control design.

Raw TLS with a line-oriented handshake, not HTTP or WebSocket: neither side then
needs framing or a WebSocket library, and a corporate egress proxy tunnels it
with exactly the `CONNECT` it would use for any HTTPS request. A proxy that
demands real HTTP inside the tunnel would break this — and would break
WebSocket-based tunnels too. If we meet one, the handshake has room for an
`Upgrade:` prelude without touching anything else.

## Why not an off-the-shelf tunnel

The transport layer here is a solved problem — chisel, frp, konnectivity
(`apiserver-network-proxy`), inlets, gost, wstunnel, cloudflared and Teleport's
`teleport-kube-agent` all move bytes out of a private cluster. We are not
claiming novelty; we are avoiding an integration:

- **Tailscale** (the design in PR #606) remains the better answer when the
  customer will run it, because governance, ACLs and audit then live in a system
  they administer. This exists for customers who won't install a third-party
  VPN/WireGuard mesh.
- **Teleport** is the fully productised version of this pod and does more than we
  do (RBAC, session recording, credentials that never leave the cluster). It is
  also a platform the customer has to adopt, plus an AGPL/licensing conversation
  — i.e. the same objection as Tailscale, one layer up.
- **chisel / frp / konnectivity** would each replace ~250 lines of stdlib Go with
  a dependency whose auth model we would then have to bend to per-session
  tokens, and whose config surface we would have to keep out of the customer's
  way. Their generality is the cost, not the benefit: the "we run one static
  binary that only dials out" line above is the deliverable.

## What the customer hands us

The tunnel carries bytes; it does not authenticate to Kubernetes. The API
credential is still a kubeconfig, and issuing it is theirs to do — start
read-only:

```sh
kubectl create serviceaccount nuphos -n nuphos-relay
kubectl create clusterrolebinding nuphos-view \
  --clusterrole=view --serviceaccount=nuphos-relay:nuphos
# A bound, expiring token beats a permanent Secret; renew or widen later.
kubectl create token nuphos -n nuphos-relay --duration=720h
```

They paste that token, the API server's CA, and its **internal** address
(`https://10.0.0.1:6443` — it never needs to be publicly resolvable) into the
Nuphos cluster page. We reach it through the relay.

## Install

`deploy/nuphos-relay-agent.yaml` is the entire install: a namespace, a Secret,
and a Deployment, with three placeholders to fill in. `deploy/networkpolicy-example.yaml`
is the optional egress boundary, kept separate because applying it unedited
would take the tunnel down.

## Build & publish

Multi-arch, to ECR **Public**, for the same reason as `apps/node-shell`: this
image runs on customers' clusters, which have no Zeabur registry credentials.

```sh
ALIAS=c7s2j3w4
REPO="public.ecr.aws/${ALIAS}/kube-relay-agent"

aws ecr-public get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws
docker buildx build --platform linux/amd64,linux/arm64 --push -t "${REPO}:v1" .
```

Give customers the resulting **`@sha256:` digest**, never a mutable tag.

The ECR Public repository, alias and OIDC deploy role are encoded in
`.github/workflows/deploy-kube-relay-agent.yml`. Push an immutable
`kube-relay-agent-v<semver>` tag (or dispatch that exact tag) to publish both
architectures, then copy the workflow's reported `@sha256` digest into
`NUPHOS_RELAY_AGENT_IMAGE`.

## Tests

```sh
go test ./...
```

Covers the protocol round trip against a TLS test relay (park → `OPEN` → dial →
splice bytes → half-close), rejection of an unknown command, a refused token,
proxy-environment resolution, and settings validation.

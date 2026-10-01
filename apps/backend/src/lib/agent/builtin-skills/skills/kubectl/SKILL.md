---
name: kubectl
description: Inspect and operate the team's Kubernetes clusters (EKS / GKE / TKE / ACK / LKE / VKE / AKS, plus on-prem clusters reached through the Nuphos relay) with kubectl. One `get_kubeconfig` call writes a context for every reachable cluster; credentials renew themselves.
---

# kubectl

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill whenever the user asks you to look at or change resources on one of their Nuphos-managed Kubernetes clusters.

## Target a cluster

The kubeconfig comes from the `get_kubeconfig` tool (in the `nuphos-tools` MCP server). Call it, write the returned YAML to `~/.kube/config` with mode 0600, and every cluster this session can access — EKS, GKE, TKE, ACK, LKE, VKE, AKS, and on-prem clusters — is a context named `<provider>/<account>/<cluster>` (e.g. `aws/123456789012/prod-main`, `gcp/my-project/staging`, `tencent/prod/web`, `onprem/acme-dc1/cluster`).

```bash
kubectl config get-contexts                          # list reachable clusters
kubectl --context aws/123456789012/prod-main get pods -A
```

- **Always pass `--context` explicitly** on every command. There is deliberately no current-context — running against an implicit cluster is how wrong-cluster accidents happen, and naming the target in the command also makes approvals reviewable.
- **Credential renewal is built in.** Some contexts carry a long-lived credential; others fetch a short-lived one on demand. Do not run provider kubeconfig commands (`gcloud container clusters get-credentials`, `aws eks update-kubeconfig`, …) or `scripts/sync-clusters.sh`, and do not edit `~/.kube/config` by hand. This also covers helm/flux/argocd, which read the same kubeconfig.
- **Call `get_kubeconfig` again and rewrite the file** when kubectl reports an authentication error, when a context you expect is missing, or when the user just connected a cluster.
- If `kubectl: command not found`, install it first (idempotent): `bash skills/kubectl/scripts/install.sh`

## Reaching a service inside an on-prem cluster

`onprem/…` contexts go through a relay, and two things follow from that.

**kubectl works normally**, including `port-forward` — the forward rides the API
server connection, so it is relayed like everything else:

```bash
kubectl --context onprem/acme-dc1/cluster -n data port-forward svc/postgres 5432:5432 &
psql -h 127.0.0.1 -p 5432 ...
```

That needs `create` on `pods/portforward`, which the read-only `view` role does
NOT include. If it is denied, do not work around it — say which permission is
missing and let the user decide whether to widen it.

**For anything port-forward cannot reach** — a database or appliance in their
network that is not a Kubernetes Service, or a cluster whose RBAC stops at
read-only — tunnel the address directly. Tools like psql, redis-cli and mongosh
have no proxy support, so this gives them a local port instead:

```bash
python3 skills/kubectl/scripts/onprem-tunnel.py open onprem/acme-dc1/cluster 10.0.0.5:5432
# -> 127.0.0.1:53219 -> 10.0.0.5:5432 via onprem/acme-dc1/cluster
psql -h 127.0.0.1 -p 53219 ...

python3 skills/kubectl/scripts/onprem-tunnel.py list
python3 skills/kubectl/scripts/onprem-tunnel.py close 53219   # or: close all
```

It takes the credential from the kubeconfig, so there is nothing to configure,
and it reaches exactly what the customer's relay pod is allowed to reach — no
more. `open` fails loudly if the tunnel cannot be established, so a psql that
hangs is never the first sign of trouble. Close tunnels when done.

## When a cluster you expect isn't listed

Only clusters the sandbox can actually reach are included. A missing context usually means one of:

- **The cluster has no public API server endpoint and is not enrolled as an on-prem cluster.** Nothing to fix from here — it is unreachable from the sandbox regardless of credentials. Tell the user, and mention that a private cluster can be enrolled by running the Nuphos relay agent in it.
- **An `onprem/…` context exists but every command fails to connect.** Those clusters are reached through a pod the customer runs in their own cluster; if it is scaled to zero, evicted, or blocked by their egress rules, nothing here can route to them. Reconnects and brief restart windows are absorbed before you ever see an error, so a connection failure here means the pod is genuinely absent, not flapping. Say exactly that instead of retrying — it is theirs to fix.
- **The account isn't enabled for this session**, or your member account isn't on its Access allow list. Ask the user or a team admin.
- **The AKS cluster uses Entra ID (AAD) integration.** Those need the `kubelogin` binary, which the sandbox doesn't ship, so they are deliberately left out. AKS clusters with a local admin account do appear.

Ask before guessing at a target — running kubectl against the wrong cluster is destructive.

## Permission errors (HTTP 403)

If a credential fetch reports HTTP 403 on kubectl's stderr, your member account does not have Access to the backing credential, or that credential was not selected for this agent session. Do not retry and do not try to request temporary access from inside the sandbox. Ask the user or a team admin to add the member account to the integration's Access allow list, or switch to another integration already enabled for this session.

A 403 *from the Kubernetes API itself* (`... is forbidden: User ... cannot list resource ...`) is different: that is the cluster's own RBAC, not Nuphos access. Tell the user which subject needs which role. One special case — on Volcengine VKE, RBAC is bound when the credential is issued, so a grant made afterwards never applies to the existing one. After the user grants it, call `get_kubeconfig` once with `fresh: true` and rewrite `~/.kube/config`.

## Common operations

```bash
ctx="aws/123456789012/prod-main"   # always name your target

# Sanity check
kubectl --context "$ctx" cluster-info
kubectl --context "$ctx" get nodes -o wide

# Workloads
kubectl --context "$ctx" get pods -A
kubectl --context "$ctx" -n <ns> describe pod <name>
kubectl --context "$ctx" -n <ns> logs <pod> [-c <container>] [--tail=200]
kubectl --context "$ctx" -n <ns> logs -f <pod>   # streaming — only when user asks
kubectl --context "$ctx" -n <ns> top pod         # needs metrics-server

# Events (best first stop when something is broken)
kubectl --context "$ctx" -n <ns> get events --sort-by=.lastTimestamp

# Resource discovery
kubectl --context "$ctx" api-resources
kubectl explain <kind>

# Apply / delete (mutations — see Safety below)
kubectl --context "$ctx" apply -f manifest.yaml
kubectl --context "$ctx" -n <ns> delete pod <name>
kubectl --context "$ctx" -n <ns> rollout restart deploy/<name>
```

## Safety

- **Read-only by default.** Use `get`, `describe`, `logs`, `top`, `explain` freely.
- **Confirm before mutating.** For `apply`, `delete`, `edit`, `patch`, `scale`, `rollout`, `cordon`, `drain`, `exec`, `cp`, summarize what will change and ask the user before running. Never delete a namespace, CRD, or anything in `kube-system` without explicit confirmation.
- **Avoid foot-guns.** Don't run `--all-namespaces` deletions, `--force --grace-period=0`, or `kubectl delete -f` against a directory you didn't just fetch.
- **Don't dump secret data.** When inspecting `Secret` objects, prefer `kubectl get secret <name> -o jsonpath='{.metadata}'` or `... -o yaml | grep -v "^\s*[a-zA-Z0-9_-]*: [A-Za-z0-9+/=]\{20,\}"` rather than printing raw base64 values.

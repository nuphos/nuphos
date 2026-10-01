---
name: helm
description: Install applications onto an Nuphos-managed Kubernetes cluster using the helm CLI from inside the sandbox. Use this for chart-based deploys ("install Inngest", "deploy ingress-nginx", "set up cert-manager"). Includes an install script for the helm binary.
---

# helm

Use this skill when the user wants to **install or upgrade** something packaged as a Helm chart on one of their Nuphos clusters — e.g. "幫我部署 Inngest", "install ingress-nginx", "set up cert-manager". For inspection (`get pods`, `logs`, etc.) keep using `kubectl` — `helm` is for chart-driven deploys.

Helm reuses the same kubeconfig the `kubectl` skill writes to `~/.kube/config`, so the typical workflow is:

1. Pick the target cluster context (see the `kubectl` skill — its kubeconfig has a context for every cluster this session can reach).
2. Use `web_search` + `web_fetch` to confirm the chart's official repo / OCI URL and the recommended install instructions, then run `helm --kube-context <context> install ...`.

## Setup

```bash
# Sanity check — pass the target context explicitly on every helm command.
kubectl config get-contexts
helm version --short
helm --kube-context <context> list -A
```

### Fallback: helm or kubectl missing

If for some reason the binary isn't there (cold start without the runtime image), run the install script(s) — they're idempotent:

```bash
bash skills/kubectl/scripts/install.sh
bash skills/helm/scripts/install.sh
```

## Discovering the chart

Don't guess install commands. For any project the user names, do this first:

1. `web_search` for `"<name> helm chart"` or `"<name> install kubernetes"` to find the official source.
2. `web_fetch` the most authoritative result (project docs, GitHub README, ArtifactHub page) to read the exact `helm repo add` / `helm install` block.
3. Note any required dependencies (cert-manager, an ingress controller, a CRD pre-install step, persistent storage).

## Common operations

Every cluster-facing command needs `--kube-context` — the kubeconfig
deliberately has no current context, so a command without it fails or, worse,
lands on whatever a locally-loaded config left behind.

```bash
ctx="gcp/my-project/prod"   # from `kubectl config get-contexts`

# Add and update a classic chart repo (local-only, no cluster contact)
helm repo add <name> <url>
helm repo update

# Install / upgrade with custom values
helm --kube-context "$ctx" upgrade --install <release> <chart> \
  --namespace <ns> --create-namespace \
  --version <chart-version> \
  --set key=value \
  --values values.yaml

# OCI-hosted charts (no `repo add` needed)
helm --kube-context "$ctx" upgrade --install <release> oci://<registry>/<chart> --version <chart-version> -n <ns> --create-namespace

# Inspect
helm --kube-context "$ctx" list -A
helm --kube-context "$ctx" status <release> -n <ns>
helm --kube-context "$ctx" get values <release> -n <ns>
helm --kube-context "$ctx" get manifest <release> -n <ns>
helm --kube-context "$ctx" history <release> -n <ns>

# Diff before applying (if helm-diff plugin is available)
helm --kube-context "$ctx" diff upgrade <release> <chart> -n <ns> --values values.yaml

# Rollback / uninstall
helm --kube-context "$ctx" rollback <release> <revision> -n <ns>
helm --kube-context "$ctx" uninstall <release> -n <ns>
```

## Safety

- **Always confirm before installing.** Summarize: chart name & version, target namespace, key values (storage class, replicas, public exposure, default credentials). Wait for explicit user approval before running `helm install` / `helm upgrade`. The MongoDB-style "要我就以這個配置部署嗎？" pattern is good.
- **Pin the chart version** with `--version <x.y.z>` so the deploy is reproducible. Don't blindly install latest.
- **Default to a dedicated namespace** with `--namespace <release>` `--create-namespace`, not `default` and not `kube-system`.
- **Quote secrets, don't echo them.** When generating passwords for a chart, write them via `--set-string foo.password=$(openssl rand -hex 16)` or a values file, not directly into the chat.
- **Don't expose to the public internet by default.** If the chart has an ingress / LoadBalancer service, ask the user whether they want it exposed before enabling it. Prefer ClusterIP + port-forward for first install.
- **Uninstall is destructive.** `helm uninstall` removes resources (and often PVCs depending on chart). Confirm before running and warn that data may be lost.
- **No `--force` upgrades** unless the user asks — that recreates resources and can cause downtime.

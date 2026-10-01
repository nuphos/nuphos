---
name: fluxcd
description: Inspect and operate Flux CD resources from the sandbox with the flux CLI. Use for Flux reconciliation, GitRepository/Kustomization/HelmRelease status, suspend/resume, and GitOps drift triage after kubectl has loaded the target kubeconfig.
---

# Flux CD CLI

Use this skill when the user asks about Flux CD, GitOps reconciliation, Flux
Kustomizations, HelmReleases, GitRepositories, ImageUpdateAutomation, or why a
cluster is not applying changes from Git.

If `flux` is not on PATH, report that the sandbox runtime image does not bundle
`flux`; do not spend the turn installing it.

Pick the target cluster context first (see the `kubectl` skill — its
kubeconfig has a context for every reachable cluster) and pass it
explicitly with `--context` on every flux command.

## Setup

```bash
kubectl config get-contexts
flux --context <context> version
```

If Flux might be installed in a non-default namespace, discover it first:

```bash
kubectl get ns
kubectl get deploy -A | grep -i flux
```

## Read-only First

Start with read-only checks:

```bash
flux check
flux get sources git -A
flux get sources helm -A
flux get kustomizations -A
flux get helmreleases -A
flux logs --all-namespaces --level=error --since=30m
kubectl get events -A --sort-by=.lastTimestamp
```

For a specific object:

```bash
flux get kustomization <name> -n <namespace>
flux get helmrelease <name> -n <namespace>
kubectl -n <namespace> describe kustomization/<name>
kubectl -n <namespace> describe helmrelease/<name>
```

## Mutations

Ask for explicit confirmation before:

- `flux reconcile ...`
- `flux suspend ...`
- `flux resume ...`
- `flux create ...`
- `flux delete ...`
- Any `kubectl patch/apply/delete` on Flux resources

Before reconciling or suspending/resuming, summarize the current cluster
context, namespace, resource kind/name, and whether the operation can trigger a
Helm upgrade, prune, or workload rollout.

## Common Operations

```bash
# Reconcile source first, then the dependent workload.
flux reconcile source git <source> -n <namespace>
flux reconcile kustomization <name> -n <namespace> --with-source

# HelmRelease
flux reconcile helmrelease <name> -n <namespace> --with-source

# Temporarily pause/resume reconciliation.
flux suspend kustomization <name> -n <namespace>
flux resume kustomization <name> -n <namespace>
```

## Safety

- Always pass `--context` explicitly — the kubeconfig deliberately sets no
  current-context.
- Prefer `flux get ... -A` and `flux logs` before mutating.
- Do not suspend broad sets of resources unless the user explicitly requests
  that scope.
- Treat Flux changes as production deploy changes: they can roll pods,
  uninstall resources through prune, or update Helm releases.

---
name: argocd
description: Inspect and operate Argo CD applications from the sandbox with the argocd CLI. Use for Argo CD app status, history, sync, rollback, and resource inspection after credentials or server context are available.
---

# Argo CD CLI

Use this skill when the user asks about Argo CD applications, GitOps sync
state, Argo CD rollbacks, app health, or why Kubernetes resources managed by
Argo CD are out of sync.

If `argocd` is not on PATH, report that the sandbox runtime image does not
bundle `argocd`; do not spend the turn installing it.

## Setup

Argo CD credentials are not minted by Nuphos today. Use one of these contexts:

- The user provides an Argo CD server and token.
- A kubeconfig is loaded with the `kubectl` skill and Argo CD is configured for
  core mode.
- The target cluster exposes Argo CD credentials in a known, user-approved
  Kubernetes Secret.

Before running mutating commands, always show the target server and app name.

```bash
# Token-based login. Do not echo the token.
ARGOCD_SERVER=<argocd.example.com>
ARGOCD_AUTH_TOKEN=<token> argocd app list --server "$ARGOCD_SERVER" --grpc-web

# Core mode through the kubectl skill's kubeconfig. There is no current-context — name
# the target cluster explicitly, exactly like kubectl.
kubectl config get-contexts
argocd --core --kube-context <context> app list
```

## Read-only First

Start with read-only commands. Every one of these talks to a control plane, so
carry the same targeting flags you established in Setup — `--server` in
server mode, `--core --kube-context <context>` in core mode (shown here as
`$target`):

```bash
argocd version --client --short          # local only, no target needed

target="--core --kube-context <context>"  # or: target="--server $ARGOCD_SERVER --grpc-web"
argocd $target app list
argocd $target app get <app>
argocd $target app history <app>
argocd $target app manifests <app>
argocd $target app resources <app>
argocd $target app diff <app>
```

List the available contexts with `kubectl config get-contexts` before picking
one — the kubeconfig deliberately has no default.

## Mutations

Ask for explicit confirmation before:

- `argocd app sync`
- `argocd app rollback`
- `argocd app terminate-op`
- `argocd app delete`
- `argocd app set`
- Any command with `--prune`, `--force`, or `--replace`

Summarize the app, project, destination cluster/namespace, revision, and any
prune/force flags before running the command.

## Safety

- Do not print tokens, session cookies, or Kubernetes Secret values.
- Do not assume `argocd app list` without `--server` or `--core --kube-context`
  is pointed at the right control plane. Name the target explicitly.
- Prefer `argocd app diff` before sync when the user asks to deploy changes.
- Avoid broad commands such as syncing every app in a project unless the user
  explicitly requests that scope.

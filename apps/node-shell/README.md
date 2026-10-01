# node-shell image

Minimal privileged-pod image for the desktop **Node Terminal** feature
(`apps/desktop`, ZEA-9858). A node has no exec subresource, so "open a node
shell" means: create a tiny privileged pod pinned to the node (host PID/IPC/net)
and `nsenter` into the host's PID 1 namespaces. This image is what that pod runs.

Because the pod is privileged and shares host namespaces, **the image
effectively owns the node**. It must therefore come from a Zeabur-controlled
registry and be pinned by digest — never a mutable public tag. This repo exists
to replace the temporary `busybox:1.36.1` default (see ZEA-9869 / Codex review
on PR #185).

## Registry: ECR **Public** (not private)

Backend/admin push to **private** ECR because they only run on Zeabur's own EKS,
which has pull access. This image is different: it runs on **users' arbitrary
clusters** (any cloud), which have no Zeabur registry credentials. So it must be
**publicly pullable** — published to **Amazon ECR Public** (`public.ecr.aws`),
still Zeabur-controlled and digest-pinned.

Gotchas:

- ECR Public images live under a **registry alias**, not the account id:
  `public.ecr.aws/<alias>/node-shell`. Find/set the alias in the console under
  Public registry → Settings (公有注册表 → 设置).
- The ECR Public push API is **only in `us-east-1`**, regardless of console
  region.
- Pushing needs `ecr-public:*` push perms **plus `sts:GetServiceBearerToken`**.

## What's in it

Only `nsenter` (from `util-linux-misc`) plus `sleep` (busybox, in the Alpine
base). The interactive shell comes from the **host** via nsenter, so this image
deliberately carries no bash/extra tooling.

## How the desktop app consumes it

`apps/desktop/electron/pod-exec.ts` reads `NUPHOS_NODE_SHELL_IMAGE` and falls
back to a default. Once this image is published, set its **immutable digest** as
that default (and/or inject the env var at deploy time):

```text
public.ecr.aws/c7s2j3w4/node-shell@sha256:<digest>
```

## Build & publish (multi-arch)

Nodes can be amd64 or arm64, so publish a manifest list covering both.

Manual (until the CI workflow is wired — see below):

```sh
ALIAS=c7s2j3w4                         # default public-registry alias
REPO="public.ecr.aws/${ALIAS}/node-shell"

# ECR Public auth is us-east-1 only; the registry host is always public.ecr.aws.
aws ecr-public get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws

# Build + push linux/amd64 + linux/arm64 in one manifest list.
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file apps/node-shell/Dockerfile \
  --tag "$REPO:v1" \
  --provenance=false \
  --push \
  apps/node-shell

# Resolve the immutable manifest-list digest to pin into the desktop app:
docker buildx imagetools inspect "$REPO:v1" --format '{{json .Manifest.Digest}}'
```

Scan before relying on it:

```sh
trivy image --severity HIGH,CRITICAL "$REPO:v1"
```

## CI

`.github/workflows/deploy-node-shell.yml` builds + pushes multi-arch to ECR
**Public** via OIDC. It is **workflow_dispatch-only** until the infra
prerequisites exist:

- [ ] Create an **ECR Public** repo `node-shell` in the deploy account.
- [ ] Note the registry **alias** (公有注册表 → 设置) and set `ECR_PUBLIC_ALIAS`
      in the workflow.
- [ ] Grant the GitHub OIDC deploy role ECR Public push perms **plus
      `sts:GetServiceBearerToken`**; set `AWS_DEPLOY_ROLE_ARN`.
- [ ] After the first publish, set the digest as `NODE_SHELL_IMAGE`'s default in
      `apps/desktop/electron/pod-exec.ts` and flip PR #185 back to ready.

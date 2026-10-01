---
name: aliyun
description: Run Alibaba Cloud CLI (aliyun) commands from the sandbox to inspect or change Alibaba Cloud resources (ACK, ECS, SLB, VPC, OSS, etc.). Includes a script to load a Nuphos-bound Alibaba Cloud account's credentials.
---

# Alibaba Cloud CLI (aliyun)

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change Alibaba Cloud resources directly with `aliyun`. Authenticate before any `aliyun` call — either with credentials Nuphos holds for a bound account (preferred), or with credentials the user pasted in.

## When to skip this skill

For anything Nuphos already exposes via its own API — listing ACK clusters, fetching kubeconfigs, listing ECS instances — call the Nuphos backend route directly instead of `aliyun`. Same data, no setup, smaller blast radius:

- List ACK clusters in a bound account → `GET /teams/:teamId/aliyun-accounts/:accountId/clusters`
- List ECS instances → `GET /teams/:teamId/aliyun-accounts/:accountId/ecs-instances`
- Run kubectl against an ACK cluster → its context is `aliyun/<account>/<cluster>` in the kubeconfig the kubectl skill sets up

Use this skill when the user asks for something Nuphos does not expose (e.g. OSS, SLB/CLB, VPC/security-group edits, RDS, Cloud Monitor), or hands you keys for an account Nuphos isn't connected to.

## Setup

```bash
# Authenticate. Pick ONE path:

# (a) PREFERRED — short-lived assumed-role creds for an Nuphos-bound account.
#     Writes ~/.aliyun/config.json so plain `aliyun` calls work.
bash skills/aliyun/scripts/setup-credentials.sh <teamId> <accountId> [region]

# (b) Static keys the user pasted — pass per command, never write to disk.
aliyun ecs DescribeRegions --region cn-hangzhou \
  --access-key-id AKID... --access-key-secret ...
```

### Fallback: aliyun CLI missing

If `aliyun: command not found` (cold start without the runtime image), install it:

```bash
curl -fsSL https://aliyuncli.alicdn.com/aliyun-cli-linux-latest-amd64.tgz | tar xz && sudo mv aliyun /usr/local/bin/
```

Nuphos uses OIDC web-identity federation here (like AWS): the customer registers Nuphos as a RAM OIDC identity provider and creates a RAM role trusting it, then Nuphos calls `sts:AssumeRoleWithOIDC` to get short-lived credentials — no long-lived keys are stored. `setup-credentials.sh` calls `GET /teams/:teamId/aliyun-accounts/:accountId/credentials` on the Nuphos backend with the user's `NUPHOS_TOKEN` and writes an `StsToken`-mode profile (AccessKeyId/AccessKeySecret + `sts_token`). These expire (assumed-role session), so re-run the script to refresh. The credentials carry exactly the role's permissions.

Always run `aliyun sts GetCallerIdentity` first to confirm which account you are about to operate on, and tell the user before doing anything mutating.

## When you hit a permission / 403 error

If `setup-credentials.sh` returns HTTP 403, the current member account does not have access to that Alibaba Cloud binding (or it wasn't shared with them). Do not try to request access from inside the sandbox. Ask the user or a team admin to add the member account to the binding's Access allow list.

If an `aliyun` call returns `Forbidden.RAM` / `NoPermission` / `NotAuthorized`, the bound role is missing a permission — report exactly which action/resource failed so the user can widen the RAM policy. Do not attempt to escalate from inside the sandbox.

## Common operations

```bash
# Which identity am I?
aliyun sts GetCallerIdentity

# List ACK clusters
aliyun cs GET /api/v1/clusters

# List ECS instances in a region
aliyun ecs DescribeInstances --RegionId cn-hangzhou

# Describe an SLB load balancer
aliyun slb DescribeLoadBalancers --RegionId cn-hangzhou
```

Alibaba Cloud APIs are region-scoped for ECS/SLB/VPC (pass `--RegionId`); ACK's cluster APIs are account-global. Use `aliyun <product> --help` to discover actions.

## China vs International accounts

Alibaba Cloud has two isolated partitions (like AWS `aws` vs `aws-cn`): **China** (aliyun.com, `cn-*` regions) and **International** (alibabacloud.com, `ap-*`/`us-*`/`eu-*` regions). A credential works in only one. `setup-credentials.sh` writes the partition-appropriate default region automatically (from the backend's `defaultRegion`), so plain `aliyun` calls target a region the keys can authenticate against — override with an explicit `--RegionId` for other regions in the same partition.

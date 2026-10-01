---
name: tencent
description: Run Tencent Cloud CLI (tccli) commands from the sandbox to inspect or change Tencent resources (TKE, CVM, CLB, VPC, etc.). Includes a script to load short-lived credentials for an Nuphos-bound Tencent account.
---

# Tencent Cloud CLI (tccli)

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change Tencent Cloud resources directly with `tccli`. Authenticate before any `tccli` call — either with credentials Nuphos mints for a bound account (preferred), or with credentials the user pasted in.

## When to skip this skill

For anything Nuphos already exposes via its own API — listing TKE clusters, fetching kubeconfigs — call the Nuphos backend route directly instead of `tccli`. Same data, no setup, smaller blast radius:

- List TKE clusters in a bound account → `GET /teams/:teamId/tencent-accounts/:accountId/clusters`
- Run kubectl against a TKE cluster → its context is `tencent/<account>/<cluster>` in the kubeconfig the kubectl skill sets up

Use this skill when the user asks for something Nuphos does not expose (e.g. COS, CLB, VPC/security-group edits, CVM, Cloud Monitor), or hands you keys for an account Nuphos isn't connected to.

## Setup

```bash
# Authenticate. Pick ONE path:

# (a) PREFERRED — short-lived assumed-role STS credentials for an Nuphos-bound
#     account. Writes ~/.tccli/default.credential + default.configure so plain
#     `tccli` calls work. These expire (assumed-role session) — re-run to refresh.
bash skills/tencent/scripts/setup-credentials.sh <teamId> <accountId> [region]

# (b) Static keys the user pasted — pass per command, never write to disk.
tccli cvm DescribeRegions --region ap-guangzhou \
  --SecretId AKID... --SecretKey ...
```

`tccli` is pre-installed in the sandbox runtime. If it is missing, the sandbox
is running an outdated image; report that runtime mismatch instead of doing an
unpinned package install during the task.

Nuphos uses OIDC web-identity federation here (like AWS): the customer registers Nuphos as a CAM OIDC identity provider and creates a CAM role trusting it, then Nuphos calls `sts:AssumeRoleWithWebIdentity` to get short-lived credentials — no long-lived keys are stored. `setup-credentials.sh` calls `GET /teams/:teamId/tencent-accounts/:accountId/credentials` on the Nuphos backend with the user's `NUPHOS_TOKEN` and writes a `token`-type tccli profile (SecretId/SecretKey + token). These expire (assumed-role session), so re-run the script to refresh. The credentials carry exactly the role's permissions.

Always run `tccli sts GetCallerIdentity --region <region>` first to confirm which account/role you are about to operate on, and tell the user before doing anything mutating.

## When you hit AuthFailure / HTTP 403

If `setup-credentials.sh` returns HTTP 403, the current member account does not have access to that Tencent binding (or it wasn't shared with them). Do not try to request access from inside the sandbox. Ask the user or a team admin to add the member account to the binding's Access allow list.

If a `tccli` call returns `AuthFailure.UnauthorizedOperation` or `CamNoAuth*`, the bound CAM role is missing a permission — report exactly which action/resource failed so the user can widen the role's policy. Do not attempt to escalate from inside the sandbox.

## Common operations

```bash
# Which identity am I?
tccli sts GetCallerIdentity --region ap-guangzhou

# List TKE clusters in a region
tccli tke DescribeClusters --region ap-guangzhou

# List CVM instances
tccli cvm DescribeInstances --region ap-guangzhou

# Describe a CLB load balancer
tccli clb DescribeLoadBalancers --region ap-guangzhou
```

Tencent APIs are region-scoped — always pass `--region`. Use `tccli <product> help` to discover actions.

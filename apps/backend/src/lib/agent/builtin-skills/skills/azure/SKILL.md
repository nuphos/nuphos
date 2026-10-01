---
name: azure
description: Inspect or change Microsoft Azure resources from the sandbox via the Azure Resource Manager (ARM) REST API or the az CLI. Includes a script to load a short-lived ARM access token for an Nuphos-bound Azure subscription.
---

# Microsoft Azure (ARM)

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change Azure resources. Authenticate before any ARM/`az` call with the short-lived token Nuphos mints for a bound subscription.

## When to skip this skill

For anything Nuphos already exposes via its own API — listing AKS clusters, fetching kubeconfigs — call the Nuphos backend route directly instead of hitting ARM yourself. Same data, no setup, smaller blast radius:

- List AKS clusters in a bound subscription → `GET /teams/:teamId/azure-accounts/:accountId/clusters`
- Run kubectl against an AKS cluster → its context is `azure/<account>/<cluster>` in the kubeconfig the kubectl skill sets up. Entra-ID (AAD) integrated clusters are the one exception — they need `kubelogin`, which the sandbox doesn't ship, so they are not included.

Use this skill when the user asks for something Nuphos does not expose (e.g. resource groups, storage accounts, VMs, networking, role assignments).

## Setup

```bash
# Load a short-lived ARM access token for an Nuphos-bound subscription, then
# source it so $AZURE_ACCESS_TOKEN + $AZURE_SUBSCRIPTION_ID are available.
# The token expires (workload-identity federation) — re-run to refresh.
source <(bash skills/azure/scripts/setup-credentials.sh <teamId> <accountId>)
```

Nuphos uses OIDC workload identity federation here (like AWS/Tencent): the customer creates an Entra ID app registration with a federated credential trusting the Nuphos issuer and grants it an RBAC role on a subscription. Nuphos exchanges a per-team token for a short-lived ARM access token — no client secret is stored. `setup-credentials.sh` calls `GET /teams/:teamId/azure-accounts/:accountId/credentials` on the Nuphos backend with the user's `NUPHOS_TOKEN` and prints `export` lines for the token + subscription id. The token carries exactly the app's RBAC permissions and expires (~1h), so re-run to refresh.

## Calling ARM

The token is a standard `management.azure.com` bearer. The sandbox runtime
pre-installs `az`; prefer `az rest` for ARM requests and use raw `curl` when you
need exact control over headers or response handling:

```bash
# Which subscription/tenant is this token for?
curl -sS -H "Authorization: Bearer $AZURE_ACCESS_TOKEN" \
  "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID?api-version=2022-12-01"

# List resource groups
curl -sS -H "Authorization: Bearer $AZURE_ACCESS_TOKEN" \
  "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourcegroups?api-version=2021-04-01"

# List AKS clusters (prefer the Nuphos route above unless you need raw ARM)
curl -sS -H "Authorization: Bearer $AZURE_ACCESS_TOKEN" \
  "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/providers/Microsoft.ContainerService/managedClusters?api-version=2024-05-01"
```

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourcegroups?api-version=2021-04-01" \
  --headers "Authorization=Bearer $AZURE_ACCESS_TOKEN"
```

Always confirm which subscription you are about to operate on, and tell the user before doing anything mutating.

## When you hit HTTP 401 / 403

If `setup-credentials.sh` returns HTTP 403, the current member account does not have access to that Azure binding (or it wasn't shared with them). Do not try to request access from inside the sandbox. Ask the user or a team admin to add the member account to the binding's Access allow list.

If an ARM call returns `AuthorizationFailed`, the app's RBAC role is missing a permission — report exactly which action/scope failed so the user can widen the role assignment. Do not attempt to escalate from inside the sandbox.

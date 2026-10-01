---
name: nuphos-api
description: Live reference for Nuphos-native REST resources and operations. For third-party/cloud provider work, use that provider's native skill and semantic scripts first; use this skill when the task specifically needs a Nuphos API operation or route contract.
---

# nuphos-api

Nuphos backend exposes a REST API that wraps most BYOC and BYOS operations the agent needs. When a user asks about teams, accounts, projects, Cloud Run services, clusters, VPCs, firewalls, NACLs, kubeconfigs, credentials, Zeabur projects/servers, or bound integrations, start from this API before guessing cloud CLI commands.

The OpenAPI document is the source of truth for documented routes. Do not rely on a copied route list in this skill; fetch the current schema before choosing an endpoint or request shape. If a needed legacy BYOS route is not in OpenAPI yet, do not probe guessed paths. Use the exact setup script or documented route in the provider skill (`aws`, `gcloud`, `kubectl`, `cloudflare`) instead.

## Nuphos GUI links

When writing a final answer that mentions a concrete Nuphos resource and the user would benefit from opening it in the desktop UI, search the GUI route catalog instead of guessing the URL:

```bash
rg -i "s3|bucket|ec2|grafana|pod|deployment|github|plan" skills/nuphos-api/references/gui-routes.md
```

Use the matching route template from `skills/nuphos-api/references/gui-routes.md` only when you have every required id listed on that row. If the catalog has no matching route or an id is missing, do not invent a Nuphos URL.

## Fetch the current API schema

Run this first when you need API details:

```bash
bash skills/nuphos-api/scripts/openapi.sh
```

Useful variants:

```bash
# List matching paths / operation ids.
bash skills/nuphos-api/scripts/openapi.sh --path clusters
bash skills/nuphos-api/scripts/openapi.sh --path linode-accounts
bash skills/nuphos-api/scripts/openapi.sh --path github-installations
bash skills/nuphos-api/scripts/openapi.sh --path cloud-run-services
bash skills/nuphos-api/scripts/openapi.sh --path credentials

# Print one operation with parameters, requestBody, and responses.
bash skills/nuphos-api/scripts/openapi.sh --operation plans.create

# Save and print the full OpenAPI JSON.
bash skills/nuphos-api/scripts/openapi.sh --raw

# Reuse the cached schema when the API is temporarily unreachable.
bash skills/nuphos-api/scripts/openapi.sh --no-refresh --path plans
```

The script fetches `${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}/openapi.json`, caches it at `/tmp/nuphos-openapi.json`, and prints a compact summary by default so the agent can inspect the live contract without reading a huge JSON blob in every turn. If refresh fails but a cache exists, it falls back to the cached schema.

Always call Nuphos backend APIs through the `ac` helper or `${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}`. Do not hard-code `https://api.nuphos.ai`; local dev injects `NUPHOS_BACKEND_URL` so sandbox calls route back through the developer tunnel to the same backend this chat is using.

Do not fetch raw provider credentials from Nuphos credential endpoints just to inspect a third-party provider. For Zeabur, use the documented Nuphos API routes under `/teams/{teamId}/zeabur-providers/...` for providers, projects, and servers. Do not put a Zeabur token into shell commands, logs, or external GraphQL calls.

## Auth

All API routes except health/openapi-style public routes should be called with:

```bash
Authorization: Bearer $NUPHOS_TOKEN
```

The token is already exported in the sandbox. In a classic sandbox it is the
current user's session. When `NUPHOS_SESSION_ID` is set it is a conversation
principal: call the same `/teams/...` URLs, and the backend automatically
limits the request to that conversation's team, selected credentials, and
explicitly supported API capabilities. Do not inspect, print, replace, or test
the token. A `403 conversation_api_forbidden` is an authoritative capability
boundary; use the provider's semantic scripts or explain that the operation is
not available instead of looking for another token or route.

Reusable helper:

```bash
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }
```

## Admin routes and human-only operations

In a conversation principal (`NUPHOS_SESSION_ID` set) the allow-list is the
whole story: admin-only routes, `GET /teams/:teamId` itself, and every route
that creates, edits, or removes a cloud/integration binding are denied no
matter what role the signed-in user holds. Checking the role proves nothing —
there is no token or plan approval that turns them on.

So on `403 conversation_api_forbidden`, do not report it as missing permissions
and do not ask for the API to be opened. Say plainly that agents cannot perform
this operation, and name the step the user takes in the Nuphos app (binding a
cloud account or integration lives under Settings -> Integrations), including
the exact values they need to enter. Do everything you *can* do first — for a
cloud onboarding that usually means preparing the service account, role, or
trust policy with the provider skill — so only the human step is left.

In a classic sandbox (no `NUPHOS_SESSION_ID`) the token is the user's own
session and admin routes follow the user's team role as usual.

If the work requires external credentials or capabilities outside Nuphos API access, such as a cloud CLI action that Nuphos does not expose, use the relevant `aws`, `gcloud`, `kubectl`, `github`, `grafana`, or `cloudflare` skill.

## Workflow

1. For a Nuphos API task, fetch the latest OpenAPI schema with `scripts/openapi.sh`. For provider credential setup or a provider-specific workflow, load that provider skill and use its semantic scripts instead.
2. Pick the matching operation from the live schema.
3. Use `ac` to call the endpoint with `$NUPHOS_TOKEN`.
4. For mutations, create a plan first instead of executing immediately.
5. For read-only questions, call the API directly and summarize the result.

The sandbox has `jq`; use it for JSON formatting and filtering instead of
starting a Python process. Reach for Python only when the transformation is too
complex to express clearly in `jq`.

---
name: huawei
description: Call Huawei Cloud (华为云) REST APIs from the sandbox with the bundled signer to inspect or change Huawei Cloud resources (CCE, ECS, ELB, VPC, OBS, RDS, etc.). Includes a script to load a Nuphos-bound Huawei Cloud account's short-lived federated credentials.
---

# Huawei Cloud (华为云)

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change Huawei Cloud resources. Authenticate before any call — either with credentials Nuphos holds for a bound account (preferred), or with credentials the user pasted in.

## Setup

```bash
# Authenticate. PREFERRED — short-lived federated creds for a Nuphos-bound account.
bash skills/huawei/scripts/setup-credentials.sh <teamId> <accountId> [region]
source ~/.huawei/credentials.env
```

Nuphos uses OIDC federation here, like every other cloud connector — but Huawei Cloud has no AssumeRole, so the trust relationship *is* an IAM5 OIDC provider plus a trust agency assigned to Nuphos's audience on it. Nuphos mints a per-team RS256 ID token and calls STS's `AssumeAgencyWithOIDC` (`POST https://sts.<region>.myhuaweicloud.com/v5/agencies/assume-with-oidc`, unsigned) with the provider and agency URNs to get temporary AK/SK + security token directly — no long-lived Huawei keys, no intermediate token, and no relation to IAM's legacy Keystone identity-provider APIs, which don't see IAM5 providers at all.

`setup-credentials.sh` calls `GET /teams/:teamId/huawei-accounts/:accountId/credentials` with the user's `NUPHOS_TOKEN` and writes both naming schemes, because neither reads the other's:

- `HUAWEICLOUD_SDK_AK` / `HUAWEICLOUD_SDK_SK` / `HUAWEICLOUD_SDK_SECURITY_TOKEN` / `HUAWEICLOUD_SDK_REGION` — the bundled `hw-api.py` signer and Huawei's official SDKs
- `HW_ACCESS_KEY` / `HW_SECRET_KEY` / `HW_SECURITY_TOKEN` / `HW_REGION_NAME` — the Terraform provider

It also exports `HUAWEICLOUD_DOMAIN_ID` (the account id). Federated credentials carry no IAM user, so use it wherever an API path or SDK asks for a domain id.

The credentials expire (temporary security credentials, one hour by default), so re-run the script to refresh. They carry exactly the permissions of the trust agency the customer assigned to Nuphos's audience — nothing more.

## What the customer has to have set up

If federation fails at bind time or later, it is almost always one of these on the customer's side:

1. An IAM identity provider with protocol **OIDC**.
2. Identity provider URL = the Nuphos issuer, audience = the value shown in the connect dialog (`GET /teams/:teamId/huawei-accounts/oidc-info` returns issuer, audience and this team's subject).
3. A trust agency assigned to that audience (**Assign Trust Agency** on the provider's Audiences tab), holding the permissions Nuphos should have.
4. That agency's permissions assigned at the account level (**All resources** / 全局服务), because Nuphos asks for an account-scoped credential. An agency holding only one project's permissions authenticates but cannot be scoped to the account, and the exchange fails.

A wrong audience, provider name, or trust agency name all surface as a rejected `AssumeAgencyWithOIDC` call.

## "Can you see my Huawei account?"

Answer from `list_credentials` (or the credentials section of your instructions) alone: if a `huawei` entry is listed, the binding exists and is selected for this conversation, and its label names the account. Do **not** run the setup script or make a live API call to answer this — only do so when the user asks you to actually look at something in the account.

## Calling the API

There is **no Huawei CLI in the sandbox** — `hcloud` here is Hetzner's CLI, never Huawei's. Call the REST API with the bundled signer, which signs requests exactly as Huawei's official SDKs do (`SDK-HMAC-SHA256`, plus the signed `X-Security-Token` header temporary credentials require). Do not write your own signer.

First call — confirm the credentials work. This is the call Nuphos itself makes with these credentials when the account is bound, so it succeeds on any correctly bound account:

```bash
source ~/.huawei/credentials.env
python3 skills/huawei/scripts/hw-api.py GET "https://iam.myhuaweicloud.com/v5/agencies?limit=1"
```

Then fetch the project id for the region (many service APIs are project-scoped) and call the service:

```bash
python3 skills/huawei/scripts/hw-api.py GET \
  "https://iam.myhuaweicloud.com/v3/projects?name=$HUAWEICLOUD_SDK_REGION"
python3 skills/huawei/scripts/hw-api.py GET \
  "https://cce.$HUAWEICLOUD_SDK_REGION.myhuaweicloud.com/api/v3/projects/<projectId>/clusters"
```

A `403` after the first call succeeded means the trust agency lacks that permission — report it rather than retrying variants. A `401` means the credentials expired or were not sourced: re-run `setup-credentials.sh` and `source` the file again.

Regional endpoints are `<service>.<region>.myhuaweicloud.com`; IAM is also reachable globally at `iam.myhuaweicloud.com`. Fetch project ids rather than guessing them.

Look an API up before calling it rather than guessing a path or parameter name — the API Explorer at `https://apiexplorer.developer.huaweicloud.com/apiexplorer/doc?product=<Product>&api=<Action>` is authoritative.

## Region

`cn-north-4` (北京四) is the default this skill writes when the backend does not say otherwise. Resources are region-scoped, so confirm the region with the user before a sweep rather than assuming every account lives in the default.

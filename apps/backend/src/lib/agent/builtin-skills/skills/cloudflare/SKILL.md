---
name: cloudflare
description: Use Cloudflare API credentials bound in Nuphos to inspect or change Cloudflare account resources.
---

# cloudflare

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change Cloudflare resources in a team-bound account.

## Setup

The bound Cloudflare accounts are already listed for you under **Cloudflare accounts:** in the
credential section of the system prompt. Each line carries the `accountId`, `accountName`, and
a ready-to-run `setupCommand`. Pick the matching account and run its `setupCommand` verbatim:

```bash
bash skills/cloudflare/scripts/setup-credentials.sh <teamId> <accountId>
```

The script calls `GET /teams/$TEAM/cloudflare-accounts/$ACCOUNT_ID/credentials` on Nuphos backend with the user's `NUPHOS_TOKEN`. When running inside an Nuphos agent sandbox, it prefers the agent-session path automatically. It writes a private env file at `~/.cloudflare/nuphos.env`.

Then call Cloudflare with curl:

```bash
source ~/.cloudflare/nuphos.env

curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_KEY" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
```

If the credential section lists no Cloudflare accounts, tell the user a team admin needs to bind one first — you cannot bind it for them.

### Fallback: discover accounts yourself

Only if the credential section is missing or looks stale. `$TEAM` is exported in the runtime
environment.

```bash
# Reuse the helper from the nuphos-api skill (loads it if needed):
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }

ac /teams/$TEAM/cloudflare-accounts | python3 -m json.tool
```

## Nuphos API

- `GET /teams/$TEAM/cloudflare-accounts` — list bound Cloudflare accounts (`accountId`, `accountName`)
- `POST /teams/$TEAM/cloudflare-accounts` (admin) — bind an account with `accountId` and a scoped API token as `apiKey`
- `GET /teams/$TEAM/cloudflare-accounts/$ACCOUNT_ID` — account detail without the secret
- `DELETE /teams/$TEAM/cloudflare-accounts/$ACCOUNT_ID` (admin)
- `GET /teams/$TEAM/cloudflare-accounts/$ACCOUNT_ID/credentials` — retrieve the bound API key/token for Cloudflare API calls

## Safety

- Use Cloudflare scoped API tokens. Global API Keys are not supported.
- Treat the returned key as sensitive. Do not print it, commit it, or paste it into final answers.
- Confirm with the user before mutations such as changing DNS records, zones, workers, rules, WAF, access policies, or account settings.
- If a Cloudflare call returns 401/403, re-run the setup script first. If it still fails, explain the missing Cloudflare permission or account mismatch.

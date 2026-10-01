---
name: tailscale
description: Use a Tailscale OAuth client bound in Nuphos to inspect or change Tailscale tailnet resources through the Tailscale API.
---

# tailscale

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or manage Tailscale devices, tailnet settings, DNS, ACLs, auth keys, or other Tailscale API resources.

## Interpret setup requests generously

Users might ask for this in imprecise language, for example:

- "Use my local tailscale cli to create an OAuth client and bind it to Nuphos."
- "Set up Tailscale BYOK for this team."
- "Connect my Tailscale to Nuphos."

Treat these as a request to complete the whole setup, not as a literal command contract. Do not fail just because the wording mentions the Tailscale CLI.

Follow this flow:

1. Check local context:
   ```bash
   command -v tailscale >/dev/null 2>&1 && tailscale status || true
   ```
2. If the installed `tailscale` CLI exposes a real command for creating OAuth clients, use it.
3. If the CLI cannot create OAuth clients, explain briefly that Tailscale OAuth clients are created in the Tailscale admin console under Trust credentials / OAuth. Then guide the user there and continue the workflow after they provide the generated client ID and secret.
4. Ask for the intended permission level and choose the minimum OAuth client scopes needed. For general Nuphos device listing/management, the user usually needs a device-related scope such as read/write device access. If Tailscale returns a scope error later, name the missing capability instead of asking for unrelated credentials.
5. Bind the OAuth client to Nuphos with a clear label that reflects its permission level, such as `tailscale-devices-readonly` or `tailscale-devices-admin`.
6. Verify by listing the bound clients and calling the devices endpoint.

Important: the OAuth client secret is shown only once by Tailscale. Never print it back to the user or store it outside the Nuphos binding flow.

## Bind an OAuth client to Nuphos

If the user provides a Tailscale OAuth client ID and secret, bind it with the Nuphos API. Prefer reading the secret silently from stdin when running locally.

```bash
team_id="<teamId>"
label="<descriptive-label>"

read -r -p "Tailscale OAuth client ID: " tailscale_client_id
read -r -s -p "Tailscale OAuth client secret: " tailscale_client_secret
printf '\n'

python3 - "$team_id" "$label" "$tailscale_client_id" "$tailscale_client_secret" <<'PY' | \
  curl -fsS -X POST "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}/teams/${team_id}/tailscale-clients" \
    -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @-
import json
import sys

_, team_id, label, client_id, client_secret = sys.argv
print(json.dumps({
    "label": label,
    "clientId": client_id,
    "clientSecret": client_secret,
}))
PY
```

After binding, list clients:

```bash
curl -fsS -H "Authorization: Bearer $NUPHOS_TOKEN" \
  "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}/teams/${team_id}/tailscale-clients" | python3 -m json.tool
```

## Authenticate

Use the exact setup command shown in the Nuphos credential prompt. It looks like:

```bash
bash skills/tailscale/scripts/setup-credentials.sh <teamId> <clientId>
```

The script calls `GET /teams/:teamId/tailscale-clients/:clientId/credentials` on the Nuphos backend with the user's `NUPHOS_TOKEN`. In an Nuphos agent sandbox it automatically prefers the agent-session scoped endpoint. It writes `~/.tailscale/nuphos.env` and exports values that later shell commands can source.

```bash
source ~/.tailscale/nuphos.env
curl -fsS -H "Authorization: Bearer $TAILSCALE_API_TOKEN" \
  "https://api.tailscale.com/api/v2/tailnet/$TAILSCALE_TAILNET/devices" | python3 -m json.tool
```

`TAILSCALE_TAILNET` defaults to `-`, which means the tailnet associated with the OAuth access token.

## Useful endpoints

- `GET /teams/:teamId/tailscale-clients` — list bound Tailscale OAuth clients.
- `GET /teams/:teamId/tailscale-clients/:clientId/devices` — list devices through Nuphos.
- `GET /teams/:teamId/tailscale-clients/:clientId/credentials` — mint a short-lived Tailscale OAuth access token.

Direct Tailscale API base URL:

```bash
https://api.tailscale.com/api/v2
```

## Safety

- Do not print `TAILSCALE_API_TOKEN`, `TS_API_TOKEN`, or `~/.tailscale/nuphos.env`.
- If Tailscale returns 401, the OAuth access token might be expired. Re-run the setup script.
- If an API call returns a scope/permission error, tell the user which Tailscale OAuth client scope is needed instead of asking for the client secret again.
- If the requested Tailscale client is not listed in the enabled credentials prompt, ask the user to update this session's credential selection.

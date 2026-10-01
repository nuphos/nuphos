---
name: upstash
description: Manage Upstash — list/create/delete Redis databases, read usage stats and backups, and manage Vector indexes — through an Upstash account the user's team has bound to Nuphos. Use whenever the user asks about their Upstash Redis databases, wants to provision or tear one down, check an Upstash endpoint/region/plan, inspect Redis usage or costs, or manage Upstash Vector indexes. Nuphos backend hands the agent an Upstash Management API key; the agent calls api.upstash.com/v2 directly with curl.
---

# upstash

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants you to inspect or change their **Upstash**
resources — find a Redis database's endpoint, provision a new one, check usage
stats before a plan change, tear down a stale database, or manage Vector
indexes — using the **Upstash account** their team has already bound to Nuphos.

Anything the Upstash Management API can do, this skill can do. The sandbox
pre-installs Upstash's official CLI, which reads the credentials this skill
loads; prefer it for supported operations and use the raw Management API for
the remaining endpoints.

> **Scope: control plane, not data plane.** This is the *Management* API — it
> manages databases as resources (create/delete/stats/plan). It does **not**
> read or write the keys *inside* a Redis database. For that you need the
> database's own REST endpoint + token, which `GET /redis/database/{id}` exposes
> as `endpoint` and `rest_token` (see "Talking to a database" below).

## Setup

The bound Upstash accounts are already listed for you under **Upstash accounts:** in the
credential section of the system prompt. Each line carries the `accountId`, `label`, `email`, a
ready-to-run `setupCommand`, and a `databasesEndpoint` for a quick read-only listing through
Nuphos. Pick one (most teams have exactly one) and run its `setupCommand` verbatim:

```bash
# 1. Load the account's key into the env.
bash skills/upstash/scripts/setup-credentials.sh <teamId> <accountId>
source ~/.upstash/nuphos.env

# The official CLI reuses UPSTASH_EMAIL + UPSTASH_API_KEY. It is the shortest
# path for common operations and avoids hand-authoring URLs and auth headers.
upstash redis list
upstash redis get --db-id <id> --hide-credentials

# 2. Raw helper for Management API calls the CLI does not expose. Auth is HTTP Basic: email as the
#    username, API key as the password.
#    --fail-with-body is what makes an HTTP error an *error*: without it curl
#    exits 0 on a 401 and the failure looks like success. It still prints the
#    body, so Upstash's {"error": "..."} stays visible.
ups() {
  # usage: ups <METHOD> <path> [curl args...]
  local method="$1" path="$2"; shift 2
  curl -sS --fail-with-body -X "$method" "https://api.upstash.com/v2${path}" \
    -u "$UPSTASH_EMAIL:$UPSTASH_API_KEY" \
    -H "Content-Type: application/json" "$@"
}

# 3. Same call, but strips live credentials from the response. Database and
#    Vector objects embed `password` / `rest_token`; printing them would leak
#    data-plane credentials into the transcript. **Display through `ups_safe`.**
#    Raw `ups` is fine only where the response is documented not to carry
#    secrets (stats, backups, the "OK" maintenance endpoints), or for the
#    non-printing `eval` flow in "Talking to a database".
#    `out=$(ups ...)` before the pipe on purpose: piping straight into python
#    would return *python's* status and swallow the API failure.
ups_safe() {
  local out rc
  out="$(ups "$@")"; rc=$?
  printf '%s' "$out" | python3 -c '
import json, sys
SECRET = {"password", "rest_token", "read_only_rest_token"}
def scrub(o):
    if isinstance(o, dict):
        return {k: ("<redacted>" if k in SECRET else scrub(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(i) for i in o]
    return o
raw = sys.stdin.read()
try:
    print(json.dumps(scrub(json.loads(raw)), indent=2))
except json.JSONDecodeError:
    # Non-JSON bodies (e.g. the bare "OK" some endpoints return) pass through.
    sys.stdout.write(raw)
'
  return $rc
}

# Sanity check — list the account's Redis databases.
ups_safe GET /redis/databases
```

If the credential section lists no Upstash accounts, tell the user a
team admin needs to connect Upstash first (Cloud → Integrations → Add →
Upstash). You cannot bind it for them.

If `setup-credentials.sh` returns **403**, the user isn't on this binding's
access allow-list — ask a team admin to grant them access. **404** means the
binding was deleted — re-list accounts (see the fallback below).

### Fallback: discover accounts yourself

Only if the credential section is missing or looks stale. `$TEAM` is exported in the runtime
environment.

```bash
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }
ac /teams/$TEAM/upstash-accounts | python3 -m json.tool
# → { "accounts": [ { "id": "<accountId>", "label": "Acme",
#       "email": "ops@acme.com", ... } ] }
```

> **Watch the singular/plural paths.** Upstash is inconsistent and a wrong path
> 404s: listing is `/redis/databases` (plural), but create is `/redis/database`
> and single-database operations are `/redis/database/{id}` (singular). Vector
> listing is `/vector/index` (singular), not `/vector/indexes`.

## Redis — list and inspect

```bash
ups_safe GET /redis/databases
# → [ { "database_id": "...", "database_name": "prod-cache", "region": "global",
#       "state": "active", "endpoint": "xxx.upstash.io", "port": 6379,
#       "primary_region": "us-east-1", "read_regions": ["eu-west-1"], ... } ]

DB=<database_id>
ups_safe GET /redis/database/$DB     # full detail, credentials redacted
```

Useful fields: `database_id`, `database_name`, `state` (`active`/`deleted`),
`endpoint` + `port`, `tls`, `primary_region`, `read_regions`, `db_type`
(plan/tier), `creation_time` (unix seconds), `budget`.

## Redis — usage stats

```bash
ups GET /redis/stats/$DB | python3 -m json.tool
```

Returns time series for throughput, commands, latency (mean + p99), bandwidth,
disk usage and keyspace, plus cache hits/misses, per-command counts, and monthly
billing/storage figures. Use this to answer "is this database busy / should we
change plan / why is the bill up".

## Redis — create

```bash
ups_safe POST /redis/database -d '{
  "database_name": "prod-cache",
  "platform": "aws",
  "primary_region": "us-east-1",
  "read_regions": ["eu-west-1"],
  "tls": true
}'
```

The response carries `database_id` and `endpoint` — **and live `password` /
`rest_token` values**, which is why this goes through `ups_safe`. The database
is created either way; redaction only affects what gets displayed.

Required: `database_name`, `platform` (`aws` or `gcp`), and `primary_region`.
There is **no** `region` field on create — a database becomes global by listing
`read_regions`. Optional: `read_regions`, `plan`, `budget`, `eviction`, `tls`.
Region names are AWS-style (`us-east-1`, `eu-west-1`, `ap-northeast-1`, …).
**Creating a database costs the user money** — always confirm first (see Safety).

## Redis — modify

```bash
ups_safe POST /redis/rename/$DB -d '{"name":"new-name"}'
ups POST /redis/update-regions/$DB -d '{"read_regions":["eu-west-1","us-west-1"]}' | python3 -m json.tool

# Change plan. Note the odd path shape — the id is a path *segment* here
# (/redis/{id}/change-plan), unlike every other Redis op above, and the field is
# `plan_name`, not `plan`.
ups POST /redis/$DB/change-plan -d '{"plan_name":"fixed_1gb"}' | python3 -m json.tool
# plan_name: free | payg | fixed_250mb | fixed_1gb | fixed_5gb | fixed_10gb
#            | fixed_50gb | fixed_100gb | fixed_500gb
ups_safe POST /redis/reset-password/$DB   # rotates the password AND rest_token

ups_safe POST /redis/enable-tls/$DB
ups POST /redis/enable-autoupgrade/$DB | python3 -m json.tool
ups POST /redis/disable-autoupgrade/$DB | python3 -m json.tool
ups POST /redis/enable-eviction/$DB | python3 -m json.tool
ups POST /redis/disable-eviction/$DB | python3 -m json.tool
```

## Redis — delete

```bash
ups DELETE /redis/database/$DB     # → "OK"
```

**Irreversible and destroys data.** Only on an explicit instruction naming the
database, and echo back the name + id you're about to delete first.

## Redis — backups

```bash
ups GET /redis/list-backup/$DB | python3 -m json.tool
ups POST /redis/create-backup/$DB -d '{"name":"pre-migration"}' | python3 -m json.tool
ups POST /redis/restore-backup/$DB -d '{"backup_id":"<id>"}' | python3 -m json.tool
ups DELETE /redis/delete-backup/$DB/<backupId>
ups POST /redis/enable-dailybackup/$DB | python3 -m json.tool
```

Restoring **overwrites the database's current contents** — treat it like a
delete and confirm explicitly.

## Vector indexes

```bash
ups_safe GET /vector/index                 # note: singular
IDX=<index id>
ups_safe GET /vector/index/$IDX
ups_safe POST /vector/index -d '{
  "name": "docs-embeddings",
  "region": "us-east-1",
  "similarity_function": "COSINE",
  "dimension_count": 1536
}'
ups DELETE /vector/index/$IDX
ups_safe POST /vector/index/$IDX/rename -d '{"name":"new-name"}'
```

Create requires `name`, `region` (`us-east-1`, `eu-west-1`, `us-central1`),
`similarity_function` (`COSINE`, `EUCLIDEAN`, `DOT_PRODUCT`), and
`dimension_count`. Unlike Redis, Vector *does* take a `region` field.

## Talking to a database (data plane)

The Management API won't read keys. Pull the database's own REST credentials,
then use the Upstash Redis REST API:

Note this is the one place that reads the raw response — `eval` consumes it
without printing, so the token never reaches the transcript. Do **not** swap in
`ups_safe` here: it would redact the very field you need.

```bash
# The Python is inside single quotes, so do NOT backslash-escape the inner
# double quotes — single quotes are literal in bash and the backslashes would
# reach Python and be a SyntaxError. Plain concatenation instead of f-strings,
# because nesting the same quote inside an f-string only became legal in 3.12.
eval "$(ups GET /redis/database/$DB | python3 -c '
import json,sys,shlex
d = json.load(sys.stdin)
endpoint = d.get("endpoint")
token = d.get("rest_token")
# Upstash returns credentials by default (the endpoint accepts ?credentials=hide
# to suppress them), but they are absent from the documented response schema —
# so fail with a clear message rather than a bare KeyError if that ever changes.
if not endpoint or not token:
    raise SystemExit(
        "endpoint/rest_token missing from database detail; rotate credentials with "
        "POST /redis/reset-password/" + (d.get("database_id") or "<id>")
    )
print("REST_URL=" + shlex.quote("https://" + endpoint))
print("REST_TOKEN=" + shlex.quote(token))
')"

curl -sS "$REST_URL/get/mykey" -H "Authorization: Bearer $REST_TOKEN"
curl -sS "$REST_URL/set/mykey/myvalue" -H "Authorization: Bearer $REST_TOKEN"
```

Commands map to path segments (`/get/k`, `/set/k/v`, `/dbsize`, `/scan/0`).
Reading keys is fine; **writing or deleting keys is production data mutation** —
confirm first.

## Safety

- **Read-only is safe.** Listing databases/indexes, `GET` detail, and stats need
  no confirmation.
- **Confirm before anything that costs money or changes infra.** Creating a
  database or index, changing a plan, updating regions — summarize exactly what
  you'll do (which account, name, region, plan) and ask, unless the user already
  gave an explicit instruction ("create a redis in us-east-1 called X").
- **Deletes and restores are destructive.** `DELETE /redis/database/{id}`,
  `DELETE /vector/index/{id}`, and `restore-backup` destroy or overwrite data
  irreversibly. Require an explicit instruction naming the resource, echo back
  what you're about to destroy, and never batch-delete on a vague instruction.
- **Password resets break clients.** `reset-password` rotates the password and
  `rest_token`; anything using the old one starts failing. Confirm first and
  tell the user their apps need the new credentials.
- **Don't leak credentials.** `UPSTASH_API_KEY` controls the whole account, and
  `rest_token`/`password` from database detail are live secrets. Never echo
  them, never paste them into a page, ticket, or commit. If asked "what's the
  key", say it's held in the sandbox env and not shown.

## Errors

- `403` from `setup-credentials.sh` — caller not on the binding allow-list.
- `404` from `setup-credentials.sh` — binding was removed; re-list accounts.
- Upstash `401 Unauthorized` — the stored key was revoked (or the email doesn't
  match it); tell the user a team admin needs to re-connect Upstash.
- Upstash `404` on a path you expected to work — almost always the
  singular/plural trap above (`/redis/database` vs `/redis/databases`), or a
  database id from a different account.
- Upstash `400` — bad body shape; re-read the field names in this skill (e.g.
  `database_name`, not `name`, on create).

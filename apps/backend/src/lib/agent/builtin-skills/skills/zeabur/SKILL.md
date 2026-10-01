---
name: zeabur
description: Inspect or manage Zeabur (PaaS) resources for a Nuphos-bound Zeabur provider — projects, services, deployments, runtime/build logs, and environment variables — via the Zeabur GraphQL API (and the zeabur CLI when present). Includes a setup script that loads the selected provider's API token into the sandbox.
---

# Zeabur

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or operate a Zeabur deployment, service, project, or its logs/environment variables — for example when they paste a `zeabur.com` deployment URL and ask what is happening with it.

Zeabur is just one of several Nuphos-bound providers (peer to AWS, GCP, Cloudflare). Everything here is bounded by the user's Zeabur API token; there is no special internal access.

The Zeabur GraphQL API at `https://api.zeabur.com/graphql` is the dependable backbone — it is always reachable from the sandbox via `curl`. The `zeabur` CLI may or may not be pre-installed; prefer GraphQL and fall back to the CLI only when it is present.

## Setup

Load the token for the selected provider before any call:

```bash
bash .claude/skills/zeabur/scripts/setup-credentials.sh <teamId> <zeaburId>
source ~/.zeabur/nuphos.env   # exports ZEABUR_TOKEN, ZEABUR_ID, ZEABUR_KIND, ZEABUR_NAME
```

The script fetches the token through the ordinary Nuphos team API. A conversation bearer is authorized against this conversation's selected providers automatically. The script writes `~/.zeabur/nuphos.env` and runs `zeabur auth login --token` if the CLI exists. `<zeaburId>` is the `zeaburId` shown in this session's enabled-credentials list.

In Claude Code, `skills` is a compatibility link to the native `.claude/skills` tree and the
runtime supplies the session-scoped Nuphos variables automatically. Do not search the filesystem
or inspect environment variables before running the documented script.

When the user already gave a project ID, inspect that project directly in one call; do not list
every project or try every selected provider first:

```bash
bash .claude/skills/zeabur/scripts/inspect-project.sh <teamId> <zeaburId> <projectId>
```

This performs setup and returns the project's environments and services together. Use the
returned IDs to build a Plan or perform the requested read. Only enumerate projects when the user
did not identify one.

## Parsing a Zeabur dashboard URL

A deployment URL carries every id you need:

```text
https://zeabur.com/projects/<projectID>/services/<serviceID>/deployments/<deploymentID>?envID=<environmentID>
```

- `projectID`   → project
- `serviceID`   → service
- `deploymentID`→ a specific deployment (optional for runtime logs)
- `envID`       → environmentID (Zeabur projects have one environment per env; most queries need it)

If the URL omits `envID`, list environments for the project with `environments(projectID:)` and pick the right one.

## GraphQL helper

```bash
zq() {  # zq '<query>' '<variables-json>'
  curl -sS https://api.zeabur.com/graphql \
    -H "Authorization: Bearer ${ZEABUR_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data "$(python3 -c 'import json,sys; print(json.dumps({"query":sys.argv[1],"variables":json.loads(sys.argv[2] or "{}")}))' "$1" "${2:-}")"
}
```

## Verified queries

ObjectID-typed arguments take the 24-char hex ids from the URL.

```graphql
# Identity / projects (user token: omit ownerID; team token: ownerID = $ZEABUR_ID)
query { me { _id name } teams { _id name } }
query Projects($ownerID: ObjectID) { projects(ownerID: $ownerID) { edges { node { _id name } } } }

# Environments of a project
query Envs($projectID: ObjectID!) { environments(projectID: $projectID) { _id name } }

# Services in a project, or one service
query Services($projectID: ObjectID!) { services(projectID: $projectID) { edges { node { _id name } } } }
query Service($id: ObjectID!) { service(_id: $id) { _id name } }

# Deployments of a service (most recent first); or one deployment
query Deployments($serviceID: ObjectID!, $environmentID: ObjectID!, $perPage: Int) {
  deployments(serviceID: $serviceID, environmentID: $environmentID, perPage: $perPage) {
    edges { node { _id status createdAt } }
  }
}
query Deployment($id: ObjectID!) { deployment(_id: $id) { _id status createdAt } }

# Logs — return [{ timestamp, message }]
query RuntimeLogs($serviceID: ObjectID!, $environmentID: ObjectID!, $deploymentID: ObjectID) {
  runtimeLogs(serviceID: $serviceID, environmentID: $environmentID, deploymentID: $deploymentID) { timestamp message }
}
query BuildLogs($deploymentID: ObjectID!) {
  buildLogs(deploymentID: $deploymentID) { timestamp message }
}

# Environment variables of a service (values are returned in plaintext)
query Variables($serviceID: ObjectID!, $environmentID: ObjectID!) {
  service(_id: $serviceID) { variables(environmentID: $environmentID, exposed: true) { key value } }
}

# Update variables (mutation)
mutation UpdateVars($environmentID: ObjectID!, $serviceID: ObjectID!, $data: Map!) {
  updateEnvironmentVariable(environmentID: $environmentID, serviceID: $serviceID, data: $data)
}
```

Example — runtime logs straight from a pasted URL:

```bash
source ~/.zeabur/nuphos.env
zq 'query($s:ObjectID!,$e:ObjectID!,$d:ObjectID){runtimeLogs(serviceID:$s,environmentID:$e,deploymentID:$d){timestamp message}}' \
   '{"s":"<serviceID>","e":"<environmentID>","d":"<deploymentID>"}'
```

If you need fields or operations not listed here, introspect the live schema instead of guessing:

```bash
zq 'query{__type(name:"Deployment"){fields{name}}}'
zq 'query{__schema{queryType{fields{name}}}}'
```

## zeabur CLI (when present)

`zeabur auth login --token` is handled by the setup script. The CLI is context-driven:

```bash
zeabur project ls
zeabur context set project --id <projectID>
zeabur context set env --id <environmentID>
zeabur service ls
zeabur context set service --id <serviceID>
zeabur deployment get
zeabur deployment log -t=runtime
zeabur deployment log -t=build
zeabur variable list
zeabur service restart --env-id <environmentID> --service-name <name>
```

Append `-i=false` for non-interactive mode. If `zeabur` is not installed, use the GraphQL queries above.

## Safety

- Read-only by default: identity/project/service/deployment/log/variable reads are safe.
- Confirm with the user before any mutation: `updateEnvironmentVariable`, variable create/delete, service restart/redeploy/delete, domain changes.
- Environment variable values are returned in plaintext and often contain secrets. Present them when the user asks, but never paste the Zeabur API token (`ZEABUR_TOKEN`) into chat and do not `cat ~/.zeabur/nuphos.env`.
- If the requested Zeabur provider is not in this session's enabled credentials, ask the user to update the credential selection rather than trying other tokens.

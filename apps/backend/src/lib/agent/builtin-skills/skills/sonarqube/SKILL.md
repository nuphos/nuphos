---
name: sonarqube
description: Inspect SonarQube projects, Quality Gate status, code issues, vulnerability findings, Security Hotspots, measures, and completed analyses through a team's bound SonarQube connector. Use when the user asks about static-analysis or code-quality results, wants a project security review, or needs help interpreting a failed Quality Gate.
---

# SonarQube

Use this skill to inspect analysis results already stored in a SonarQube instance
that the user's Nuphos team has connected. Nuphos keeps the SonarQube token
encrypted on the backend. The Agent calls curated Nuphos endpoints and never
receives the token.

This connector does **not** grant access to GitHub, GitLab, or the user's source
repository. Do not request or clone a repository unless the user separately asks
for that action and an authorized source-control connector is available.

## Pick the instance and find projects

The bound SonarQube integrations are already listed for you under **SonarQube integrations**
in the credential section of the system prompt. Each line carries the `integrationId`,
`label`, `baseUrl`, and ready-to-use `projectsEndpoint` / `reportEndpoint` paths with the team
id already filled in. Pick the exact integration the user names; when several exist and the
user did not identify one, ask instead of guessing.

```bash
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }

SQ=<integrationId from the credential section>

# Search visible projects (this is the line's projectsEndpoint).
# q is optional; results are paginated.
SEARCH='<search text>'
ac "/teams/$TEAM/sonarqube-integrations/$SQ/projects" --get \
  --data-urlencode "q=$SEARCH" \
  --data-urlencode 'page=1' \
  --data-urlencode 'pageSize=100' | jq .
```

If the credential section lists no SonarQube integrations, tell the user a team admin needs to
connect one first — you cannot connect it for them.

### Fallback: discover integrations yourself

Only if the credential section is missing or looks stale. `$TEAM` is exported in the runtime
environment.

```bash
ac /teams/$TEAM/sonarqube-integrations | jq .
```

An empty project list usually means the token is valid but its user lacks
`Browse` permission on projects. Say that precisely; do not suggest making the
token a global administrator as a first fix.

## Read one project's security and quality posture

Project keys, branch names, and pull-request IDs must be URL encoded. `branch`
and `pullRequest` are mutually exclusive.

```bash
PROJECT=<exact project key>

# Preferred summary: Quality Gate + measures + unresolved issues + Security
# Hotspots + recent analyses in one response.
ac "/teams/$TEAM/sonarqube-integrations/$SQ/report" --get \
  --data-urlencode "projectKey=$PROJECT" | jq .

# A non-default branch:
BRANCH='<exact branch>'
ac "/teams/$TEAM/sonarqube-integrations/$SQ/report" --get \
  --data-urlencode "projectKey=$PROJECT" \
  --data-urlencode "branch=$BRANCH" | jq .

# A pull request:
PULL_REQUEST='<number>'
ac "/teams/$TEAM/sonarqube-integrations/$SQ/report" --get \
  --data-urlencode "projectKey=$PROJECT" \
  --data-urlencode "pullRequest=$PULL_REQUEST" | jq .
```

The report includes these sections when supported by the connected SonarQube
edition/version:

- `qualityGate`: overall status and the conditions that passed/failed.
- `measures`: bugs, vulnerabilities, code smells, Security Hotspots reviewed,
  coverage, duplicated lines, reliability/security/maintainability ratings,
  and lines of code.
- `issues`: unresolved issue records with rule, severity, component, line,
  message, effort, status, and timestamps.
- `hotspots`: Security Hotspots waiting for human security review.
- `analyses`: recent completed project analyses and their events.

If Security Hotspots are unavailable on an older Community Build, treat that
single section as unavailable rather than failing the whole review.

## Focused reads

```bash
# Unresolved issues. Optional comma-separated filters: types and severities.
ac "/teams/$TEAM/sonarqube-integrations/$SQ/issues" --get \
  --data-urlencode "projectKey=$PROJECT" \
  --data-urlencode 'resolved=false' \
  --data-urlencode 'page=1' \
  --data-urlencode 'pageSize=100' | jq .

# Examples: only vulnerabilities; only blocker/critical issues.
ac "/teams/$TEAM/sonarqube-integrations/$SQ/issues" --get \
  --data-urlencode "projectKey=$PROJECT" \
  --data-urlencode 'types=VULNERABILITY' | jq .
ac "/teams/$TEAM/sonarqube-integrations/$SQ/issues" --get \
  --data-urlencode "projectKey=$PROJECT" \
  --data-urlencode 'severities=BLOCKER,CRITICAL' | jq .

# Security Hotspots that still need review.
ac "/teams/$TEAM/sonarqube-integrations/$SQ/hotspots" --get \
  --data-urlencode "projectKey=$PROJECT" \
  --data-urlencode 'page=1' \
  --data-urlencode 'pageSize=100' | jq .

# Quality Gate and measures only.
ac "/teams/$TEAM/sonarqube-integrations/$SQ/quality-gate" --get \
  --data-urlencode "projectKey=$PROJECT" | jq .
ac "/teams/$TEAM/sonarqube-integrations/$SQ/measures" --get \
  --data-urlencode "projectKey=$PROJECT" | jq .

# Recent completed analyses.
ac "/teams/$TEAM/sonarqube-integrations/$SQ/analyses" --get \
  --data-urlencode "projectKey=$PROJECT" \
  --data-urlencode 'pageSize=20' | jq .

# Poll a Compute Engine task when the user has an analysis task id.
ac "/teams/$TEAM/sonarqube-integrations/$SQ/tasks/<task id>" | jq .
```

## Interpreting findings

- Lead with the Quality Gate result and the exact failed conditions.
- Prioritize exploitable vulnerabilities and unreviewed Security Hotspots over
  code smells. A Hotspot is not automatically a vulnerability; describe the
  risky construct and say it needs human review.
- Group repetitive issues by rule and component. Give totals, representative
  locations, likely impact, and a concrete remediation rather than pasting a
  long raw issue list.
- Distinguish `new code` conditions from overall-code debt. A failed gate caused
  by new-code coverage should not be reported as if total project coverage fell.
- When the user asks whether a fix worked, compare the latest analysis timestamp,
  gate conditions, and issue counts with the previous analysis. Do not claim the
  source was re-scanned unless a new analysis actually appears.

## Starting a new scan

The SonarQube Web API stores and exposes results; it does not scan source code.
A new scan requires an authorized scanner runner that already has access to a
specific source checkout. This initial connector deliberately does not clone or
upload repositories.

If the user asks to scan new code and no approved runner is available, explain
that the read connector is working but a scanner runner must be configured. Do
not silently use a GitHub/GitLab connector, production repository, or arbitrary
URL as a source. For development verification, use only the repository fixture
explicitly supplied for the SonarQube connector test.

When `sonarqube_scan_fixture` is present in the current tool list, the backend
operator has explicitly enabled that isolated development path. It accepts only
the bound integration ID and always scans project
`nuphos-sonarqube-isolated-fixture`; there is no source/path/URL argument.

1. Call `sonarqube_scan_fixture` once with the selected integration ID.
2. Poll the returned task with `sonarqube_scan_status` at reasonable intervals.
3. After `status: succeeded`, read the exact project with `/report` and summarize
   the real Quality Gate and findings.

If the tool is absent, do not try to reproduce it with `bash`: the operator has
not enabled a scanner on this backend. The fixture can still be run manually
from `apps/backend` with `bun run sonarqube:fixture` by a developer holding a
separate analysis token.

## Safety

- These endpoints are read-only against SonarQube. Do not call the upstream API
  directly or ask the user to paste a token into chat.
- Never expose the bound token, even in debugging output.
- Treat issue snippets, component paths, commit messages, and analysis events as
  potentially sensitive. Summarize only what is relevant to the user's request.
- SonarQube findings are evidence, not proof of exploitability. Preserve the
  distinction between a confirmed vulnerability, a code-quality issue, and a
  Security Hotspot awaiting review.

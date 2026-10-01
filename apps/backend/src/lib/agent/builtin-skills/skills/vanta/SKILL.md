---
name: vanta
description: Read a team's Vanta compliance posture (failing tests / vulnerabilities that need attention) through the Nuphos API. Use when the user asks what compliance or security issues their infrastructure has, what is failing in Vanta, or what to remediate for SOC 2 / ISO 27001 / HIPAA.
---

# Vanta compliance

Use this skill when the user wants to know which compliance checks are failing or
what infrastructure issues need to be resolved for their security frameworks
(SOC 2, ISO 27001, HIPAA, PCI, GDPR) as tracked by Vanta.

The Vanta access token is held **server-side** by Nuphos. You never handle it —
read everything through the Nuphos API with `ac`. Do not ask the user for a Vanta
token, and do not paste tokens into chat.

## Discovering the integration

The enabled credentials prompt lists each Vanta integration with its
`integrationId` and a `testsEndpoint`. If none is listed, ask the user to bind a
Vanta integration and enable it for this session — do not conclude Vanta is
unsupported.

## Reading failing tests (the issues to fix)

Each Vanta *test* is one compliance check. The list route wraps results in an
object, so extract `.tests[]` before piping to `jq`:

```bash
# Default: tests that NEED ATTENTION (the compliance issues to resolve)
ac /teams/<teamId>/vanta-integrations/<integrationId>/tests        # -> { "tests": [...] }

# Only infrastructure-facing categories (Infrastructure, Vulnerability
# management, Logging, Monitoring & alerts, Data storage):
ac "/teams/<teamId>/vanta-integrations/<integrationId>/tests?infraOnly=true"

# Change the status filter (e.g. PASSED, DEACTIVATED):
ac "/teams/<teamId>/vanta-integrations/<integrationId>/tests?status=PASSED"
```

Each test carries everything needed to explain and remediate the issue:

```bash
ac "/teams/<teamId>/vanta-integrations/<integrationId>/tests?infraOnly=true" \
  | jq -r '.tests[] | "[\(.category)] \(.name)\n  why: \(.failureDescription)\n  fix: \(.remediationDescription)\n"'
```

Fields: `id`, `name`, `category`, `status`, `failureDescription`,
`remediationDescription`, `lastTestRunDate`.

## How to help

- Summarize failing tests grouped by category; lead with Infrastructure and
  Vulnerability management when the user is asking about infra.
- For each issue, use `failureDescription` to explain what's wrong and
  `remediationDescription` for how to fix it.
- When a failing test maps to a resource you can act on through another bound
  provider (e.g. a Cloudflare setting, an AWS config, a GitHub vulnerability),
  offer to remediate it there — but confirm with the user before any change.

## Safety

- Read-only. This skill only reads compliance status; it never writes to Vanta.
- Never print or echo the Vanta token (it is not exposed to the sandbox by
  default — reads go through the Nuphos API above).

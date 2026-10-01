---
name: secureframe
description: Read a team's Secureframe compliance posture (failing tests that need attention) through the Nuphos API. Use when the user asks what compliance or security issues their infrastructure has, what is failing in Secureframe, or what to remediate for SOC 2 / ISO 27001 / HIPAA / PCI / GDPR.
---

# Secureframe compliance

Use this skill when the user wants to know which compliance checks are failing or
what needs remediating for their security frameworks (SOC 2, ISO 27001, HIPAA,
PCI, GDPR) as tracked by Secureframe.

The Secureframe API key/secret is held **server-side** by Nuphos. You never
handle it — read everything through the Nuphos API with `ac`. Do not ask the
user for Secureframe credentials, and do not paste them into chat.

## Discovering the integration

The enabled credentials prompt lists each Secureframe integration with its
`integrationId` and a `testsEndpoint`. If none is listed, ask the user to bind a
Secureframe integration and enable it for this session — do not conclude
Secureframe is unsupported.

## Reading failing tests (the issues to fix)

Each Secureframe *test* is one compliance check. The list route wraps results in
an object, so extract `.tests[]` before piping to `jq`:

```bash
# Default: failing tests (health_status:fail — the compliance issues to resolve)
ac /teams/<teamId>/secureframe-integrations/<integrationId>/tests   # -> { "tests": [...] }

# All tests (not just failing):
ac "/teams/<teamId>/secureframe-integrations/<integrationId>/tests?failingOnly=false"

# Custom Lucene filter (Secureframe query syntax):
ac "/teams/<teamId>/secureframe-integrations/<integrationId>/tests?q=health_status:fail%20AND%20frameworks:soc2_alpha"
```

Each test carries:

```bash
ac /teams/<teamId>/secureframe-integrations/<integrationId>/tests \
  | jq -r '.tests[] | "[\(.healthStatus)] \(.description)\n  why: \(.failureMessage)\n  fix: \(.remediation)\n"'
```

Fields: `id`, `description`, `healthStatus` (`pass`/`fail`/`disabled`),
`enabled`, `failureMessage` (why it's failing), `remediation` (how to fix it),
and `raw` (the full attributes blob for anything not normalized — e.g.
`framework_keys`, `test_domain`, `last_passed_at`).

## How to help

- Summarize failing tests; lead with what maps to infrastructure the user can
  act on.
- When a failing test maps to a resource reachable through another bound
  provider (AWS config, Cloudflare setting, GitHub finding), offer to remediate
  it there — but confirm with the user before any change.

## Safety

- Read-only. This skill only reads compliance status; it never writes to
  Secureframe.
- Never print or echo the Secureframe API key/secret (reads go through the
  Nuphos API above, which keeps them server-side).

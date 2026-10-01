# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Nuphos — including the backend API, the admin UI, the desktop app, the agent sandbox, the BYOS connectors, or any related integration — please report it privately by email to:

**trustandsafety@zeabur.com**

Please do **not** file a public GitHub issue, open a pull request, or discuss the vulnerability in public forums until we have had a chance to address it.

When reporting, include as much of the following as you can:

- A clear description of the issue and the impact you believe it has.
- Steps to reproduce, or a proof-of-concept exploit.
- The affected commit, release, or deployment (for example, `apps/backend` at `<sha>`, or the desktop DMG version).
- Your environment (OS, runtime versions, browser if relevant).
- Any mitigations you have already identified.

You will receive an acknowledgement within **2 business days** and a status update within **5 business days**. We will keep you informed as we investigate and remediate.

## Scope

In scope:

- Authentication, authorization, and session handling in `apps/backend` and `apps/admin`.
- Tenant isolation across Nuphos accounts, including BYOS-bound clusters and cloud accounts.
- The agent sandbox (`apps/backend/src/lib/agent/`) and any path that lets agent code reach data, credentials, or networks it should not.
- The Electron desktop app's IPC bridge, auto-updater channel, and credential handling.
- Supply-chain risks in this repository's `package.json` / `bun.lock` / `pnpm-lock.yaml`.

Out of scope:

- Findings against hosted Nuphos services that are not reproducible from this repository's source. Report those through the Nuphos platform security process instead.
- Vulnerabilities that require a pre-compromised host, a malicious package the user installed deliberately, or social-engineering of the user.
- Missing security headers, rate limits, or other best-practice gaps without a concrete exploit path.

## Disclosure

We aim to release a fix and coordinate public disclosure within **90 days** of the initial report. Sooner if the issue is being actively exploited, later if the fix requires a coordinated rollout across BYOS customers. We are happy to credit reporters in the release notes unless they prefer to remain anonymous.

## Safe Harbor

We will not pursue legal action against researchers who:

- Follow this policy and report in good faith.
- Avoid privacy violations, destruction of data, and disruption of service.
- Do not exfiltrate more data than necessary to demonstrate the vulnerability.
- Give us reasonable time to remediate before public disclosure.

# Contributing to Nuphos

## Before you write code

For anything beyond a small fix, open an issue first. A session here spans
several people, several machines and whatever accounts the team has connected,
so a change that looks local often is not — credential handling, team scoping
and agent permissions all have blast radius past the file you are editing.

If you are fixing something that is clearly broken, just send the pull request.

## Getting it running

`bun run dev` at the repository root. Prerequisites and the full local-stack
walkthrough are in the [README](README.md#local-development).

If you want the whole thing rather than a dev loop, `deploy/compose` brings it
up with one `docker compose up` — see
[`deploy/compose/README.md`](deploy/compose/README.md).

## What CI checks

Every pull request runs typecheck, tests, lint, format and an import-cycle
check, scoped to the apps your change touches. Run them locally first:

```sh
cd apps/backend && bun run typecheck && bun test        # backend
cd apps/desktop && pnpm typecheck && pnpm test          # desktop
bun run check:cycles                                     # import cycles
```

Formatting is Prettier, configured once at the repository root. Lint is per-app,
because each app has a different package manager and framework preset.

Two lint rules surprise people, so they are worth stating up front:

- **Comment blocks are capped at three consecutive lines.** The rule's own
  message explains why: a long comment usually means the code below should be
  clearer, and decision history belongs in the pull request.
- **No nested ternaries, and complexity ceilings per function.** Both fire as
  warnings, not errors, but a reviewer will usually ask.

## What we look for in a pull request

Say what the change does and why the problem exists, not just what you edited.
If there was a choice between adding something and removing something, say why
the subtraction did not work — that question comes up in review every time.

Tests for behaviour, not for coverage. A test that would have caught the bug is
worth more than three that restate the implementation.

Pull requests get an automated review in addition to a human one. It will
sometimes be wrong; say so and explain why rather than changing code you believe
is correct.

## Developer Certificate of Origin

This project uses the [Developer Certificate of Origin 1.1](DCO). Sign off
every commit to certify that you wrote it or otherwise have the right to submit
it under the project licence:

```sh
git commit -s
```

That appends a `Signed-off-by: Your Name <you@example.com>` trailer built from
your Git `user.name` and `user.email`. CI's `DCO` check rejects a pull request
when any non-merge commit lacks a `Signed-off-by` line that matches the
commit's author exactly, so the name and email must be the ones the commit is
authored with.

If you forgot, add the sign-off to the commits already on your branch and
force-push it:

```sh
git rebase --signoff origin/main
```

A few rules that follow from what the sign-off certifies:

- **Only sign off for yourself.** Never add a `Signed-off-by` line for someone
  else, even with their permission; they add their own.
- **Keep other people's attribution.** When you squash, rebase or otherwise
  carry someone else's commits forward, keep their `Signed-off-by` (and
  `Co-authored-by`) lines and add yours below them; do not drop or rewrite
  them.
- **Commits made through GitHub** (the web editor, the API, automation) record
  the GitHub account as author. Sign off with exactly that name and email, as
  `git log --format='%an <%ae>'` shows it. Bots sign off as themselves, for
  example
  `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`.
  The one exception is Dependabot, whose own trailer
  (`dependabot[bot] <support@github.com>`) is accepted.

## Commit messages

Imperative subject, under about 72 characters, optionally prefixed with a scope
(`fix(desktop):`). The body is for _why_. We squash on merge, so the pull
request title and description end up as the permanent record — write them for
whoever is bisecting this in a year.

## Dependencies

Every project commits its lockfile and CI installs from it (`--frozen-lockfile`,
`--locked`), so a dependency changes only in a reviewed commit.

A new release is not used until it is seven days old. Most compromised packages
are found and pulled within days of publication, and the delay keeps them out of
this repository while that happens. It is enforced in two places:

- **Renovate** (`renovate.json`), self-hosted in `.github/workflows/renovate.yml`,
  proposes updates once a week, Monday 00:00–06:00 UTC, with `minimumReleaseAge`
  set to seven days. Compatible updates for one project share a pull request;
  majors wait until a maintainer ticks them on the Dependency Dashboard issue.
  GitHub Actions are pinned to commit digests. The runtime image's agent SDKs
  (`apps/runtime/image`, updated by `runtime-update-*.yml`) and our own
  `ghcr.io/nuphos` images are left out. The dependencies we patch are left out
  too, and the packages that pin them exactly (`electron-builder`, the three
  `@opentelemetry/exporter-*-otlp-http`) wait for Dashboard approval, because
  their update needs the patch regenerated.
- **The package managers**, for anything you add or update by hand.
  `bunfig.toml` (root) and `apps/backend/bunfig.toml` set Bun's
  `minimumReleaseAge`; `apps/desktop/.npmrc` sets pnpm's `minimum-release-age`;
  `deploy/railway/.npmrc` sets npm's `min-release-age` (npm 11 or later; `npm ci`
  installs the lockfile either way). Versions already in a lockfile still
  install.

The delay applies to the version Renovate picks, not to what the package
manager resolves around it, so Renovate's lock file maintenance (a full
re-resolve) runs only for the root Bun project, which enforces the delay
itself. It is off for the backend and the desktop, whose patched dependencies
(the OpenTelemetry exporters, `electron-builder`) must not move without
approval, and for Cargo and npm.

Two ecosystems have no local delay, so check the release date yourself (crates.io,
Maven Central) before adding or bumping a dependency by hand:

- **Cargo**: `registry.global-min-publish-age` needs Cargo 1.100, and the CLI
  and openab toolchains (1.94, 1.99) only warn about it. Because Cargo can also
  pull in new transitive crates of any age, every Renovate Cargo update waits
  for Dashboard approval; before ticking it, check that the crates it would add
  to `Cargo.lock` are at least seven days old. Once both toolchains move past
  1.100, add the setting to a `.cargo/config.toml` in both projects and drop
  the approval.
- **Gradle** (`apps/android`): Gradle has no release-age setting and the
  project has no dependency locking.

One deliberate exception has no delay at all: the runtime image's Claude Agent
SDK and Codex CLI (`apps/runtime/image`). `runtime-update-claude-sdk.yml` and
`runtime-update-codex-cli.yml` take each vendor's latest release daily, with
whatever new transitive packages it brings, so the runtime keeps up with the
agents it runs. The reviewer of those pull requests is the gate: read the
lockfile diff for new or unexpected packages before approving.

Bun's version lives in `.bun-version` (every CI job reads it) and in
`apps/backend/Dockerfile`; CI fails if they differ, and Renovate updates both
in one pull request.

No dependency runs install scripts unless it is listed: `trustedDependencies` is
empty in both Bun projects, which also turns off Bun's built-in allowlist, and
the desktop allows only `pnpm.onlyBuiltDependencies`. Adding an entry needs a
reason in the pull request.

Renovate does not update the iOS app's Swift packages (`apps/ios`); update them
in Xcode and pick a release at least seven days old.

### Urgent security fixes

A fix for a published vulnerability should not wait a week:

- Renovate's vulnerability pull requests skip the delay and the schedule. They
  need Dependabot alerts enabled on the repository and read access to them for
  the Renovate App.
- To get any other pending update now, tick it under "Pending Status Checks" on
  the Dependency Dashboard, then run the workflow (below).
- By hand, override the delay for one command and say why in the pull request:
  `bun update <pkg> --minimum-release-age=0`,
  `pnpm update <pkg> --config.minimum-release-age=0` or
  `npm update <pkg> --min-release-age=0`. Cargo needs no override.

### Running Renovate

The workflow runs hourly inside the Monday window. To run it at any other time,
for example right after ticking a box on the Dependency Dashboard, open Actions →
Renovate → Run workflow (choose `debug` to get a verbose log). Renovate reads the
Dashboard only when it runs, so a ticked box waits for the next run.

The workflow authenticates as a GitHub App dedicated to Renovate, never as the
Nuphos product App, whose installations reach customer organizations. Its
private key is a secret of the `renovate` environment, so only this job can read
it. Until a maintainer sets the App up, the job is skipped:

1. Create a GitHub App owned by the `nuphos` organization (for example
   `nuphos-renovate`), with webhooks off and these repository permissions:
   Contents, Pull requests, Issues and Workflows: read and write; Checks,
   Commit statuses and Dependabot alerts: read; Metadata: read.
2. Install it on `nuphos/nuphos` only.
3. Generate a private key.
4. In the repository settings, create the environment `renovate` (deployment
   branches: `main` only), add the secret `RENOVATE_APP_PRIVATE_KEY` (the key)
   to it, and add the repository variable `RENOVATE_APP_CLIENT_ID` (the App's
   client ID).
5. Enable the dependency graph and Dependabot alerts (Settings → Advanced
   Security), so vulnerability updates work. Dependabot's own updates stay off.
6. If a ruleset or branch protection restricts who may create branches or
   bypass rules, allow the App to create `renovate/*` branches.
7. Run the workflow once by hand and check that it opens the Dependency
   Dashboard issue.

### Renovate pull requests

Renovate commits through the GitHub API as the App (`platformCommit`), so GitHub
signs its commits, and each one carries a `Signed-off-by:` naming the App's bot
user, which the workflow derives from the App. It opens pull requests from
branches in this repository with the App's token, so CI runs on them, unlike the
`runtime-update-*.yml` pull requests opened with `GITHUB_TOKEN`. They still need
an approving review. If you push a fix to a Renovate branch, sign off your own
commit; Renovate stops rebasing a branch someone else has pushed to until you
tick "rebase" on the pull request.

## Security

Do not open a pull request for a vulnerability. See [SECURITY.md](SECURITY.md) —
it goes through GitHub's private vulnerability reporting so the fix can land
before the details are public.

## Licence and naming

Contributions are under Apache-2.0, the same as the rest of the repository. The
Nuphos name and logo are trademarks and are handled separately — see
[TRADEMARK.md](TRADEMARK.md). In short: fork freely, rename if you ship it as
your own product.

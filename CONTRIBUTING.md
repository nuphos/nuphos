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

In UI copy, call the Nuphos team a team (in other languages, that language's
word for team), never a workspace. "Workspace" is only for a third-party
service's own workspace, such as Slack, Notion or Linear, and for the local file
workspace or working directory.

Tests for behaviour, not for coverage. A test that would have caught the bug is
worth more than three that restate the implementation.

Pull requests get an automated review in addition to a human one. It will
sometimes be wrong; say so and explain why rather than changing code you believe
is correct.

## Verification before merge

A change is merged when it has been shown to work in the product, not when its
unit tests pass. Most regressions here sit between two components (the Desktop
app and the backend, the backend and a runtime), where each side's tests run
against a stand-in for the other and stay green.

Every pull request fills in **How this was verified** in its description:

- **The flow you exercised**, as the steps a person takes, on the real app or
  service the change runs in. A component harness or fixture counts only for
  what it renders; say so, and name what it does not cover.
- **The build and environment**: local stack, packaged app, simulator or
  device, and the operating system when it matters.
- **The result you observed**, with a screenshot or recording when the change
  is visible.
- **What you did not verify.** An honest gap is fine. A gap nobody mentioned is
  how a fix ships that does not fix the report.

Two rules on tests:

- **A bug fix comes with a test that fails without the fix.** If no test can
  express it, say why in the description, and describe the manual check instead.
- **A flow that broke after merge gets an automated end-to-end scenario** in the
  pull request that repairs it, in the cheapest harness that can express it.

A reviewer will ask for the missing piece rather than approve without it.
Changes with no behaviour to exercise (documentation, comments, renames,
dependency bumps covered by CI) can write "not applicable" and one line of why.

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
this repository while that happens. The package managers enforce it for anything
you add or update: `bunfig.toml` (root) and `apps/backend/bunfig.toml` set Bun's
`minimumReleaseAge`; `apps/desktop/.npmrc` sets pnpm's `minimum-release-age`;
`deploy/railway/.npmrc` sets npm's `min-release-age` (npm 11 or later; `npm ci`
installs the lockfile either way). Versions already in a lockfile still install.

Two ecosystems have no local delay, so check the release date yourself (crates.io,
Maven Central) before adding or bumping a dependency:

- **Cargo**: `registry.global-min-publish-age` needs Cargo 1.100, and the CLI
  and openab toolchains (1.94, 1.99) only warn about it. Cargo can also pull in
  new transitive crates of any age, so check that the crates an update adds to
  `Cargo.lock` are at least seven days old. Once both toolchains move past
  1.100, add the setting to a `.cargo/config.toml` in both projects.
- **Gradle** (`apps/android`): Gradle has no release-age setting and the
  project has no dependency locking.

One deliberate exception has no delay at all: the runtime image's Claude Agent
SDK and Codex CLI (`apps/runtime/image`). `runtime-update-claude-sdk.yml` and
`runtime-update-codex-cli.yml` take each vendor's latest release, with
whatever new transitive packages it brings, so the runtime keeps up with the
agents it runs. They run on demand, and every runtime release pull request
includes the latest SDK and Codex CLI. The reviewer of that pull request is the
gate: read the lockfile diff for new or unexpected packages before approving.

Bun's version lives in `.bun-version` (every CI job reads it) and in
`apps/backend/Dockerfile`; CI fails if they differ, so update both together.

No dependency runs install scripts unless it is listed: `trustedDependencies` is
empty in both Bun projects, which also turns off Bun's built-in allowlist, and
the desktop allows only `pnpm.onlyBuiltDependencies`. Adding an entry needs a
reason in the pull request.

The iOS app's Swift packages (`apps/ios`) are updated in Xcode; pick a release
at least seven days old.

### Security updates

Dependabot security updates are the only automated dependency updater. When an
advisory affects a locked dependency, Dependabot opens a pull request with the
patched version. `.github/dependabot.yml` only declares the Bun projects, which
Dependabot would otherwise treat as npm, and sets `open-pull-requests-limit: 0`
so it opens no routine version updates.

Dependabot cannot update a dependency that a parent package pins below the
patched version, or a crate in a Cargo workspace member; its run then fails
with `security_update_not_possible` or `dependency_file_not_supported`. Fix
those by hand, by upgrading the parent rather than adding an override where
possible, and override the delay for one command, saying why in the pull
request: `bun update <pkg> --minimum-release-age=0`,
`pnpm update <pkg> --config.minimum-release-age=0` or
`npm update <pkg> --min-release-age=0`. Cargo needs no override.

## Security

Do not open a pull request for a vulnerability. See [SECURITY.md](SECURITY.md) —
it goes through GitHub's private vulnerability reporting so the fix can land
before the details are public.

## Licence and naming

Contributions are under Apache-2.0, the same as the rest of the repository. The
Nuphos name and logo are trademarks and are handled separately — see
[TRADEMARK.md](TRADEMARK.md). In short: fork freely, rename if you ship it as
your own product.

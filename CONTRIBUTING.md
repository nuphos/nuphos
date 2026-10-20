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

## Security

Do not open a pull request for a vulnerability. See [SECURITY.md](SECURITY.md) —
it goes through GitHub's private vulnerability reporting so the fix can land
before the details are public.

## Licence and naming

Contributions are under Apache-2.0, the same as the rest of the repository. The
Nuphos name and logo are trademarks and are handled separately — see
[TRADEMARK.md](TRADEMARK.md). In short: fork freely, rename if you ship it as
your own product.

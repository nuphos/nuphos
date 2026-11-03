---
name: git-signing
description: Sign a participant's local git commits and tags with their own SSH signing key in the agent sandbox, isolated per Nuphos participant. Use when someone asks for commits signed with their own key, or when a change needs a real `git commit` / `git push` (file modes, symlinks, submodules, several commits) that must be Verified.
---

# git-signing — commits signed with a participant's own key

The `github` skill's `createCommitOnBranch` flow already produces Verified
commits, signed by GitHub (`web-flow`). Use this skill instead when a participant
wants the signature to be **theirs**, or when the work needs a local
`git commit` / `git push`, which is otherwise unsigned in the sandbox. It works
with any forge that accepts SSH signing keys (GitHub, GitLab).

A session home is shared by every participant in the conversation. This skill
therefore never puts an author or signing key in the shared git config; each
participant's identity lives in its own directory and is used only through
`git-as`.

## Rules

- **Identity follows the sender.** Use `git-as <sender-id>` only with the
  current message's server-authored `sender.id`. Never commit as one
  participant on another participant's request, and never pick an identity from
  the runtime account, display name or provider login.
- **Set up only on the participant's own request**, with the name and the email
  they want on their commits. The email must be verified on their forge account,
  or the forge shows the signature as Unverified.
- **No silent fallback.** If signing or `git-as` fails, stop and report it. Do
  not commit unsigned, switch identity, or use `createCommitOnBranch` instead
  without saying so.
- **Push as the same person.** Before pushing, re-run the forge's setup for the
  current sender (for GitHub, their Personal Credential) so the push and the
  signature belong to the same account.
- Follow the repository's own rules. Some require `createCommitOnBranch`, others
  a `Signed-off-by` trailer (`git-as <sender-id> commit -s` adds one from the
  same identity).

## Setup

```bash
bash skills/git-signing/scripts/setup-signing.sh <sender-id> --name "<name>" --email "<email>"
```

It creates a dedicated, passphrase-less ed25519 key under
`~/.config/nuphos-git-identities/<sender-id>/`, writes that participant's git
config there, removes author and signing settings from the shared config and
sets `user.useConfigOnly=true`, installs `~/.local/bin/git-as`, and signs and
verifies a probe commit. Running it again keeps the existing key.

Show the participant the printed public key and ask them to add it on the forge
as a **Signing Key** (GitHub: SSH and GPG keys → New SSH key → Key type
"Signing Key"; an Authentication Key does not verify signatures). Agent tokens
cannot register keys for them.

## Use

```bash
git-as <sender-id> commit -m "fix: ..."
git-as <sender-id> tag -s v1.2.3 -m "v1.2.3"
git-as <sender-id> log --show-signature -1
```

Plain `git commit` without `git-as` fails with `Author identity unknown`; that is
the isolation working, not a misconfiguration.

## Limits

- The key exists only in this conversation's session home. A new conversation
  needs a new key, registered again. Old keys can be deleted from the forge
  afterwards.
- Isolation between participants is enforced by these rules, not by the OS:
  every participant's files belong to the same sandbox user. That is why the key
  is signing-only and revocable. Deleting it on the forge revokes it.
- Never copy a participant's personal or primary key into the sandbox, and never
  print the private key.

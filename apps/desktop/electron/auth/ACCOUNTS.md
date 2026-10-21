# Signed-in accounts: invariants

The desktop app can keep several accounts signed in, on more than one backend,
and switch between them. The account it acts as is one immutable value, the
account context (`account-context.ts`): a backend, the session token it issued,
and an epoch. Nothing changes the backend or the token on its own:
`accountContext.swap` replaces both at once and says why (`signIn`, `switch`,
`signOut`, `refresh`, `endpoint`). `apiUrl()` and `authSession` are read-only
views of it.

|     | Invariant                                                                                                                                                                                                                                                                                                                                                                                                             | Enforced by                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| I1  | A token takes effect only on the backend that issued it.                                                                                                                                                                                                                                                                                                                                                              | `swap` changes both together and refuses to move a token to another backend                                     |
| I2  | The current account decides the backend. The endpoint saved for the CLI (`cli.api-url`) never moves with a switch, and a read moves the app to the current account's backend. Choosing another endpoint on the sign-in screen signs out of the old one.                                                                                                                                                               | `read` in `auth/config.ts`; `setApiUrl`                                                                         |
| I3  | Every change to the sign-in file runs in the config turn (`inTurn`). Work based on an earlier read writes or publishes only if nothing else landed since (`writeIf`, `publishIf`, `unchangedSince`).                                                                                                                                                                                                                  | `auth/config.ts`, `auth/me.ts`                                                                                  |
| I4  | A sign-in belongs to one attempt, which owns its backend. Cancelling it or starting another one makes its result void, even if its write is already queued. Its change says `signIn`, so it is known as an added account.                                                                                                                                                                                             | `auth/sign-in.ts`                                                                                               |
| I5  | Work that belongs to an account registers with `accountContext.onLeave` and ends when the app leaves that account (`sub@backend`), before anyone hears of the next one. Work still starting for it (a terminal fetching credentials or probing) takes `accountEpoch()` first and is refused by `assertSameAccount` once the account is gone. Every window then reloads, so no renderer carries state across accounts. | `account-context.ts`; `account-work.ts`; `terminal.ts`, `pod-exec.ts`, `analytics.ts`; `main/account-reload.ts` |
| I6  | Anything stored per user is keyed by user and backend, not user id alone. The local runtime keeps a Cloud user under the bare id (existing homes) and anyone else under `<id>@<host>`.                                                                                                                                                                                                                                | `accountKey`, `composerDraftOwner`, `runtimeOwner`                                                              |

`config.model.test.ts` checks I1–I3 against random interleavings of sign-ins on
two backends, switches, sign-outs and status probes.

Adding work that belongs to an account? Register its teardown with
`accountContext.onLeave` in the module that owns it. Starting async work whose
result applies to the account? Take `accountContext.current()` first and drop
the result unless `accountContext.isCurrent(ctx)` still holds, or go through
I3 when it writes the sign-in file.

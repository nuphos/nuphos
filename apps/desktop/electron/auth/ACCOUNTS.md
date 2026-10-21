# Signed-in accounts: invariants

The desktop app can keep several accounts signed in, on more than one backend,
and switch between them. Which account is current is spread over several
pieces of process-wide state: the session token (`authSession`), the backend
(`apiUrl()`), the backend staged for a sign-in in progress (`loginApiUrl()`),
`desktop.yaml` with its keychain items, the analytics identity, and every
window's renderer state. Anything that changes one of them must keep the rules
below. `config.model.test.ts` checks I1–I3 against random interleavings.

|     | Invariant                                                                                                                                                                                               | Enforced by                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| I1  | A token takes effect only while the app points at the backend that issued it. The outgoing session is cleared before the backend changes.                                                               | `moveTo` in `config.ts`; `switchTo` reads the token before moving |
| I2  | The current account decides the backend. The endpoint saved for the CLI (`cli.api-url`) never moves with a switch, and a read moves the app to the current account's backend.                           | `useApiUrl` in `api-endpoint.ts`; `read` in `config.ts`           |
| I3  | Every change to the sign-in runs in the config turn (`inTurn`). Work based on an earlier read writes or publishes only if nothing else landed since (`writeIf`, `publishIf`, `unchangedSince`).         | `config.ts`, `me.ts`                                              |
| I4  | A sign-in belongs to one attempt, which owns its backend. Cancelling it or starting another one makes its result void, even if its write is already queued.                                             | `sign-in.ts`                                                      |
| I5  | When the shown account (`sub@backend`) changes, the main process ends account-scoped work (SSH, pod exec, analytics identity) and then reloads every window. No renderer carries state across accounts. | `main/account-reload.ts`                                          |
| I6  | Anything stored per user is keyed by user and backend, not user id alone. The local runtime keeps a Cloud user under the bare id (existing homes) and anyone else under `<id>@<host>`.                  | `accountKey`, `composerDraftOwner`, `runtimeOwner`                |

Adding state or work that belongs to an account? Then it has to join I5's
teardown, and any async result has to go through I3. Collecting all of this
into one account context that is swapped as a whole is tracked separately.

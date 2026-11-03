// The account the app acts as is `<user>@<backend>`. Leaving it (a switch,
// a sign-out, a token the backend rejected) ends everything opened as it, and
// every window reloads: no renderer carries one account's state into the
// next. A refreshed token for the same account is not leaving it.

import { normalizedApi } from '../auth/accounts.ts'

import type { AccountContext, AuthSession } from '../auth-session.ts'

export function accountOf(ctx: AccountContext): string | null {
  return ctx.token ? `${ctx.userId ?? 'unknown'}@${normalizedApi(ctx.api)}` : null
}

export function leaves(next: AccountContext, prev: AccountContext): boolean {
  const was = accountOf(prev)

  return was !== null && accountOf(next) !== was
}

export type LeaveHandlers = {
  /** Resolves once the sign-in file has caught up with the change. */
  settled: () => Promise<unknown>
  /** Ends what was opened as the account left: shells, port forwards. */
  teardown: () => void
  /** Reloads every window, once the change that left the account has settled. */
  reload: () => void
}

export function followAccount(session: AuthSession, on: LeaveHandlers): () => void {
  return session.subscribe((next, prev) => {
    if (!leaves(next, prev)) return
    const was = accountOf(prev)

    on.teardown()
    // Once the change is on disk: a sign-out the file refused is undone in
    // memory, and reloading then would only sign back in to the same account.
    setImmediate(() => {
      void on.settled().then(() => {
        if (accountOf(session.context()) !== was) on.reload()
      })
    })
  })
}

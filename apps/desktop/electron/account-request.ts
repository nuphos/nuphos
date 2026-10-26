// A request to the backend is made as one account from start to finish: its
// URL, token and cancellation all come from one context (auth-session.ts).
// A sign-out or another account aborts it, and a reply that lands after the
// account changed is dropped rather than shown as the new account's.

import { requestContext } from './auth/config.ts'
import { AccountChangedError, authSession } from './auth-session.ts'

import type { AccountContext } from './auth-session.ts'

export type SignedIn = AccountContext & { readonly token: string }

export async function signedIn(
  source: () => Promise<AccountContext> = requestContext,
): Promise<SignedIn> {
  const account = await source()

  if (!account.token) throw new Error('Not signed in')

  return account as SignedIn
}

/** The account's signal, plus a timeout when one is given. */
export function accountSignal(account: AccountContext, timeoutMs?: number): AbortSignal {
  return timeoutMs
    ? AbortSignal.any([account.signal, AbortSignal.timeout(timeoutMs)])
    : account.signal
}

/** Throws if the account changed while the request was out. */
export function stillCurrent(account: AccountContext): void {
  if (account.signal.aborted) throw new AccountChangedError()
  authSession.assertCurrent(account)
}

/** A failed fetch rethrows as the account change that aborted it, if that is what happened. */
export function accountFailure(account: AccountContext, error: unknown): unknown {
  return account.signal.aborted ? new AccountChangedError() : error
}

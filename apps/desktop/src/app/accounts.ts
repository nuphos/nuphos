// The accounts signed in on this computer, as the account menu and the
// sign-in screen show them. Switching is the main process's (auth.ts): it
// reloads every window, so nothing here outlives the account it was for.

import type { AccountSummary } from '../types'

const CLOUD_ORIGIN = 'https://api.nuphos.ai'

export function accountName(account: AccountSummary): string {
  const user = account.userInfo

  return user?.name || user?.username || user?.email || account.key.split('@')[0] || account.key
}

/** The backend to name beside an account: none for Nuphos Cloud. */
export function backendLabel(api: string): string | null {
  try {
    const url = new URL(api)

    return url.origin === CLOUD_ORIGIN ? null : url.host
  } catch {
    return api
  }
}

/** The accounts that are signed in but not the one in use, in the order signed in. */
export function waitingAccounts(accounts: AccountSummary[]): AccountSummary[] {
  return accounts.filter((a) => !a.active)
}

export type AddAccountRequest = {
  /** Why the sign-in screen is shown, e.g. an account that must sign in again. */
  notice?: string
}

const addAccountListeners = new Set<(request: AddAccountRequest) => void>()

/** Shows the sign-in screen over the workspace, to sign in to one more account. */
export function requestAddAccount(request: AddAccountRequest = {}): void {
  for (const listener of addAccountListeners) listener(request)
}

export function onAddAccount(listener: (request: AddAccountRequest) => void): () => void {
  addAccountListeners.add(listener)

  return () => {
    addAccountListeners.delete(listener)
  }
}

type SwitchDeps = {
  switchAccount: (key: string) => Promise<'switched' | 'signInAgain'>
  requestAddAccount: (request: AddAccountRequest) => void
}

/**
 * Switches to `account`. On success every window reloads as it; one that can
 * no longer be used has been signed out, and the sign-in screen asks for it.
 */
export async function switchToAccount(
  account: AccountSummary,
  notice: (name: string) => string,
  deps: SwitchDeps,
): Promise<void> {
  if ((await deps.switchAccount(account.key)) === 'signInAgain')
    deps.requestAddAccount({ notice: notice(accountName(account)) })
}

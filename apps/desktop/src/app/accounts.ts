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

// The open request to add an account, as an external store for
// `useSyncExternalStore`: the account menu sets it, App shows the sign-in screen.
let addAccount: AddAccountRequest | null = null
const addAccountListeners = new Set<() => void>()

function setAddAccount(request: AddAccountRequest | null): void {
  addAccount = request
  // The workspace stays mounted behind the sign-in screen; Cmd+W and the like
  // must not reach it.
  if (typeof window !== 'undefined') window.api.suspendAppShortcuts(request !== null)
  for (const listener of addAccountListeners) listener()
}

/** Shows the sign-in screen over the workspace, to sign in to one more account. */
export function requestAddAccount(request: AddAccountRequest = {}): void {
  setAddAccount(request)
}

export function cancelAddAccount(): void {
  setAddAccount(null)
}

export function addAccountRequest(): AddAccountRequest | null {
  return addAccount
}

export function subscribeAddAccount(listener: () => void): () => void {
  addAccountListeners.add(listener)

  return () => {
    addAccountListeners.delete(listener)
  }
}

type SwitchDeps = {
  switchAccount: (key: string) => Promise<'switched' | 'signInAgain'>
  requestAddAccount: (request: AddAccountRequest) => void
  /** The backend this app uses now. */
  currentApi: () => Promise<string>
  /** Moves the app to another backend, setting the account in use aside there. */
  moveTo: (api: string) => Promise<unknown>
  /** Reloads this window; every account change is a new page. */
  reload: () => void
}

const sameBackend = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return a === b
  }
}

// Survives the reload a move to another backend takes.
const NOTICE_KEY = 'nuphos.signInAgain.notice'

/** The notice left for the sign-in screen by `switchToAccount`, once. */
export function takeSignInNotice(): string | undefined {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY) ?? undefined

    sessionStorage.removeItem(NOTICE_KEY)

    return notice
  } catch {
    return undefined
  }
}

/**
 * Switches to `account`; on success every window reloads as it. One that can
 * no longer be used has been signed out, and the sign-in screen asks for it
 * again, on its own backend.
 */
export async function switchToAccount(
  account: AccountSummary,
  notice: (name: string) => string,
  deps: SwitchDeps,
): Promise<'switched' | 'signInAgain'> {
  const outcome = await deps.switchAccount(account.key)
  const text = notice(accountName(account))

  if (outcome === 'switched' || sameBackend(account.api, await deps.currentApi())) {
    if (outcome === 'signInAgain') deps.requestAddAccount({ notice: text })

    return outcome
  }
  try {
    sessionStorage.setItem(NOTICE_KEY, text)
  } catch {
    // The sign-in screen just shows no notice.
  }
  await deps.moveTo(account.api)
  deps.reload()

  return outcome
}

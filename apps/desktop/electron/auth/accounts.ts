// The signed-in accounts this app remembers. desktop.yaml keeps the active
// one at its top level, as before, so `nuphos login` and older builds read it
// unchanged; the others wait in its `accounts` list, each with the backend
// that issued its token. One file, so a switch is one write.

import type { UserInfo } from '../auth-status.ts'

/** A sign-in as stored: the token is in the keychain item, or in the file without one. */
export type StoredAccount = {
  /** The backend that issued the token. */
  api?: string
  token?: string
  keychainAccount?: string
  user?: string
  username?: string
  userInfo?: UserInfo
}

/** What the app shows of an account; never its token. */
export type AccountSummary = {
  /** `<user id>@<backend>`: the same user on two backends is two accounts. */
  key: string
  api: string
  userInfo?: UserInfo
  active: boolean
}

export function normalizedApi(api: string): string {
  let out = api.trim()

  while (out.endsWith('/')) out = out.slice(0, -1)

  return out
}

/** Also the keychain item's name, so an account and its item always match. */
export function accountKey(api: string, userInfo: UserInfo | undefined): string {
  return `${userInfo?.id ?? 'default'}@${normalizedApi(api)}`
}

export function keyOf(account: StoredAccount, fallbackApi: string): string {
  return accountKey(account.api ?? fallbackApi, account.userInfo)
}

export function signedIn(account: StoredAccount): boolean {
  return Boolean(account.token || account.keychainAccount)
}

/** The fields of an account, without whatever else the file holds. */
export function stored(account: StoredAccount, api: string): StoredAccount {
  return {
    api: normalizedApi(account.api ?? api),
    token: account.token,
    keychainAccount: account.keychainAccount,
    user: account.user,
    username: account.username,
    userInfo: account.userInfo,
  }
}

/**
 * The list once `active` becomes the active account: an account signed in
 * before it waits in the list, unless it is the same account again.
 */
export function waiting(
  others: StoredAccount[],
  previous: StoredAccount | null,
  activeKey: string,
  api: string,
): StoredAccount[] {
  const kept = others.filter((a) => keyOf(a, api) !== activeKey)

  if (!previous || !signedIn(previous) || keyOf(previous, api) === activeKey) return kept

  return [...kept.filter((a) => keyOf(a, api) !== keyOf(previous, api)), stored(previous, api)]
}

export function summaries(
  active: StoredAccount | null,
  others: StoredAccount[],
  api: string,
): AccountSummary[] {
  const summary = (account: StoredAccount, isActive: boolean): AccountSummary => ({
    key: keyOf(account, api),
    api: normalizedApi(account.api ?? api),
    userInfo: account.userInfo,
    active: isActive,
  })

  return [
    ...(active && signedIn(active) ? [summary(active, true)] : []),
    ...others.map((a) => summary(a, false)),
  ]
}

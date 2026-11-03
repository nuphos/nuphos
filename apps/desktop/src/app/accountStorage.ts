// State that belongs to an account (its last team, its open tabs) is stored
// under that account's key, so switching accounts never restores another
// account's teams. Set once per page load: switching reloads every window.

import { readLocalStorage, writeLocalStorage } from './localStorage.ts'

// The account that inherits the state stored before it was kept per account.
const LEGACY_OWNER_KEY = 'nuphos.accountStorage.legacyOwner'

let account: string | null = null

/** The account this window shows, `<user id>@<backend>`. */
export function setStorageAccount(key: string | null): void {
  account = key
  if (key && !readLocalStorage(LEGACY_OWNER_KEY)) writeLocalStorage(LEGACY_OWNER_KEY, key)
}

/** `key` for the account this window shows; `key` itself before there is one. */
export function accountScoped(key: string): string {
  return account ? `${key}@${account}` : key
}

/** Reads an account's value, falling back once to what was stored before accounts were kept apart. */
export function readAccountStorage(key: string): string | null {
  const scoped = readLocalStorage(accountScoped(key))

  if (scoped !== null || !account || readLocalStorage(LEGACY_OWNER_KEY) !== account) return scoped

  return readLocalStorage(key)
}

export function writeAccountStorage(key: string, value: string): void {
  writeLocalStorage(accountScoped(key), value)
}

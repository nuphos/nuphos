// The keychain items desktop.yaml names: one per account, made and removed only
// by the packaged app (token-store.ts).

import type { StoredAccount } from './accounts.ts'
import type { TokenStore } from './token-store.ts'

export function keychainItems(store: TokenStore, secure: () => boolean, path: string) {
  async function forget(account: string | undefined) {
    // Only the packaged app made the item, so only it may remove it.
    if (!account || !secure()) return
    try {
      await store.delete(account)
    } catch (e) {
      console.warn('auth: failed to remove the session token from the keychain', e)
    }
  }

  async function tokenOf(account: StoredAccount): Promise<string | null> {
    if (account.token) return account.token
    if (!account.keychainAccount || !secure()) return null

    return store.get(account.keychainAccount).catch((e: unknown) => {
      console.warn('auth: failed to read the session token from the keychain', e)

      return null
    })
  }

  /** Moves the token into the keychain item `item`; `active` then only names it. */
  async function intoKeychain(active: StoredAccount, item: string, token: string, had?: string) {
    try {
      // Update in place only an item this app made: one that was already
      // there could carry another app's access (a pre-created item, as in
      // the XARA attacks), so it is replaced.
      if (had !== item) await store.delete(item).catch(() => null)
      await store.set(item, token)
      active.token = undefined
      active.keychainAccount = item
    } catch (e) {
      // Still signed in, only less safely.
      console.warn(`auth: keeping the session token in ${path} instead`, e)
    }
  }

  return { forget, tokenOf, intoKeychain }
}

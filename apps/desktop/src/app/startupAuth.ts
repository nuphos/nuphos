// Who this window signs in as, read once per page load. Every account change
// reloads every window (electron/main/account-leave.ts), so nothing here has
// to be refetched, invalidated or cancelled: the next account is the next page.

import { api } from '../api'
import { claimComposerDrafts } from '../components/agent/panel/composerDrafts'
import { claimClearedReplies } from '../components/agent/panel/composerReplyCleared'
import { identifyUser } from '../lib/analytics'

import { setStorageAccount } from './accountStorage'

import type { AccountSummary, UserInfo } from '../types'

export type AuthState =
  { status: 'anonymous'; accounts: AccountSummary[] } | { status: 'authenticated'; user: UserInfo }

/** The accounts signed in on this computer; none if the list cannot be read. */
function readAccounts(): Promise<AccountSummary[]> {
  return api.authListAccounts().catch(() => [])
}

/**
 * Makes `user` the one this page shows. The account's key is settled before
 * the workspace reads anything stored for it.
 */
export async function enterAs(user: UserInfo): Promise<AuthState> {
  const accounts = await readAccounts()

  setStorageAccount(accounts.find((a) => a.active)?.key ?? null)
  identifyUser(user)
  claimComposerDrafts(user.id)
  claimClearedReplies(user.id)

  return { status: 'authenticated', user }
}

async function readStartup(): Promise<AuthState> {
  const status = await api.authStatus().catch(() => ({ loggedIn: false }) as const)

  if (status.loggedIn) return enterAs(status.user)

  return { status: 'anonymous', accounts: await readAccounts() }
}

let startup: Promise<AuthState> | null = null

/** The same promise for the page's lifetime, as `use()` needs. */
export function startupAuth(): Promise<AuthState> {
  startup ??= readStartup()

  return startup
}

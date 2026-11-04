import { listTeams } from '../atlas/teams'
import { listAccounts, switchAccount } from '../auth'
import { accountCredentials } from '../auth/config.ts'
import { authSession } from '../auth-session.ts'

import { accountForTeam, switchThenWait } from './account-for-link-core.ts'
import { nextReload } from './account-leave'
import { accountOf } from './account-leave-core.ts'

import type { AccountSummary } from '../auth/accounts.ts'

// A switch reloads every window; past this, the link opens anyway.
const RELOAD_WAIT_MS = 10_000

/** A waiting account's teams, asked of its own backend with its own token. */
async function teamsOf(account: AccountSummary): Promise<string[]> {
  const credentials = await accountCredentials(account.key)

  if (!credentials) return []
  const res = await fetch(`${credentials.api}/teams`, {
    headers: { authorization: `Bearer ${credentials.token}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) return []
  const body = (await res.json()) as { teams?: { id: string }[] }

  return (body.teams ?? []).map((team) => team.id)
}

const switching = { switchAccount, nextReload, waitMs: RELOAD_WAIT_MS }

/**
 * Opens a link to `teamId` as the account in that team: the one in use if it
 * is, else another signed-in account that is, switched to first. `open` is
 * told whether the link switched accounts.
 */
export async function openInTeamAccount(
  teamId: string | null,
  open: (switched: boolean) => void,
): Promise<void> {
  let switched = false

  if (teamId && authSession.context().token) {
    const key = await accountForTeam(teamId, {
      activeTeams: async () => (await listTeams()).map((team) => team.id),
      accounts: listAccounts,
      teamsOf,
    }).catch(() => null)

    if (key) switched = await switchThenWait(key, switching)
  }
  open(switched)
}

/**
 * Opens what a notification points at as the account it was raised for,
 * switching back to it first. Nothing opens for an account since signed out.
 */
export async function openAsAccount(owner: string, open: () => void): Promise<void> {
  if (accountOf(authSession.context()) === owner) return open()
  const signedIn = (await listAccounts().catch(() => [])).some((a) => a.key === owner)

  if (signedIn && (await switchThenWait(owner, switching))) open()
}

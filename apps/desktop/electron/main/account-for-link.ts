import { listAccounts, switchAccount } from '../auth'
import { accountCredentials } from '../auth/config.ts'
import { requestContext } from '../auth/request-context.ts'
import { authSession } from '../auth-session.ts'

import { accountForTeam, oneAtATime, switchThenWait } from './account-for-link-core.ts'
import { nextReload, reloadWindows } from './account-leave'
import { accountOf } from './account-leave-core.ts'

import type { AccountSummary } from '../auth/accounts.ts'

// A switch reloads every window; past this, the link opens anyway.
const RELOAD_WAIT_MS = 10_000
// Per backend, asked in parallel: lookup and reload stay well inside the 35 s
// a `local_browser` open waits for its tab (local-runtime/browser-tabs.ts).
const LOOKUP_MS = 5_000

async function teamIds(api: string, token: string): Promise<string[]> {
  const res = await fetch(`${api}/teams`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(LOOKUP_MS),
  })

  if (!res.ok) return []
  const body = (await res.json()) as { teams?: { id: string }[] }

  return (body.teams ?? []).map((team) => team.id)
}

/** A waiting account's teams, asked of its own backend with its own token. */
async function teamsOf(account: AccountSummary): Promise<string[]> {
  const credentials = await accountCredentials(account.key)

  return credentials ? teamIds(credentials.api, credentials.token) : []
}

/** The account in use: from the sign-in file before the startup check has run. */
async function activeTeams(): Promise<string[]> {
  const { api, token } = await requestContext()

  return token ? teamIds(api, token) : []
}

// One switch and its link at a time (account-for-link-core.ts).
const inTurn = oneAtATime()

function switching() {
  // Before the startup check no window has signed in yet: it reads the
  // account switched to, and nothing reloads.
  const started = authSession.settled()

  return {
    switchAccount: async (key: string) => {
      // From no account in use there is none to leave, so nothing else
      // reloads the windows out of the sign-in screen.
      const signedOut = started && !authSession.context().token
      const outcome = await switchAccount(key)

      if (outcome === 'switched' && signedOut) reloadWindows()

      return outcome
    },
    nextReload,
    waitMs: started ? RELOAD_WAIT_MS : 0,
  }
}

/**
 * Opens a link to `teamId` as the account in that team: the one in use if it
 * is, else another signed-in account that is, switched to first. `open` is
 * told whether the link switched accounts.
 */
export function openInTeamAccount(
  teamId: string | null,
  open: (switched: boolean) => void,
): Promise<void> {
  return inTurn(async () => {
    let switched = false

    if (teamId && (await requestContext()).token) {
      const key = await accountForTeam(teamId, {
        activeTeams,
        accounts: listAccounts,
        teamsOf,
      }).catch(() => null)

      if (key) switched = await switchThenWait(key, switching())
    }
    open(switched)
  })
}

/**
 * Opens what a notification points at as the account it was raised for,
 * switching back to it first. Nothing opens for an account since signed out.
 */
export function openAsAccount(owner: string, open: () => void): Promise<void> {
  return inTurn(async () => {
    if (accountOf(authSession.context()) === owner) return open()
    const signedIn = (await listAccounts().catch(() => [])).some((a) => a.key === owner)

    if (signedIn && (await switchThenWait(owner, switching()))) open()
  })
}

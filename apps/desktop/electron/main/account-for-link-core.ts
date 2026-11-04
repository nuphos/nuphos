// Which signed-in account a link or a notification belongs to. A link names a
// team; the account in use opens it if it is in that team, otherwise the first
// other signed-in account that is. Nothing is switched for a team no account
// here belongs to: the link opens as it always did.

import type { AccountSummary } from '../auth/accounts.ts'

export type LinkAccountDeps = {
  /** The teams of the account in use. */
  activeTeams: () => Promise<string[]>
  accounts: () => Promise<AccountSummary[]>
  /** The teams of a waiting account, asked of its own backend with its own token. */
  teamsOf: (account: AccountSummary) => Promise<string[]>
}

/** The team a Nuphos page path is in: `/teams/<id>/…`. */
export function teamOfPath(path: string): string | null {
  return /^\/teams\/([^/?#]+)/u.exec(path)?.[1] ?? null
}

/** The key of the waiting account to switch to before opening a link to `teamId`, if any. */
export async function accountForTeam(
  teamId: string,
  deps: LinkAccountDeps,
): Promise<string | null> {
  if ((await deps.activeTeams().catch(() => [teamId])).includes(teamId)) return null
  const waiting = (await deps.accounts()).filter((a) => !a.active)
  // All at once, so one slow or unreachable backend bounds the wait.
  const teams = await Promise.all(waiting.map((a) => deps.teamsOf(a).catch((): string[] => [])))

  return waiting.find((_, i) => teams[i]?.includes(teamId))?.key ?? null
}

export type SwitchDeps = {
  switchAccount: (key: string) => Promise<'switched' | 'signInAgain' | null>
  /** Taken before the switch: resolves once the windows reload as the next account. */
  nextReload: () => { reloaded: Promise<void>; cancel: () => void }
  /** How long to wait for the reload before going on anyway. */
  waitMs: number
}

/** Switches to `key`, and resolves once the windows are reloading as it; false if it did not switch. */
export async function switchThenWait(key: string, deps: SwitchDeps): Promise<boolean> {
  const { reloaded, cancel } = deps.nextReload()

  if ((await deps.switchAccount(key).catch(() => null)) !== 'switched') {
    cancel()

    return false
  }
  await Promise.race([reloaded, new Promise((resolve) => setTimeout(resolve, deps.waitMs))])
  cancel()

  return true
}

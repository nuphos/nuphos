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
  for (const account of (await deps.accounts()).filter((a) => !a.active)) {
    if ((await deps.teamsOf(account).catch((): string[] => [])).includes(teamId)) return account.key
  }

  return null
}

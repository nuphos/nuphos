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
  /** The key of the account in use now. */
  inUse: () => Promise<string | null>
}

/**
 * How a switch for a link ended: `switched` once the windows reload as `key`;
 * `moved` when it switched but another switch (from the sidebar, say) landed
 * before the reload, so the windows are some other account's; `failed` when
 * it did not switch.
 */
export type SwitchOutcome = 'switched' | 'moved' | 'failed'

/** Switches to `key`, and resolves once the windows are reloading as it. */
export async function switchThenWait(key: string, deps: SwitchDeps): Promise<SwitchOutcome> {
  const { reloaded, cancel } = deps.nextReload()

  if ((await deps.switchAccount(key).catch(() => null)) !== 'switched') {
    cancel()

    return 'failed'
  }
  await Promise.race([reloaded, new Promise((resolve) => setTimeout(resolve, deps.waitMs))])
  cancel()

  // The reload waited for may have been another account's.
  return (await deps.inUse().catch(() => null)) === key ? 'switched' : 'moved'
}

/**
 * Runs tasks one at a time, each after the last has finished or failed: a
 * second switch must never take the first one's reload as its own.
 */
export function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
  let turn: Promise<unknown> = Promise.resolve()

  return (task) => {
    const run = turn.then(task, task)

    turn = run.catch(() => undefined)

    return run
  }
}

export type RouteDeps = {
  /** Grows whenever the account in use changes, from anywhere. */
  epoch: () => number
  /** The waiting account to switch to for the link, if any. */
  route: () => Promise<string | null>
  switchTo: (key: string) => Promise<SwitchOutcome>
  attempts: number
}

/**
 * Routes a link and switches for it. An answer that arrived after the account
 * in use changed (a switch from the sidebar, say), or a switch that another
 * one overtook, is stale: routing starts over from the account now in use, a
 * few times at most. Whether the windows reloaded for it: a switch that was
 * overtaken still reloaded them, so its link must still wait to be delivered
 * even when the account now in use needs no further switch.
 */
export async function routeAndSwitch(deps: RouteDeps): Promise<boolean> {
  let moved = false

  for (let attempt = 0; attempt < deps.attempts; attempt += 1) {
    const epoch = deps.epoch()
    const key = await deps.route().catch(() => null)

    if (deps.epoch() !== epoch) continue
    if (!key) return moved
    const outcome = await deps.switchTo(key)

    if (outcome !== 'moved') return outcome === 'switched' || moved
    moved = true
  }

  return moved
}

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The one team an agent token may reach, for the rest of its request. Team
 * access is checked in a few central places (membership, the team list,
 * conversation access) rather than in every route, so those consult this
 * instead of each route learning about agent tokens.
 */
const scope = new AsyncLocalStorage<{ teamId: string }>()

export function runInTokenTeamScope<T>(teamId: string, fn: () => T): T {
  return scope.run({ teamId }, fn)
}

/** The team the current request is limited to, or undefined for no limit. */
export function tokenTeamScope(): string | undefined {
  return scope.getStore()?.teamId
}

/** Whether a request limited by an agent token may touch `teamId`. */
export function inTokenTeamScope(teamId: string | undefined): boolean {
  const limit = tokenTeamScope()

  return limit === undefined || limit === teamId
}

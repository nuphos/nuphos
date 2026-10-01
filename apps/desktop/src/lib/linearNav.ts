import type { LinearNavState, LinearTeamRef } from './app-routes/types.ts'

export const LINEAR_PAGE_KEY = 'team.linear'
export const DEFAULT_LINEAR_NAV: LinearNavState = { view: 'teams' }

export type LinearCrumb = {
  kind: 'root' | 'team' | 'issue'
  label: string
  /** Where clicking the crumb goes; absent on the crumb for the current view. */
  target?: LinearNavState
}

export function linearNavOf(nav: LinearNavState | null | undefined): LinearNavState {
  return nav ?? DEFAULT_LINEAR_NAV
}

/** Identifies the page a nav shows, ignoring labels the views refine after load. */
function linearNavIdentity(nav: LinearNavState): string {
  if (nav.view === 'teams') return 'teams'
  if (nav.view === 'team') return `team:${nav.bindingId}:${nav.team.id}`

  return `issue:${nav.bindingId}:${nav.identifier}`
}

function sameTeam(a: LinearTeamRef | undefined, b: LinearTeamRef | undefined): boolean {
  return (
    a === b || (a?.id === b?.id && a?.key === b?.key && a?.name === b?.name && a?.url === b?.url)
  )
}

function sameLinearNav(a: LinearNavState, b: LinearNavState): boolean {
  if (linearNavIdentity(a) !== linearNavIdentity(b)) return false
  if (a.view === 'team' && b.view === 'team') return sameTeam(a.team, b.team)
  if (a.view === 'issue' && b.view === 'issue') {
    return a.title === b.title && a.url === b.url && sameTeam(a.team, b.team)
  }

  return true
}

/** Applies a Linear nav move to a tab. A label refinement keeps the tab as-is
 *  (same object when nothing changed); moving to another page clears the
 *  list filter, which belonged to the list being left. */
export function withLinearNav<T extends { linearNav?: LinearNavState | null; filter: string }>(
  tab: T,
  next: LinearNavState,
): T {
  const prev = linearNavOf(tab.linearNav)

  if (tab.linearNav && sameLinearNav(prev, next)) return tab
  const filter = linearNavIdentity(prev) === linearNavIdentity(next) ? tab.filter : ''

  return { ...tab, linearNav: next, filter }
}

export function linearIssueLabel(identifier: string, title: string | undefined): string {
  return title ? `${identifier} · ${title}` : identifier
}

export function linearCrumbs(nav: LinearNavState): LinearCrumb[] {
  const root: LinearCrumb = { kind: 'root', label: 'Linear' }

  if (nav.view === 'teams') return [root]
  const crumbs: LinearCrumb[] = [{ ...root, target: DEFAULT_LINEAR_NAV }]

  if (nav.view === 'team') return [...crumbs, { kind: 'team', label: nav.team.name }]
  if (nav.team) {
    crumbs.push({
      kind: 'team',
      label: nav.team.name,
      target: { view: 'team', bindingId: nav.bindingId, team: nav.team },
    })
  }

  return [...crumbs, { kind: 'issue', label: linearIssueLabel(nav.identifier, nav.title) }]
}

export function linearPageTitle(nav: LinearNavState): string {
  if (nav.view === 'teams') return 'Linear'
  if (nav.view === 'team') return nav.team.name

  return linearIssueLabel(nav.identifier, nav.title)
}

/** A Linear team restored from a URL: only its id is known until the list loads. */
export function linearTeamStub(id: string): LinearTeamRef {
  return { id, key: '', name: 'Team' }
}

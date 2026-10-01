import { LINEAR_PAGE_KEY, linearNavOf, linearTeamStub } from '../linearNav.ts'

import { emptyNavigation } from './parseShared.ts'
import { pathSegment } from './sections.ts'

import type { LinearNavState, NavigationSnapshot } from './types.ts'
import type { Scope } from '../../types'

const ISSUE_IDENTIFIER = /^[A-Za-z0-9]+-\d+$/

/** `/teams/<id>/linear/…` segments after `linear` → the Linear page. */
export function linearNavigation(
  teamScope: Scope,
  segs: readonly string[],
): NavigationSnapshot | null {
  const nav = linearNavFromSegments(segs)

  return nav ? emptyNavigation(teamScope, LINEAR_PAGE_KEY, { linearNav: nav }) : null
}

function linearNavFromSegments(segs: readonly string[]): LinearNavState | null {
  if (segs.length === 0) return { view: 'teams' }
  const [workspaces, bindingId, section, id] = segs

  if (workspaces !== 'workspaces' || !bindingId || !id || segs.length > 4) return null
  if (section === 'teams') return { view: 'team', bindingId, team: linearTeamStub(id) }
  if (section === 'issues' && ISSUE_IDENTIFIER.test(id)) {
    return { view: 'issue', bindingId, identifier: id.toUpperCase() }
  }

  return null
}

export function linearPagePath(teamId: string, linearNav: LinearNavState | null | undefined) {
  const base = `/teams/${pathSegment(teamId)}/linear`
  const nav = linearNavOf(linearNav)

  if (nav.view === 'teams') return base
  const workspace = `${base}/workspaces/${pathSegment(nav.bindingId)}`

  return nav.view === 'team'
    ? `${workspace}/teams/${pathSegment(nav.team.id)}`
    : `${workspace}/issues/${pathSegment(nav.identifier)}`
}

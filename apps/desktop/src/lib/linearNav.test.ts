import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withRenamedPage } from '../app/workspacePersistence.ts'

import { emptyNavigation, navigationFromAppPath, pageLocationForNavigation } from './appRoutes.ts'
import { DEFAULT_LINEAR_NAV, linearCrumbs, linearPageTitle, withLinearNav } from './linearNav.ts'

import type { LinearNavState, NavigationSnapshot } from './appRoutes.ts'

const TEAM = { id: 'team-uuid', key: 'NUPS', name: 'Nuphos', url: 'https://linear.app/z/team/NUPS' }
const TEAM_NAV: LinearNavState = { view: 'team', bindingId: 'b1', team: TEAM }
const ISSUE_NAV: LinearNavState = {
  view: 'issue',
  bindingId: 'b1',
  identifier: 'NUPS-7',
  title: 'Fix it',
  team: TEAM,
}

function pathFor(linearNav: LinearNavState): string {
  return pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId: 't1' }, 'team.linear', { linearNav }),
  ).pathname
}

test('each Linear view has its own path', () => {
  assert.equal(pathFor(DEFAULT_LINEAR_NAV), '/teams/t1/linear')
  assert.equal(pathFor(TEAM_NAV), '/teams/t1/linear/workspaces/b1/teams/team-uuid')
  assert.equal(pathFor(ISSUE_NAV), '/teams/t1/linear/workspaces/b1/issues/NUPS-7')
})

test('Linear paths parse back to the matching view with stub labels', () => {
  assert.deepEqual(navigationFromAppPath('/teams/t1/linear')?.linearNav, { view: 'teams' })
  assert.deepEqual(
    navigationFromAppPath('/teams/t1/linear/workspaces/b1/teams/team-uuid')?.linearNav,
    {
      view: 'team',
      bindingId: 'b1',
      team: { id: 'team-uuid', key: '', name: 'Team' },
    },
  )
  const issue = navigationFromAppPath('/teams/t1/linear/workspaces/b1/issues/nups-7')

  assert.equal(issue?.active, 'team.linear')
  assert.deepEqual(issue?.linearNav, { view: 'issue', bindingId: 'b1', identifier: 'NUPS-7' })
})

test('malformed Linear paths do not parse', () => {
  assert.equal(navigationFromAppPath('/teams/t1/linear/workspaces/b1/issues/not-an-id'), null)
  assert.equal(navigationFromAppPath('/teams/t1/linear/workspaces/b1'), null)
  assert.equal(navigationFromAppPath('/teams/t1/linear/workspaces/b1/teams/x/extra'), null)
  assert.equal(navigationFromAppPath('/teams/t1/linear/elsewhere'), null)
})

test('the teams view is a single, current crumb', () => {
  assert.deepEqual(linearCrumbs(DEFAULT_LINEAR_NAV), [{ kind: 'root', label: 'Linear' }])
})

test('a team view links back to the teams list', () => {
  assert.deepEqual(linearCrumbs(TEAM_NAV), [
    { kind: 'root', label: 'Linear', target: DEFAULT_LINEAR_NAV },
    { kind: 'team', label: 'Nuphos' },
  ])
})

test('an issue view reads Linear › team › issue, each ancestor clickable', () => {
  assert.deepEqual(linearCrumbs(ISSUE_NAV), [
    { kind: 'root', label: 'Linear', target: DEFAULT_LINEAR_NAV },
    { kind: 'team', label: 'Nuphos', target: TEAM_NAV },
    { kind: 'issue', label: 'NUPS-7 · Fix it' },
  ])
  assert.equal(linearPageTitle(ISSUE_NAV), 'NUPS-7 · Fix it')
})

test('an issue whose team is not known yet skips the team crumb', () => {
  assert.deepEqual(linearCrumbs({ view: 'issue', bindingId: 'b1', identifier: 'NUPS-7' }), [
    { kind: 'root', label: 'Linear', target: DEFAULT_LINEAR_NAV },
    { kind: 'issue', label: 'NUPS-7' },
  ])
})

test('withLinearNav keeps the tab when only an identical nav is re-applied', () => {
  const tab = { linearNav: ISSUE_NAV, filter: '' }

  assert.equal(withLinearNav(tab, { ...ISSUE_NAV, team: { ...TEAM } }), tab)
})

test('withLinearNav keeps the filter on a label refinement, clears it on a move', () => {
  const stub: LinearNavState = {
    view: 'team',
    bindingId: 'b1',
    team: { id: TEAM.id, key: '', name: 'Team' },
  }
  const tab = { linearNav: stub, filter: 'bug' }

  assert.deepEqual(withLinearNav(tab, TEAM_NAV), { linearNav: TEAM_NAV, filter: 'bug' })
  assert.deepEqual(withLinearNav(tab, ISSUE_NAV), { linearNav: ISSUE_NAV, filter: '' })
})

test('saved team.linear-issue tabs restore onto the Linear issue view', () => {
  const legacy = {
    ...emptyNavigation({ kind: 'team', teamId: 't1' }, 'team.linear-issue'),
    linearIssue: { bindingId: 'b1', identifier: 'NUPS-7', title: 'Fix it' },
  } as NavigationSnapshot
  const restored = withRenamedPage(legacy)

  assert.equal(restored.active, 'team.linear')
  assert.deepEqual(restored.linearNav, {
    view: 'issue',
    bindingId: 'b1',
    identifier: 'NUPS-7',
    title: 'Fix it',
  })
  assert.equal('linearIssue' in restored, false)
})

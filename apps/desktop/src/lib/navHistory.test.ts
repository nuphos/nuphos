import assert from 'node:assert/strict'
import { test } from 'node:test'

import { emptyNavigation } from './appRoutes.ts'
import {
  NAV_HISTORY_LIMIT,
  canStepNavigation,
  inheritNavigation,
  navigationKey,
  pushNavigation,
  replaceNavigation,
  stepNavigation,
} from './navHistory.ts'

import type { NavigationSnapshot } from './appRoutes.ts'
import type { NavHistory } from './navHistory.ts'

// Run with: bun run test  (node --experimental-strip-types --test)
//
// The back/forward stack. History used to be reconstructed by an effect that
// diffed a hand-listed subset of NavigationSnapshot's fields, so every drill-
// down stored in a field nobody remembered to list (awsDetail, nuphosDashboard,
// architectureDetail, the integrations modal) was invisible to Back. These
// tests pin the two properties that replaced it: an entry is the tab's whole
// snapshot, and its identity is the URL.

const T = 'team1'
const team = { kind: 'team' as const, teamId: T }

const nav = (active: string, extra: Partial<NavigationSnapshot> = {}) =>
  emptyNavigation(team, active, extra)

const awsNav = (active: string, extra: Partial<NavigationSnapshot> = {}) =>
  emptyNavigation({ kind: 'aws-account', teamId: T, accountId: 'acct-1' }, active, extra)

const at = (...entries: NavigationSnapshot[]): NavHistory => ({
  navHistory: entries,
  navHistoryIndex: entries.length - 1,
})

const keys = (state: NavHistory) => state.navHistory.map(navigationKey)

test('a move to a different page is recorded', () => {
  const state = pushNavigation(at(nav('team.agent')), nav('team.plans'))

  assert.equal(state.navHistory.length, 2)
  assert.equal(state.navHistoryIndex, 1)
})

test('re-landing on the current page is not a navigation', () => {
  const start = at(nav('team.agent'), nav('team.plans'))

  assert.equal(pushNavigation(start, nav('team.plans')), start)
})

test('opening a chat from a list leaves Back pointing at the list', () => {
  let state = at(nav('team.agent'))

  state = pushNavigation(state, nav('team.plans'))
  state = pushNavigation(state, nav('team.agent', { agentSessionId: 'sess-1' }))

  const back = stepNavigation(state, -1)

  assert.equal(navigationKey(back!.snapshot), navigationKey(nav('team.plans')))
})

test('a new tab opened from another tab inherits its back stack', () => {
  const source = at(nav('team.agent'), nav('team.plans'))
  const opened = inheritNavigation(source, nav('team.agent', { agentSessionId: 'sess-1' }))

  assert.equal(canStepNavigation(opened, -1), true)
  assert.deepEqual(keys(opened), [
    navigationKey(nav('team.agent')),
    navigationKey(nav('team.plans')),
    navigationKey(nav('team.agent', { agentSessionId: 'sess-1' })),
  ])
})

test('inheriting drops the source tab forward stack', () => {
  const source: NavHistory = {
    navHistory: [nav('team.agent'), nav('team.plans'), nav('team.audit')],
    navHistoryIndex: 1,
  }
  const opened = inheritNavigation(source, nav('team.triggers'))

  assert.deepEqual(keys(opened), [
    navigationKey(nav('team.agent')),
    navigationKey(nav('team.plans')),
    navigationKey(nav('team.triggers')),
  ])
})

// A tab can be retargeted across teams in place (a deep link landing on an
// open tab), so its stack outlives the team it was built in. Inheriting the
// whole thing let Back walk a brand-new tab into a team it was never in.
test('inheriting stops at a team boundary inside the source stack', () => {
  const otherTeam = { kind: 'team' as const, teamId: 'team2' }
  const source: NavHistory = {
    navHistory: [
      emptyNavigation(otherTeam, 'team.agent'),
      emptyNavigation(otherTeam, 'team.plans'),
      nav('team.agent'),
      nav('team.plans'),
    ],
    navHistoryIndex: 3,
  }
  const opened = inheritNavigation(source, nav('team.triggers'))

  assert.deepEqual(keys(opened), [
    navigationKey(nav('team.agent')),
    navigationKey(nav('team.plans')),
    navigationKey(nav('team.triggers')),
  ])
  assert.equal(
    opened.navHistory.every((entry) => entry.scope.teamId === T),
    true,
    'no entry may belong to another team',
  )
})

test('inheriting from a tab in another team keeps nothing', () => {
  const source = at(emptyNavigation({ kind: 'team', teamId: 'team2' }, 'team.agent'))
  const opened = inheritNavigation(source, nav('team.agent'))

  assert.deepEqual(keys(opened), [navigationKey(nav('team.agent'))])
  assert.equal(canStepNavigation(opened, -1), false)
})

test('navigating after a Back drops the forward stack', () => {
  const state: NavHistory = {
    navHistory: [nav('team.agent'), nav('team.plans'), nav('team.audit')],
    navHistoryIndex: 1,
  }
  const next = pushNavigation(state, nav('team.triggers'))

  assert.deepEqual(keys(next), [
    navigationKey(nav('team.agent')),
    navigationKey(nav('team.plans')),
    navigationKey(nav('team.triggers')),
  ])
  assert.equal(canStepNavigation(next, 1), false)
})

test('the stack is bounded, keeping the most recent entries', () => {
  let state = at(nav('team.agent'))

  for (let i = 0; i < NAV_HISTORY_LIMIT + 10; i++) {
    state = pushNavigation(state, nav('team.agent', { agentSessionId: `sess-${i}` }))
  }
  assert.equal(state.navHistory.length, NAV_HISTORY_LIMIT)
  assert.equal(state.navHistoryIndex, NAV_HISTORY_LIMIT - 1)
  assert.equal(
    navigationKey(state.navHistory[NAV_HISTORY_LIMIT - 1]),
    navigationKey(nav('team.agent', { agentSessionId: `sess-${NAV_HISTORY_LIMIT + 9}` })),
  )
})

test('a refinement rewrites the current entry instead of stacking', () => {
  let state = at(nav('team.agent'), nav('team.agent-skills'))

  for (const filter of ['d', 'de', 'dep']) {
    state = replaceNavigation(state, nav('team.agent-skills', { filter }))
  }
  assert.equal(state.navHistory.length, 2)
  assert.equal(
    navigationKey(state.navHistory[1]),
    navigationKey(nav('team.agent-skills', { filter: 'dep' })),
  )
  assert.equal(navigationKey(stepNavigation(state, -1)!.snapshot), navigationKey(nav('team.agent')))
})

// `filter` is in every snapshot but in only a few URLs, so an entry whose href
// is unchanged can still be out of date. Skipping the write left Back restoring
// the filter as it was when the page was first entered.
test('a refinement keeps state the URL does not carry', () => {
  const state = replaceNavigation(
    at(nav('team.agent'), nav('team.integrations')),
    nav('team.integrations', { filter: 'grafana' }),
  )

  assert.equal(
    navigationKey(state.navHistory[1]),
    navigationKey(nav('team.integrations')),
    'this page does not encode its filter in the URL',
  )
  assert.equal(state.navHistory[1].filter, 'grafana')
})

test('stepping past either end of the stack is refused', () => {
  const state = at(nav('team.agent'), nav('team.plans'))

  assert.equal(stepNavigation(state, 1), null)
  assert.equal(stepNavigation({ ...state, navHistoryIndex: 0 }, -1), null)
})

// The regression that motivated deriving history from the whole snapshot:
// every one of these drill-downs lives in a field the old change-detector
// never looked at, so Back skipped straight past them.
const DRILL_DOWNS: { name: string; from: NavigationSnapshot; to: NavigationSnapshot }[] = [
  {
    name: 'aws resource detail',
    from: awsNav('aws.lambda'),
    to: awsNav('aws.lambda', {
      awsDetail: { kind: 'lambda', name: 'fn-1', region: 'us-east-1' },
    }),
  },
  {
    name: 'architecture diagram',
    from: nav('team.architecture'),
    to: nav('team.architecture', {
      architectureDetail: { diagramId: 'diagram-1', diagramName: 'Prod' },
    }),
  },
  {
    name: 'cost dashboard',
    from: nav('team.dashboards'),
    to: nav('team.dashboards', {
      nuphosDashboard: { dashboardId: 'dash-1', dashboardName: 'Monthly' },
    }),
  },
  {
    name: 'integration marketplace',
    from: nav('team.integrations'),
    to: nav('team.integrations', { addIntegrationOpen: true }),
  },
]

for (const { name, from, to } of DRILL_DOWNS) {
  test(`Back returns from a ${name}`, () => {
    const state = pushNavigation(at(from), to)

    assert.equal(state.navHistory.length, 2, `${name} did not record a history entry`)
    assert.equal(navigationKey(stepNavigation(state, -1)!.snapshot), navigationKey(from))
  })
}

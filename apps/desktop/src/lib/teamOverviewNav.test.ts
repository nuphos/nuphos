import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ARCHIVED_CHATS_NAV_ITEM,
  CONNECTORS_NAV_ITEM,
  TEAM_SIDEBAR_NAV_ITEMS,
  TEAM_WORKSPACE_NAV_ITEMS,
  canonicalTeamOverviewKey,
  isTeamManagementKey,
  isTeamOverviewKey,
  isTeamWorkspaceKey,
  renamedTeamNavKey,
  renamedTeamPagePath,
  teamOverviewNavItemFor,
} from './teamOverviewNav.ts'

const ALL_ITEMS = [...TEAM_SIDEBAR_NAV_ITEMS, ...TEAM_WORKSPACE_NAV_ITEMS]

test('the sidebar lists New Bot then Connectors', () => {
  assert.deepEqual(
    TEAM_SIDEBAR_NAV_ITEMS.map((item) => item.key),
    ['team.agent', 'team.integrations'],
  )
  assert.equal(TEAM_SIDEBAR_NAV_ITEMS[1], CONNECTORS_NAV_ITEM)
})

test('workspace pages are the ones launched beside a conversation', () => {
  assert.deepEqual(
    TEAM_WORKSPACE_NAV_ITEMS.map((item) => item.key),
    [
      'team.browser',
      'team.files',
      'team.terminal',
      'team.architecture',
      'team.designs',
      'team.monitoring',
    ],
  )
})

test('management and workspace keys are disjoint and classified', () => {
  for (const item of TEAM_WORKSPACE_NAV_ITEMS) {
    assert.ok(isTeamWorkspaceKey(item.key))
    assert.equal(isTeamManagementKey(item.key), false)
  }
  assert.equal(isTeamManagementKey('team.agent'), false)
})

test('Connectors is a dialog, not a page that replaces the chat surface', () => {
  assert.equal(isTeamManagementKey('team.integrations'), false)
  assert.equal(isTeamManagementKey('team.accounts'), false)
  assert.equal(isTeamWorkspaceKey('team.integrations'), false)
})

test('Plans opens as the existing main page and keeps its route key', () => {
  assert.ok(isTeamManagementKey('team.plans'))
  assert.equal(isTeamWorkspaceKey('team.plans'), false)
  assert.equal(teamOverviewNavItemFor('team.plans')?.label, 'Plans')
  assert.equal(renamedTeamPagePath('/teams/t1/plans'), '/teams/t1/plans')
})

test('archived chats open in the main pane without a nav row of their own', () => {
  assert.ok(isTeamManagementKey(ARCHIVED_CHATS_NAV_ITEM.key))
  assert.equal(teamOverviewNavItemFor(ARCHIVED_CHATS_NAV_ITEM.key), ARCHIVED_CHATS_NAV_ITEM)
  assert.equal(
    TEAM_SIDEBAR_NAV_ITEMS.some((item) => item.key === ARCHIVED_CHATS_NAV_ITEM.key),
    false,
  )
})

test('every item carries a label and an icon', () => {
  for (const item of ALL_ITEMS) {
    assert.ok(item.label.length > 0, `${item.key} needs a label`)
    assert.ok(item.icon, `${item.key} needs an icon`)
  }
})

test('keys are unique', () => {
  const keys = ALL_ITEMS.map((item) => item.key)

  assert.equal(new Set(keys).size, keys.length)
})

test('resolves the nav item for each page key', () => {
  assert.equal(teamOverviewNavItemFor('team.monitoring')?.label, 'Monitoring')
  assert.equal(teamOverviewNavItemFor('team.agent')?.label, 'New Bot')
  assert.equal(teamOverviewNavItemFor('team.agent-memories')?.label, 'Memories')
  assert.equal(teamOverviewNavItemFor('team.triggers')?.label, 'Inbox')
})

test('retired scheduling pages resolve to Inbox', () => {
  assert.equal(canonicalTeamOverviewKey(renamedTeamNavKey('team.calendar')), 'team.inbox')
  assert.equal(teamOverviewNavItemFor('team.schedule')?.label, 'Inbox')
  assert.equal(isTeamManagementKey('team.schedule'), true)
})

test('the legacy team.accounts alias resolves to Connectors', () => {
  assert.equal(canonicalTeamOverviewKey('team.accounts'), 'team.integrations')
  assert.equal(teamOverviewNavItemFor('team.accounts')?.label, 'Connectors')
  assert.ok(isTeamOverviewKey('team.accounts'))
})

test('non-Overview pages are not Overview keys', () => {
  assert.equal(isTeamOverviewKey('team.members'), false)
  assert.equal(isTeamOverviewKey('team.observability'), false)
  assert.equal(isTeamOverviewKey('aws.s3'), false)
})

test('a stored Cost Management key or path resolves to Dashboards', () => {
  assert.equal(renamedTeamNavKey('team.cost-management'), 'team.dashboards')
  assert.equal(renamedTeamNavKey('team.plans'), 'team.plans')
  assert.equal(renamedTeamPagePath('/teams/t1/cost-management'), '/teams/t1/dashboards')
  assert.equal(renamedTeamPagePath('/teams/t1/cost-management/d1'), '/teams/t1/dashboards/d1')
  assert.equal(renamedTeamPagePath('/teams/t1/cost-managementx'), '/teams/t1/cost-managementx')
  assert.equal(renamedTeamPagePath('/teams/t1/plans'), '/teams/t1/plans')
})

test('Home opens the dashboard without adding a top sidebar row', () => {
  assert.ok(isTeamManagementKey('team.home'))
  assert.equal(teamOverviewNavItemFor('team.home')?.label, 'Stats')
  assert.equal(
    TEAM_SIDEBAR_NAV_ITEMS.some((item) => item.key === 'team.home'),
    false,
  )
})

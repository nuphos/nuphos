import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createWorkspaceTab,
  createWorkspaceTabFromNavigation,
  retargetWorkspaceTabToNavigation,
  isFreshTeamTab,
  navigationSnapshot,
  restoreNavigation,
} from './workspaceTabFactory.ts'

import type { Scope } from '../types'

const scope: Extract<Scope, { kind: 'cluster' }> = {
  kind: 'cluster',
  teamId: 'team',
  parentKind: 'gcp-project',
  parentId: 'project',
  provider: 'gcp',
  region: 'us-west1-a',
  clusterName: 'prod',
  serviceAccountId: 'credential',
}
const connected = () => ({
  ...createWorkspaceTab('team'),
  scope,
  active: 'pods',
  kubeconfigContext: 'gke-prod',
  clusterLabel: 'prod',
})

test('a fresh workspace tab opens the New Tab launcher', () => {
  const tab = createWorkspaceTab('team')

  assert.equal(tab.active, 'team.new-tab')
  assert.equal(isFreshTeamTab(tab), true)
})

test('back from detail and forward again reuse the established cluster connection', () => {
  const list = connected()
  const detail = { ...list, target: { kind: 'Pod' as const, namespace: 'default', name: 'api' } }
  const back = restoreNavigation(detail, navigationSnapshot(list), 0)

  assert.equal(back.kubeconfigContext, 'gke-prod')
  assert.equal(back.switching, false)
  assert.equal(back.target, null)
  const forward = restoreNavigation(back, navigationSnapshot(detail), 1)

  assert.equal(forward.kubeconfigContext, 'gke-prod')
  assert.equal(forward.target?.name, 'api')
})

test('namespace history changes reuse the connection but restore the requested namespace', () => {
  const tab = connected()
  const snapshot = { ...navigationSnapshot(tab), scope: { ...scope, namespace: 'other' } }
  const next = restoreNavigation(tab, snapshot, 0)

  assert.equal(next.kubeconfigContext, 'gke-prod')
  assert.deepEqual(next.scope, snapshot.scope)
})

test('different cluster, account, region, team or credentials never reuse the connection', () => {
  const tab = connected()

  for (const change of [
    { clusterName: 'other' },
    { parentId: 'other' },
    { teamId: 'other' },
    { region: 'other' },
    { serviceAccountId: 'other' },
    { roleId: 'other' },
  ]) {
    const next = restoreNavigation(
      tab,
      { ...navigationSnapshot(tab), scope: { ...scope, ...change } },
      0,
    )

    assert.equal(next.kubeconfigContext, null)
  }
  const team = { ...navigationSnapshot(tab), scope: { kind: 'team' as const, teamId: 'team' } }

  assert.equal(restoreNavigation(tab, team, 0).kubeconfigContext, null)
})

test('same display name cannot reuse a different provider cluster ID', () => {
  const tab = {
    ...connected(),
    scope: {
      ...scope,
      parentKind: 'linode-account' as const,
      provider: 'linode' as const,
      linodeClusterId: 1,
    },
  }
  const snapshot = { ...navigationSnapshot(tab), scope: { ...tab.scope, linodeClusterId: 2 } }

  assert.equal(restoreNavigation(tab, snapshot, 0).kubeconfigContext, null)
})

test('a cold restored tab still requires its first connection', () => {
  const tab = { ...connected(), kubeconfigContext: null }

  assert.equal(restoreNavigation(tab, navigationSnapshot(tab), 0).kubeconfigContext, null)
})

test('browser URL survives favorites, duplication and navigation restore', () => {
  const tab = {
    ...createWorkspaceTab('team'),
    active: 'team.browser',
    browserUrl: 'https://example.com/path?q=a#section',
  }
  const snapshot = navigationSnapshot(tab)

  assert.equal(createWorkspaceTabFromNavigation(snapshot).browserUrl, tab.browserUrl)
  assert.equal(
    restoreNavigation(createWorkspaceTab('team'), snapshot, 0).browserUrl,
    tab.browserUrl,
  )
  assert.equal(
    retargetWorkspaceTabToNavigation(createWorkspaceTab('team'), snapshot).browserUrl,
    tab.browserUrl,
  )
  assert.equal(
    retargetWorkspaceTabToNavigation(tab, navigationSnapshot(createWorkspaceTab('team')))
      .browserUrl,
    undefined,
  )
})

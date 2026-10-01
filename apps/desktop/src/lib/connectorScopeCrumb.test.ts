import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONNECTOR_PARENT_KINDS,
  CONNECTOR_PARENT_META,
  CONNECTOR_SETTINGS_PAGES,
  connectorParentRef,
  connectorParentScope,
  isIntegrationNavigation,
  isSettingsNavigation,
  isTeamIntegrationsActive,
} from './connectorScopeCrumb.ts'

import type { Scope } from '../types.ts'

const T = 'team-1'

test('every connector parent kind round-trips scope → ref → scope', () => {
  for (const kind of CONNECTOR_PARENT_KINDS) {
    const scope = connectorParentScope({ kind, id: `${kind}-id` }, T)

    assert.equal(scope.teamId, T)
    assert.deepEqual(
      connectorParentRef(scope),
      { kind, id: `${kind}-id` },
      `${kind} does not resolve back to its own crumb`,
    )
  }
})

test('every connector parent kind has a labelled, grouped crumb', () => {
  for (const kind of CONNECTOR_PARENT_KINDS) {
    const meta = CONNECTOR_PARENT_META[kind]

    assert.ok(meta.fallbackLabel.length > 0, `${kind} has no fallback label`)
    assert.ok(meta.group.length > 0, `${kind} has no picker group`)
  }
})

// The regression this module exists for: `azure.apps` was treated as connector
// settings navigation — which suppresses the page crumb — while the breadcrumb's
// hand-maintained scope list had no `azure-subscription` branch, so the trail
// collapsed to `Home / Connectors` with nothing naming the subscription.
test('settings pages always have a connector crumb to end on', () => {
  for (const kind of CONNECTOR_PARENT_KINDS) {
    for (const active of CONNECTOR_SETTINGS_PAGES[kind]) {
      const scope = connectorParentScope({ kind, id: 'x' }, T)

      assert.ok(isSettingsNavigation(scope, active), `${kind}/${active} is not settings navigation`)
      assert.ok(
        isIntegrationNavigation(scope, active),
        `${kind}/${active} left the connectors trail`,
      )
      assert.ok(connectorParentRef(scope), `${kind}/${active} would render no connector crumb`)
    }
  }
})

test('azure app pages name their subscription', () => {
  const scope: Scope = { kind: 'azure-subscription', teamId: T, subscriptionId: 'sub-1' }

  assert.deepEqual(connectorParentRef(scope), { kind: 'azure-subscription', id: 'sub-1' })
  assert.equal(CONNECTOR_PARENT_META['azure-subscription'].logo, 'azure')
})

test('nested resources name the connector they were reached through', () => {
  assert.deepEqual(
    connectorParentRef({
      kind: 'cluster',
      teamId: T,
      parentKind: 'onprem-cluster',
      parentId: 'onprem-1',
      clusterName: 'office cluster',
      provider: 'onprem',
      region: 'onprem',
      onpremClusterId: 'onprem-1',
    }),
    { kind: 'onprem-cluster', id: 'onprem-1' },
  )
  assert.deepEqual(
    connectorParentRef({
      kind: 'cluster',
      teamId: T,
      parentKind: 'gcp-project',
      parentId: 'proj-1',
      clusterName: 'c',
      provider: 'gcp',
      region: 'us-central1',
    }),
    { kind: 'gcp-project', id: 'proj-1' },
  )
  assert.deepEqual(
    connectorParentRef({
      kind: 'aws-ecs-cluster',
      teamId: T,
      accountId: 'acct-1',
      region: 'us-east-1',
      clusterName: 'c',
      clusterArn: 'arn:aws:ecs:::cluster/c',
    }),
    { kind: 'aws-account', id: 'acct-1' },
  )
  assert.deepEqual(
    connectorParentRef({
      kind: 'cloudflare-zone',
      teamId: T,
      accountId: 'acct-1',
      zoneId: 'z',
      zoneName: 'example.com',
    }),
    { kind: 'cloudflare-account', id: 'acct-1' },
  )
})

test('scopes above or beside the connectors trail have no crumb', () => {
  assert.equal(connectorParentRef({ kind: 'team', teamId: T }), null)
  assert.equal(
    connectorParentRef({
      kind: 'compliance-integration',
      teamId: T,
      provider: 'vanta',
      integrationId: 'i-1',
    }),
    null,
  )
})

test('team integrations keys drive the connectors trail', () => {
  assert.ok(isTeamIntegrationsActive('team.integrations'))
  assert.ok(isTeamIntegrationsActive('team.accounts'))
  assert.ok(!isTeamIntegrationsActive('team.agent'))
  assert.ok(isIntegrationNavigation({ kind: 'team', teamId: T }, 'team.integrations'))
  assert.ok(!isIntegrationNavigation({ kind: 'team', teamId: T }, 'team.agent'))
  // Resource pages keep their own page crumb.
  assert.ok(
    !isSettingsNavigation({ kind: 'aws-account', teamId: T, accountId: 'a' }, 'aws.clusters'),
  )
})

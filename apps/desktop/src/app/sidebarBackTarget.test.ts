import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sidebarBackTarget } from './sidebarBackTarget.ts'

test('on-prem Kubernetes resources return to Connectors', () => {
  const target = sidebarBackTarget(
    {
      kind: 'cluster',
      teamId: 'team-1',
      parentKind: 'onprem-cluster',
      parentId: 'cluster-1',
      clusterName: 'Office cluster',
      provider: 'onprem',
      region: 'onprem',
      onpremClusterId: 'cluster-1',
    },
    'cluster.deployments',
    null,
    undefined,
  )

  assert.deepEqual(target, {
    scope: { kind: 'team', teamId: 'team-1' },
    active: 'team.integrations',
  })
})

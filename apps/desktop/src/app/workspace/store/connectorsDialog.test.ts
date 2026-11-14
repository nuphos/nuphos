import assert from 'node:assert/strict'
import { test } from 'node:test'

import { connectorDetailForScope, connectorsDialogOf } from './connectorsDialog.ts'

const T = 'team-1'

test('a link names the dialog it opens: the list, a connector, or the marketplace', () => {
  assert.deepEqual(connectorsDialogOf({}), { detail: null, addIntegrationOpen: false })
  assert.deepEqual(connectorsDialogOf({ addIntegrationOpen: true }), {
    detail: null,
    addIntegrationOpen: true,
  })
  assert.deepEqual(
    connectorsDialogOf({ connectorDetail: { provider: 'gcp', connectorId: 'p', name: 'GCP' } }),
    { detail: { provider: 'gcp', connectorId: 'p', name: 'GCP' }, addIntegrationOpen: false },
  )
})

test('a resource scope opens Connectors on the connector it hangs off', () => {
  assert.deepEqual(connectorDetailForScope({ kind: 'aws-account', teamId: T, accountId: '123' }), {
    provider: 'aws',
    connectorId: '123',
    name: 'AWS',
  })
  assert.deepEqual(
    connectorDetailForScope({
      kind: 'cluster',
      teamId: T,
      parentKind: 'onprem-cluster',
      parentId: 'k-1',
      clusterName: 'office cluster',
      provider: 'onprem',
      region: 'onprem',
      onpremClusterId: 'k-1',
    }),
    { provider: 'onprem-k8s', connectorId: 'k-1', name: 'Kubernetes' },
  )
  // A database's detail depends on its engine, which the scope does not carry.
  assert.equal(
    connectorDetailForScope({ kind: 'database-connection', teamId: T, connectionId: 'db' }),
    null,
  )
  assert.equal(connectorDetailForScope({ kind: 'team', teamId: T }), null)
})

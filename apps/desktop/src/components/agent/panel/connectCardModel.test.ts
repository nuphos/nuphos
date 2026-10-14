import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONNECT_SELECTION_KEY,
  connectRowStatus,
  newConnectIds,
  parseConnectRequest,
  withConnectIds,
} from './connectCardModel.ts'

import type { AgentCredentialSelection } from '../../../api'

function selection(partial: Partial<AgentCredentialSelection> = {}): AgentCredentialSelection {
  const empty = Object.fromEntries(
    [...Object.values(CONNECT_SELECTION_KEY), 'deviceIds'].map((key) => [key, []]),
  ) as unknown as AgentCredentialSelection

  return { ...empty, ...partial }
}

test('parseConnectRequest keeps known providers once and drops the rest', () => {
  assert.deepEqual(
    parseConnectRequest({ providers: ['linear', 'slack', 'linear', 'grafana'], reason: 'why' }),
    { providers: ['linear', 'grafana'], reason: 'why' },
  )
  assert.equal(parseConnectRequest({ providers: ['slack'] }), null)
  assert.equal(parseConnectRequest(undefined), null)
})

test('a row is connected only when a bound credential of that provider is selected', () => {
  const available = selection({ linearWorkspaceIds: ['w1'] })

  assert.equal(
    connectRowStatus('linear', 'idle', selection({ linearWorkspaceIds: ['w1'] }), available),
    'connected',
  )
  // Bound to the team but not ticked for this chat.
  assert.equal(connectRowStatus('linear', 'idle', selection(), available), 'available')
  assert.equal(connectRowStatus('linear', 'cancelled', selection(), available), 'cancelled')
  assert.equal(connectRowStatus('grafana', 'idle', selection(), available), 'idle')
  // A stale selected id that no longer exists does not count.
  assert.equal(
    connectRowStatus('grafana', 'error', selection({ grafanaInstanceIds: ['gone'] }), available),
    'error',
  )
})

test('newConnectIds finds what a bind added, and withConnectIds selects it once', () => {
  const before = selection({ grafanaInstanceIds: ['g1'] })
  const after = selection({ grafanaInstanceIds: ['g1', 'g2'], linearWorkspaceIds: ['w1'] })
  const added = newConnectIds('grafana', before, after)

  assert.deepEqual(added, ['g2'])
  assert.deepEqual(
    withConnectIds(selection({ grafanaInstanceIds: ['g2'] }), 'grafana', added).grafanaInstanceIds,
    ['g2'],
  )
})

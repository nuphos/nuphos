import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONNECT_SELECTION_KEY,
  connectRowStatus,
  newConnectIds,
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
  withConnectIds,
} from './connectCardModel.ts'

import type { AgentCredentialSelection } from '../../../api'

function selection(partial: Partial<AgentCredentialSelection> = {}): AgentCredentialSelection {
  const empty = Object.fromEntries(
    [...Object.values(CONNECT_SELECTION_KEY), 'deviceIds'].map((key) => [key, []]),
  ) as unknown as AgentCredentialSelection

  return { ...empty, ...partial }
}

test('parseConnectRequest reads an integration decision and keeps known providers once', () => {
  assert.deepEqual(
    parseConnectRequest({
      category: 'integration',
      question: 'why',
      providers: ['linear', 'slack', 'linear', 'grafana'],
    }),
    { providers: ['linear', 'grafana'], reason: 'why' },
  )
  assert.equal(parseConnectRequest({ category: 'integration', providers: ['slack'] }), null)
  // Any other decision stays a plain question, even with providers.
  assert.equal(parseConnectRequest({ category: 'approval', providers: ['linear'] }), null)
  assert.equal(parseConnectRequest(undefined), null)
})

test('parseChoiceRequest reads any other decision, with its options as replies', () => {
  assert.deepEqual(
    parseChoiceRequest({
      category: 'approval',
      question: ' Start it? ',
      options: ['Yes', '', 2, 'No'],
    }),
    { category: 'approval', question: 'Start it?', options: ['Yes', 'No'] },
  )
  assert.deepEqual(parseChoiceRequest({ category: 'preference', question: 'Which?' }), {
    category: 'preference',
    question: 'Which?',
    options: [],
  })
  // An integration decision with known providers is a Connect card instead.
  assert.equal(
    parseChoiceRequest({ category: 'integration', question: 'why', providers: ['linear'] }),
    null,
  )
  assert.equal(parseChoiceRequest({ category: 'approval', question: '  ' }), null)
  assert.equal(parseChoiceRequest(undefined), null)
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
  // Several bound: one click must not select them all, so the user picks one.
  assert.equal(
    connectRowStatus('aws', 'idle', selection(), selection({ awsRoleIds: ['admin', 'read'] })),
    'choose',
  )
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

test('parseSecretRequest reads a credential decision that names a secret', () => {
  const input = {
    category: 'credential',
    question: 'Calling the API needs your OpenAI key.',
    secretName: 'OPENAI_API_KEY',
  }

  assert.deepEqual(parseSecretRequest(input), {
    name: 'OPENAI_API_KEY',
    reason: 'Calling the API needs your OpenAI key.',
  })
  // Its question card gives way to the secure input card.
  assert.equal(parseChoiceRequest(input), null)
  assert.equal(parseSecretRequest({ ...input, category: 'approval' }), null)
  assert.equal(parseSecretRequest({ ...input, secretName: '../etc/passwd' }), null)
})

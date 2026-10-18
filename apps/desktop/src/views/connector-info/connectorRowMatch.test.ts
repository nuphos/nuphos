import assert from 'node:assert/strict'
import test from 'node:test'

import { connectorRowFor } from './connectorRowMatch.ts'

import type { IntegrationPlatformRow } from '../cloud/team-home-bind'

const row = (key: string, provider: string, deletable = true) =>
  ({
    key,
    provider,
    account: key,
    principal: '',
    status: '',
    onDelete: deletable ? async () => {} : undefined,
  }) as unknown as IntegrationPlatformRow

test('an id-keyed connection matches its own row', () => {
  const rows = [row('github:1', 'github'), row('github:2', 'github')]

  assert.equal(connectorRowFor(rows, 'github', '2')?.key, 'github:2')
  assert.equal(connectorRowFor(rows, 'github', '3'), undefined)
})

test('a singleton connection named after its provider matches the deletable row', () => {
  const rows = [
    row('slack:linked', 'slack', false),
    row('slack:T1', 'slack'),
    row('discord:G1', 'discord'),
  ]

  assert.equal(connectorRowFor(rows, 'discord', 'discord')?.key, 'discord:G1')
  assert.equal(connectorRowFor(rows, 'slack', 'slack')?.key, 'slack:T1')
})

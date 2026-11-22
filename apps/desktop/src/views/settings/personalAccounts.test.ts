import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MULTI_ACCOUNT_PROVIDERS, credentialsFor } from './personalAccounts.ts'

const account = (id: string, provider: 'github' | 'gmail', teamId: string | null = null) => ({
  id,
  provider,
  login: id,
  workspaceName: null,
  teamId,
  connectedAt: 'x',
})

test('every account of a provider is listed, not only the first', () => {
  const list = [account('a', 'github'), account('b', 'github'), account('c', 'gmail', 't1')]

  assert.deepEqual(
    credentialsFor(list, 'github', 't1').map((c) => c.id),
    ['a', 'b'],
  )
})

test('a Google grant belongs to its team alone', () => {
  const list = [account('c', 'gmail', 't1')]

  assert.equal(credentialsFor(list, 'gmail', 't2').length, 0)
  assert.equal(credentialsFor(list, 'gmail', 't1').length, 1)
})

test('only GitHub and Linear offer another account', () => {
  assert.deepEqual([...MULTI_ACCOUNT_PROVIDERS], ['github', 'linear'])
})

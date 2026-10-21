import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accountEpoch, assertSameAccount, endAccountWork } from './account-work.ts'
import { accountContext } from './api-endpoint.ts'

test('work started before the app left an account is refused afterwards', () => {
  const since = accountEpoch()

  assert.doesNotThrow(() => assertSameAccount(since))
  endAccountWork()
  assert.throws(() => assertSameAccount(since), /account changed/u)
  assert.doesNotThrow(() => assertSameAccount(accountEpoch()))
})

test('leaving an account in the account context ends its pending work', () => {
  const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`
  const api = accountContext.current().api

  accountContext.swap({ api, token: jwt('u1') }, 'signIn')
  const since = accountEpoch()

  // A new token for the same account keeps its work.
  accountContext.swap({ api, token: `${jwt('u1')}x` }, 'refresh')
  assert.doesNotThrow(() => assertSameAccount(since))
  accountContext.swap({ api, token: jwt('u2') }, 'switch')
  assert.throws(() => assertSameAccount(since), /account changed/u)
})

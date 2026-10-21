import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accountEpoch, assertSameAccount, endAccountWork } from './account-work.ts'

test('work started before the app left an account is refused afterwards', () => {
  const since = accountEpoch()

  assert.doesNotThrow(() => assertSameAccount(since))
  endAccountWork()
  assert.throws(() => assertSameAccount(since), /account changed/u)
  assert.doesNotThrow(() => assertSameAccount(accountEpoch()))
})

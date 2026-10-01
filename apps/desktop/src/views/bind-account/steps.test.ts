import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HUAWEI_STEPS } from './steps.ts'

test('Huawei steps name what the user actually does in each', () => {
  assert.deepEqual(HUAWEI_STEPS, [
    'Add the identity provider',
    'Create a trust agency',
    'Bind the account',
  ])
})

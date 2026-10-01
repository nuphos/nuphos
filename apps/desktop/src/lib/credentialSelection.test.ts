import assert from 'node:assert/strict'
import test from 'node:test'

import { pruneSelectionToAvailable } from './credentialSelection.ts'

const available = {
  awsRoleIds: ['aws-1', 'aws-2'],
  azureAccountIds: ['az-1'],
  zeaburIds: [] as string[],
}

test('keeps ids that still exist', () => {
  assert.deepEqual(pruneSelectionToAvailable({ awsRoleIds: ['aws-1'] }, available), {
    awsRoleIds: ['aws-1'],
    azureAccountIds: [],
    zeaburIds: [],
  })
})

test('drops an id whose connector was deleted', () => {
  const pruned = pruneSelectionToAvailable(
    { awsRoleIds: ['aws-1'], azureAccountIds: ['az-deleted'] },
    available,
  )

  assert.deepEqual(pruned.azureAccountIds, [])
  assert.deepEqual(pruned.awsRoleIds, ['aws-1'])
})

test('fills in providers the stored selection never had', () => {
  assert.deepEqual(pruneSelectionToAvailable({}, available), {
    awsRoleIds: [],
    azureAccountIds: [],
    zeaburIds: [],
  })
})

// Keys come from what is available, not from what was stored: a provider that
// no longer exists at all must not survive on the strength of a stored key.
test('ignores a stored provider key that is gone from the options', () => {
  const pruned = pruneSelectionToAvailable(
    { retiredProviderIds: ['x-1'] } as Record<string, string[]>,
    available,
  )

  assert.equal('retiredProviderIds' in pruned, false)
})

test('a provider with nothing available keeps nothing', () => {
  assert.deepEqual(pruneSelectionToAvailable({ zeaburIds: ['z-1'] }, available).zeaburIds, [])
})

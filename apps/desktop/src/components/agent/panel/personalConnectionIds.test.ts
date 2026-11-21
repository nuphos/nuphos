import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { teamIdentityOf } from './personalIdentity.ts'

describe('which of the owner’s accounts a selection names', () => {
  const id = 'a1'.repeat(12)

  test('the owner’s connection ids are carried through, so a save never drops them', () => {
    const saved = teamIdentityOf({ personalCredentialIds: ['github'], personalConnectionIds: [id] })

    assert.deepEqual(saved.personalConnectionIds, [id])
  })

  test('a teammate’s count is read-only and is never sent back', () => {
    const saved = teamIdentityOf({ personalCredentialIds: ['github'], personalAccountCount: 2 })

    assert.equal('personalAccountCount' in saved, false)
    assert.equal('personalConnectionIds' in saved, false)
  })
})

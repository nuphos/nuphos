import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { connectedMessage, duplicateNotice, findDuplicateConnection } from './posthogConnections.ts'

const prod = { id: 'a', label: 'Prod Analytics', region: 'us' as const }
const existing = [prod, { id: 'b', label: 'Marketing', region: 'eu' as const }]

describe('PostHog duplicate connections', () => {
  test('matches the same label case-insensitively before the region', () => {
    assert.equal(findDuplicateConnection(existing, '  prod analytics ', 'eu')?.id, 'a')
  })

  test('falls back to a binding in the same region', () => {
    assert.equal(findDuplicateConnection(existing, 'New', 'eu')?.id, 'b')
    assert.equal(findDuplicateConnection(existing, '', 'us')?.id, 'a')
  })

  test('returns null when nothing overlaps', () => {
    assert.equal(findDuplicateConnection([prod], 'Other', 'eu'), null)
    assert.equal(findDuplicateConnection([], 'Prod', 'us'), null)
  })

  test('describes the duplicate and the connect outcome', () => {
    assert.equal(
      duplicateNotice(prod),
      'A PostHog connection named Prod Analytics (US Cloud) already exists.',
    )
    assert.equal(connectedMessage(existing, 'b', 'x'), 'Updated the existing connection Marketing')
    assert.equal(connectedMessage(existing, 'z', 'Fresh'), 'Connected Fresh')
  })
})

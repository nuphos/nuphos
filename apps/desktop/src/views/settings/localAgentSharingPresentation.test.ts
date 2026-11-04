import assert from 'node:assert/strict'
import test from 'node:test'

import { shareSummary } from './localAgentSharingPresentation.ts'

test('the summary says how far and with whom', () => {
  assert.equal(shareSummary({ level: 'off', everyone: true, userIds: [] }), 'Not shared')
  assert.equal(
    shareSummary({ level: 'approve', everyone: false, userIds: ['a'] }),
    'Ask me first · 1 person',
  )
  assert.equal(
    shareSummary({ level: 'full', everyone: true, userIds: [] }, 7),
    'Full access · everyone in this team (7)',
  )
  assert.equal(
    shareSummary({ level: 'approve', everyone: false, userIds: [] }),
    'Ask me first · no one picked yet',
  )
})

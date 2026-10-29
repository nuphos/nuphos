import assert from 'node:assert/strict'
import test from 'node:test'

import {
  allowedLevels,
  effectiveShare,
  shareSummary,
  sharingOffText,
} from './localAgentSharingPresentation.ts'

test('an owner picks only levels at or under the team ceiling', () => {
  assert.deepEqual(allowedLevels('off'), ['off'])
  assert.deepEqual(allowedLevels('approve'), ['off', 'approve'])
  assert.deepEqual(allowedLevels('full'), ['off', 'approve', 'full'])
})

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

test('a share above a lowered ceiling shows and edits at the ceiling', () => {
  const full = { level: 'full' as const, everyone: false, userIds: ['a'] }

  assert.deepEqual(effectiveShare(full, 'approve'), { ...full, level: 'approve' })
  assert.equal(effectiveShare(full, 'full'), full)
  assert.equal(shareSummary(effectiveShare(full, 'approve')), 'Ask me first · 1 person')
})

test('sharing turned off names who to ask, or falls back to the administrators', () => {
  assert.equal(
    sharingOffText('Bryan'),
    'Sharing your own computer is turned off for this team. Ask Bryan to turn it on.',
  )
  assert.equal(
    sharingOffText(null),
    'Your team’s administrators have turned off sharing your own computer.',
  )
})

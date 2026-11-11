import assert from 'node:assert/strict'
import { test } from 'node:test'

import { channelRevision } from './channelRevision.ts'

const probe = {
  transcriptUpdatedAt: '2026-11-07T09:00:00Z',
  messageCount: 3,
  agentSessionIds: ['bot-1'],
  title: 'Helper',
  faces: [{ id: 'bot-1', name: 'Helper', agent: {} }],
}

test('an unchanged channel keeps its revision', () => {
  assert.equal(channelRevision(probe), channelRevision({ ...probe }))
})

test('renaming the Bot changes the revision without a new post', () => {
  const renamed = {
    ...probe,
    title: 'Scout',
    faces: [{ id: 'bot-1', name: 'Scout', agent: {} }],
  }

  assert.notEqual(channelRevision(renamed), channelRevision(probe))
})

test('a new face picture changes the revision', () => {
  const repainted = { ...probe, faces: [{ id: 'bot-1', name: 'Helper', agent: { avatar: '05' } }] }

  assert.notEqual(channelRevision(repainted), channelRevision(probe))
})

test('a new post or member still changes the revision', () => {
  assert.notEqual(channelRevision({ ...probe, messageCount: 4 }), channelRevision(probe))
  assert.notEqual(
    channelRevision({ ...probe, agentSessionIds: ['bot-1', 'bot-2'] }),
    channelRevision(probe),
  )
})

test('an opening failure refreshes the chat even before its first message', () => {
  const failed = {
    ...probe,
    timelineEvents: [
      { kind: 'agent_reply_failed', at: '2026-11-07T09:01:00Z', text: 'Could not reply' },
    ],
  }

  assert.notEqual(channelRevision(failed), channelRevision(probe))
})

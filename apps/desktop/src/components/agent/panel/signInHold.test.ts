import assert from 'node:assert/strict'
import { test } from 'node:test'

import { signInHoldNotice } from './signInHold.ts'

import type { Message, QueuedMessage } from './model.ts'
import type { AgentSignInRequest } from '../../../api/agent-types.ts'

const now = Date.parse('2026-10-30T07:00:00Z')
const ask: AgentSignInRequest = {
  runtimeId: 'runtime-team-claude',
  requesterId: 'shant',
  requesterName: 'Shant',
  askedUserIds: ['bryan'],
  askedName: 'Bryan',
  askedAt: '2026-10-30T06:50:00Z',
}
const queued = [{ id: 'q1', text: 'Roll back staging', filePaths: [] }] as QueuedMessage[]

test('the requester sees their queued message wait for the person they asked', () => {
  assert.deepEqual(signInHoldNotice(ask, 'shant', { messages: [], queued }, now), {
    status: 'pending',
    text: 'Waiting for Bryan to sign in. Your message is sent once they do.',
  })
})

test('no notice for someone else, with nothing queued, or once the agent answered', () => {
  assert.equal(signInHoldNotice(ask, 'bryan', { messages: [], queued }, now), null)
  assert.equal(signInHoldNotice(ask, 'shant', { messages: [], queued: [] }, now), null)
  const answered = [
    { id: 'a1', role: 'assistant', parts: [], createdAt: Date.parse('2026-10-30T06:55:00Z') },
  ] as unknown as Message[]

  assert.equal(signInHoldNotice(ask, 'shant', { messages: answered, queued }, now), null)
})

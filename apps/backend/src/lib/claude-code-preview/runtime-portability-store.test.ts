import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import {
  assertConversationRuntimeAvailable,
  discardRuntimeDeletion,
} from './runtime-portability-store'
import { refusedForNow, resentAfter } from './runtime-refusal'

let memory = portabilityDb()

useDb({ db: () => memory })
beforeEach(() => {
  memory = portabilityDb()
})

test('a leftover teardown job blocks nothing and goes with its runtime, in its team only', async () => {
  const job = { _id: 'old-binding', teamId: 'team', placements: [{ url: 'wss://runtime/acp' }] }

  memory.rows('agent_runtime_deletions').push(job)
  memory.rows('agent_conversations').push({
    sessionId: 'agent',
    teamId: 'team',
    runtimeId: 'old-binding',
    claudeCodePreview: { runtimeUrl: 'wss://runtime/acp' },
  })
  await assertConversationRuntimeAvailable('agent')
  await discardRuntimeDeletion('other-team', 'old-binding')
  expect(memory.rows('agent_runtime_deletions')).toEqual([job])
  await discardRuntimeDeletion('team', 'old-binding')
  expect(memory.rows('agent_runtime_deletions')).toEqual([])
})

test('a channel never runs a turn, whichever path asks', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'channel', teamId: 'team', kind: 'channel' })
  memory.rows('agent_conversations').push({ sessionId: 'agent', teamId: 'team' })
  await expect(assertConversationRuntimeAvailable('channel')).rejects.toMatchObject({
    code: 'channel_conversation',
  })
  await assertConversationRuntimeAvailable('agent')
})

test('a restored Task may run while an older home generation awaits cleanup', async () => {
  memory.rows('agent_conversations').push({
    sessionId: 'restored',
    teamId: 'team',
    archiveHomePendingEpochs: [
      { epoch: 0, runtimeId: 'local_owner_device', provider: 'claude-code' },
    ],
    sessionHomeEpoch: 1,
  })
  await expect(assertConversationRuntimeAvailable('restored')).resolves.toBeUndefined()
})

test('a turn a move cuts into waits for it: the queue sends it again (#5376)', async () => {
  memory.rows('agent_conversations').push({
    sessionId: 'moving',
    teamId: 'team',
    runtimeOperation: { token: 'move', expiresAt: new Date(Date.now() + 60_000) },
  })
  const error: unknown = await assertConversationRuntimeAvailable('moving').catch((e: unknown) => e)

  // Queued again by the Trigger's turn, with no error shown.
  expect(refusedForNow(error)).toBe(true)
  expect(resentAfter(error, { clientResendsRefusal: true })).toBe(true)
})

import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import {
  assertConversationRuntimeAvailable,
  assertRuntimeNotDeleting,
} from './runtime-portability-store'

let memory = portabilityDb()

useDb({ db: () => memory })
beforeEach(() => {
  memory = portabilityDb()
})

test('only unfinished deletions block matching runtime identities and URLs within the team', async () => {
  const job = {
    _id: 'old-binding',
    teamId: 'team',
    placements: [{ url: 'wss://runtime/acp' }],
    completedAt: new Date(),
  }

  memory.rows('agent_runtime_deletions').push(job)
  await assertRuntimeNotDeleting('team', 'old-binding')
  await assertRuntimeNotDeleting('team', 'new-binding', 'wss://runtime/acp')
  Reflect.deleteProperty(job, 'completedAt')
  await expect(assertRuntimeNotDeleting('team', 'old-binding')).rejects.toMatchObject({
    code: 'runtime_deleting',
  })
  await expect(
    assertRuntimeNotDeleting('team', 'new-binding', 'wss://runtime/acp'),
  ).rejects.toMatchObject({ code: 'runtime_deleting' })
  await assertRuntimeNotDeleting('other-team', 'old-binding', 'wss://runtime/acp')
  await assertRuntimeNotDeleting('team', 'new-binding', 'wss://another/acp')
})

test('a channel never runs a turn, whichever path asks', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'channel', teamId: 'team', kind: 'channel' })
  memory.rows('agent_conversations').push({ sessionId: 'agent', teamId: 'team' })
  await expect(assertConversationRuntimeAvailable('channel')).rejects.toMatchObject({
    code: 'channel_conversation',
  })
  await assertConversationRuntimeAvailable('agent')
})

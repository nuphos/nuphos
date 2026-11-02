import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { deleteConversation } from './maintenance'
import { agentConversations } from './shared'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
beforeEach(() => {
  memory = portabilityDb()
})

test('a deleted agent leaves every channel it was in', async () => {
  const rows = memory.rows('agent_conversations')

  rows.push({ sessionId: 'agent', userId: 'owner', teamId: 'team' })
  rows.push({ sessionId: 'g1', userId: 'owner', kind: 'channel', agentSessionIds: ['agent', 'b'] })
  rows.push({ sessionId: 'g2', userId: 'other', kind: 'channel', agentSessionIds: ['agent'] })

  expect(await deleteConversation('agent', 'owner', 'team')).toBe(true)
  expect((await agentConversations().findOne({ sessionId: 'g1' }))?.agentSessionIds).toEqual(['b'])
  expect((await agentConversations().findOne({ sessionId: 'g2' }))?.agentSessionIds).toEqual([])
})

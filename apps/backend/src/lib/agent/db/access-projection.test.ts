import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })

const { unreadableSessionIds } = await import('@/routes/agent-journal/shared')
const { assertPlanAccess } = await import('@/lib/agent/plans/access')
const { verifyAgentForActor } = await import('@/lib/agents/identity')
const { readTeamTurns } = await import('@/lib/agent/team-turns')
const { readsConversation } = await import('./access')

// A Bot the team could see, and a teammate was invited to, before Bots became their owner's alone.
const BOT = {
  sessionId: 'bot',
  userId: 'owner',
  teamId: 'team',
  avatar: '07-ada',
  generalAccess: 'view',
  participantIds: ['guest'],
  title: 'Ada',
  lastActiveAt: new Date(),
}

beforeEach(() => {
  memory = portabilityDb()
  memory.rows('agent_conversations').push({ ...BOT })
})

// Each of these reads only some fields; leaving out `avatar` would let the guest in.
test('every read that checks access reads a Bot as its owner’s alone', async () => {
  expect([...(await unreadableSessionIds(['bot'], 'guest'))]).toEqual(['bot'])
  await expect(
    assertPlanAccess({ sourceConversationId: 'bot' } as never, 'guest', 'read'),
  ).rejects.toMatchObject({ status: 404 })
  expect(await verifyAgentForActor('guest', 'owner', 'bot')).toBeNull()
  const [turns] = await readTeamTurns('team', 0, new Date())

  expect(readsConversation(turns!.session, 'guest')).toBe(false)
  expect(readsConversation(turns!.session, 'owner')).toBe(true)
})

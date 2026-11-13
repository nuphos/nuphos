import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { derivedAvatar } from '../bot-avatars'

import { addChannelAgent, listChannelAgents } from './channels'
import { agentConversations } from './shared'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
beforeEach(() => {
  memory = portabilityDb()
})

function channel() {
  memory.rows('agent_conversations').push({
    sessionId: 'g1',
    userId: 'owner',
    teamId: 'team',
    kind: 'channel',
    agentSessionIds: [],
  })
}

test('a Task added to a channel stays a Task and shows the face its id derives', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'agent-1', userId: 'owner', teamId: 'team' })
  channel()

  const added = await addChannelAgent('g1', 'agent-1')

  expect(added?.agentSessionIds).toEqual(['agent-1'])
  expect((await agentConversations().findOne({ sessionId: 'agent-1' }))?.avatar).toBeUndefined()
  expect((await listChannelAgents(added!))[0]?.avatar).toBe(derivedAvatar('agent-1'))
})

test('a Bot keeps its own face', async () => {
  memory.rows('agent_conversations').push({
    sessionId: 'agent-1',
    userId: 'owner',
    teamId: 'team',
    avatar: '07-ada',
  })
  channel()

  const added = await addChannelAgent('g1', 'agent-1')

  expect((await listChannelAgents(added!))[0]?.avatar).toBe('07-ada')
})

test('nothing is added when the channel does not exist', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'agent-1', userId: 'owner', teamId: 'team' })

  expect(await addChannelAgent('missing', 'agent-1')).toBeNull()
})

import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { derivedAvatar } from '../bot-avatars'

import { addChannelAgent } from './channels'
import { agentConversations } from './shared'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
beforeEach(() => {
  memory = portabilityDb()
})

test('an agent added to a channel gets the face its id derives', async () => {
  const rows = memory.rows('agent_conversations')

  rows.push({ sessionId: 'agent-1', userId: 'owner', teamId: 'team' })
  rows.push({
    sessionId: 'g1',
    userId: 'owner',
    teamId: 'team',
    kind: 'channel',
    agentSessionIds: [],
  })

  expect((await addChannelAgent('g1', 'agent-1'))?.agentSessionIds).toEqual(['agent-1'])
  expect((await agentConversations().findOne({ sessionId: 'agent-1' }))?.avatar).toBe(
    derivedAvatar('agent-1'),
  )
})

test('a face the agent already has is kept', async () => {
  const rows = memory.rows('agent_conversations')

  rows.push({ sessionId: 'agent-1', userId: 'owner', teamId: 'team', avatar: '07-ada' })
  rows.push({
    sessionId: 'g1',
    userId: 'owner',
    teamId: 'team',
    kind: 'channel',
    agentSessionIds: [],
  })

  await addChannelAgent('g1', 'agent-1')
  expect((await agentConversations().findOne({ sessionId: 'agent-1' }))?.avatar).toBe('07-ada')
})

test('no face is stored when the channel does not exist', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'agent-1', userId: 'owner', teamId: 'team' })

  expect(await addChannelAgent('missing', 'agent-1')).toBeNull()
  expect((await agentConversations().findOne({ sessionId: 'agent-1' }))?.avatar).toBeUndefined()
})

import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { derivedAvatar } from '../bot-avatars'

import { leaveChats } from './bot-membership'
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

test('a Task is not added to a chat, and stays a Task', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'agent-1', userId: 'owner', teamId: 'team' })
  channel()

  await expect(addChannelAgent('g1', 'agent-1')).rejects.toMatchObject({ code: 'not_a_bot' })
  expect((await agentConversations().findOne({ sessionId: 'g1' }))?.agentSessionIds).toEqual([])
  expect((await agentConversations().findOne({ sessionId: 'agent-1' }))?.avatar).toBeUndefined()
})

test('a Task already in a chat from before shows the face its id derives', async () => {
  memory.rows('agent_conversations').push({ sessionId: 'agent-1', userId: 'owner', teamId: 'team' })

  expect(
    (await listChannelAgents({ teamId: 'team', agentSessionIds: ['agent-1'] }))[0]?.avatar,
  ).toBe(derivedAvatar('agent-1'))
})

function bot() {
  memory.rows('agent_conversations').push({
    sessionId: 'agent-1',
    userId: 'owner',
    teamId: 'team',
    avatar: '07-ada',
  })
}

test('a Bot keeps its own face', async () => {
  bot()
  channel()

  const added = await addChannelAgent('g1', 'agent-1')

  expect((await listChannelAgents(added!))[0]?.avatar).toBe('07-ada')
})

test('nothing is added when the channel does not exist', async () => {
  bot()

  expect(await addChannelAgent('missing', 'agent-1')).toBeNull()
})

test('a Bot made a Task leaves its group chats and its 1:1 chat is archived with it', async () => {
  bot()
  memory.rows('agent_conversations').push(
    {
      sessionId: 'dm',
      userId: 'owner',
      teamId: 'team',
      kind: 'channel',
      agentSessionIds: ['agent-1'],
    },
    {
      sessionId: 'group',
      userId: 'owner',
      teamId: 'team',
      kind: 'channel',
      agentSessionIds: ['agent-1', 'agent-2'],
      leadAgentSessionId: 'agent-1',
    },
  )

  await leaveChats('agent-1')

  const dm = await agentConversations().findOne({ sessionId: 'dm' })
  const group = await agentConversations().findOne({ sessionId: 'group' })

  expect(dm?.archivedAt).toBeInstanceOf(Date)
  expect(dm?.agentSessionIds).toEqual(['agent-1'])
  expect(group?.archivedAt).toBeUndefined()
  expect(group?.agentSessionIds).toEqual(['agent-2'])
  expect(group?.leadAgentSessionId).toBeUndefined()
})

test('a group chat with only that Bot in it is left, not archived as its 1:1 chat', async () => {
  bot()
  memory.rows('agent_conversations').push({
    sessionId: 'new-group',
    userId: 'owner',
    teamId: 'team',
    kind: 'channel',
    group: true,
    agentSessionIds: ['agent-1'],
  })

  await leaveChats('agent-1')

  const group = await agentConversations().findOne({ sessionId: 'new-group' })

  expect(group?.archivedAt).toBeUndefined()
  expect(group?.agentSessionIds).toEqual([])
})

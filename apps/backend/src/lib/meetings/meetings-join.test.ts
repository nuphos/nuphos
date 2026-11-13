import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { agentConversations } from '@/lib/agent/db/shared'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { joinMeeting } from './meetings'
import * as recall from './recall'

import type { AgentConversation } from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
const created = spyOn(recall, 'createMeetingBot')

spyOn(recall, 'recallConfig').mockReturnValue({ botsPerTeamPerDay: 10 } as never)

beforeEach(() => {
  memory = portabilityDb()
  created.mockReset()
  created.mockResolvedValue('recall-bot')
  memory.rows('agent_conversations').push(
    {
      _id: 'bot',
      sessionId: 'bot',
      userId: 'owner',
      teamId: 'team',
      title: 'Ada',
      avatar: '07-ada',
    },
    {
      _id: 'task',
      sessionId: 'task',
      userId: 'owner',
      teamId: 'team',
      title: 'Notes',
      parentSessionId: 'bot',
    },
    { _id: 'lone-task', sessionId: 'lone-task', userId: 'owner', teamId: 'team', title: 'Alone' },
  )
})
afterEach(() => {
  created.mockReset()
})

const conversation = async (sessionId: string) =>
  (await agentConversations().findOne({ sessionId })) as AgentConversation

test('a Task joins the call as the Bot above it, which hears the call', async () => {
  const { channelId } = await joinMeeting(
    await conversation('task'),
    'team',
    'https://meet.example.com/abc',
  )

  expect(created.mock.calls[0]?.[0]).toMatchObject({ botName: 'Ada' })
  expect((await conversation(channelId)).agentSessionIds).toEqual(['bot'])
  expect((await conversation('task')).avatar).toBeUndefined()
})

test('a Task with no Bot above it is refused before any call bot or chat is made', async () => {
  await expect(
    joinMeeting(await conversation('lone-task'), 'team', 'https://meet.example.com/abc'),
  ).rejects.toThrow('Only a Bot can be in a chat')
  expect(created).not.toHaveBeenCalled()
  expect(await agentConversations().find({ kind: 'channel' }).toArray()).toEqual([])
})

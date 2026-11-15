import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'

import * as turns from '@/lib/agent/conversation-turn'
import { agentConversations } from '@/lib/agent/db/shared'
import * as threads from '@/lib/agent/thread-bridge'
import * as identity from '@/lib/identity'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { chatInMeeting, handleRecallEvent, joinMeeting, leaveMeetingTask } from './meetings'
import * as recall from './recall'

import type { AgentConversation } from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
const created = spyOn(recall, 'createMeetingBot')
const left = spyOn(recall, 'leaveMeeting')
const typed = spyOn(recall, 'sendMeetingChat')
const thread = spyOn(threads, 'createAgentThread')
const turn = spyOn(turns, 'startConversationTurn')
const configured = spyOn(recall, 'recallConfig').mockReturnValue({
  botsPerTeamPerDay: 10,
} as never)
const member = spyOn(identity, 'getTeamMembership').mockResolvedValue({ role: 'member' } as never)

const actor = (sessionId: string) => ({ userId: 'owner', teamId: 'team', sessionId, locale: 'en' })

beforeEach(() => {
  memory = portabilityDb()
  for (const spy of [created, left, typed, thread, turn]) spy.mockReset()
  created.mockResolvedValue('recall-bot')
  left.mockResolvedValue()
  typed.mockResolvedValue()
  turn.mockResolvedValue({ status: 'started', run: Promise.resolve(undefined) })
  // The Task create_thread would make: a conversation under the actor.
  thread.mockImplementation((from, _prompt, title) => {
    memory.rows('agent_conversations').push({
      _id: 'meeting',
      sessionId: 'meeting',
      userId: from.userId,
      teamId: from.teamId,
      title,
      parentSessionId: from.sessionId,
    })

    return Promise.resolve({
      threadId: 'meeting',
      _links: { web: '/teams/team/agent/meeting' },
    } as never)
  })
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
// Other files in the run use the real ones.
afterAll(() => {
  for (const spy of [created, left, typed, thread, turn, configured, member]) spy.mockRestore()
})

const conversation = async (sessionId: string) =>
  (await agentConversations().findOne({ sessionId })) as AgentConversation

test('a meeting is a Task under the Bot, which is in the call under the Bot’s name', async () => {
  const { threadId } = await joinMeeting(actor('task'), 'https://meet.example.com/abc', 'Notes.')
  const meeting = await conversation(threadId)

  expect(created.mock.calls[0]?.[0]).toMatchObject({ botName: 'Ada' })
  expect(thread.mock.calls[0]?.[1]).toContain('Notes.')
  expect(meeting).toMatchObject({
    parentSessionId: 'bot',
    title: 'Meeting abc',
    meeting: { botId: 'recall-bot', botName: 'Ada' },
  })
  // No chat is opened for the call, so the Bots list gains no row.
  expect(await agentConversations().find({ kind: 'channel' }).toArray()).toEqual([])
})

test('a Task with no Bot above it is refused before any call bot or Task is made', async () => {
  await expect(joinMeeting(actor('lone-task'), 'https://meet.example.com/abc')).rejects.toThrow(
    'Only a Bot can be in a chat',
  )
  expect(created).not.toHaveBeenCalled()
  expect(thread).not.toHaveBeenCalled()
})

test('the call bot leaves when its Task cannot be made', async () => {
  thread.mockRejectedValue(new Error('no runtime'))

  await expect(joinMeeting(actor('bot'), 'https://meet.example.com/abc')).rejects.toThrow(
    'no runtime',
  )
  expect(left).toHaveBeenCalledWith('recall-bot')
})

test('speech reaches the meeting’s Task under its speaker’s name, until it is archived and the bot leaves', async () => {
  const { threadId } = await joinMeeting(actor('bot'), 'https://meet.example.com/abc')
  const said = {
    event: 'transcript.data',
    data: {
      data: { words: [{ text: 'hello' }], participant: { id: 1, name: 'Can' } },
      bot: { id: 'recall-bot' },
    },
  }

  await handleRecallEvent('delivery-1', said)
  expect(turn.mock.calls[0]?.[0]).toMatchObject({
    targetSessionId: threadId,
    messageId: 'delivery-1',
  })
  // Every message says it, not only the first: nobody in the call speaks for the owner.
  expect(turn.mock.calls[0]?.[2]).toBe('Can (in the call, not your owner): hello')
  expect(left).not.toHaveBeenCalled()

  await agentConversations().updateOne(
    { sessionId: threadId },
    { $set: { archivedAt: new Date() } },
  )
  await handleRecallEvent('delivery-2', said)
  expect(turn).toHaveBeenCalledTimes(1)
  // Nobody is left to hear the call, so its bot leaves.
  expect(left).toHaveBeenCalledWith('recall-bot')
})

test('the Task types in its call, and it or its Bot ends the call', async () => {
  const { threadId } = await joinMeeting(actor('bot'), 'https://meet.example.com/abc')

  await chatInMeeting(actor(threadId), 'On it.')
  expect(typed).toHaveBeenCalledWith('recall-bot', 'On it.')
  await expect(chatInMeeting(actor('bot'), 'hi')).rejects.toThrow('not in a meeting')

  await leaveMeetingTask(actor('bot'), threadId)
  await leaveMeetingTask(actor(threadId))
  expect(left).toHaveBeenCalledTimes(2)
})

test('failed transcription is said in the call’s chat and to its Task', async () => {
  await joinMeeting(actor('bot'), 'https://meet.example.com/abc')
  await handleRecallEvent('delivery-1', {
    event: 'transcript.failed',
    data: { data: { sub_code: 'provider_connection_failed' }, bot: { id: 'recall-bot' } },
  })

  expect(typed.mock.calls[0]?.[1]).toContain('Speech recognition failed')
  expect(turn.mock.calls[0]?.[2]).toStartWith('Speech recognition failed')
})

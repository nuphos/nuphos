import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'

import * as turns from '@/lib/agent/conversation-turn'
import { agentConversations } from '@/lib/agent/db/shared'
import * as threads from '@/lib/agent/thread-bridge'
import * as identity from '@/lib/identity'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import {
  JOIN_TIMEOUT_MS,
  chatInMeeting,
  handleRecallEvent,
  joinMeeting,
  leaveMeetingTask,
  reportJoinTimeouts,
} from './meetings'
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

const ended = (sub_code: string, event = 'bot.call_ended') => ({
  event,
  data: { data: { code: 'call_ended', sub_code }, bot: { id: 'recall-bot' } },
})

test('a bot that leaves on its own tells its Task once and ends the meeting', async () => {
  const { threadId } = await joinMeeting(actor('bot'), 'https://meet.example.com/abc')

  await handleRecallEvent('delivery-1', ended('timeout_exceeded_everyone_left'))
  expect(turn).toHaveBeenCalledTimes(1)
  expect(turn.mock.calls[0]?.[2]).toStartWith(
    'You are no longer in the call (timeout_exceeded_everyone_left)',
  )
  await expect(chatInMeeting(actor(threadId), 'hi')).rejects.toThrow('not in a meeting')
  await expect(leaveMeetingTask(actor(threadId))).rejects.toThrow('not in a meeting')

  // A later end event for the same bot says nothing again.
  await handleRecallEvent('delivery-2', ended('bot_errored', 'bot.fatal'))
  expect(turn).toHaveBeenCalledTimes(1)
})

test('a bot that leaves because its Task asked ends the meeting without waking the Task', async () => {
  const { threadId } = await joinMeeting(actor('bot'), 'https://meet.example.com/abc')

  await handleRecallEvent('delivery-1', ended('bot_received_leave_call'))
  expect(turn).not.toHaveBeenCalled()
  await expect(chatInMeeting(actor(threadId), 'hi')).rejects.toThrow('not in a meeting')
})

function captureWarnings(): { lines: () => Record<string, unknown>[]; restore: () => void } {
  const { warn } = console
  const lines: string[] = []

  // eslint-disable-next-line no-console -- logEvent writes its record to console.warn
  console.warn = (line: unknown) => lines.push(String(line))

  return {
    lines: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    restore: () => {
      // eslint-disable-next-line no-console
      console.warn = warn
    },
  }
}

test('a bot Recall gives up on logs meeting_bot.failed, even without a Task', async () => {
  const warnings = captureWarnings()

  await handleRecallEvent('delivery-1', ended('bot_errored', 'bot.fatal'))
  warnings.restore()
  expect(warnings.lines()).toEqual([
    expect.objectContaining({
      event: 'meeting_bot.failed',
      reason: 'fatal',
      code: 'call_ended',
      sub_code: 'bot_errored',
      bot_id: 'recall-bot',
    }),
  ])
})

const MINUTE = 60_000

test('a bot no webhook ever says is in its call logs join_timeout once', async () => {
  const { threadId } = await joinMeeting(actor('bot'), 'https://meet.example.com/abc')
  const sent = Date.now()

  await agentConversations().updateOne(
    { sessionId: threadId },
    { $set: { createdAt: new Date(sent), lastActiveAt: new Date(sent) } },
  )
  const warnings = captureWarnings()

  // Still within the timeout, then in the window just past it, then in the one after.
  await reportJoinTimeouts(10 * MINUTE, sent + 20 * MINUTE)
  await reportJoinTimeouts(10 * MINUTE, sent + JOIN_TIMEOUT_MS + 5 * MINUTE)
  await reportJoinTimeouts(10 * MINUTE, sent + JOIN_TIMEOUT_MS + 15 * MINUTE)
  warnings.restore()
  expect(warnings.lines()).toEqual([
    expect.objectContaining({
      event: 'meeting_bot.failed',
      reason: 'join_timeout',
      bot_id: 'recall-bot',
      session_id: threadId,
    }),
  ])
})

test('a bot that got into its call is not a join_timeout', async () => {
  const { threadId } = await joinMeeting(actor('bot'), 'https://meet.example.com/abc')
  const sent = Date.now()

  await agentConversations().updateOne(
    { sessionId: threadId },
    { $set: { createdAt: new Date(sent), lastActiveAt: new Date(sent) } },
  )
  await handleRecallEvent('delivery-1', {
    event: 'bot.in_call_recording',
    data: { data: { code: 'in_call_recording' }, bot: { id: 'recall-bot' } },
  })
  expect(turn).not.toHaveBeenCalled()
  const warnings = captureWarnings()

  await reportJoinTimeouts(10 * MINUTE, sent + JOIN_TIMEOUT_MS + 5 * MINUTE)
  warnings.restore()
  expect(warnings.lines()).toEqual([])
})

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useBoxWake } from '@/lib/test/doubles/box-wake'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { systemSender } from './message-metadata'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
  hasPendingUserMessages,
} from './pending-messages'
import { startQueuedTurn } from './queued-turn'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type * as dbActual from '@/lib/db'

// A Trigger fire has no sender to tell when its computer stays offline. It is
// recorded on its Trigger instead: a missed run until a turn runs again.

const TRIGGER_ID = '6af1a38b843a609932e6f66d'
const target = {
  userId: 'owner',
  teamId: 'team',
  sessionId: 'target',
  firstMessage: 'Original task',
  agentRuntime: 'claude-code',
  runtimeId: 'runtime',
} as AgentConversation
let online = false
let failure: Error | undefined
// What waking the conversation's Box answers: resuming, nothing to wake, or refused by the plan.
let wake: () => Promise<boolean> = async () => false
// Every write to the Trigger, in order.
const writes: { op: string; filter: Record<string, unknown>; update: Record<string, unknown> }[] =
  []
const write = (op: string) => async (filter: never, update: never) => {
  writes.push({ op, filter, update })

  return null
}

useIdentity({ signNuphosToken: () => 'test-token' })
useConversationChatRoute({
  resolveConversationChatRuntime: async () => ({ runtime: 'claude-code' }),
})
useBoxWake({ wakeOfflineBox: () => wake() })
useDb({
  db: () => ({
    collection: () => ({
      // The fired Trigger still exists.
      findOne: async () => ({ _id: TRIGGER_ID }),
      updateOne: write('updateOne'),
      findOneAndUpdate: write('findOneAndUpdate'),
    }),
  }),
})
useAgentDb({
  agentMessages: () => ({ findOne: async () => null, find: () => ({ toArray: async () => [] }) }),
  getConversationBySessionId: async () => target,
  getConversationWithMessages: async () => ({ conversation: target, messages: [] }),
})

function fire(offlineSince?: string, triggerId = TRIGGER_ID) {
  return {
    ...buildPendingUserMessage({
      renderedText: 'check the deploy',
      source: 'agent.resource',
      actorUserId: 'owner',
      metadata: systemSender(`trigger:${triggerId}`, 'Hourly check'),
    }),
    ...(offlineSince ? { offlineSince } : {}),
  }
}

beforeEach(() => {
  online = false
  failure = undefined
  wake = async () => false
  writes.length = 0
  installTurnRunner({
    claimAgentRunForSession: async () => () => {},
    hasActiveAgentRunForSession: async () => false,
    runAgentForTrigger: async () => {
      if (failure) throw failure
      if (!online)
        throw new AppError(409, 'runtime_offline', 'The computer running this agent is offline.')

      return { status: 'completed' }
    },
  })
})
afterEach(async () => {
  resetTurnRunner()
  await clearPendingUserMessages('owner', 'target')
})

test('a fire waiting out a reconnecting computer writes nothing to its Trigger', async () => {
  await enqueuePendingUserMessage('owner', 'target', fire())

  await startQueuedTurn('owner', 'target')
  expect(await hasPendingUserMessages('owner', 'target')).toBe(true)
  expect(writes).toEqual([])
})

test('a fire whose computer stays offline past the grace is a missed run', async () => {
  const message = fire(new Date(Date.now() - 61_000).toISOString())

  await enqueuePendingUserMessage('owner', 'target', message)

  await expect(startQueuedTurn('owner', 'target')).rejects.toThrow('offline')
  expect(await hasPendingUserMessages('owner', 'target')).toBe(false)
  expect(writes).toHaveLength(1)
  expect(writes[0]?.op).toBe('findOneAndUpdate')
  expect(String(writes[0]?.filter._id)).toBe(TRIGGER_ID)
  expect(writes[0]?.update).toEqual({ $set: { missedRunAt: new Date(message.receivedAt) } })
})

test('a fire that runs once the computer is back records the run and ends the outage', async () => {
  online = true
  await enqueuePendingUserMessage('owner', 'target', fire())

  await startQueuedTurn('owner', 'target')
  expect(writes).toHaveLength(1)
  expect(writes[0]?.op).toBe('updateOne')
  expect(String(writes[0]?.filter._id)).toBe(TRIGGER_ID)
  expect(writes[0]?.update).toEqual({
    $set: { lastRunAt: expect.any(Date) },
    $unset: { missedRunAt: '', failedRunCount: '', lastRunError: '' },
  })
})

test('a fire whose turn fails for a lasting reason counts toward pausing its Trigger', async () => {
  failure = new Error('prompt is too long: 240000 tokens > 200000 maximum')
  await enqueuePendingUserMessage('owner', 'target', fire())

  await expect(startQueuedTurn('owner', 'target')).rejects.toThrow('too long')
  expect(writes).toHaveLength(1)
  expect(writes[0]?.op).toBe('findOneAndUpdate')
  expect(writes[0]?.filter).toEqual({ _id: expect.anything(), enabled: true })
  expect(String(writes[0]?.filter._id)).toBe(TRIGGER_ID)
  expect(writes[0]?.update).toEqual({
    $inc: { failedRunCount: 1 },
    $set: { lastRunError: { message: expect.stringContaining('too long'), at: expect.any(Date) } },
  })
})

test('a fire whose agent is out of usage waits in the queue and writes nothing to its Trigger', async () => {
  failure = new Error('Gateway (status 402 Payment Required): out of credits')
  await enqueuePendingUserMessage('owner', 'target', fire())

  await startQueuedTurn('owner', 'target')
  expect(await hasPendingUserMessages('owner', 'target')).toBe(true)
  expect(writes).toEqual([])
})

test('a fire on a paused Box wakes it and waits in the queue', async () => {
  wake = async () => true
  await enqueuePendingUserMessage('owner', 'target', fire())

  await startQueuedTurn('owner', 'target')
  expect(await hasPendingUserMessages('owner', 'target')).toBe(true)
  expect(writes).toEqual([])
})

test('a fire on a Box its plan will not start fails, and counts toward pausing its Trigger', async () => {
  wake = async () => {
    throw new AppError(
      402,
      'box_vcpu_limit',
      "Your team's free cloud computer has used its 50 hours this month.",
    )
  }
  // Another Trigger's fire waiting behind it fails in the same turn.
  const other = '6af1a38b843a609932e6f66e'

  await enqueuePendingUserMessage('owner', 'target', fire())
  await enqueuePendingUserMessage('owner', 'target', fire(undefined, other))

  await startQueuedTurn('owner', 'target')
  expect(await hasPendingUserMessages('owner', 'target')).toBe(false)
  expect(writes.map((w) => String(w.filter._id))).toEqual([TRIGGER_ID, other])
  for (const { op, update } of writes) {
    expect(op).toBe('findOneAndUpdate')
    expect(update).toEqual({
      $inc: { failedRunCount: 1 },
      $set: {
        lastRunError: { message: expect.stringContaining('50 hours'), at: expect.any(Date) },
      },
    })
  }
})

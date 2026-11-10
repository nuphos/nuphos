import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

import { wakeForPlanDecision } from './plan-wake'

const turns: { sessionId: string; userId: string; messageId: string; text: string }[] = []

useSlackAgentBot({ getSlackAgentThreadBySessionId: async () => null })
useAgentDb({
  getConversationBySessionId: async (sessionId) =>
    sessionId === 'task' ? ({ sessionId, userId: 'owner', teamId: 'team' } as never) : null,
})
useConversationTurn({
  startConversationTurn: async (data, _target, text) => {
    turns.push({
      sessionId: data.targetSessionId,
      userId: data.userId,
      messageId: data.messageId,
      text,
    })

    return { status: 'started' as const, run: Promise.resolve(undefined) }
  },
})

beforeEach(() => {
  turns.length = 0
})

const plan = { number: 7, title: 'Daily backup', sourceConversationId: 'task' }

test('an approval made outside the conversation wakes it, as its owner', async () => {
  await wakeForPlanDecision(plan, 'approved', 'teammate')

  expect(turns).toEqual([
    {
      sessionId: 'task',
      userId: 'owner',
      // Fixed per plan and decision, so a repeated report does not wake it twice.
      messageId: 'plan-7-approved',
      text: 'Plan #7 (Daily backup) was approved. Confirm it with get.sh, then execute it.',
    },
  ])
})

test('a rejection tells the agent to stop', async () => {
  await wakeForPlanDecision(plan, 'rejected', 'owner')

  expect(turns.map((turn) => turn.text)).toEqual([
    'Plan #7 (Daily backup) was rejected. Discard it and stop.',
  ])
})

test('a plan with no conversation wakes nothing', async () => {
  await wakeForPlanDecision({ ...plan, sourceConversationId: undefined }, 'approved', 'owner')
  await wakeForPlanDecision({ ...plan, sourceConversationId: 'gone' }, 'approved', 'owner')

  expect(turns).toEqual([])
})

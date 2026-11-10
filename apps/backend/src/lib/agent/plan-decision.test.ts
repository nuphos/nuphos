import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentPlans } from '@/lib/test/doubles/agent-plans'
import { useJournalCapture } from '@/lib/test/doubles/journal-capture'

import { answerHumanTurn, askPlanDecisions } from './plan-decision'

import type { InputRequest } from '@/lib/agent/db/pending-decision'
import type { UIMessage } from 'ai'

const plan = {
  id: '7',
  title: 'Daily backup',
  sourceConversationId: 'task',
  steps: [{ title: 'Create job', jobs: [{ title: 'kubectl apply', commands: [] }] }],
  costSummary: '~$1/month',
  riskWorstCase: 'Backups silently empty',
  riskMitigations: ['Verify the first backup'],
  status: 'proposed' as const,
}

let requests: InputRequest[] = []
const approvals: string[] = []
const rejections: string[] = []
const resolved: string[] = []
const closedPlans: string[] = []

useAgentDb({
  addInputRequest: async (_sessionId, _userId, request) => {
    requests.push({ ...request, status: 'open' })
  },
  findInputRequest: async (_sessionId, _userId, id) => requests.find((r) => r.id === id),
  resolveInputRequest: async (_sessionId, _userId, id) => {
    resolved.push(id)

    return true
  },
  resolvePlanInputRequests: async (_sessionId, planId) => {
    closedPlans.push(planId)
  },
  clearPendingDecision: async () => {},
})
useAgentPlans({
  assertPlanAccess: async () => {},
  getPlan: async () => plan as never,
  recordPlanApproval: async (id, _scope, userId) => {
    approvals.push(`${id}:${userId}`)

    return {
      plan: { ...plan, status: 'approved' } as never,
      recorded: true,
      thresholdReached: true,
    }
  },
  updatePlan: async (id, patch) => {
    rejections.push(`${id}:${String(patch.rejectedBy)}`)

    return { ...plan, status: 'rejected' } as never
  },
})
useJournalCapture({ journalPlanDecision: async () => {} })

beforeEach(() => {
  requests = []
  for (const list of [approvals, rejections, resolved, closedPlans]) list.length = 0
})

const said = (text: string): UIMessage[] => [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text }] },
]

async function askAndAnswer(text: string) {
  await askPlanDecisions(
    'task',
    'owner',
    [plan],
    [{ toolCallId: 'nuphos-plan-7-1', output: { planId: '7' } }],
  )
  await answerHumanTurn({
    sessionId: 'task',
    userId: 'owner',
    actorUserId: 'approver',
    decisionReplyTo: 'nuphos-plan-7-1',
    messages: said(text),
  })
}

test('a proposed plan is asked about under its card id', async () => {
  await askPlanDecisions(
    'task',
    'owner',
    [plan, { ...plan, id: '8', status: 'approved' }],
    [
      { toolCallId: 'nuphos-plan-7-1', output: { planId: '7' } },
      { toolCallId: 'nuphos-plan-8-1', output: { planId: '8' } },
    ],
  )

  expect(requests).toMatchObject([
    {
      id: 'nuphos-plan-7-1',
      planId: '7',
      category: 'approval',
      question: 'Approve plan #7: Daily backup?',
      options: ['Approve', 'Reject'],
    },
  ])
})

test('answering Approve approves the plan as the person who answered', async () => {
  await askAndAnswer('Approve')

  expect(approvals).toEqual(['7:approver'])
  // Closed because the plan was decided, not because something was said.
  expect(closedPlans).toEqual(['7'])
  expect(resolved).toEqual([])
})

test('answering Reject rejects it', async () => {
  await askAndAnswer('Reject')

  expect(rejections).toEqual(['7:approver'])
  expect(approvals).toEqual([])
})

test('any other reply leaves the plan and its question open', async () => {
  await askAndAnswer('ok, go ahead')

  expect(approvals).toEqual([])
  expect(rejections).toEqual([])
  expect(resolved).toEqual([])
  expect(closedPlans).toEqual([])
})

test('an ordinary question still closes when answered', async () => {
  requests.push({
    id: 'q1',
    category: 'preference',
    question: 'Which?',
    askedAt: new Date(),
    status: 'open',
  })
  await answerHumanTurn({
    sessionId: 'task',
    userId: 'owner',
    decisionReplyTo: 'q1',
    messages: said('A'),
  })

  expect(resolved).toEqual(['q1'])
})

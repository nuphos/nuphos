import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentPlans } from '@/lib/test/doubles/agent-plans'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'

const VIEWER = '64b5f1c2e4b0a1d2c3e4f5a6'
const OWNER = '64b5f1c2e4b0a1d2c3e4f5a7'

type Conversation = Record<string, unknown> & { sessionId: string }
let conversations: Conversation[] = []
let updated = 0
let approved = 0
let retried = 0

const plan = (number: number, sourceConversationId?: string) => ({
  id: String(number),
  number,
  status: 'proposed',
  sourceConversationId,
})

useAuthMiddleware({
  requireAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', VIEWER)
    await next()
  },
})
useAgentDb({
  agentConversations: () =>
    ({
      findOne: (filter: { sessionId: string }) =>
        Promise.resolve(conversations.find((row) => row.sessionId === filter.sessionId) ?? null),
      find: (filter: { sessionId: { $in: string[] } }) => ({
        toArray: () =>
          Promise.resolve(
            conversations.filter((row) => filter.sessionId.$in.includes(row.sessionId)),
          ),
      }),
    }) as never,
})
useAgentPlans({
  getPlan: (id: string) =>
    Promise.resolve(plan(Number(id), { '1': 'private', '2': 'shared' }[id]) as never),
  listPlans: () =>
    Promise.resolve({
      plans: [plan(1, 'private'), plan(2, 'shared'), plan(3)] as never,
      nextCursor: null,
      hasMore: false,
    }),
  recordPlanApproval: () => {
    approved++

    return Promise.resolve({ plan: null, thresholdReached: false } as never)
  },
  retryPlan: () => {
    retried++

    return Promise.resolve(null)
  },
  updatePlan: () => {
    updated++

    return Promise.resolve(plan(2, 'shared') as never)
  },
})

await import('./routes-plans')
const { agent } = await import('./router')
const app = new Hono().route('/agent', agent).onError(errorHandler)

beforeEach(() => {
  updated = 0
  approved = 0
  retried = 0
  conversations = [
    { sessionId: 'private', userId: OWNER, teamId: 't', generalAccess: 'none' },
    { sessionId: 'shared', userId: OWNER, teamId: 't', generalAccess: 'view' },
  ]
})

describe('plans follow their conversation access', () => {
  test('the list hides plans from conversations the caller cannot open', async () => {
    const body = (await (await app.request('/agent/plans')).json()) as {
      plans: { number: number }[]
    }

    expect(body.plans.map((row) => row.number)).toEqual([2, 3])
  })

  test('a plan from a private conversation answers not found', async () => {
    expect((await app.request('/agent/plans/1')).status).toBe(404)
    expect((await app.request('/agent/plans/2')).status).toBe(200)
  })

  test('changing a plan needs reply access to its conversation', async () => {
    const response = await app.request('/agent/plans/2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })

    expect(response.status).toBe(403)
    expect(updated).toBe(0)
  })

  test('approving and retrying need reply access too', async () => {
    const post = (path: string) =>
      app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

    expect((await post('/agent/plans/2/approvals')).status).toBe(403)
    expect((await post('/agent/plans/2/retry')).status).toBe(403)
    expect(approved + retried).toBe(0)
  })

  test('a plan without a source conversation stays team-wide', async () => {
    expect((await app.request('/agent/plans/3')).status).toBe(200)
    const response = await app.request('/agent/plans/3', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })

    expect(response.status).toBe(200)
    expect(updated).toBe(1)
  })
})

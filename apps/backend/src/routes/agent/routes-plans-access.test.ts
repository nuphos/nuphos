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
let writes = 0
let listed: Record<string, unknown> | undefined

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
  listPlans: (options: Record<string, unknown>) => {
    listed = options

    return Promise.resolve({
      plans: [plan(1, 'private'), plan(2, 'shared'), plan(3)] as never,
      nextCursor: null,
      hasMore: false,
    })
  },
  recordPlanApproval: () => {
    writes++

    return Promise.resolve({ plan: null, thresholdReached: false } as never)
  },
  updatePlan: () => {
    writes++

    return Promise.resolve(plan(2, 'shared') as never)
  },
})

await import('./routes-plans')
const { agent } = await import('./router')
const app = new Hono().route('/agent', agent).onError(errorHandler)

beforeEach(() => {
  writes = 0
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
    // Filtered in the query too, so a page is not emptied after the fact.
    expect(listed?.viewerId).toBe(VIEWER)
  })

  test('a plan from a private conversation answers not found', async () => {
    expect((await app.request('/agent/plans/1')).status).toBe(404)
    expect((await app.request('/agent/plans/2')).status).toBe(200)
  })

  test('every write answers that plans are retired and changes nothing', async () => {
    const send = (method: string, path: string) =>
      app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })

    for (const [method, path] of [
      ['PATCH', '/agent/plans/3'],
      ['POST', '/agent/plans/3/approvals'],
      ['POST', '/agent/plans/3/retry'],
      ['PUT', '/agent/plan-approval-policy'],
    ] as const) {
      const response = await send(method, path)

      expect(response.status).toBe(410)
      expect(await response.json()).toMatchObject({ error: { code: 'plans_retired' } })
    }
    expect(writes).toBe(0)
  })

  test('a plan without a source conversation stays team-wide', async () => {
    expect((await app.request('/agent/plans/3')).status).toBe(200)
  })
})

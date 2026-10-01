import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentPlans } from '@/lib/test/doubles/agent-plans'
import { errorHandler } from '@/lib/errors'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { AgentVars } from '@/routes/agent-sessions/shared'

const calls: {
  awaiting: unknown[]
  create: unknown[]
  get: unknown[]
  list: unknown[]
  update: unknown[]
} = {
  awaiting: [],
  create: [],
  get: [],
  list: [],
  update: [],
}
const current = {
  id: '404',
  number: 404,
  title: 'Demo',
  overview: 'Preview',
  steps: [],
  actions: [],
  status: 'proposed',
} as never

useAgentPlans({
  hasPlanAwaitingApprovalForConversation: async (sessionId, scope) => {
    calls.awaiting.push({ sessionId, scope })

    return true
  },
  createPlan: async (input) => {
    calls.create.push(input)

    return current
  },
  getPlan: async (_id, scope) => {
    calls.get.push(scope)

    return current
  },
  listPlans: async (options) => {
    calls.list.push(options)

    return { plans: [current], nextCursor: null, hasMore: false }
  },
  updatePlan: async (_id, patch, scope) => {
    calls.update.push({ patch, scope })

    return current
  },
})

const { previewPlans } = await import('./plans')
const app = new Hono<{ Variables: AgentVars & TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('agent', { userId: 'user-1', sessionId: 'conv-1' })
  c.set('userId', 'user-1')
  c.set('teamId', 'team-1')
  await next()
})
app.route('/plans', previewPlans)
app.onError(errorHandler)

beforeEach(() => {
  calls.awaiting.length = 0
  calls.create.length = 0
  calls.get.length = 0
  calls.list.length = 0
  calls.update.length = 0
})

describe('Claude runtime Plan REST surface', () => {
  test('creates a conversation-scoped shell', async () => {
    const response = await app.request('/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Demo', overview: 'Preview' }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: '404',
      status: 'proposed',
      _links: {
        self: '/agent-sessions/conv-1/teams/team-1/plans/404',
        app: 'https://nuphos.ai/teams/team-1/plans/404',
        collection: '/agent-sessions/conv-1/teams/team-1/plans',
        team: 'https://nuphos.ai/teams/team-1',
        conversation: 'https://nuphos.ai/teams/team-1/agent/conv-1',
      },
    })
    expect(calls.create).toEqual([
      {
        teamId: 'team-1',
        createdBy: 'user-1',
        sourceConversationId: 'conv-1',
        title: 'Demo',
        overview: 'Preview',
        steps: [],
      },
    ])
  })

  test('creates a complete proposal atomically after validating every section', async () => {
    const proposal = {
      title: 'Demo',
      overview: 'Preview',
      decisions: [{ label: 'Region', value: 'us-east-1' }],
      steps: [
        {
          title: 'Apply',
          jobs: [
            {
              title: 'Service',
              commands: [{ command: 'restart service', description: 'Apply safely' }],
            },
          ],
        },
      ],
      costSummary: '$5/month',
      costMonthly: '$5',
      riskWorstCase: 'Brief service interruption',
      riskMitigations: ['Check health before continuing'],
    }
    const response = await app.request('/plans/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proposal),
    })

    expect(response.status).toBe(201)
    expect(calls.create).toEqual([
      {
        ...proposal,
        teamId: 'team-1',
        createdBy: 'user-1',
        sourceConversationId: 'conv-1',
        costOneTime: undefined,
        costSavings: undefined,
      },
    ])
  })

  test('rejects an invalid complete proposal without creating a shell', async () => {
    const response = await app.request('/plans/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Demo',
        decisions: [],
        steps: [{ title: 'Apply', jobs: [{ title: 'Service', commands: [] }] }],
        costSummary: '$5/month',
        costMonthly: 0.1,
        riskWorstCase: 'Interruption',
        riskMitigations: ['Rollback'],
      }),
    })

    expect(response.status).toBe(400)
    expect(calls.create).toHaveLength(0)
  })

  test('links every listed resource and the collection', async () => {
    const response = await app.request('/plans')
    const body = (await response.json()) as {
      plans: { _links: Record<string, string> }[]
      _links: Record<string, string>
    }

    expect(response.status).toBe(200)
    expect(body._links.collection).toBe('/agent-sessions/conv-1/teams/team-1/plans')
    expect(body._links.appCollection).toBe('https://nuphos.ai/teams/team-1/plans')
    expect(body.plans[0]?._links.app).toBe('https://nuphos.ai/teams/team-1/plans/404')
    expect(calls.list).toEqual([
      { teamId: 'team-1', createdBy: 'user-1', sourceConversationId: 'conv-1' },
    ])
  })

  test('scopes reads and writes to the bearer conversation', async () => {
    const read = await app.request('/plans/404')
    const revised = await app.request('/plans/404', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ costSummary: '$5/month' }),
    })

    expect(read.status).toBe(200)
    expect(revised.status).toBe(200)
    expect(calls.get).toEqual([
      { teamId: 'team-1', userId: 'user-1', sourceConversationId: 'conv-1' },
    ])
    expect(calls.update).toEqual([
      {
        patch: { costSummary: '$5/month' },
        scope: {
          teamId: 'team-1',
          userId: 'user-1',
          sourceConversationId: 'conv-1',
        },
      },
    ])
  })

  test('accepts proposal sections but rejects human-only statuses', async () => {
    const revised = await app.request('/plans/404', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decisions: [{ label: 'Region', value: 'us-east-1' }],
        costSummary: '$5/month',
      }),
    })

    expect(revised.status).toBe(200)
    expect(calls.update[0]).toMatchObject({
      patch: {
        decisions: [{ label: 'Region', value: 'us-east-1' }],
        costSummary: '$5/month',
      },
      scope: {
        teamId: 'team-1',
        userId: 'user-1',
        sourceConversationId: 'conv-1',
      },
    })

    const approved = await app.request('/plans/404', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    expect(approved.status).toBe(400)
  })
})

import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useToolApprovalDecide } from '@/lib/test/doubles/tool-approval-decide'

import { agent } from './router'

import type { AgentConversation } from '@/lib/agent/db'

const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const OWNER = '111111111111111111111111'
const TEAMMATE = '222222222222222222222222'
let viewer = OWNER
let result: 'decided' | 'expired' | 'forbidden' = 'decided'
const decided: unknown[] = []

const conversation = {
  sessionId: 'bot',
  userId: OWNER,
  teamId: TEAM,
  participantIds: [TEAMMATE],
} as AgentConversation

useIdentity({
  authenticateToken: async () => ({ user: { id: viewer } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }) as never,
})
useAgentDb({
  getReadableConversation: async (id, _viewer, team) =>
    id === 'bot' && team === TEAM ? conversation : null,
})
useToolApprovalDecide({
  decideToolApproval: async (args) => {
    decided.push(args)

    return result
  },
})

const app = new Hono().route('/agent', agent)

app.onError(errorHandler)
beforeEach(() => {
  viewer = OWNER
  result = 'decided'
  decided.length = 0
})

function decide(body: unknown, session = 'bot') {
  return app.request(`/agent/conversations/${session}/tool-approvals/tool-1?teamId=${TEAM}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('the owner allows a waiting tool call', async () => {
  const response = await decide({ decision: 'allow' })

  expect(response.status).toBe(200)
  expect(decided).toEqual([
    { userId: OWNER, sessionId: 'bot', toolCallId: 'tool-1', decision: 'allow' },
  ])
})

test('a participant who is not the owner cannot decide', async () => {
  viewer = TEAMMATE

  expect((await decide({ decision: 'allow' })).status).toBe(403)
  expect(decided).toEqual([])
})

test('an unknown conversation or a malformed decision is refused', async () => {
  expect((await decide({ decision: 'allow' }, 'other')).status).toBe(404)
  for (const body of [{}, { decision: 'maybe' }, { decision: 'allow', extra: 1 }])
    expect((await decide(body)).status).toBe(400)
  expect(decided).toEqual([])
})

test('a request that waits for someone else, or has expired, says so', async () => {
  result = 'forbidden'
  expect((await decide({ decision: 'reject' })).status).toBe(403)
  result = 'expired'
  expect((await decide({ decision: 'reject' })).status).toBe(409)
})

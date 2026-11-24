// Agent lifecycle rows are debugging telemetry: they must reach PostHog without
// person processing, even when a caller passes its own value for the flag.
import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { PostHog } from 'posthog-node'

import { config } from '@/config'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'

useAuthMiddleware({
  requireAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    await next()
  },
})

const { traceAgentChatEvent } = await import('./trace')

await import('./routes-chat')
const { agent } = await import('./router')

import type { EventMessage } from 'posthog-node'

const sent: EventMessage[] = []
const apiKey = config.posthog.apiKey
const capture = spyOn(PostHog.prototype, 'capture').mockImplementation((message) => {
  sent.push(message)
})

beforeAll(() => {
  config.posthog.apiKey = 'phc_test'
})

beforeEach(() => {
  sent.length = 0
})

afterAll(() => {
  config.posthog.apiKey = apiKey
  capture.mockRestore()
})

test('agent_lifecycle skips person processing and keeps its properties', () => {
  traceAgentChatEvent(
    'info',
    'agent.chat.run.finished',
    {
      requestId: 'r1',
      userId: 'u1',
      sessionId: 's1',
      teamId: 't1',
      streamId: 'st1',
      route: '/agent/chat',
      method: 'POST',
    },
    { $process_person_profile: true, outcome: 'ok' },
    { duration_ms: 12 },
  )

  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({
    event: 'agent_lifecycle',
    distinctId: 'u1',
    properties: {
      $process_person_profile: false,
      phase: 'agent.chat.run.finished',
      request_id: 'r1',
      session_id: 's1',
      team_id: 't1',
      stream_id: 'st1',
      route: '/agent/chat',
      outcome: 'ok',
      duration_ms: 12,
    },
  })
})

test('a client breadcrumb becomes a person-less agent_lifecycle row', async () => {
  const app = new Hono().route('/agent', agent)
  const response = await app.request('/agent/chat/st1/report-failure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', phase: 'first_byte_timeout', level: 'info' }),
  })

  expect(response.status).toBeLessThan(300)
  expect(sent.find((message) => message.event === 'agent_lifecycle')).toMatchObject({
    distinctId: 'u1',
    properties: {
      $process_person_profile: false,
      phase: 'client.first_byte_timeout',
      source: 'client',
      stream_id: 'st1',
      session_id: 's1',
      level: 'info',
    },
  })
})

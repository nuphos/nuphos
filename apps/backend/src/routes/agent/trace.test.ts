// Agent lifecycle rows are debugging telemetry: they must reach PostHog without
// person processing, even when a caller passes its own value for the flag.
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { PostHog } from 'posthog-node'

import { config } from '@/config'

import { traceAgentChatEvent } from './trace'

import type { EventMessage } from 'posthog-node'

const sent: EventMessage[] = []
const apiKey = config.posthog.apiKey
const capture = spyOn(PostHog.prototype, 'capture').mockImplementation((message) => {
  sent.push(message)
})

beforeAll(() => {
  config.posthog.apiKey = 'phc_test'
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

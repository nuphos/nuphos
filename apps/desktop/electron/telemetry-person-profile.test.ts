// Debugging telemetry must reach PostHog without person processing, which is
// billed per event. Only the PostHog client is fake; the capture path is real.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mock, test } from 'node:test'

import type { AddressInfo } from 'node:net'

type Message = { distinctId: string; event: string; properties?: Record<string, unknown> }

const sent: Message[] = []

mock.module('posthog-node', {
  namedExports: {
    PostHog: class {
      capture(message: Message): void {
        sent.push(message)
      }
    },
  },
})
process.env.POSTHOG_KEY = 'phc_test'

const { initMainAnalytics, setAnalyticsTeam } = await import('./analytics.ts')
const { traceStream } = await import('./agent/chat-shared.ts')
const { backendFailure } = await import('./fetch-error.ts')
const { dialBackend } = await import('./backend-socket.ts')

initMainAnalytics()
setAnalyticsTeam('t1')

function last(event: string): Record<string, unknown> | undefined {
  return sent.findLast((message) => message.event === event)?.properties
}

test('agent_stream_lifecycle skips person processing even when a caller sets the flag', () => {
  traceStream(
    'first_byte',
    { streamId: 'st1', sessionId: 's1' },
    {
      $process_person_profile: true,
      attempt: 2,
    },
  )

  assert.deepEqual(last('agent_stream_lifecycle'), {
    team_id: 't1',
    phase: 'first_byte',
    stream_id: 'st1',
    session_id: 's1',
    attempt: 2,
    $process_person_profile: false,
  })
})

test('backend_request_failed skips person processing', () => {
  backendFailure(new Error('boom'), '/agent/sessions', 'r1')

  assert.equal(last('backend_request_failed')?.$process_person_profile, false)
  assert.equal(last('backend_request_failed')?.request_id, 'r1')
  assert.equal(last('backend_request_failed')?.route, '/agent/sessions')
})

test('backend_socket_dial_failed skips person processing', async () => {
  const server = createServer().listen(0, '127.0.0.1')

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  server.close()
  await new Promise<void>((resolve) => {
    dialBackend(`http://127.0.0.1:${String(port)}/x`, {}).addEventListener('error', () => resolve())
  })

  assert.deepEqual(last('backend_socket_dial_failed'), {
    team_id: 't1',
    host: `127.0.0.1:${String(port)}`,
    code: 'ECONNREFUSED',
    $process_person_profile: false,
  })
})

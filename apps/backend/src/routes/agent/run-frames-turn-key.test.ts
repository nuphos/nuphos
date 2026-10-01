import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { appendAgentRunTurnComplete } from './run-frames'
import { createAgentRun } from './run-registry'

describe('agent run terminal frames', () => {
  test('carries the request id as the durable memory turn key', () => {
    const run = createAgentRun('user-1', 'session-1', 'stream-1', {
      requestId: 'request-1',
      userId: 'user-1',
      sessionId: 'session-1',
      streamId: 'stream-1',
      route: '/agent/chat',
      method: 'POST',
    })

    appendAgentRunTurnComplete(run)

    expect(run.frames.at(-1)).toContain('"turnKey":"request-1"')
    run.releaseOwnership()
  })
})

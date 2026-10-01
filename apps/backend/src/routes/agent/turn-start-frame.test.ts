import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { createAgentRun } from './run-registry'
import { appendAgentRunTurnStart, turnInputMessages } from './turn-start-frame'

import type { UIMessage } from 'ai'

function newRun() {
  return createAgentRun('user-1', 'session-1', 'stream-1', {
    requestId: 'request-1',
    userId: 'user-1',
    sessionId: 'session-1',
    streamId: 'stream-1',
    route: '/agent/chat',
    method: 'POST',
  })
}

function frameData(frame: string): Record<string, unknown> {
  return JSON.parse(frame.replace(/^data: /, '').trim()) as Record<string, unknown>
}

const history: UIMessage[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Draft a plan' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Plan #522 is ready.' }] },
]
const approval: UIMessage = {
  id: 'u2',
  role: 'user',
  parts: [{ type: 'text', text: 'Approved plan #522 — please proceed with plan #522.' }],
}

describe('turn start frame', () => {
  test('opens the run with the user message that started the turn', () => {
    const run = newRun()

    appendAgentRunTurnStart(run, [...history, approval])

    expect(run.frames).toHaveLength(1)
    expect(frameData(run.frames[0]!)).toEqual({
      type: 'atlas-turn-start',
      messages: [
        {
          id: 'u2',
          role: 'user',
          parts: [{ type: 'text', text: 'Approved plan #522 — please proceed with plan #522.' }],
        },
      ],
    })
    run.releaseOwnership()
  })

  test('carries every trailing user message and nothing before them', () => {
    const second: UIMessage = { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'Also…' }] }

    expect(turnInputMessages([...history, approval, second]).map((m) => m.id)).toEqual(['u2', 'u3'])
  })

  test('a continuation has no new input and emits nothing', () => {
    const run = newRun()

    appendAgentRunTurnStart(run, history)

    expect(run.frames).toHaveLength(0)
    run.releaseOwnership()
  })
})

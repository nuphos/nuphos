import { describe, expect, test } from 'bun:test'

import { signalAgentRunCancellation } from './run-cancel'

import type { AgentRun } from './types'

function createRun(): AgentRun {
  const now = Date.now()

  return {
    key: 'user-1:stream-1',
    streamId: 'stream-1',
    sessionId: 'session-1',
    userId: 'user-1',
    frames: [],
    done: false,
    abortController: new AbortController(),
    subscribers: new Set(),
    createdAt: now,
    lastAccessAt: now,
    lastFrameAt: now,
    releaseOwnership: () => {},
  }
}

describe('signalAgentRunCancellation', () => {
  test('signals the producer without synthesizing terminal state', () => {
    const run = createRun()

    expect(signalAgentRunCancellation(run)).toBe(true)
    expect(run.abortController.signal.aborted).toBe(true)
    expect(run.done).toBe(false)
    expect(run.frames).toEqual([])
    expect(run.lastFinishReason).toBeUndefined()
  })

  test('does not signal an already finished run', () => {
    const run = createRun()

    run.done = true
    expect(signalAgentRunCancellation(run)).toBe(false)
    expect(run.abortController.signal.aborted).toBe(false)
  })
})

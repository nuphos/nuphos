import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { appendAgentRunDone, finishAgentRun } from './run-frames'
import { createAgentRun } from './run-registry'
import { RUN_FRAME_STALL_MS, stalledAgentRuns } from './run-stall'

import type { AgentRun } from './types'

function run(streamId: string): AgentRun {
  return createAgentRun('user-1', 'session-1', streamId, {
    requestId: `request-${streamId}`,
    userId: 'user-1',
    sessionId: 'session-1',
    streamId,
    route: '/agent/chat',
    method: 'POST',
  })
}

describe('finishing a run always closes its stream', () => {
  test('synthesizes a terminal frame when the producer left without one', () => {
    const subject = run('stream-stop')

    subject.frames.push('data: {"type":"text-delta","delta":"half a sentence"}\n\n')
    finishAgentRun(subject, 'stopped-by-user')

    // A replica tailing the Redis mirror has only the done frame to go on, so
    // "flip done and release the lease" is not enough to end anyone else's view.
    expect(subject.frames.at(-1)).toContain('atlas-stream-done')
    expect(subject.frames.at(-2)).toContain('"reason":"stopped-by-user"')
    subject.releaseOwnership()
  })

  test('leaves a stream that already ended untouched', () => {
    const subject = run('stream-clean')

    appendAgentRunDone(subject)
    const frameCount = subject.frames.length

    finishAgentRun(subject)

    expect(subject.frames).toHaveLength(frameCount)
    subject.releaseOwnership()
  })
})

describe('stalled run detection', () => {
  test('selects only runs silent past the window', () => {
    const now = Date.now()
    const fresh = run('stream-fresh')
    const stalled = run('stream-stalled')

    fresh.lastFrameAt = now - 1_000
    stalled.lastFrameAt = now - RUN_FRAME_STALL_MS - 1

    expect(stalledAgentRuns([fresh, stalled], now).map((r) => r.streamId)).toEqual([
      'stream-stalled',
    ])
    fresh.releaseOwnership()
    stalled.releaseOwnership()
  })

  test('ignores a reader refreshing lastAccessAt on a dead run', () => {
    const now = Date.now()
    const subject = run('stream-resumed')

    // The client reattaches every few seconds; that is what kept the old
    // lastAccessAt-based view of "activity" warm on a run with no producer.
    subject.lastAccessAt = now
    subject.lastFrameAt = now - RUN_FRAME_STALL_MS - 1

    expect(stalledAgentRuns([subject], now)).toHaveLength(1)
    subject.releaseOwnership()
  })
})

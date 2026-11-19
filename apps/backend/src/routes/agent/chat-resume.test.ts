import { expect, spyOn, test } from 'bun:test'

import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'

import { resumeFromRedisOrThrow } from './chat-resume'

import type { AgentChatBody } from './types'

// The run is gone from this replica and from Redis: it ended before the resume arrived.
useAgentRunStore({ streamAgentRunFromRedis: async () => null })

test('a resume of a stream that already ended answers 409 without logging an error', async () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {})
  const lines = spyOn(console, 'log').mockImplementation(() => {})

  try {
    const resumed = resumeFromRedisOrThrow({
      requestId: 'r1',
      userId: 'u1',
      runOwnerUserId: 'u1',
      sessionId: 's1',
      teamId: 't1',
      streamId: 'stream-1',
      body: { id: 's1', messages: [], resume: true, resumeFrom: 0 } as AgentChatBody,
      readOnlyResume: false,
    })

    await expect(resumed).rejects.toMatchObject({ status: 409, code: 'stream_not_resumable' })
    // The client falls back to a fresh start; the request log already records the 409.
    const logged = [...errors.mock.calls, ...lines.mock.calls].map(([line]) => String(line))

    expect(logged.filter((line) => line.includes('"level":"error"'))).toEqual([])
  } finally {
    errors.mockRestore()
    lines.mockRestore()
  }
})

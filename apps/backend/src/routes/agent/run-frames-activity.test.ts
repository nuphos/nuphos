import '@/routes/agent'

import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import {
  appendAgentRunPhase,
  appendAgentRunTurnComplete,
  appendAgentRunTurnPaused,
} from './run-frames'
import { createAgentRun } from './run-registry'

import type * as dbActual from '@/lib/db'

const bumps: unknown[] = []

useDb({
  db: (() => ({
    collection: () => ({
      updateOne: (filter: unknown, update: unknown) => {
        bumps.push({ filter, update })

        return Promise.resolve({ matchedCount: 1 })
      },
    }),
  })) as unknown as typeof dbActual.db,
})

test('every turn boundary, and nothing else, records conversation activity', async () => {
  const run = createAgentRun('owner', 'session-a', 'stream-a', {
    requestId: 'request-a',
    userId: 'owner',
    sessionId: 'session-a',
    streamId: 'stream-a',
    route: '/agent/chat',
    method: 'POST',
  })

  appendAgentRunPhase(run, 'connecting-model')
  appendAgentRunTurnPaused(run, 'max-steps')
  appendAgentRunTurnComplete(run)
  await Promise.resolve()

  const bump = {
    filter: { sessionId: 'session-a', userId: 'owner' },
    update: { $inc: { activitySeq: 1 } },
  }

  expect(bumps).toEqual([bump, bump])
  run.releaseOwnership()
})

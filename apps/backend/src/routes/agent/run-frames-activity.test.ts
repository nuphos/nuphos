import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import {
  appendAgentRunPhase,
  appendAgentRunTurnComplete,
  appendAgentRunTurnPaused,
} from './run-frames'
import { createAgentRun } from './run-registry'

import type * as dbActual from '@/lib/db'

const bumps: unknown[] = []

beforeEach(() => {
  bumps.length = 0
})
// A bump first looks the conversation up, then writes.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

useDb({
  db: (() => ({
    collection: (name: string) => ({
      // Not a Task under a Bot: a plain bump.
      findOne: () => Promise.resolve(null),
      updateOne: (filter: unknown, update: unknown) => {
        if (name === 'agent_conversations') bumps.push({ filter, update })

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
  await settled()

  const bump = {
    filter: { sessionId: 'session-a', userId: 'owner' },
    update: { $inc: { activitySeq: 1 } },
  }

  expect(bumps).toEqual([bump, bump])
  run.releaseOwnership()
})

test('a turn only channel posts started records activity for a pause, not for its end', async () => {
  const run = createAgentRun('owner', 'session-b', 'stream-b', undefined, { channelWoken: true })

  appendAgentRunTurnComplete(run)
  await settled()
  expect(bumps).toEqual([])

  appendAgentRunTurnPaused(run, 'max-steps')
  await settled()
  expect(bumps).toEqual([
    { filter: { sessionId: 'session-b', userId: 'owner' }, update: { $inc: { activitySeq: 1 } } },
  ])
  run.releaseOwnership()
})

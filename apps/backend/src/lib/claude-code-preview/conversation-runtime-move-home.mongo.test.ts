import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { setConversationArchived } from '@/lib/agent/db/archive'
import { agentConversations } from '@/lib/agent/db/shared'
import { closeDb, connectDb } from '@/lib/db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { usePendingQueue } from '@/lib/test/doubles/pending-queue'
import { useRedis } from '@/lib/test/doubles/redis'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { controlRegistry } from './agent-chat-registry'
import { moveConversationRuntime } from './conversation-runtime-move'
import { reclaimPendingArchiveHome } from './runtime-session-home'

import type { AgentConversation } from '@/lib/agent/db/shared'

const owner = randomUUID()
const team = randomUUID()
// Three runtimes; `b` and `b2` stand for two agents on one computer.
const runtimes = ['a', 'b', 'b2']

useRedis({ redisEnabled: () => true })
useAgentRunStore({
  getActiveAgentRunForSession: async () => null,
  reserveActiveAgentRunForSession: async () => async () => {},
})
usePendingQueue({ hasQueuedTranscriptMessage: async () => false })
useRuntimeModels({
  runtimeModelCatalog: async () => ({ models: [], controls: { modelId: 'default' } }) as never,
})
useRuntimeCatalog({
  requireRuntimeInstance: async (_teamId: string, id: string) =>
    ({
      id,
      provider: 'claude-code',
      label: id,
      status: 'active',
      kind: 'external',
      createdAt: '',
    }) as never,
  developmentRuntimeEndpoint: () => undefined as never,
})
useRuntimeRegistry({
  resolveTeamRuntimeEndpoints: async () =>
    runtimes.map((runtimeId) => ({ runtimeId, url: `wss://${runtimeId}/acp`, authKey: 'key' })),
})

const { acquire, runtimeJobs } = controlRegistry
let jobs: { runtimeId: string; epoch: number }[] = []

const conversation = async (runtimeId: string) => {
  const sessionId = randomUUID()
  const now = new Date()

  await agentConversations().insertOne({
    sessionId,
    userId: owner,
    teamId: team,
    title: 'Fixture',
    firstMessage: '',
    messageCount: 0,
    createdAt: now,
    lastActiveAt: now,
    agentRuntime: 'claude-code',
    runtimeId,
  })

  return sessionId
}
const move = async (sessionId: string, to: string) => {
  const row = await agentConversations().findOne({ sessionId })

  if (!row) throw new Error('missing fixture')
  await moveConversationRuntime(row, to, owner)
}
// Set by the reclaim, outside the conversation type.
const row = (sessionId: string) =>
  agentConversations().findOne({ sessionId }) as Promise<
    (AgentConversation & { sessionHomeReclaimedAt?: Date }) | null
  >
const queued = async (sessionId: string) =>
  (await row(sessionId))?.archiveHomePendingEpochs?.map((home) => [home.runtimeId, home.epoch])

describe.skipIf(!process.env.TEST_MONGODB_URI)('the home a move leaves (#5047)', () => {
  beforeAll(async () => {
    await connectDb()
    controlRegistry.runtimeJobs = () => ['session-homes', 'session-homes-v2']
    controlRegistry.acquire = (async (_teamId: string, endpoint: { runtimeId: string }) => ({
      runJob: async (request: { stdin: string }) => {
        jobs.push({ runtimeId: endpoint.runtimeId, epoch: JSON.parse(request.stdin).epoch })

        return { exitCode: 0, stdout: '{"result":"removed"}' }
      },
    })) as never
  })
  afterEach(() => {
    jobs = []
  })
  afterAll(async () => {
    controlRegistry.acquire = acquire
    controlRegistry.runtimeJobs = runtimeJobs
    await agentConversations().deleteMany({ teamId: team })
    await closeDb()
  })

  test('every home of A -> B -> B2 is queued and reclaimed on its runtime at its generation', async () => {
    const sessionId = await conversation('a')

    await move(sessionId, 'b')
    await move(sessionId, 'b2')

    expect((await row(sessionId))?.sessionHomeEpoch).toBe(2)
    expect((await row(sessionId))?.settingsRevision).toBe(2)
    expect(await queued(sessionId)).toEqual([
      ['a', 0],
      ['b', 1],
    ])
    expect(await reclaimPendingArchiveHome(sessionId)).toBe(true)
    expect(jobs).toEqual([
      { runtimeId: 'a', epoch: 0 },
      { runtimeId: 'b', epoch: 1 },
    ])
    // The live home, generation 2 on b2, was never sent a job.
    expect(await queued(sessionId)).toEqual([])
    expect((await row(sessionId))?.sessionHomeReclaimedAt).toBeUndefined()
  })

  test('archiving after a move reclaims the left home and the current one', async () => {
    const sessionId = await conversation('a')

    await move(sessionId, 'b')
    await setConversationArchived(sessionId, true, { source: 'user' })

    expect(await queued(sessionId)).toEqual([
      ['a', 0],
      ['b', 1],
    ])
    expect(await reclaimPendingArchiveHome(sessionId)).toBe(true)
    expect(jobs).toEqual([
      { runtimeId: 'a', epoch: 0 },
      { runtimeId: 'b', epoch: 1 },
    ])
    expect((await row(sessionId))?.sessionHomeReclaimedAt).toBeInstanceOf(Date)
  })

  test('moving back starts a newer generation, so the queued old one is not the live home', async () => {
    const sessionId = await conversation('a')

    await move(sessionId, 'b')
    await move(sessionId, 'a')

    expect((await row(sessionId))?.sessionHomeEpoch).toBe(2)
    expect(await queued(sessionId)).toEqual([
      ['a', 0],
      ['b', 1],
    ])
    await reclaimPendingArchiveHome(sessionId)
    expect(jobs.filter((job) => job.runtimeId === 'a')).toEqual([{ runtimeId: 'a', epoch: 0 }])
  })
})

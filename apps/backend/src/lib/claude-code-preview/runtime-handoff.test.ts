// The replica that adopts a handed-off session carries the rest of the turn:
// its output streams on a run clients can attach to and lands in the transcript.
import '@/routes/agent'

import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { getLocalActiveAgentRun } from '@/lib/agent/run-admission'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'
import { autonomous } from '@/routes/agent/chat-preview-autonomous-runs'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { setClaudeCodeAutonomousUpdateHandler } from './agent-chat-runtime'
import {
  HANDOFF_SETTLE_MS,
  adoptRuntimeHandoff,
  adoptRuntimeHandoffs,
  claimRuntimeHandoffs,
} from './runtime-handoff'

import type { OpenAbSessionUpdate } from './openab-acp-client'
import type { RuntimeHandoff } from './runtime-handoff'
import type { TeamPreviewClient } from './team-openab-runtime'

const endpoint = {
  url: 'wss://runtime.invalid/acp',
  authKey: 'k',
  provider: 'claude-code' as const,
}
const attachment = { openabSessionId: 'sess_live', runtimeUrl: endpoint.url }
const noop = () => {}
const stored = new Map<string, string>()
const loads: { session: string; servers: unknown }[] = []
const persisted: { sessionId: string; userId: string; parts: unknown[] }[] = []
let replay: OpenAbSessionUpdate[] = []
let hasAttachment = true
let activeStream: string | null = null
let restoredOwner = false
let emit: (update: OpenAbSessionUpdate) => void = noop
let acquire: ReturnType<typeof spyOn>

const client = {
  loadSession: async (session: string, _cwd: string, servers: unknown) => {
    loads.push({ session, servers })
    for (const update of replay) emit(update)

    return { alive: true }
  },
  cancel: noop,
  onSessionUpdate: (_session: string, handler: (update: OpenAbSessionUpdate) => void) => {
    emit = handler

    return noop
  },
  onSessionPermission: () => noop,
  onClosed: () => noop,
  onRetired: () => noop,
} as unknown as TeamPreviewClient

useRedis({
  redisEnabled: () => activeStream !== null,
  withRedis: (op) =>
    op({
      hgetall: async () => Object.fromEntries(stored),
      hmget: async () => [activeStream, '0', 'actor'],
      get: async () => (activeStream || restoredOwner ? 'live-replica' : null),
      eval: async (_script: string, _count: number, _key: string, field: string, raw: string) =>
        stored.get(field) === raw && stored.delete(field) ? 1 : 0,
      hsetnx: async (_key: string, field: string, value: string) => {
        if (stored.has(field)) return 0
        stored.set(field, value)

        return 1
      },
    } as never),
})
useDb({
  db: () => ({ collection: () => ({ findOne: async () => null, updateOne: async () => ({}) }) }),
})
useAgentDb({
  getConversationBySessionId: async (sessionId: string) => ({
    sessionId,
    teamId: 'team',
    userId: 'owner',
    claudeCodePreview: hasAttachment ? attachment : undefined,
  }),
  getConversationPreviewAttachment: async () => attachment,
  appendAutonomousConversationTurn: async (data: {
    sessionId: string
    userId: string
    message: { parts: unknown[] }
  }) => {
    persisted.push({ sessionId: data.sessionId, userId: data.userId, parts: data.message.parts })
  },
})
useConversationChatRoute({
  resolveConversationChatRuntime: async () => ({ endpoint }),
})

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(5)
}

const handoff = (at: number): RuntimeHandoff => ({
  teamId: 'team',
  conversationId: 'conv',
  ownerUserId: 'owner',
  actorUserId: 'actor',
  locale: 'en-US',
  at,
})

beforeEach(() => {
  stored.clear()
  replay = []
  hasAttachment = true
  activeStream = null
  restoredOwner = false
  loads.length = 0
  persisted.length = 0
  emit = noop
  setClaudeCodeAutonomousUpdateHandler(autonomous.update)
  acquire = spyOn(registry, 'acquire').mockResolvedValue(client)
})
afterEach(() => {
  acquire.mockRestore()
  sessionsByConversation.get('team:conv')?.stopObserving?.()
  sessionsByConversation.delete('team:conv')
})

test('exactly one replica claims a handoff, and only once the old connection had time to go', async () => {
  const now = Date.now()

  stored.set('team:conv', JSON.stringify(handoff(now)))
  expect(await claimRuntimeHandoffs(now)).toEqual([])

  const later = now + HANDOFF_SETTLE_MS
  const [first, second] = await Promise.all([
    claimRuntimeHandoffs(later),
    claimRuntimeHandoffs(later),
  ])

  expect([...first, ...second]).toEqual([handoff(now)])
})

test('each claimed handoff is adopted once', async () => {
  const adopted: string[] = []

  stored.set('team:conv', JSON.stringify(handoff(Date.now() - HANDOFF_SETTLE_MS)))
  await adoptRuntimeHandoffs(async (claimed) => {
    adopted.push(claimed.conversationId)
  })
  await adoptRuntimeHandoffs(async (claimed) => {
    adopted.push(claimed.conversationId)
  })

  expect(adopted).toEqual(['conv'])
})

test('a failed adoption is retried a bounded number of times, never dropped silently', async () => {
  let tries = 0

  stored.set('team:conv', JSON.stringify(handoff(Date.now() - HANDOFF_SETTLE_MS)))
  for (let round = 0; round < 7; round++) {
    await adoptRuntimeHandoffs(async () => {
      tries++
      throw new Error('runtime lookup failed')
    })
  }

  expect(tries).toBe(5)
  expect(stored.size).toBe(0)
})

test('the adopting replica streams and saves the rest of the turn', async () => {
  await adoptRuntimeHandoff(handoff(Date.now()))

  expect(loads).toEqual([{ session: 'sess_live', servers: expect.any(Array) }])
  emit({
    kind: 'agent',
    update: {
      kind: 'runtime-state',
      snapshot: { schemaVersion: 2, state: 'active', phase: 'working' },
    },
  })
  emit({ kind: 'text', text: 'Project created.' })
  await until(() => getLocalActiveAgentRun('owner', 'conv') !== null)

  expect(getLocalActiveAgentRun('owner', 'conv')).not.toBeNull()

  emit({
    kind: 'agent',
    update: { kind: 'runtime-state', snapshot: { schemaVersion: 2, state: 'idle', phase: 'idle' } },
  })
  await until(() => persisted.length > 0)

  expect(getLocalActiveAgentRun('owner', 'conv')).toBeNull()
  expect(persisted).toEqual([
    { sessionId: 'conv', userId: 'owner', parts: [{ type: 'text', text: 'Project created.' }] },
  ])
})

test('crash adoption saves output replayed inside session/resume, under the durable owner', async () => {
  replay = [
    {
      kind: 'agent',
      update: {
        kind: 'runtime-state',
        snapshot: {
          schemaVersion: 2,
          state: 'active',
          phase: 'working',
        },
      },
    },
    { kind: 'text', text: 'Recovered final result.' },
    {
      kind: 'agent',
      update: {
        kind: 'runtime-state',
        snapshot: {
          schemaVersion: 2,
          state: 'idle',
          phase: 'idle',
        },
      },
    },
  ]
  await adoptRuntimeHandoff({ ...handoff(Date.now()), abandonedStreamId: 'dead-stream' })
  await until(() => persisted.length > 0)
  expect(persisted).toEqual([
    {
      sessionId: 'conv',
      userId: 'owner',
      parts: [{ type: 'text', text: 'Recovered final result.' }],
    },
  ])
  expect(getLocalActiveAgentRun('owner', 'conv')).toBeNull()
})

test('crash adoption skips a conversation moved away from its attachment', async () => {
  hasAttachment = false
  await adoptRuntimeHandoff({ ...handoff(Date.now()), abandonedStreamId: 'dead-stream' })
  expect(loads).toEqual([])
})

test('crash adoption never takes output from a newer live run', async () => {
  activeStream = 'new-stream'
  await adoptRuntimeHandoff({ ...handoff(Date.now()), abandonedStreamId: 'dead-stream' })
  expect(loads).toEqual([])
})

test('crash adoption skips an owner restored after failover without its active guard', async () => {
  restoredOwner = true
  await adoptRuntimeHandoff({ ...handoff(Date.now()), abandonedStreamId: 'dead-stream' })
  expect(loads).toEqual([])
  expect(acquire).not.toHaveBeenCalled()
})

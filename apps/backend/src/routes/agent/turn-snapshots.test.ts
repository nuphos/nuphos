import { expect, test } from 'bun:test'

import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useRedis } from '@/lib/test/doubles/redis'

import type { AgentRun } from './types'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

// What the shared store holds, by stream.
let stored = new Map<string, string[]>()

useRedis({ redisEnabled: () => true })
useAgentRunStore({ readRunChannels: async (_userId, streamId) => stored.get(streamId) ?? [] })

const { turnSnapshots } = await import('./turn-snapshots')

const active: SessionExecutionState = { state: 'active', epoch: 'r', revision: 1 }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a channel steered in on another replica reaches the turn’s own snapshots', async () => {
  const run = { userId: 'owner', sessionId: 'agent', streamId: 'turn', channelIds: [] }
  const snapshots = await turnSnapshots(run as unknown as AgentRun, { sessionId: 'agent' })

  // Started from the agent's own chat: no channel shows it typing.
  stored = new Map()
  expect(snapshots.with(active).channelIds).toEqual([])
  await settle()
  // A post in the channel steered this turn, recorded on another replica.
  stored = new Map([['turn', ['channel-a']]])
  snapshots.with(active)
  await settle()
  expect(snapshots.with({ ...active, revision: 2 }).channelIds).toEqual(['channel-a'])
})

test('a read before the turn’s own write lands loses none of its channels', async () => {
  const run = { userId: 'owner', sessionId: 'agent', streamId: 'turn', channelIds: ['channel-a'] }
  const snapshots = await turnSnapshots(run as unknown as AgentRun, { sessionId: 'agent' })

  stored = new Map([['earlier-turn', ['channel-b']]])
  snapshots.with(active)
  await settle()
  expect(snapshots.with(active).channelIds).toEqual(['channel-a'])
  // A finished turn names none.
  expect(snapshots.with({ ...active, state: 'idle' }).channelIds).toBeUndefined()
})

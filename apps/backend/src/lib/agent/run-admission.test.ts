import { afterEach, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useRedis } from '@/lib/test/doubles/redis'

import { agentRuns, claimAgentRunForSession, hasActiveAgentRunForSession } from './run-admission'

import type { AgentRun } from '@/routes/agent/types'

const nodeEnv = config.nodeEnv

// Redis absent: the case the local dev stack always runs in.
useRedis({ redisEnabled: () => false })
useAgentRunStore({
  getActiveAgentRunForSession: async () => null,
  reserveActiveAgentRunForSession: async () => async () => {},
})

function setNodeEnv(value: string) {
  ;(config as { nodeEnv?: string }).nodeEnv = value
}

// This file is the only one that moves nodeEnv, and it shares a bucket with
// tests that read it — so restore it around every case, not just before.
beforeEach(() => setNodeEnv(nodeEnv ?? 'test'))
afterEach(() => setNodeEnv(nodeEnv ?? 'test'))

test('a move without Redis is refused in production and allowed in development', async () => {
  // Redis is the cross-replica lock. Production without it cannot coordinate a
  // move; development runs one replica, so the in-process reservation is the
  // whole coordination and refusing there only made moves untestable locally.
  setNodeEnv('production')
  await expect(claimAgentRunForSession('user', 'session-prod', true)).rejects.toMatchObject({
    code: 'runtime_coordination_unavailable',
  })

  setNodeEnv('development')
  expect(await claimAgentRunForSession('user', 'session-dev', true)).toBeFunction()
})

test('without Redis, a newer runtime-started run does not hide the backend turn holding the session', async () => {
  const run = (streamId: string, createdAt: number, runtimeOwned?: boolean) =>
    ({
      key: streamId,
      streamId,
      sessionId: 'session-mixed',
      userId: 'user',
      createdAt,
      done: false,
      ...(runtimeOwned ? { runtimeOwned } : {}),
    }) as AgentRun

  agentRuns.set('backend', run('backend', 1))
  agentRuns.set('runtime', run('runtime', 2, true))
  try {
    expect(await hasActiveAgentRunForSession('user', 'session-mixed')).toBe(true)
    agentRuns.delete('backend')
    expect(await hasActiveAgentRunForSession('user', 'session-mixed')).toBe(false)
  } finally {
    agentRuns.delete('backend')
    agentRuns.delete('runtime')
  }
})

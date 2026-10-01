import { afterEach, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useRedis } from '@/lib/test/doubles/redis'

import { claimAgentRunForSession } from './run-admission'

const nodeEnv = config.nodeEnv

// Redis absent: the case the local dev stack always runs in.
useRedis({ redisEnabled: () => false })
useAgentRunStore({
  getActiveAgentRunForSession: async () => null,
  reserveActiveAgentRunForSession: async () => () => {},
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

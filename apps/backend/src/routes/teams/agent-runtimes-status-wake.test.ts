import { beforeEach, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { useBoxUpdate } from '@/lib/test/doubles/box-update'
import { useBoxWake } from '@/lib/test/doubles/box-wake'
import { useLocalRuntimePresence } from '@/lib/test/doubles/local-runtime-presence'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import type { TeamAuthVariables } from '@/middleware/auth'

// Run with: cd apps/backend && bun test src/routes/teams/agent-runtimes-status-wake.test.ts

const boxRuntime = localRuntimeId({ userId: 'owner', deviceId: 'box-1', provider: 'codex' })
const woken: (string | undefined)[] = []

useRuntimeCatalog({
  requireRuntimeInstance: async (_teamId, id) => ({ kind: 'local', id }) as never,
})
useBoxUpdate({ boxUpdateStatus: async () => null })
// The Box was paused, so its host reports nothing.
useLocalRuntimePresence({ runtimePresenceStore: () => createMemoryPresenceStore() })
useBoxWake({
  wakeOfflineBox: async (runtimeId) => {
    woken.push(runtimeId)

    return true
  },
})

beforeEach(() => {
  woken.length = 0
})

async function status(query = '') {
  const { Hono } = await import('hono')
  const { registerAgentRuntimeRoutes } = await import('./agent-runtimes')
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamRole', 'EDITOR')
    c.set('teamId', 'team-1')
    c.set('userId', 'owner')
    await next()
  })
  registerAgentRuntimeRoutes(app)
  const response = await app.request(`/agent-runtimes/${boxRuntime}/status${query}`)

  return (await response.json()) as { online: boolean }
}

test('waiting to sign in wakes a paused Box, or the wait never ends', async () => {
  expect((await status('?wake=1')).online).toBe(false)
  expect(woken).toEqual([boxRuntime])
})

test('only looking at a paused Box leaves it paused', async () => {
  await status()
  expect(woken).toEqual([])
})

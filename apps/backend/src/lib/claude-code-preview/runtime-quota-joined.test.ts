import { afterEach, expect, test } from 'bun:test'

import { clearRuntimeQuotaCache, fetchRuntimeQuota } from './runtime-quota'
import { reportedQuota } from './runtime-quota-probe'

import type { RuntimeInstance } from './runtime-instances'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'

const tunnelUrl = 'nuphos-device://runtime/admin/pod-device?team=team-a'
const usageAt = '2026-10-20T00:20:00.000Z'
const claude: RuntimeInstance = {
  id: 'claude-1',
  provider: 'claude-code',
  label: 'Claude',
  status: 'active',
  kind: 'managed',
  createdAt: usageAt,
}

/** What the CLI host reports after reading the account with the agent's own env (CLAUDE_CONFIG_DIR). */
function presence(agent?: { loggedIn: boolean | null; usage?: unknown }) {
  const status = {
    agents: agent
      ? {
          'claude-code': {
            cli: { installed: true, loggedIn: agent.loggedIn },
            ...(agent.usage ? { usage: agent.usage, usageAt } : {}),
          },
        }
      : {},
  }

  return () => Promise.resolve({ conn: 'c1', status } as unknown as LocalRuntimePresence)
}

afterEach(() => {
  clearRuntimeQuotaCache()
})

test('a joined runtime reads its usage from what its host reported, never from the pod', async () => {
  const usage = { five_hour: { utilization: 5, resets_at: '2026-10-20T04:00:00Z' } }

  expect(await reportedQuota(tunnelUrl, presence({ loggedIn: true, usage }))).toEqual({
    usage,
    readAt: usageAt,
  })
})

test('a joined runtime is signed out only when its host says so', async () => {
  expect(await reportedQuota(tunnelUrl, presence({ loggedIn: false }))).toEqual({
    error: 'Sign in required',
    asked: true,
  })
  expect(await reportedQuota(tunnelUrl, presence({ loggedIn: true }))).toEqual({
    error: 'The agent has not reported usage yet',
  })
})

test('a joined runtime whose host is not connected is offline', async () => {
  expect(await reportedQuota(tunnelUrl, () => Promise.resolve(null))).toEqual({
    error: 'Agent is offline',
    offline: true,
  })
  expect(await reportedQuota(tunnelUrl, presence())).toEqual({
    error: 'Agent is offline',
    offline: true,
  })
})

test('the reading is normalized at the instant the host read it', async () => {
  const quota = await fetchRuntimeQuota('team-a', claude, () => 1_000, {
    probe: () =>
      Promise.resolve({
        usage: { five_hour: { utilization: 5, resets_at: '2026-10-20T04:00:00Z' } },
        readAt: usageAt,
      }),
  })

  expect(quota.fetchedAt).toBe(usageAt)
  expect(quota.available).toBe(true)
})

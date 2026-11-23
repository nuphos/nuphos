import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useObservability } from '@/lib/test/doubles/observability'
import { useRedis } from '@/lib/test/doubles/redis'

import { boxUpdateSweepDeps, startBoxUpdateSweep, sweepBoxUpdates } from './box-update-sweep'

import type { UpdateSweepDeps } from './box-update-sweep'
import type { LocalRuntimeStatus } from './local-runtime/protocol'

const events: string[] = []

useObservability({
  logEvent: (_level, event) => {
    events.push(event)
  },
  logError: (event) => {
    events.push(event)
  },
})

// One claim store, as Redis is: the first claim of a key wins until reset.
const claimed = new Set<string>()
const claim = (key: string) => {
  if (claimed.has(key)) return Promise.resolve(false)
  claimed.add(key)

  return Promise.resolve(true)
}

useRedis({ claimRun: claim })

const saved = { ...config.box }
const now = Date.parse('2026-11-22T12:00:00Z')
const idle = now - 11 * 60_000

type Host = { cliVersion?: string; autoInstall?: boolean; usedAt?: number; busy?: boolean }

/** A sweep over these Boxes, keyed by device id; returns the devices it updated. */
async function sweep(hosts: Record<string, Host>, overrides: Partial<UpdateSweepDeps> = {}) {
  const updated: string[] = []
  const deps: UpdateSweepDeps = {
    running: async () =>
      Object.keys(hosts).map((deviceId) => ({ teamId: 't1', userId: 'u1', deviceId })),
    presence: async (_userId, deviceId) => {
      const { cliVersion, autoInstall, usedAt } = hosts[deviceId]!

      return {
        conn: 'c1',
        seenAt: now,
        status: { cliVersion, autoInstall, agents: {} } as unknown as LocalRuntimeStatus,
        usedAt,
      }
    },
    busy: async (_teamId, { deviceId }) => Boolean(hosts[deviceId]!.busy),
    claim: (deviceId, version) => claim(`once:${deviceId}:${version}`),
    update: async ({ deviceId }) => {
      updated.push(deviceId)
    },
    ...overrides,
  }

  claimed.delete('agent:box-update-sweep')
  await sweepBoxUpdates(now, deps)

  return updated
}

beforeEach(() => {
  events.length = 0
  claimed.clear()
  config.box.instabox = { apiKey: 'ibk_test' }
  config.box.autoUpdate = true
})

afterEach(() => {
  Object.assign(config.box, saved)
})

describe('Box update sweep', () => {
  test('updates an idle Box on a CLI that does not update itself', async () => {
    expect(
      await sweep({
        old: { cliVersion: '0.27.4', usedAt: idle },
        current: { cliVersion: '0.28.0', usedAt: idle },
        preview: { cliVersion: '0.27.5-beta.1', usedAt: idle },
        unknown: { usedAt: idle },
      }),
    ).toEqual(['old'])
    expect(events).toEqual(['agent.box.auto_update_started'])
  })

  test('leaves a Box in use, mid-turn or never used', async () => {
    expect(
      await sweep({
        recent: { cliVersion: '0.27.4', usedAt: now - 9 * 60_000 },
        busy: { cliVersion: '0.27.4', usedAt: idle, busy: true },
        unused: { cliVersion: '0.27.4' },
      }),
    ).toEqual([])
  })

  test('leaves a host that turned autoInstall off', async () => {
    expect(
      await sweep({
        off: { cliVersion: '0.27.4', autoInstall: false, usedAt: idle },
        old: { cliVersion: '0.19.9', autoInstall: false, usedAt: idle },
      }),
    ).toEqual([])
  })

  test('updates at most three Boxes a sweep', async () => {
    const hosts = Object.fromEntries(
      ['a', 'b', 'c', 'd'].map((id) => [id, { cliVersion: '0.27.4', usedAt: idle }]),
    )

    expect(await sweep(hosts)).toEqual(['a', 'b', 'c'])
    expect(await sweep(hosts)).toEqual(['d'])
  })

  test('tries each version once: a failed update is not retried', async () => {
    const hosts = { old: { cliVersion: '0.27.4', usedAt: idle } }

    expect(await sweep(hosts, { update: () => Promise.reject(new Error('paused')) })).toEqual([])
    expect(events).toEqual(['agent.box.auto_update_failed'])
    expect(await sweep(hosts)).toEqual([])
  })

  test('does not start when switched off', () => {
    const schedule = spyOn(globalThis, 'setInterval')

    config.box.autoUpdate = false
    startBoxUpdateSweep()()
    expect(schedule).not.toHaveBeenCalled()
    config.box.autoUpdate = true
    startBoxUpdateSweep()()
    expect(schedule).toHaveBeenCalledTimes(1)
    schedule.mockRestore()
  })

  test('without Redis, a replica still tries each version once', async () => {
    expect(await boxUpdateSweepDeps.claim('d1', '0.27.4')).toBe(true)
    claimed.clear() // Redis forgot it, or there is none
    expect(await boxUpdateSweepDeps.claim('d1', '0.27.4')).toBe(false)
    expect(await boxUpdateSweepDeps.claim('d1', '0.27.5')).toBe(true)
  })
})

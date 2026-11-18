import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'
import { useObservability } from '@/lib/test/doubles/observability'

import { IDLE_PAUSE_MS, assertFreeAllowance, monthStart, vcpuHours } from './box-free'
import { sweepFreeBoxes } from './box-free-sweep'

import type { FreeSweepDeps } from './box-free-sweep'

const events: string[] = []

useObservability({
  logEvent: (_level, event) => {
    events.push(event)
  },
})

const saved = { ...config.box }
const now = Date.parse('2026-11-18T12:00:00Z')
const at = (iso: string) => new Date(`2026-11-${iso}Z`)

beforeEach(() => {
  events.length = 0
  config.box.instabox = { apiKey: 'ibk_test' }
  config.box.defaultVcpuLimit = 2
  config.box.defaultMonthlyHours = 50
})

afterEach(() => {
  Object.assign(config.box, saved)
  delete config.box.defaultMonthlyHours
})

describe('free Box hours', () => {
  test('the month starts at midnight UTC on the first', () => {
    expect(new Date(monthStart(now)).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  test('the reading before the window holds until the first sample in it', () => {
    const from = at('18T00:00:00').getTime()
    const rows = [
      { usedVcpus: 0, at: at('18T01:00:00') },
      { usedVcpus: 4, at: at('18T03:00:00') },
    ]

    // 2 vCPU for 1 h, nothing for 2 h, 4 vCPU for 1 h.
    expect(
      vcpuHours({ usedVcpus: 2, at: at('17T00:00:00') }, rows, from, from + 4 * 3_600_000),
    ).toBe(6)
    expect(vcpuHours(null, [], from, from + 3_600_000)).toBe(0)
  })
})

const used = (hours: number) => () => Promise.resolve(hours)

describe('free Box allowance', () => {
  test('a second Box is refused, a start within the hours is not', async () => {
    await expect(assertFreeAllowance('t1', 1, true, now, used(0))).rejects.toMatchObject({
      status: 402,
      code: 'box_vcpu_limit',
    })
    await assertFreeAllowance('t1', 0, true, now, used(99))
    await assertFreeAllowance('t1', 1, false, now, used(99))
  })

  test('a start after the month’s hours is refused until the next month', async () => {
    const refused = assertFreeAllowance('t1', 1, false, now, used(100))

    await expect(refused).rejects.toMatchObject({ status: 402, code: 'box_vcpu_limit' })
    await expect(refused).rejects.toThrow(/50 hours this month.*2026-12-01/)
  })

  test('without the setting nothing is refused', async () => {
    delete config.box.defaultMonthlyHours
    await assertFreeAllowance('t1', 3, true, now, used(1_000))
  })
})

function deps(over: Partial<FreeSweepDeps> = {}) {
  const paused: string[] = []
  const noted: string[] = []

  return {
    paused,
    noted,
    deps: {
      running: () =>
        Promise.resolve([
          { teamId: 'free', userId: 'u1', deviceId: 'idle' },
          { teamId: 'free', userId: 'u1', deviceId: 'busy' },
          { teamId: 'free', userId: 'u1', deviceId: 'unjoined' },
          { teamId: 'paid', userId: 'u2', deviceId: 'paid-idle' },
        ]),
      subscribed: () => Promise.resolve(new Set(['paid'])),
      monthVcpuHours: () => Promise.resolve(10),
      usedAt: (_userId: string, deviceId: string) =>
        Promise.resolve(
          (
            { idle: now - IDLE_PAUSE_MS, busy: now - 60_000, 'paid-idle': 0 } as Record<
              string,
              number | undefined
            >
          )[deviceId],
        ),
      pause: (_userId: string, deviceId: string) => {
        paused.push(deviceId)

        return Promise.resolve()
      },
      noteUsage: (teamId: string) => {
        noted.push(teamId)
      },
      ...over,
    } satisfies FreeSweepDeps,
  }
}

describe('free Box sweep', () => {
  test('pauses a free Box nobody used for the idle time, and no other', async () => {
    const { deps: d, paused, noted } = deps()

    await sweepFreeBoxes(now, d)
    expect(paused).toEqual(['idle'])
    expect(noted).toEqual(['free'])
    expect(events).toEqual(['agent.box.free_paused'])
  })

  test('pauses every running free Box once the hours are used', async () => {
    const { deps: d, paused } = deps({ monthVcpuHours: () => Promise.resolve(100) })

    await sweepFreeBoxes(now, d)
    expect(paused).toEqual(['idle', 'busy', 'unjoined'])
  })

  test('does nothing without the setting', async () => {
    delete config.box.defaultMonthlyHours
    const { deps: d, paused } = deps()

    await sweepFreeBoxes(now, d)
    expect(paused).toEqual([])
  })
})

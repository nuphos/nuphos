import { describe, expect, test } from 'bun:test'

import { botPresence, botRuntimes } from './bot-presence'

import type { RuntimeInstance } from '@/lib/claude-code-preview/runtime-instances'

const RESETS = '2026-11-17T18:00:00.000Z'

const cloud: RuntimeInstance = {
  id: 'cloud-1',
  provider: 'claude-code',
  label: 'Claude Code',
  status: 'active',
  kind: 'external',
  createdAt: '2026-11-01T00:00:00.000Z',
}
const computer = (local: Partial<NonNullable<RuntimeInstance['local']>> = {}): RuntimeInstance => ({
  ...cloud,
  id: 'local_owner_mac_claude-code',
  kind: 'local',
  local: {
    ownerUserId: 'owner',
    deviceId: 'mac',
    deviceLabel: 'Mac',
    online: true,
    signedIn: true,
    ...local,
  },
})
const presence = (runtime: Parameters<typeof botPresence>[0]['runtime'], busy = false) =>
  botPresence({ ownerRemoved: false, runtime, busy })

describe('a Bot that can reply', () => {
  test('is online, and busy while a turn of its runs', () => {
    expect(presence({ instance: computer() })).toEqual({ state: 'online' })
    expect(presence({ instance: computer() }, true)).toEqual({ state: 'busy' })
  })

  test('on a cloud runtime or the team default, is online', () => {
    expect(presence({ instance: cloud })).toEqual({ state: 'online' })
    expect(presence(null)).toEqual({ state: 'online' })
  })
})

describe('a Bot that cannot reply is offline, with why', () => {
  test('its owner has left the team', () => {
    expect(
      botPresence({ ownerRemoved: true, runtime: { instance: computer() }, busy: false }),
    ).toEqual({
      state: 'offline',
      reason: 'owner_removed',
    })
  })

  test('its runtime, or the computer it ran on, is gone', () => {
    expect(presence({})).toEqual({ state: 'offline', reason: 'runtime_deleted' })
  })

  test('its runtime is disabled or being deleted', () => {
    expect(presence({ instance: { ...cloud, status: 'disabled' } })).toEqual({
      state: 'offline',
      reason: 'runtime_disabled',
    })
    expect(presence({ instance: { ...cloud, deletion: { state: 'deleting' } } })).toEqual({
      state: 'offline',
      reason: 'runtime_disabled',
    })
  })

  test('its computer is offline, even mid-turn', () => {
    expect(presence({ instance: computer({ online: false }) }, true)).toEqual({
      state: 'offline',
      reason: 'computer_offline',
    })
  })

  test('its agent needs a new sign-in', () => {
    expect(presence({ instance: computer({ signedIn: false }) })).toEqual({
      state: 'offline',
      reason: 'sign_in_required',
    })
  })

  test('its usage is used up, with when it comes back', async () => {
    const instance = computer({ usage: { five_hour: { utilization: 100, resets_at: RESETS } } })
    const [runtime] = await botRuntimes(
      'team',
      [{ userId: 'owner', runtimeId: instance.id }],
      async () => [instance],
    )

    expect(presence(runtime ?? null)).toEqual({
      state: 'offline',
      reason: 'usage_limit',
      resetsAt: RESETS,
    })
  })
})

describe('a Codex Bot past its window, on credits', () => {
  const codexOn = async (credits: Record<string, boolean>) => {
    const instance = {
      ...computer({
        usage: {
          plan_type: 'pro',
          rate_limit: {
            allowed: false,
            limit_reached: true,
            primary_window: { used_percent: 100, limit_window_seconds: 604_800 },
          },
          credits,
        },
      }),
      id: 'local_owner_mac_codex',
      provider: 'codex' as const,
    }
    const [runtime] = await botRuntimes(
      'team',
      [{ userId: 'owner', runtimeId: instance.id }],
      async () => [instance],
    )

    return runtime ?? null
  }

  test('still replies, so is online, and busy while it runs', async () => {
    const runtime = await codexOn({ has_credits: true, overage_limit_reached: false })

    expect(presence(runtime)).toEqual({ state: 'online' })
    expect(presence(runtime, true)).toEqual({ state: 'busy' })
  })

  test('is out of usage once the credits are gone too', async () => {
    for (const credits of [
      { has_credits: false, overage_limit_reached: false },
      { has_credits: true, overage_limit_reached: true },
    ]) {
      expect(presence(await codexOn(credits))).toMatchObject({
        state: 'offline',
        reason: 'usage_limit',
      })
    }
  })
})

describe("the Bots' runtimes", () => {
  test("read each owner's list once, and find what is gone", async () => {
    const reads: string[] = []
    const runtimes = await botRuntimes(
      'team',
      [
        { userId: 'owner', runtimeId: 'cloud-1' },
        { userId: 'owner', runtimeId: 'deleted' },
        { userId: 'other' },
      ],
      async (_team, userId) => {
        reads.push(userId ?? '')

        return [cloud]
      },
    )

    expect(reads).toEqual(['owner'])
    expect(runtimes).toEqual([{ instance: cloud }, {}, null])
  })
})

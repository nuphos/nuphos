import { describe, expect, test } from 'bun:test'

import { BOX_UPDATE_WINDOW_MS, boxUpdatingSince } from './box-updating'

import type { AgentDevice } from './store'

// Run with: cd apps/backend && bun test src/lib/agent/devices/box-updating.test.ts

const startedAt = new Date('2026-10-21T08:00:00Z')
const box = (fields: Partial<AgentDevice> = {}) =>
  ({
    deviceId: 'b1',
    box: { provider: 'instabox', teamId: 't1', sandboxId: 'm_b1', updateStartedAt: startedAt },
    ...fields,
  }) as AgentDevice
const now = startedAt.getTime() + 60_000

describe('Box updating', () => {
  test('an update is underway until the host reports in after it started', () => {
    expect(boxUpdatingSince(box({ lastSeenAt: new Date(startedAt.getTime() - 1) }), now)).toEqual(
      startedAt,
    )
    expect(boxUpdatingSince(box(), now)).toEqual(startedAt)
    expect(boxUpdatingSince(box({ lastSeenAt: new Date(now) }), now)).toBeUndefined()
  })

  test('an update whose host never came back ends with its window, and a Box never updated is not updating', () => {
    expect(boxUpdatingSince(box(), startedAt.getTime() + BOX_UPDATE_WINDOW_MS + 1)).toBeUndefined()
    expect(
      boxUpdatingSince(box({ box: { provider: 'instabox', teamId: 't1' } }), now),
    ).toBeUndefined()
  })
})

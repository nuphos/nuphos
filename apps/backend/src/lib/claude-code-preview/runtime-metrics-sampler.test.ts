import { describe, expect, test } from 'bun:test'

import { localRuntimeId, parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'

import { deviceMetricsRuntimeId, sampleBucket } from './runtime-metrics-store'

describe('sampleBucket', () => {
  test('floors to the sampling interval so replicas agree on the row', () => {
    const t = Date.UTC(2026, 8, 12, 6, 0, 44)

    expect(sampleBucket(t).toISOString()).toBe('2026-09-12T06:00:30.000Z')
    expect(sampleBucket(t + 15_999).toISOString()).toBe('2026-09-12T06:00:30.000Z')
    expect(sampleBucket(t + 16_000).toISOString()).toBe('2026-09-12T06:01:00.000Z')
  })
})

describe('deviceMetricsRuntimeId', () => {
  test('every agent on one computer reads the same series', () => {
    const ids = [
      localRuntimeId({ userId: 'u1', deviceId: 'd1', provider: 'claude-code' }),
      localRuntimeId({ userId: 'u1', deviceId: 'd1', provider: 'codex' }),
      localRuntimeId({
        userId: 'u1',
        deviceId: 'd1',
        provider: 'claude-code',
        instanceId: '15e543bd-1cb1-46ea-8142-cd32dec98926',
      }),
    ]

    for (const id of ids) {
      const ref = parseLocalRuntimeId(id)

      expect(ref && deviceMetricsRuntimeId(ref.userId, ref.deviceId)).toBe(
        deviceMetricsRuntimeId('u1', 'd1'),
      )
    }
    expect(deviceMetricsRuntimeId('u1', 'd2')).not.toBe(deviceMetricsRuntimeId('u1', 'd1'))
  })
})

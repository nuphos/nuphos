import { describe, expect, test } from 'bun:test'

import { sampleBucket } from './runtime-metrics-store'
import { runtimeServiceName } from './runtime-service-name'

describe('runtimeServiceName', () => {
  test('reads the Service behind a provisioner URL in the managed namespace', () => {
    expect(
      runtimeServiceName('ws://openab-team-abc.openab-runtimes.svc:8080/acp', 'openab-runtimes'),
    ).toBe('openab-team-abc')
    expect(
      runtimeServiceName(
        'ws://openab-claude-1.openab-runtimes.svc.cluster.local:8080/acp',
        'openab-runtimes',
      ),
    ).toBe('openab-claude-1')
  })

  test('ignores runtimes in another namespace or outside the cluster', () => {
    expect(
      runtimeServiceName(
        'ws://openab-team-abc.openab-runtimes-dev.svc:8080/acp',
        'openab-runtimes',
      ),
    ).toBeNull()
    expect(runtimeServiceName('wss://runtime.example.com/acp', 'openab-runtimes')).toBeNull()
    expect(runtimeServiceName('not a url', 'openab-runtimes')).toBeNull()
  })
})

describe('sampleBucket', () => {
  test('floors to the sampling interval so replicas agree on the row', () => {
    const t = Date.UTC(2026, 8, 12, 6, 0, 44)

    expect(sampleBucket(t).toISOString()).toBe('2026-09-12T06:00:30.000Z')
    expect(sampleBucket(t + 15_999).toISOString()).toBe('2026-09-12T06:00:30.000Z')
    expect(sampleBucket(t + 16_000).toISOString()).toBe('2026-09-12T06:01:00.000Z')
  })
})

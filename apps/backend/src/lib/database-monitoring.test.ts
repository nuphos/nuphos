import { describe, expect, test } from 'bun:test'
import { Long } from 'mongodb'

import {
  finiteNumber,
  mongoMonitoringRates,
  normalizeMongoReplication,
  normalizeMongoServerStatus,
} from './database-monitoring'

describe('MongoDB monitoring normalization', () => {
  test('extracts bounded numeric metrics without retaining raw server status', () => {
    const normalized = normalizeMongoServerStatus({
      process: 'mongod',
      uptime: 120,
      connections: { current: 8, available: 92, totalCreated: Long.fromNumber(120) },
      opcounters: { query: 20, insert: 4, update: 3, delete: 2, command: 40 },
      opLatencies: {
        reads: { latency: 2_000, ops: 20 },
        writes: { latency: 900, ops: 9 },
        commands: { latency: 4_000, ops: 40 },
      },
      network: { bytesIn: 4_096, bytesOut: 8_192, numRequests: 60 },
      mem: { resident: 128, virtual: 512 },
      wiredTiger: {
        cache: {
          'bytes currently in the cache': 1_000,
          'maximum bytes configured': 4_000,
          'tracked dirty bytes in the cache': 100,
          'pages read into cache': 12,
          'pages written from cache': 8,
        },
      },
      globalLock: { currentQueue: { readers: 1, writers: 2 } },
      secret: 'must-not-be-retained',
    })

    expect(normalized.process).toBe('mongod')
    expect(normalized.metrics.connectionsCurrent).toBe(8)
    expect(normalized.metrics.memoryResidentBytes).toBe(128 * 1024 * 1024)
    expect(normalized.metrics.wiredTigerCacheBytes).toBe(1_000)
    expect(normalized.metrics.queueWriters).toBe(2)
    expect(normalized.capabilities).toEqual({
      serverStatus: 'available',
      wiredTiger: 'available',
      opLatencies: 'available',
      queues: 'available',
    })
    expect(JSON.stringify(normalized)).not.toContain('must-not-be-retained')
  })

  test('does not turn unavailable metrics into zero', () => {
    const normalized = normalizeMongoServerStatus({ process: 'mongos', connections: {} })

    expect(normalized.metrics.connectionsCurrent).toBeNull()
    expect(normalized.metrics.wiredTigerCacheBytes).toBeNull()
    expect(normalized.capabilities.wiredTiger).toBe('unsupported')
    expect(normalized.capabilities.opLatencies).toBe('unsupported')
  })

  test('uses tcmalloc memory counters when newer MongoDB omits mem', () => {
    const normalized = normalizeMongoServerStatus({
      process: 'mongod',
      tcmalloc: {
        generic: {
          physical_memory_used: 170_805_526,
          virtual_memory_used: 171_788_566,
        },
      },
    })

    expect(normalized.metrics.memoryResidentBytes).toBe(170_805_526)
    expect(normalized.metrics.memoryVirtualBytes).toBe(171_788_566)
  })

  test('calculates replica lag from primary optime and caps member metadata', () => {
    const primary = new Date('2026-07-17T03:00:10.000Z')
    const secondary = new Date('2026-07-17T03:00:07.500Z')
    const normalized = normalizeMongoReplication({
      members: [
        { name: 'mongo-0.internal:27017', stateStr: 'PRIMARY', health: 1, optimeDate: primary },
        {
          name: 'mongo-1.internal:27017',
          stateStr: 'SECONDARY',
          health: 1,
          optimeDate: secondary,
          self: true,
        },
      ],
    })

    expect(normalized.lagSeconds).toBe(2.5)
    expect(normalized.healthyMemberCount).toBe(2)
    expect(normalized.members[1]).toMatchObject({ state: 'SECONDARY', self: true, lagSeconds: 2.5 })
  })

  test('derives rates and interval latency from cumulative counters', () => {
    const base = normalizeMongoServerStatus({
      opcounters: { query: 100, insert: 10, update: 10, delete: 5, command: 200 },
      opLatencies: {
        reads: { latency: 10_000, ops: 100 },
        writes: { latency: 2_000, ops: 20 },
        commands: { latency: 20_000, ops: 200 },
      },
      network: { bytesIn: 1_000, bytesOut: 2_000 },
    }).metrics
    const current = normalizeMongoServerStatus({
      opcounters: { query: 120, insert: 12, update: 13, delete: 6, command: 240 },
      opLatencies: {
        reads: { latency: 14_000, ops: 120 },
        writes: { latency: 2_900, ops: 26 },
        commands: { latency: 28_000, ops: 240 },
      },
      network: { bytesIn: 3_000, bytesOut: 6_000 },
    }).metrics
    const rates = mongoMonitoringRates(
      { sampledAt: new Date('2026-07-17T03:00:10Z'), metrics: current },
      { sampledAt: new Date('2026-07-17T03:00:00Z'), metrics: base },
    )

    expect(rates.queryPerSecond).toBe(2)
    expect(rates.bytesOutPerSecond).toBe(400)
    expect(rates.readLatencyMicros).toBe(200)
    expect(rates.writeLatencyMicros).toBe(150)
  })

  test('refuses unsafe numeric conversions', () => {
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBeNull()
    expect(finiteNumber(2n ** 63n)).toBeNull()
  })
})

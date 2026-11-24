import { describe, expect, test } from 'bun:test'

import { lastPausedBy, machineFull } from './instabox-machines'

/** A connection whose instabox answers the machine's operation log with these operations. */
const answering = (operations: unknown[], seen: string[] = []) => ({
  apiKey: 'k',
  apiUrl: 'https://instabox.test',
  fetch: ((url: string) => {
    seen.push(url)

    return Promise.resolve(Response.json({ machineId: 'm1', state: 'suspended', operations }))
  }) as typeof fetch,
})

const op = (type: string, trigger?: string, state = 'succeeded') => ({
  type,
  state,
  ...(trigger ? { trigger } : {}),
})

describe("the reason instabox gives for a machine's last pause", () => {
  test('is the trigger of a pause instabox started itself', async () => {
    const seen: string[] = []

    expect(
      await lastPausedBy(answering([op('resume'), op('suspend', 'memory_pressure')], seen), 'm1'),
    ).toBe('memory_pressure')
    expect(seen).toEqual(['https://instabox.test/v1/machines/m1/logs?tail=1'])
  })

  test('is absent when a client asked for the pause', async () => {
    expect(await lastPausedBy(answering([op('suspend')]), 'm1')).toBeUndefined()
  })

  test('is absent once the machine was resumed since', async () => {
    expect(
      await lastPausedBy(answering([op('suspend', 'memory_pressure'), op('resume')]), 'm1'),
    ).toBeUndefined()
  })

  test('is absent for a pause that failed', async () => {
    expect(
      await lastPausedBy(answering([op('suspend', 'memory_pressure', 'failed')]), 'm1'),
    ).toBeUndefined()
  })
})

/** A connection whose instabox answers the machine's metrics with these samples. */
const sampling = (metrics: unknown[], seen: string[] = []) => ({
  apiKey: 'k',
  apiUrl: 'https://instabox.test',
  fetch: ((url: string) => {
    seen.push(url)

    return Promise.resolve(Response.json({ metrics }))
  }) as typeof fetch,
})

const GiB = 1024 ** 3
const sample = (cpuUsedPct: number, memUsedGiB: number) => ({
  timestamp: '2026-11-24T00:30:00Z',
  cpuUsedPct,
  cpuCount: 8,
  memUsed: memUsedGiB * GiB,
  memTotal: 16 * GiB,
})

describe('whether a machine has run out of CPU or memory, from its latest instabox sample', () => {
  test('is full when both are', async () => {
    const seen: string[] = []

    expect(await machineFull(sampling([sample(50, 12), sample(100, 15.6)], seen), 'm1')).toBe(true)
    expect(seen).toEqual(['https://instabox.test/v1/machines/m1/metrics'])
  })

  test('is full when either is', async () => {
    expect(await machineFull(sampling([sample(97, 8)]), 'm1')).toBe(true)
    expect(await machineFull(sampling([sample(20, 15.5)]), 'm1')).toBe(true)
  })

  test('is not full when the latest sample has headroom, even after a full one', async () => {
    expect(await machineFull(sampling([sample(100, 15.8), sample(70, 12.3)]), 'm1')).toBe(false)
  })

  test('is not full without samples', async () => {
    expect(await machineFull(sampling([]), 'm1')).toBe(false)
  })
})

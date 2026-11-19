import { describe, expect, test } from 'bun:test'

import { lastPausedBy } from './instabox-machines'

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

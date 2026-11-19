import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { useRedis } from '@/lib/test/doubles/redis'

// What the resume answers, also fed to Desktop's stream consumer in its chat-read test.
import expected from './expired-resume-frames.json'

// The run's buffer and owner live in a real Redis, as in production; CI sets TEST_REDIS_URL.
const client = process.env.TEST_REDIS_URL ? new Redis(process.env.TEST_REDIS_URL) : null

useRedis({
  redisEnabled: () => Boolean(client),
  withRedis: (async (op: (redis: unknown) => unknown) => (client ? op(client) : null)) as never,
  getRedis: (() => client) as never,
})

const { mirrorAgentRunFrame, startAgentRunOwnership, streamAgentRunFromRedis } =
  await import('../run-store')
const { streamKey } = await import('./shared')

afterAll(() => client?.disconnect())

const frame = (data: Record<string, unknown>) => `data: ${JSON.stringify(data)}\n\n`

/** Every SSE frame the resume answered with, parsed. */
async function frames(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text()

  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as Record<string, unknown>)
}

// #3713: a client dropped after 11 frames, the run finished, and its buffer expired.
describe.skipIf(!client)('a resume of a run whose buffer expired', () => {
  test('answers at once that the stream is gone, without the attach grace', async () => {
    const userId = `resume-expired-${randomUUID()}`
    const streamId = randomUUID()
    const release = startAgentRunOwnership(userId, 'session', streamId)

    for (let i = 0; i < 20; i++) mirrorAgentRunFrame(userId, streamId, frame({ type: 'text', i }))
    mirrorAgentRunFrame(userId, streamId, frame({ type: 'atlas-stream-done' }))
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await client?.exists(streamKey(userId, streamId))).toBe(1)
    // The finished run's buffer outlived its reconnect window.
    await client?.del(streamKey(userId, streamId))

    const started = Date.now()
    const response = await streamAgentRunFromRedis(userId, streamId, 11)
    const answered = await frames(response ?? new Response(''))

    expect(Date.now() - started).toBeLessThan(2_000)
    expect(answered).toHaveLength(expected.length)
    expected.forEach((frame, i) => expect(answered[i]).toMatchObject(frame))
  }, 10_000)
})

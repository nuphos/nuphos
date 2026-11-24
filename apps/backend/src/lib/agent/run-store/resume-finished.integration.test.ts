import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { useRedis } from '@/lib/test/doubles/redis'

// The run's buffer and owner live in a real Redis, as in production; CI sets TEST_REDIS_URL.
const client = process.env.TEST_REDIS_URL ? new Redis(process.env.TEST_REDIS_URL) : null

useRedis({
  redisEnabled: () => Boolean(client),
  withRedis: (async (op: (redis: unknown) => unknown) => (client ? op(client) : null)) as never,
  getRedis: (() => client) as never,
})

const { mirrorAgentRunFrame, startAgentRunOwnership, streamAgentRunFromRedis } =
  await import('../run-store')

afterAll(() => client?.disconnect())

const frame = (data: Record<string, unknown>) => `data: ${JSON.stringify(data)}\n\n`

/** Every SSE data frame the resume answered with, parsed. */
async function frames(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text()

  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as Record<string, unknown>)
}

// #4924: Desktop waits for a turn to end by resuming past its last frame. When the run has
// just finished, that resume must end with the done frame, not an owner_abandoned error.
describe.skipIf(!client)('a resume past the end of a finished run', () => {
  test('ends at once with the done frame', async () => {
    const userId = `resume-finished-${randomUUID()}`
    const streamId = randomUUID()
    const release = startAgentRunOwnership(userId, 'session', streamId)

    for (let i = 0; i < 3; i++) mirrorAgentRunFrame(userId, streamId, frame({ type: 'text', i }))
    mirrorAgentRunFrame(userId, streamId, frame({ type: 'atlas-stream-done' }))
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const started = Date.now()
    const response = await streamAgentRunFromRedis(userId, streamId, Number.MAX_SAFE_INTEGER)

    expect(await frames(response ?? new Response(''))).toEqual([{ type: 'atlas-stream-done' }])
    expect(Date.now() - started).toBeLessThan(2_000)
  }, 15_000)
})

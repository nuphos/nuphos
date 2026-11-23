import { expect, test } from 'bun:test'

import { real, useRedis } from '@/lib/test/doubles/redis'

import type { StreamResumeContext } from './stream-phases'
import type { RedisOptions } from 'ioredis'

let tailOptions: RedisOptions | undefined
let closeState: (() => void) | undefined

useRedis({
  getRedis: () =>
    ({
      duplicate(override: RedisOptions) {
        tailOptions = override

        return {
          on: () => {},
          disconnect: () => {},
          // One empty BLOCK, then the reader goes away.
          xread: async () => {
            closeState?.()

            return null
          },
        }
      },
    }) as never,
})

const { tailAgentRunStream } = await import('./stream-phases')

test('the blocking tail connection has no socket timeout', async () => {
  const state = {
    closed: false,
    lastId: '0',
    sawDone: false,
    ownerSeenAt: 0,
    emittedFrames: 0,
    emittedBytes: 0,
    heartbeatCount: 0,
  }
  const ctx: StreamResumeContext = {
    key: 'k',
    oKey: 'k:owner',
    startIndex: 0,
    startedAt: Date.now(),
    trace: undefined,
    state,
    emit: () => {},
    close: () => {},
  }

  closeState = () => {
    state.closed = true
  }
  await tailAgentRunStream(ctx)

  // An idle XREAD BLOCK receives nothing until it ends, so the shared client's
  // socket timeout would drop this connection on every empty block.
  const options = { socketTimeout: real.REDIS_SOCKET_TIMEOUT_MS, ...tailOptions }

  expect(real.REDIS_SOCKET_TIMEOUT_MS).toBeGreaterThan(0)
  expect(options.socketTimeout).toBeUndefined()
})

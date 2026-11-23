import { expect, test } from 'bun:test'

import { useObservability } from '@/lib/test/doubles/observability'
import { real, useRedis } from '@/lib/test/doubles/redis'

import type { StreamResumeContext } from './stream-phases'
import type { RedisOptions } from 'ioredis'

let tailOptions: RedisOptions | undefined
let closeState: (() => void) | undefined

const logged: { level: string; event: string }[] = []

useObservability({
  logEvent: (level: string, event: string) => {
    logged.push({ level, event })
  },
})
useRedis({
  // No stream and no owner: the run's buffer is gone.
  withRedis: (async () => [0, null, []]) as never,
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

const { backfillAgentRunHistory, tailAgentRunStream } = await import('./stream-phases')

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

function resumeFrom(startIndex: number): StreamResumeContext {
  const state = {
    closed: false,
    lastId: '0',
    sawDone: false,
    ownerSeenAt: 0,
    emittedFrames: 0,
    emittedBytes: 0,
    heartbeatCount: 0,
  }

  return {
    key: 'k',
    oKey: 'k:owner',
    startIndex,
    startedAt: Date.now(),
    trace: undefined,
    state,
    emit: () => {},
    close: () => {
      state.closed = true
    },
  }
}

const missing = () =>
  logged.filter((entry) => entry.event === 'agent.run.redis_resume.stream_missing_after_wait')

test('a resume of a finished run whose buffer expired is a warning, not an error', async () => {
  // A client resuming after the finished run's buffer expired is told the stream is gone,
  // as expected; it is no fault to alert on.
  logged.length = 0
  await backfillAgentRunHistory(resumeFrom(11))

  expect(missing()).toEqual([
    { level: 'warn', event: 'agent.run.redis_resume.stream_missing_after_wait' },
  ])
})

test('a run that never registered its stream is still an error', async () => {
  logged.length = 0
  await backfillAgentRunHistory(resumeFrom(0))

  expect(missing()).toEqual([
    { level: 'error', event: 'agent.run.redis_resume.stream_missing_after_wait' },
  ])
})

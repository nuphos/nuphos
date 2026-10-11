import type Redis from 'ioredis'

// ioredis keeps a half-open socket "connected" indefinitely. Count op timeouts
// in a row so the caller can drop the socket and let the retry strategy
// reconnect.
export const REDIS_WEDGE_TIMEOUT_THRESHOLD = 5

export const REDIS_OP_TIMEOUT_MESSAGE = 'redis op timeout'

export function createRedisWedgeDetector(
  onWedge: () => void,
  threshold = REDIS_WEDGE_TIMEOUT_THRESHOLD,
) {
  let consecutiveTimeouts = 0

  return {
    success(): void {
      consecutiveTimeouts = 0
    },
    failure(err: unknown): void {
      if (!(err instanceof Error) || err.message !== REDIS_OP_TIMEOUT_MESSAGE) {
        consecutiveTimeouts = 0

        return
      }
      consecutiveTimeouts += 1
      if (consecutiveTimeouts < threshold) return
      consecutiveTimeouts = 0
      onWedge()
    },
  }
}

/**
 * Drops the socket so the retry strategy reconnects. Only a ready client is
 * touched: a burst of timeouts trips the detector several times in a row, and
 * disconnecting a client that is already reconnecting makes ioredis end it for
 * good, with every later command failing as "Connection is closed."
 */
export function forceReconnect(client: Pick<Redis, 'status' | 'disconnect'>): boolean {
  if (client.status !== 'ready') return false
  client.disconnect(true)

  return true
}

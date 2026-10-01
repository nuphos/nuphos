import { logError, logEvent } from '@/lib/observability'
import { redisEnabled, withRedis } from '@/lib/redis'

import { trackGuardWrite } from './guards'
import { activeRunReservationKey, OWNER_HEARTBEAT_MS, RESERVATION_TTL_SEC } from './shared'

/**
 * Acquire the short session-claim lease and keep it alive until the handler
 * releases it. The active-run hash remains the primary guard, but its first
 * heartbeat is asynchronous and can be delayed or lost during Redis failover.
 * This independent lease prevents that gap from reopening during a long turn.
 */
export async function reserveActiveAgentRunForSession(
  userId: string,
  sessionId: string,
  token: string,
  options: { heartbeatMs?: number } = {},
): Promise<(() => void) | null> {
  if (!redisEnabled()) return () => {}
  const key = activeRunReservationKey(userId, sessionId)
  const heartbeatMs = options.heartbeatMs ?? OWNER_HEARTBEAT_MS
  const result = await withRedis((c) => c.set(key, token, 'EX', RESERVATION_TTL_SEC, 'NX'))

  if (result !== 'OK') return null
  const state = { released: false, refreshStopped: false }
  const stopRefresh = () => {
    if (state.refreshStopped) return
    state.refreshStopped = true
    clearInterval(timer)
  }
  const refresh = async () => {
    const refreshed = await withRedis((c) =>
      c.eval(
        `
          if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('EXPIRE', KEYS[1], ARGV[2])
          end
          return 0
        `,
        1,
        key,
        token,
        RESERVATION_TTL_SEC,
      ),
    )

    if (refreshed === 0 && !state.released) {
      stopRefresh()
      logEvent('warn', 'agent.run.redis_reservation_lease_lost', {
        user_id: userId,
        session_id: sessionId,
        redis_reservation_key: key,
      })
    }
  }

  const timer = setInterval(() => {
    void refresh().catch((err: unknown) => {
      logError('agent.run.redis_reservation_refresh_failed', err, {
        user_id: userId,
        session_id: sessionId,
        redis_reservation_key: key,
      })
    })
  }, heartbeatMs)

  return () => {
    if (state.released) return
    state.released = true
    stopRefresh()
    const release = withRedis((c) =>
      c.eval(
        `
          if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
          end
          return 0
        `,
        1,
        key,
        token,
      ),
    )

    trackGuardWrite(release)
    void release.catch((err: unknown) => {
      logError('agent.run.redis_reservation_release_failed', err, {
        user_id: userId,
        session_id: sessionId,
        redis_reservation_key: key,
      })
    })
  }
}

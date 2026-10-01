import { logError, logEvent } from '@/lib/observability'
import { redisEnabled, replicaId, withRedis } from '@/lib/redis'

import { trackGuardWrite } from './guards'
import {
  ABANDONED_GUARD_GRACE_MS,
  ACTIVE_RUN_TTL_SEC,
  activeRunKey,
  CANCELLATION_REQUEST_TTL_SEC,
  cancellationKey,
  OWNER_HEARTBEAT_MS,
  OWNER_TTL_SEC,
  ownerKey,
  RUN_KEY_TTL_SEC,
  streamKey,
} from './shared'
import { traceRunStoreError } from './trace'

/** Mark this replica as the live owner of an agent run and start refreshing
 *  the lease. Returns a function that releases ownership. */
export function startAgentRunOwnership(
  userId: string,
  sessionId: string,
  streamId: string,
  options: {
    onCancellationRequested?: () => void
    heartbeatMs?: number
    actorUserId?: string
  } = {},
): () => void {
  if (!redisEnabled()) return () => {}
  const key = streamKey(userId, streamId)
  const oKey = ownerKey(userId, streamId)
  const aKey = activeRunKey(userId, sessionId)
  const cKey = cancellationKey(userId, streamId)
  const onCancellationRequested = options.onCancellationRequested
  const heartbeatMs = options.heartbeatMs ?? OWNER_HEARTBEAT_MS
  const state = { released: false, cancellationDelivered: false }
  const cancellationStillPending = () => !state.released && !state.cancellationDelivered

  const write = () =>
    withRedis((c) =>
      c
        .pipeline()
        .set(oKey, replicaId, 'EX', OWNER_TTL_SEC)
        .hset(aKey, 'streamId', streamId)
        .hset(aKey, 'actorUserId', options.actorUserId ?? userId)
        .hsetnx(aKey, 'startedAt', String(Date.now()))
        // The hash rides the heartbeat, so a live run keeps refreshing it; only
        // an unreleased run lets it lapse (self-healing the lock).
        .expire(aKey, ACTIVE_RUN_TTL_SEC)
        // The resumable SSE buffer stays attachable for the full 2h window.
        .expire(key, RUN_KEY_TTL_SEC)
        .exec(),
    )

  const heartbeat = async () => {
    await write()
    if (!cancellationStillPending() || !onCancellationRequested) return
    const requested = await withRedis((c) => c.get(cKey))

    if (!requested || !cancellationStillPending()) return
    state.cancellationDelivered = true
    await withRedis((c) => c.del(cKey))
    onCancellationRequested()
  }

  void heartbeat().catch((err: unknown) => {
    traceRunStoreError(
      'agent.run.redis_owner_heartbeat_failed',
      err,
      { userId, sessionId, streamId },
      {
        redis_stream_key: key,
        redis_owner_key: oKey,
        redis_active_key: aKey,
        owner_ttl_sec: OWNER_TTL_SEC,
      },
    )
  })
  const timer = setInterval(() => {
    void heartbeat().catch((err: unknown) => {
      traceRunStoreError(
        'agent.run.redis_owner_heartbeat_failed',
        err,
        { userId, sessionId, streamId },
        {
          redis_stream_key: key,
          redis_owner_key: oKey,
          redis_active_key: aKey,
          owner_ttl_sec: OWNER_TTL_SEC,
        },
      )
    })
  }, heartbeatMs)

  return () => {
    if (state.released) return
    state.released = true
    clearInterval(timer)
    const release = withRedis(async (c) => {
      const current = await c.get(oKey)

      if (current === replicaId) await c.del(oKey)
      await c.del(cKey)
      await c.eval(
        `
          local current = redis.call('HGET', KEYS[1], ARGV[1])
          if current == ARGV[2] then
            return redis.call('DEL', KEYS[1])
          end
          return 0
        `,
        1,
        aKey,
        'streamId',
        streamId,
      )
    })

    // finishAgentRun() calls this synchronously right after flipping run.done, so
    // the drainer always observes a terminating run's release as already in
    // flight — tracking it is what lets shutdown wait for the DEL to land.
    trackGuardWrite(release)
    void release.catch((err: unknown) => {
      traceRunStoreError(
        'agent.run.redis_owner_release_failed',
        err,
        { userId, sessionId, streamId },
        {
          redis_stream_key: key,
          redis_owner_key: oKey,
          redis_active_key: aKey,
        },
      )
    })
  }
}

export async function requestAgentRunCancellation(
  userId: string,
  streamId: string,
): Promise<boolean> {
  if (!redisEnabled()) return false
  const owner = await withRedis((c) => c.get(ownerKey(userId, streamId)))

  if (!owner) return false
  const stored = await withRedis((c) =>
    c.set(cancellationKey(userId, streamId), replicaId, 'EX', CANCELLATION_REQUEST_TTL_SEC),
  )

  return stored === 'OK'
}

/** True when the guard hash has outlived the replica that wrote it. Two signals,
 *  both read off Redis's own clock rather than any replica's wall clock:
 *
 *  - the per-stream owner lease is gone (nothing refreshed it for OWNER_TTL_SEC);
 *  - the hash's own TTL has decayed past the grace, proving the heartbeat that
 *    would have pushed it back to ACTIVE_RUN_TTL_SEC has stopped.
 *
 *  Requiring both is what makes a Sentinel failover safe: a failover that loses
 *  the recently-written owner key still leaves a freshly-refreshed hash TTL, so a
 *  live run is never swept out from under itself.
 *
 *  The two reads are deliberately not atomic: a run that starts between them can
 *  only make the guard look *more* alive, and the sweep itself re-checks streamId
 *  under a compare-and-delete, so a newer run's hash is never dropped. */
async function guardIsAbandoned(
  userId: string,
  sessionId: string,
  streamId: string,
): Promise<boolean> {
  if (await withRedis((c) => c.get(ownerKey(userId, streamId)))) return false
  const pttl = Number(await withRedis((c) => c.pttl(activeRunKey(userId, sessionId))))

  // -1 (no expiry set) and -2 (key vanished) are not evidence of a stalled
  // heartbeat; leave those alone rather than sweeping on a surprise.
  if (!Number.isFinite(pttl) || pttl < 0) return false

  return pttl <= ACTIVE_RUN_TTL_SEC * 1_000 - ABANDONED_GUARD_GRACE_MS
}

/** Drop a guard whose owner is provably gone, so the next message in the thread
 *  opens a turn instead of being told the session is busy. Compare-and-delete on
 *  streamId: a newer run's hash must never be swept by a stale reader. */
async function sweepAbandonedGuard(
  userId: string,
  sessionId: string,
  streamId: string,
): Promise<void> {
  const aKey = activeRunKey(userId, sessionId)

  try {
    const swept = await withRedis((c) =>
      c.eval(
        `
          local current = redis.call('HGET', KEYS[1], ARGV[1])
          if current == ARGV[2] then
            return redis.call('DEL', KEYS[1])
          end
          return 0
        `,
        1,
        aKey,
        'streamId',
        streamId,
      ),
    )

    logEvent('warn', 'agent.run.busy_guard_swept', {
      user_id: userId,
      session_id: sessionId,
      stream_id: streamId,
      redis_active_key: aKey,
      swept: swept === 1,
      abandoned_grace_ms: ABANDONED_GUARD_GRACE_MS,
    })
  } catch (err) {
    logError('agent.run.busy_guard_sweep_failed', err, {
      user_id: userId,
      session_id: sessionId,
      stream_id: streamId,
      redis_active_key: aKey,
    })
  }
}

export async function getActiveAgentRunForSession(
  userId: string,
  sessionId: string,
): Promise<{ streamId: string; startedAt: string | null; actorUserId: string | null } | null> {
  if (!redisEnabled()) return null
  const aKey = activeRunKey(userId, sessionId)
  const result = await withRedis((c) => c.hmget(aKey, 'streamId', 'startedAt', 'actorUserId'))

  if (!result) return null
  const [streamId, startedAt, actorUserId] = result

  if (!streamId) return null
  if (await guardIsAbandoned(userId, sessionId, streamId)) {
    await sweepAbandonedGuard(userId, sessionId, streamId)

    return null
  }

  return { streamId, startedAt: startedAt ?? null, actorUserId: actorUserId ?? null }
}

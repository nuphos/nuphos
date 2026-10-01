import { errorTelemetryProperties } from '@/lib/observability'
import { getRedis, withRedis } from '@/lib/redis'

import {
  OWNER_TTL_SEC,
  parseEntries,
  RESUME_ATTACH_GRACE_MS,
  RESUME_ATTACH_ORPHAN_PROBES,
  RESUME_ATTACH_RETRY_MS,
  sleep,
  STREAM_DONE_NEEDLE,
  TAIL_BLOCK_MS,
} from './shared'
import { runStoreErrorFrame, traceRunStoreError, traceRunStoreEvent } from './trace'

import type { ParsedEntry } from './shared'
import type { AgentRunStoreTrace } from './trace'

export type StreamResumeState = {
  closed: boolean
  lastId: string
  sawDone: boolean
  ownerSeenAt: number
  emittedFrames: number
  emittedBytes: number
  heartbeatCount: number
}

export type StreamResumeContext = {
  key: string
  oKey: string
  startIndex: number
  startedAt: number
  trace: AgentRunStoreTrace | undefined
  state: StreamResumeState
  emit: (frame: string) => void
  close: (reason: string, extras?: Record<string, unknown>) => void
}

// 1. Backfill history from index `startIndex` onward. A live run may
// briefly miss a Redis probe during Sentinel reconnects or before the
// owner has mirrored the first frame, so do the wait inside the already
// opened SSE response instead of returning an HTTP 409 to the client.
export async function backfillAgentRunHistory(ctx: StreamResumeContext): Promise<void> {
  const { key, oKey, startIndex, startedAt, trace, state, emit, close } = ctx
  const attachDeadline = Date.now() + RESUME_ATTACH_GRACE_MS
  let entries: ParsedEntry[] = []
  let owner: string | null = null
  let orphanProbes = 0

  while (!state.closed) {
    const probe = await withRedis(async (c) =>
      Promise.all([c.exists(key), c.get(oKey), c.xrange(key, '-', '+')]),
    )

    if (probe) {
      const [exists, currentOwner, initial] = probe

      owner = currentOwner
      if (owner) state.ownerSeenAt = Date.now()
      if (exists) {
        entries = parseEntries(initial)
        traceRunStoreEvent('info', 'agent.run.redis_resume.backfill_loaded', trace, {
          redis_stream_key: key,
          redis_owner_key: oKey,
          resume_from: startIndex,
          redis_entry_count: entries.length,
          owner_present_at_start: Boolean(owner),
          owner_replica_id: owner ?? undefined,
          attach_wait_ms: Date.now() - startedAt,
        })
        break
      }
      if (startIndex === 0 && state.ownerSeenAt === 0) orphanProbes += 1
      traceRunStoreEvent('warn', 'agent.run.redis_resume.stream_missing_waiting', trace, {
        redis_stream_key: key,
        redis_owner_key: oKey,
        resume_from: startIndex,
        owner_present: Boolean(owner),
        orphan_probes: orphanProbes,
        attach_wait_ms: Date.now() - startedAt,
        attach_grace_ms: RESUME_ATTACH_GRACE_MS,
      })
    } else {
      traceRunStoreEvent('warn', 'agent.run.redis_resume.probe_failed_waiting', trace, {
        redis_stream_key: key,
        redis_owner_key: oKey,
        resume_from: startIndex,
        attach_wait_ms: Date.now() - startedAt,
        attach_grace_ms: RESUME_ATTACH_GRACE_MS,
      })
    }
    const orphanConfirmed = orphanProbes >= RESUME_ATTACH_ORPHAN_PROBES

    if (orphanConfirmed || Date.now() >= attachDeadline) {
      traceRunStoreEvent('error', 'agent.run.redis_resume.stream_missing_after_wait', trace, {
        redis_stream_key: key,
        redis_owner_key: oKey,
        resume_from: startIndex,
        owner_present: Boolean(owner),
        orphan_confirmed: orphanConfirmed,
        orphan_probes: orphanProbes,
        attach_wait_ms: Date.now() - startedAt,
        attach_grace_ms: RESUME_ATTACH_GRACE_MS,
        error_code: 'stream_unresumable',
      })
      emit(
        runStoreErrorFrame('stream_unresumable', 'Agent run stream is no longer available', trace, {
          reason: orphanConfirmed ? 'stream_never_registered' : 'stream_missing_after_wait',
          redis_stream_key: key,
          redis_owner_key: oKey,
          resume_from: startIndex,
          owner_present: Boolean(owner),
          attach_wait_ms: Date.now() - startedAt,
          attach_grace_ms: RESUME_ATTACH_GRACE_MS,
        }),
      )
      emit(`data: ${JSON.stringify({ type: STREAM_DONE_NEEDLE })}\n\n`)
      close('stream_missing_after_wait', { error_code: 'stream_unresumable' })

      return
    }
    await sleep(RESUME_ATTACH_RETRY_MS)
  }
  if (state.closed) return
  for (let i = startIndex; i < entries.length; i++) {
    const e = entries[i]!

    emit(e.frame)
    state.lastId = e.id
  }
  if (entries.length > 0) state.lastId = entries[entries.length - 1]!.id
}

// 2. Tail new entries via blocking XREAD until done or owner abandons.
// Run XREAD directly on the ioredis client rather than through withRedis:
// the BLOCK timeout (TAIL_BLOCK_MS) is the intended wait budget, and
// wrapping it in the 500 ms withRedis timeout would cut every block short
// and spin the loop at 10x the intended cadence.
export async function tailAgentRunStream(ctx: StreamResumeContext): Promise<void> {
  // A blocking XREAD parks the whole ioredis connection for TAIL_BLOCK_MS;
  // on the shared client every concurrent withRedis() op queues behind it and
  // trips the 500ms op timeout, so each tail gets its own connection.
  const client = getRedis().duplicate()

  client.on('error', () => {
    // Surfaced per-XREAD by the catch below; an unhandled 'error' event kills the process.
  })
  try {
    await tailLoop(client, ctx)
  } finally {
    client.disconnect()
  }
}

async function tailLoop(
  client: ReturnType<typeof getRedis>,
  ctx: StreamResumeContext,
): Promise<void> {
  const { key, oKey, startIndex, trace, state, emit, close } = ctx

  while (!state.closed) {
    let result: unknown

    try {
      result = await client.xread('BLOCK', TAIL_BLOCK_MS, 'STREAMS', key, state.lastId)
    } catch (err) {
      traceRunStoreError('agent.run.redis_tail_xread_failed', err, trace, {
        redis_stream_key: key,
        redis_owner_key: oKey,
        last_redis_id: state.lastId,
        resume_from: startIndex,
        emitted_frames: state.emittedFrames,
        emitted_bytes: state.emittedBytes,
      })
      if (!state.closed) {
        emit(
          runStoreErrorFrame('stream_unresumable', 'Agent run stream tail failed', trace, {
            reason: 'redis_tail_xread_failed',
            redis_stream_key: key,
            redis_owner_key: oKey,
            last_redis_id: state.lastId,
            resume_from: startIndex,
            emitted_frames: state.emittedFrames,
            emitted_bytes: state.emittedBytes,
            ...errorTelemetryProperties(err),
          }),
        )
        emit(`data: ${JSON.stringify({ type: STREAM_DONE_NEEDLE })}\n\n`)
        close('xread_failed', { error_code: 'stream_unresumable' })
      }
      break
    }
    if (state.closed) break
    if (Array.isArray(result) && result.length > 0) {
      for (const [, raw] of result as [string, unknown][]) {
        for (const e of parseEntries(raw)) {
          emit(e.frame)
          state.lastId = e.id
        }
      }
    } else {
      // XREAD timeout — verify the owner is still alive. If the lease has
      // been gone for longer than its TTL window, surface a clean error so
      // the client stops waiting.
      const currentOwner = await withRedis((c) => c.get(oKey))

      if (currentOwner) {
        state.ownerSeenAt = Date.now()
        traceRunStoreEvent('info', 'agent.run.redis_resume.owner_seen', trace, {
          redis_owner_key: oKey,
          owner_replica_id: currentOwner,
          last_redis_id: state.lastId,
          emitted_frames: state.emittedFrames,
        })
        continue
      }
      if (state.ownerSeenAt && Date.now() - state.ownerSeenAt < (OWNER_TTL_SEC + 5) * 1000) {
        // Brief gap — keep waiting in case of a Sentinel failover.
        traceRunStoreEvent('warn', 'agent.run.redis_resume.owner_gap_waiting', trace, {
          redis_owner_key: oKey,
          owner_last_seen_ms_ago: Date.now() - state.ownerSeenAt,
          owner_ttl_sec: OWNER_TTL_SEC,
          last_redis_id: state.lastId,
          emitted_frames: state.emittedFrames,
        })
        continue
      }
      traceRunStoreEvent('error', 'agent.run.redis_resume.owner_abandoned', trace, {
        redis_stream_key: key,
        redis_owner_key: oKey,
        resume_from: startIndex,
        emitted_frames: state.emittedFrames,
        emitted_bytes: state.emittedBytes,
        last_redis_id: state.lastId,
        owner_seen_at: state.ownerSeenAt ? new Date(state.ownerSeenAt).toISOString() : null,
        owner_last_seen_ms_ago: state.ownerSeenAt ? Date.now() - state.ownerSeenAt : null,
        owner_ttl_sec: OWNER_TTL_SEC,
        error_code: 'stream_unresumable',
      })
      emit(
        runStoreErrorFrame('stream_unresumable', 'Agent run owner is no longer active', trace, {
          reason: 'owner_abandoned',
          redis_stream_key: key,
          redis_owner_key: oKey,
          resume_from: startIndex,
          emitted_frames: state.emittedFrames,
          emitted_bytes: state.emittedBytes,
          last_redis_id: state.lastId,
          owner_seen_at: state.ownerSeenAt ? new Date(state.ownerSeenAt).toISOString() : null,
          owner_last_seen_ms_ago: state.ownerSeenAt ? Date.now() - state.ownerSeenAt : null,
          owner_ttl_sec: OWNER_TTL_SEC,
        }),
      )
      emit(`data: ${JSON.stringify({ type: STREAM_DONE_NEEDLE })}\n\n`)
      close('owner_abandoned', { error_code: 'stream_unresumable' })
    }
  }
}

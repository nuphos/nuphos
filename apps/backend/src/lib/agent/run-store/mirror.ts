import { redisEnabled, withRedis } from '@/lib/redis'

import {
  FINISHED_RUN_KEY_TTL_SEC,
  frameType,
  REPLAY_FIELD_MAX_BYTES,
  RUN_KEY_TTL_SEC,
  RUN_STREAM_FRAME_MAX_BYTES,
  RUN_STREAM_MAXLEN,
  streamKey,
} from './shared'
import { traceRunStoreError } from './trace'

/** Fire-and-forget append a frame to the Redis Stream. Order is preserved on a
 *  single ioredis client (pipelined FIFO). Failures are logged inside withRedis
 *  and don't surface to callers. */
export function mirrorAgentRunFrame(userId: string, streamId: string, frame: string): void {
  if (!redisEnabled()) return
  const key = streamKey(userId, streamId)

  void withRedis((c) =>
    c
      .pipeline()
      .xadd(key, 'MAXLEN', '~', String(RUN_STREAM_MAXLEN), '*', 'f', replayFrame(frame))
      .expire(key, RUN_KEY_TTL_SEC)
      .exec(),
  ).catch((err: unknown) => {
    traceRunStoreError(
      'agent.run.redis_mirror_frame_failed',
      err,
      { userId, streamId },
      {
        redis_key: key,
        frame_bytes: frame.length,
        frame_type: frameType(frame),
      },
    )
  })
}

/**
 * The frame as a reconnecting client replays it. An oversized frame of any type
 * keeps its place (clients resume by frame count) and its small fields (type,
 * ids, names), but each large field becomes `{ omitted, bytes }`; the live
 * stream still carried the full frame.
 */
export function replayFrame(frame: string): string {
  if (frame.length <= RUN_STREAM_FRAME_MAX_BYTES) return frame
  let payload: Record<string, unknown>

  try {
    payload = JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>
  } catch {
    return frame
  }
  const kept = Object.entries(payload).map(([field, value]) => {
    const bytes = JSON.stringify(value)?.length ?? 0

    return [
      field,
      field === 'type' || bytes <= REPLAY_FIELD_MAX_BYTES ? value : { omitted: true, bytes },
    ]
  })

  return `data: ${JSON.stringify(Object.fromEntries(kept))}\n\n`
}

/** Once the run has finished, keep its buffer only as long as a reconnect takes. */
export function expireAgentRunMirror(userId: string, streamId: string): void {
  if (!redisEnabled()) return

  void withRedis((c) => c.expire(streamKey(userId, streamId), FINISHED_RUN_KEY_TTL_SEC))
}

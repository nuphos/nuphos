import { redisEnabled, withRedis } from '@/lib/redis'

import { frameType, ownerKey, RUN_KEY_TTL_SEC, RUN_STREAM_MAXLEN, streamKey } from './shared'
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
      .xadd(key, 'MAXLEN', '~', String(RUN_STREAM_MAXLEN), '*', 'f', frame)
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

/** Drop the stream + lease entirely. Used when the run completes so we
 *  don't keep a stale key around longer than necessary. */
export function dropAgentRunMirror(userId: string, streamId: string): void {
  if (!redisEnabled()) return
  const key = streamKey(userId, streamId)
  const oKey = ownerKey(userId, streamId)

  void withRedis((c) => c.pipeline().del(key).del(oKey).exec())
}

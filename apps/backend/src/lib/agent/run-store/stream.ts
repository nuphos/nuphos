import { redisEnabled } from '@/lib/redis'

import {
  cancelReason,
  frameType,
  ownerKey,
  SSE_HEARTBEAT_INTERVAL_MS,
  STREAM_DONE_NEEDLE,
  streamKey,
} from './shared'
import { backfillAgentRunHistory, tailAgentRunStream } from './stream-phases'
import { traceRunStoreError, traceRunStoreEvent } from './trace'

import type { StreamResumeState } from './stream-phases'
import type { AgentRunStoreTrace } from './trace'

/** Try to build a Response that streams an in-progress or just-finished agent
 *  run by tailing its Redis Stream. Returns null when no run is recorded. */
export async function streamAgentRunFromRedis(
  userId: string,
  streamId: string,
  resumeFrom: number | undefined,
  trace?: AgentRunStoreTrace,
): Promise<Response | null> {
  if (!redisEnabled()) {
    traceRunStoreEvent('warn', 'agent.run.redis_resume.redis_disabled', trace, {
      resume_from: resumeFrom,
    })

    return null
  }
  const key = streamKey(userId, streamId)
  const oKey = ownerKey(userId, streamId)

  const startIndex = Math.max(0, Math.floor(resumeFrom ?? 0))
  const encoder = new TextEncoder()
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  const state: StreamResumeState = {
    closed: false,
    lastId: '0',
    sawDone: false,
    ownerSeenAt: 0,
    emittedFrames: 0,
    emittedBytes: 0,
    heartbeatCount: 0,
  }
  const startedAt = Date.now()

  const stopHeartbeat = () => {
    if (!heartbeatTimer) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = (reason: string, extras?: Record<string, unknown>) => {
        if (state.closed) return
        state.closed = true
        stopHeartbeat()
        traceRunStoreEvent('info', 'agent.run.redis_resume.stream_closed', trace, {
          reason,
          resume_from: startIndex,
          emitted_frames: state.emittedFrames,
          emitted_bytes: state.emittedBytes,
          saw_done: state.sawDone,
          last_redis_id: state.lastId,
          elapsed_ms: Date.now() - startedAt,
          ...extras,
        })
        try {
          controller.close()
        } catch (err) {
          traceRunStoreError('agent.run.redis_resume.controller_close_failed', err, trace, {
            reason,
            emitted_frames: state.emittedFrames,
            last_redis_id: state.lastId,
          })
        } finally {
          if (trace?.endSpanOnClose) trace.span?.end()
        }
      }
      const emit = (frame: string) => {
        if (state.closed) return
        try {
          controller.enqueue(encoder.encode(frame))
          state.emittedFrames += 1
          state.emittedBytes += frame.length
        } catch {
          state.closed = true
          traceRunStoreEvent('warn', 'agent.run.redis_resume.enqueue_failed', trace, {
            resume_from: startIndex,
            emitted_frames: state.emittedFrames,
            emitted_bytes: state.emittedBytes,
            last_redis_id: state.lastId,
            frame_type: frameType(frame),
          })

          return
        }
        // Parse the SSE payload and check `type` exactly — a substring match
        // would mis-fire on any frame whose body happens to mention the event
        // name (e.g. an LLM reply or tool output echoing it back).
        if (frame.startsWith('data: ')) {
          try {
            const payload = JSON.parse(frame.slice('data: '.length).trimEnd())

            if (payload?.type === STREAM_DONE_NEEDLE) {
              state.sawDone = true
              close('done_frame', { frame_type: STREAM_DONE_NEEDLE })
            }
          } catch {
            // Not JSON (partial frame or a comment line) — nothing to inspect.
          }
        }
      }
      const heartbeat = () => {
        if (state.closed) return
        emit(': atlas-heartbeat\n\n')
        state.heartbeatCount += 1
      }

      // Flush response headers immediately even when the client is already at
      // the Redis tail and XREAD will block until the owner appends another
      // frame. Without this, nginx can see "upstream prematurely closed
      // connection while reading response header" and turn a healthy resume
      // wait into a 502.
      heartbeat()
      heartbeatTimer = setInterval(heartbeat, SSE_HEARTBEAT_INTERVAL_MS)

      const ctx = { key, oKey, startIndex, startedAt, trace, state, emit, close }

      await backfillAgentRunHistory(ctx)
      if (state.sawDone || state.closed) return
      await tailAgentRunStream(ctx)
    },
    cancel(reason) {
      state.closed = true
      stopHeartbeat()
      traceRunStoreEvent('warn', 'agent.run.redis_resume.client_cancelled', trace, {
        cancel_reason: cancelReason(reason),
        resume_from: startIndex,
        emitted_frames: state.emittedFrames,
        emitted_bytes: state.emittedBytes,
        heartbeat_count: state.heartbeatCount,
        saw_done: state.sawDone,
        last_redis_id: state.lastId,
        elapsed_ms: Date.now() - startedAt,
      })
      if (trace?.endSpanOnClose) trace.span?.end()
      // Client disconnected — the loop above checks `closed` after each await.
    },
  })

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-atlas-stream-id': streamId,
      'x-atlas-stream-source': 'redis',
    },
  })
}

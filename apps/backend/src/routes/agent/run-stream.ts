import { SSE_HEARTBEAT_INTERVAL_MS } from './constants'
import { traceAgentChatError, traceAgentChatEvent } from './trace'

import type { AgentRun, AgentRunSubscriber } from './types'

export function streamAgentRunResponse(run: AgentRun, resumeFrom?: number): Response {
  run.lastAccessAt = Date.now()
  const encoder = new TextEncoder()
  const responseStartedAt = Date.now()
  const startIndex =
    typeof resumeFrom === 'number' && Number.isFinite(resumeFrom)
      ? Math.max(0, Math.floor(resumeFrom))
      : 0
  let timer: ReturnType<typeof setInterval> | undefined
  let subscriber: AgentRunSubscriber | undefined
  let emittedFrames = 0
  let emittedBytes = 0
  let heartbeatCount = 0

  traceAgentChatEvent('info', 'agent.chat.sse.local_response_created', run.trace, {
    resume_from: resumeFrom,
    start_index: startIndex,
    available_frame_count: run.frames.length,
    run_done: run.done,
    last_finish_reason: run.lastFinishReason,
    subscriber_count: run.subscribers.size,
    run_age_ms: Date.now() - run.createdAt,
  })

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let nextIndex = Math.min(startIndex, run.frames.length)
      let closed = false
      const close = (reason: string, extras?: Record<string, unknown>) => {
        if (closed) return
        closed = true
        if (timer) clearInterval(timer)
        if (subscriber) run.subscribers.delete(subscriber)
        traceAgentChatEvent('info', 'agent.chat.sse.local_response_closed', run.trace, {
          reason,
          resume_from: resumeFrom,
          start_index: startIndex,
          next_index: nextIndex,
          available_frame_count: run.frames.length,
          emitted_frames: emittedFrames,
          emitted_bytes: emittedBytes,
          heartbeat_count: heartbeatCount,
          run_done: run.done,
          last_finish_reason: run.lastFinishReason,
          elapsed_ms: Date.now() - responseStartedAt,
          run_age_ms: Date.now() - run.createdAt,
          ...extras,
        })
        try {
          controller.close()
        } catch (err) {
          traceAgentChatError('agent.chat.sse.local_controller_close_failed', err, run.trace, {
            reason,
            resume_from: resumeFrom,
            start_index: startIndex,
            next_index: nextIndex,
            emitted_frames: emittedFrames,
            heartbeat_count: heartbeatCount,
            run_done: run.done,
          })
        }
      }
      const flush = () => {
        if (closed) return
        try {
          while (nextIndex < run.frames.length) {
            const frame = run.frames[nextIndex++]!

            controller.enqueue(encoder.encode(frame))
            emittedFrames += 1
            emittedBytes += frame.length
          }
          if (run.done) close('run_done')
        } catch (err) {
          closed = true
          if (timer) clearInterval(timer)
          if (subscriber) run.subscribers.delete(subscriber)
          traceAgentChatError('agent.chat.sse.local_flush_failed', err, run.trace, {
            resume_from: resumeFrom,
            start_index: startIndex,
            next_index: nextIndex,
            available_frame_count: run.frames.length,
            emitted_frames: emittedFrames,
            emitted_bytes: emittedBytes,
            heartbeat_count: heartbeatCount,
            run_done: run.done,
            last_finish_reason: run.lastFinishReason,
            elapsed_ms: Date.now() - responseStartedAt,
          })
          controller.error(err)
        }
      }

      subscriber = { poke: flush }
      run.subscribers.add(subscriber)
      traceAgentChatEvent('info', 'agent.chat.sse.local_subscriber_attached', run.trace, {
        resume_from: resumeFrom,
        start_index: startIndex,
        subscriber_count: run.subscribers.size,
        available_frame_count: run.frames.length,
        run_done: run.done,
      })

      const heartbeat = () => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': atlas-heartbeat\n\n'))
          heartbeatCount += 1
        } catch {
          traceAgentChatEvent('warn', 'agent.chat.sse.local_heartbeat_failed', run.trace, {
            resume_from: resumeFrom,
            start_index: startIndex,
            emitted_frames: emittedFrames,
            emitted_bytes: emittedBytes,
            heartbeat_count: heartbeatCount,
            run_done: run.done,
            elapsed_ms: Date.now() - responseStartedAt,
          })
          close('heartbeat_enqueue_failed')
        }
      }

      // Flush response headers immediately even when the client is exactly at
      // the in-memory tail. Without this, nginx can turn a healthy wait for the
      // next agent frame into a 502 while reading the upstream response header.
      heartbeat()
      timer = setInterval(heartbeat, SSE_HEARTBEAT_INTERVAL_MS)

      flush()
    },
    cancel(reason) {
      if (timer) clearInterval(timer)
      // A disconnected HTTP client only unsubscribes. The agent run continues
      // until it finishes or the explicit abort endpoint is called.
      if (subscriber) run.subscribers.delete(subscriber)
      traceAgentChatEvent('warn', 'agent.chat.sse.local_client_cancelled', run.trace, {
        cancel_reason: agentCancelReason(reason),
        resume_from: resumeFrom,
        start_index: startIndex,
        emitted_frames: emittedFrames,
        emitted_bytes: emittedBytes,
        heartbeat_count: heartbeatCount,
        run_done: run.done,
        last_finish_reason: run.lastFinishReason,
        elapsed_ms: Date.now() - responseStartedAt,
        run_age_ms: Date.now() - run.createdAt,
      })
    },
  })

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-atlas-stream-id': run.streamId,
    },
  })
}

export function agentCancelReason(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`
  if (typeof reason === 'string') return reason
  if (reason == null) return 'unknown'
  try {
    return JSON.stringify(reason)
  } catch {
    return Object.prototype.toString.call(reason)
  }
}

export function isClosedReadableStreamControllerError(error: unknown): boolean {
  return error instanceof TypeError && error.message.includes('Controller is already closed')
}

// Per-phase silence windows. Classification (StreamStallPhase /
// stallPhaseForFrame) lives in agent-stream-watchdog.ts; the concrete millisecond
// budgets stay here because STALL_WINDOW_TOOL_EXECUTION_MS is derived from the

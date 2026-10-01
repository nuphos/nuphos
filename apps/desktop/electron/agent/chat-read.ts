import { frameMayHaveStartedToolExecution } from '../agent-stream-retry.ts'

import {
  AGENT_STREAM_DONE_EVENT,
  AGENT_TURN_COMPLETE_EVENT,
  CHAT_STREAM_IDLE_TIMEOUT_MS,
  CHAT_STREAM_NO_CONTENT_TIMEOUT_MS,
} from './chat-shared.ts'
import {
  agentReauthenticationEvent,
  formatAgentLocalError,
  formatAgentSseError,
  parseSseEvent,
} from './stream-errors.ts'

import type { ChatStreamCtx } from './chat-shared.ts'

export type ChatReadResult =
  | { kind: 'stop' }
  | {
      kind: 'read'
      idleTimedOut: boolean
      /** Heartbeats kept arriving but no SSE frame did, for long enough that the
       *  producer behind this stream is gone rather than slow. */
      contentStalled: boolean
      needsFreshRetry: boolean
      freshRetryReason: string | null
      interruptionFrame?: Record<string, unknown>
    }

/** Drain one chat SSE response body, forwarding frames to the renderer. */
export async function consumeChatStream(
  ctx: ChatStreamCtx,
  res: Response,
  shouldResume: boolean,
): Promise<ChatReadResult> {
  const { streamId, sessionId, teamId, explicitResume, state, emit } = ctx

  if (!res.body) {
    emit({
      type: 'error',
      error: formatAgentLocalError(
        'Agent chat response had no readable body after successful headers.',
        {
          phase: 'missing_response_body',
          streamId,
          sessionId,
          teamId,
          resumeFrom: state.resumeFrom,
          reconnectAttempts: state.reconnectAttempts,
          freshRetryAttempts: state.freshRetryAttempts,
          explicitResume,
          shouldResume,
        },
      ),
    })

    return { kind: 'stop' }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  // Set when the backend signals a mid-stream failure via an SSE error
  // frame (owner replica died, Redis tail failed, sandbox crashed, model
  // errored, etc.). After the read loop we drop the partial assistant
  // turn and reissue the request from scratch with a small backoff.
  let needsFreshRetry = false
  let freshRetryReason: string | null = null
  let interruptionFrame: Record<string, unknown> | undefined

  // Content watchdog: reset by SSE frames only, never by heartbeats. Reconnecting
  // would just re-attach to the same dead run, so this one ends the stream.
  let contentStalled = false
  let contentTimer: ReturnType<typeof setTimeout> | undefined
  const armContentTimer = () => {
    if (contentTimer) clearTimeout(contentTimer)
    contentTimer = setTimeout(() => {
      contentStalled = true
      console.warn('[agent] chat stream carried only heartbeats past timeout; ending', {
        streamId,
        sessionId,
        resumeFrom: state.resumeFrom,
      })
      reader.cancel(new Error('chat stream content stalled')).catch(() => {})
    }, CHAT_STREAM_NO_CONTENT_TIMEOUT_MS)
  }

  const handleRawEvent = (raw: string): 'stop' | undefined => {
    try {
      const parsed = parseSseEvent(raw)

      if (parsed) {
        ctx.noteFirstFrame()
        // A real frame — not a heartbeat comment — so the producer is alive.
        armContentTimer()
        const data = parsed as Record<string, unknown>

        if (frameMayHaveStartedToolExecution(data)) {
          state.toolExecutionMayHaveStarted = true
        }
        if (data.type === AGENT_TURN_COMPLETE_EVENT) {
          // This is the semantic terminal frame. atlas-stream-done only closes
          // the transport envelope, so losing it must not turn an already
          // delivered answer into a failed turn or trigger a full replay.
          state.terminalEventDetected = true
        }
        if (data.type === 'error') {
          const reauthentication = agentReauthenticationEvent(data)

          if (reauthentication) {
            emit(reauthentication)

            return 'stop'
          }
          // The answer is already delivered, so a trailing error frame can only
          // be about the transport that carried it. Whatever its code, it must
          // not reopen a finished turn.
          if (state.terminalEventDetected) {
            console.warn('[agent] ignoring trailing stream error after turn completion', {
              streamId,
              sessionId,
              errorCode: data.errorCode,
              resumeFrom: state.resumeFrom,
            })

            return
          }
          needsFreshRetry = true
          freshRetryReason = formatAgentSseError(data, {
            phase: 'sse_error_frame',
            streamId,
            sessionId,
            teamId,
            resumeFrom: state.resumeFrom,
            reconnectAttempts: state.reconnectAttempts,
            freshRetryAttempts: state.freshRetryAttempts,
            explicitResume,
            shouldResume,
          })

          return
        }
        state.resumeFrom += 1
        state.reconnectAttempts = 0
        state.idleTimeouts = 0
        state.usedFreshStartFallback = false
        if (data.type === AGENT_STREAM_DONE_EVENT) {
          // Error frames are followed by a done frame; let the
          // fresh-retry branch handle that case instead of marking the
          // stream complete here.
          if (!needsFreshRetry) state.terminalEventDetected = true

          return
        }
        if (data.type === 'turn-interrupted') {
          // Like the paired error frame, this is an attempt outcome. Wait for
          // the transport's retry decision before showing a final failure.
          interruptionFrame = data

          return
        }
        emit({ type: 'sse', data: parsed })
      }
    } catch {
      // ignore malformed event
    }
  }

  // Idle watchdog: on silence past the timeout, cancel the reader so the
  // blocked read() resolves and we reconnect below instead of hanging.
  let idleTimedOut = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimedOut = true
      console.warn('[agent] chat stream idle past timeout; cancelling to reconnect', {
        streamId,
        sessionId,
        resumeFrom: state.resumeFrom,
      })
      reader.cancel(new Error('chat stream idle timeout')).catch(() => {})
    }, CHAT_STREAM_IDLE_TIMEOUT_MS)
  }

  try {
    // Armed before the first read (we're already past response headers,
    // and the backend heartbeats within ~15s) so a headers-sent-but-body-
    // never-arrives hang is caught too.
    armIdleTimer()
    armContentTimer()
    while (true) {
      const { value, done } = await reader.read()

      if (done) break
      armIdleTimer() // any bytes (incl. heartbeat) = alive, reset window
      buffer += decoder.decode(value, { stream: true })
      // SSE events separated by blank line.
      let match = /\r?\n\r?\n/.exec(buffer)

      while (match?.index !== undefined) {
        const raw = buffer.slice(0, match.index)

        buffer = buffer.slice(match.index + match[0].length)
        if (handleRawEvent(raw) === 'stop') {
          // Stop even if the server never sends a terminal frame. Cancellation
          // must not route this known credential failure into reconnect logic.
          void reader.cancel().catch(() => {
            // The credential failure has already been surfaced.
          })

          return { kind: 'stop' }
        }
        match = /\r?\n\r?\n/.exec(buffer)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim() && handleRawEvent(buffer) === 'stop') return { kind: 'stop' }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    if (contentTimer) clearTimeout(contentTimer)
    reader.releaseLock()
  }

  if (interruptionFrame && !needsFreshRetry) emit({ type: 'sse', data: interruptionFrame })

  return {
    kind: 'read',
    idleTimedOut,
    contentStalled,
    needsFreshRetry,
    freshRetryReason,
    ...(needsFreshRetry && interruptionFrame ? { interruptionFrame } : {}),
  }
}

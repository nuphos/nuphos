import { postChatAttempt } from './chat-attempt'
import { handleChatHttpFailure } from './chat-http-failure'
import { resolveStreamOutcome } from './chat-outcome'
import { consumeChatStream } from './chat-read'
import {
  CHAT_STREAM_CONNECT_STALL_BEACON_MS,
  CHAT_STREAM_RECONNECT_BASE_MS,
  CHAT_STREAM_RECONNECT_MAX_ATTEMPTS,
  CHAT_STREAM_RECONNECT_MAX_MS,
  createChatStreamState,
  reportFailure,
  traceStream,
} from './chat-shared'
import { setSessionTeam } from './client-tools'
import { readToken, teamIdFromUrl } from './http'
import { logLocalTool } from './local-exec'
import { broadcast } from './notify'
import { abortableSleep, formatAgentLocalError } from './stream-errors'

import type { ChatStreamCtx, StartChatArgs } from './chat-shared'

export const activeStreams = new Map<string, AbortController>()

export async function startChat(args: StartChatArgs): Promise<void> {
  const { streamId, sessionId, messages, continueAfterInterruption, resumeReason } = args
  const teamId = args.teamId ?? teamIdFromUrl(args.url)

  // Remember which team this session belongs to so the upload_attachment client
  // tool can team-scope its transfer (it only receives sessionId).
  if (teamId) setSessionTeam(sessionId, teamId)
  const explicitResume = args.resume === true

  // Paired with the renderer's `agent_resume_dispatched`: if that fires and
  // this does not, the IPC hop swallowed the turn (the #616 failure mode) and
  // no amount of server-side digging will show it.
  traceStream(
    'start_chat_entered',
    { streamId, sessionId },
    {
      resume_from: args.resumeFrom ?? 0,
      explicit_resume: args.resume === true,
      continue_after_interruption: Boolean(continueAfterInterruption),
      resume_reason: resumeReason ?? null,
      message_count: messages.length,
    },
  )

  const ac = new AbortController()
  const previous = activeStreams.get(streamId)

  activeStreams.set(streamId, ac)
  previous?.abort()
  const emit = (event: unknown) => {
    if (activeStreams.get(streamId) !== ac) return
    broadcast('agent:event', { streamId, event })
  }
  const state = createChatStreamState(Math.max(0, Math.floor(args.resumeFrom ?? 0)))
  let firstFrameSeen = false
  let connectStallReported = false
  const turnStartedAtMs = Date.now()
  // Fresh turns only: a mid-turn re-attach (resumeFrom > 0) can legitimately
  // sit frameless past the window while a long tool runs between frames.
  const connectStallTimer =
    state.resumeFrom === 0
      ? setTimeout(() => {
          connectStallReported = true
          reportFailure(streamId, {
            sessionId,
            phase: 'connect_stalled',
            message: `Agent chat turn still had no SSE frame ${String(CHAT_STREAM_CONNECT_STALL_BEACON_MS)}ms after send; transport is stalled or blackholed.`,
            detail: {
              reconnectAttempts: state.reconnectAttempts,
              firstByteTimeouts: state.firstByteTimeouts,
              explicitResume,
            },
          })
        }, CHAT_STREAM_CONNECT_STALL_BEACON_MS)
      : undefined
  const noteFirstFrame = () => {
    if (firstFrameSeen) return
    firstFrameSeen = true
    traceStream(
      'first_frame',
      { streamId, sessionId },
      {
        elapsed_ms: Date.now() - turnStartedAtMs,
        reconnect_attempts: state.reconnectAttempts,
        first_byte_timeouts: state.firstByteTimeouts,
      },
    )
    if (connectStallTimer) clearTimeout(connectStallTimer)
    if (connectStallReported) {
      reportFailure(streamId, {
        sessionId,
        phase: 'connect_stalled_recovered',
        message: `Agent chat turn got its first SSE frame ${String(Date.now() - turnStartedAtMs)}ms after send (stall self-recovered).`,
      })
    }
  }
  const ctx: ChatStreamCtx = {
    streamId,
    sessionId,
    teamId,
    explicitResume,
    signal: ac.signal,
    emit,
    noteFirstFrame,
    state,
  }

  try {
    const token = await readToken()

    if (ac.signal.aborted) {
      // eslint-disable-next-line require-atomic-updates -- one writer per turn; ChatStreamState is deliberately shared across awaits
      state.aborted = true
      emit({ type: 'aborted' })

      return
    }
    if (!token) {
      emit({ type: 'error', error: 'Not signed in' })

      return
    }

    while (!state.completedSuccessfully && !state.aborted) {
      logLocalTool('posting chat', {
        sessionId,
        streamId,
        resumeFrom: state.resumeFrom,
        reconnectAttempts: state.reconnectAttempts,
      })

      // Per-attempt controller so the first-byte deadline can abort this fetch
      // without touching the turn-level `ac`; user aborts propagate into it so
      // they still cancel headers waits and body reads alike.
      const attemptAc = new AbortController()
      const propagateUserAbort = () => attemptAc.abort()

      ac.signal.addEventListener('abort', propagateUserAbort, { once: true })

      try {
        const shouldResume =
          !state.forceFreshStart &&
          (explicitResume || state.reconnectAttempts > 0 || state.resumeFrom > 0)

        state.forceFreshStart = false
        const res = await postChatAttempt(ctx, args, token, attemptAc, shouldResume)

        if (!res) return
        // eslint-disable-next-line require-atomic-updates -- one writer per turn; ChatStreamState is deliberately shared across awaits
        if (res.ok) state.continuationAccepted = true
        if (!res.ok) {
          if ((await handleChatHttpFailure(ctx, res, shouldResume)) === 'stop') return
          continue
        }
        // eslint-disable-next-line require-atomic-updates -- one writer per turn; ChatStreamState is deliberately shared across awaits
        state.initialGatewayRetryAttempts = 0
        const read = await consumeChatStream(ctx, res, shouldResume)

        if (read.kind === 'stop') return
        const outcome = await resolveStreamOutcome(
          ctx,
          read,
          shouldResume,
          turnStartedAtMs,
          firstFrameSeen,
        )

        if (outcome === 'stop') return
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') {
          // eslint-disable-next-line require-atomic-updates -- one writer per turn; ChatStreamState is deliberately shared across awaits
          state.aborted = true
          emit({ type: 'aborted' })
          break
        }
        state.reconnectAttempts += 1
        traceStream(
          'reconnect',
          { streamId, sessionId },
          {
            attempt: state.reconnectAttempts,
            error: e instanceof Error ? e.message : String(e),
            resume_from: state.resumeFrom,
          },
          'warn',
        )
        if (state.reconnectAttempts > CHAT_STREAM_RECONNECT_MAX_ATTEMPTS) {
          const rawMessage = e instanceof Error ? e.message : String(e)
          const msg = rawMessage.includes('context=')
            ? rawMessage
            : formatAgentLocalError(rawMessage, {
                phase: 'reconnect_exhausted',
                streamId,
                sessionId,
                teamId,
                resumeFrom: state.resumeFrom,
                reconnectAttempts: state.reconnectAttempts,
                freshRetryAttempts: state.freshRetryAttempts,
                explicitResume,
                shouldResume:
                  !state.forceFreshStart &&
                  (explicitResume || state.reconnectAttempts > 0 || state.resumeFrom > 0),
              })

          emit({ type: 'error', error: msg })
          break
        }
        const delay = Math.min(
          CHAT_STREAM_RECONNECT_MAX_MS,
          CHAT_STREAM_RECONNECT_BASE_MS * 2 ** (state.reconnectAttempts - 1),
        )

        console.warn('[agent] chat stream disconnected; reconnecting', {
          streamId,
          sessionId,
          resumeFrom: state.resumeFrom,
          reconnectAttempts: state.reconnectAttempts,
          delay,
          error: e instanceof Error ? e.message : String(e),
        })
        await abortableSleep(delay, ac.signal)
      } finally {
        ac.signal.removeEventListener('abort', propagateUserAbort)
      }
    }
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') {
      emit({ type: 'aborted' })
    } else {
      const rawMessage = e instanceof Error ? e.message : String(e)
      const msg = rawMessage.includes('context=')
        ? rawMessage
        : formatAgentLocalError(rawMessage, {
            phase: 'outer_start_chat_exception',
            streamId,
            sessionId,
            teamId,
            resumeFrom: state.resumeFrom,
            reconnectAttempts: state.reconnectAttempts,
            freshRetryAttempts: state.freshRetryAttempts,
            explicitResume,
          })

      emit({ type: 'error', error: msg })
    }
  } finally {
    if (connectStallTimer) clearTimeout(connectStallTimer)
    if (activeStreams.get(streamId) === ac) {
      emit({ type: 'end' })
      activeStreams.delete(streamId)
    }
  }
}

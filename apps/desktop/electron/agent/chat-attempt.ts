import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../client-version'

import {
  CHAT_STREAM_FIRST_BYTE_MAX_ATTEMPTS,
  effectiveFirstByteTimeout,
  traceStream,
} from './chat-shared'
import { ATLAS_URL } from './http'
import { formatAgentLocalError } from './stream-errors'
import { windowTranscript } from './transcript-window'

import type { ChatStreamCtx, StartChatArgs } from './chat-shared'

/**
 * Issue one chat POST and wait for response headers under the first-byte
 * deadline. Returns the Response, or null when a terminal error was already
 * emitted (the caller must stop). Transport failures throw so the caller's
 * reconnect handling takes over.
 */
export async function postChatAttempt(
  ctx: ChatStreamCtx,
  args: StartChatArgs,
  token: string,
  attemptAc: AbortController,
  shouldResume: boolean,
): Promise<Response | null> {
  const { streamId, sessionId, teamId, explicitResume, state } = ctx
  const { messages, locale, url, kubeContext, diagramId, continueAfterInterruption, resumeReason } =
    args
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    accept: 'text/event-stream',
    'accept-encoding': 'identity',
    [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
  }

  if (locale) headers['x-atlas-locale'] = locale
  if (url) headers['x-atlas-url'] = url
  if (kubeContext) headers['x-atlas-kube-context'] = kubeContext
  if (diagramId) headers['x-atlas-diagram-id'] = diagramId

  let firstByteTimedOut = false
  const effectiveTimeout = effectiveFirstByteTimeout(state.firstByteTimeouts)
  const firstByteTimer = setTimeout(() => {
    firstByteTimedOut = true
    attemptAc.abort()
  }, effectiveTimeout)
  let res: Response
  const attemptStartedAt = Date.now()

  // Ship only the current turn's tail; the backend hydrates the stored prefix
  // from `baseIndex`. Keeps the body flat across a long live session instead
  // of growing until the ingress answers 413.
  const window = state.sendFullTranscript
    ? { messages, baseIndex: args.baseIndex, dropped: 0 }
    : windowTranscript(messages as { role?: unknown }[], args.baseIndex)

  // A 409 rejection that carried the server's stored count: keep the same
  // window but claim that count as the prefix, so the store's truth wins over
  // the local arithmetic without resending the whole transcript.
  if (!state.sendFullTranscript && state.rebaseBaseIndex !== undefined) {
    window.baseIndex = state.rebaseBaseIndex
  }

  traceStream(
    'post_attempt',
    { streamId, sessionId },
    {
      resume_from: state.resumeFrom,
      should_resume: shouldResume,
      reconnect_attempts: state.reconnectAttempts,
      first_byte_timeouts: state.firstByteTimeouts,
      idle_timeouts: state.idleTimeouts,
      fresh_retry_attempts: state.freshRetryAttempts,
      message_count: window.messages.length,
      window_dropped: window.dropped,
      base_index: window.baseIndex ?? 0,
      full_transcript_fallback: state.sendFullTranscript,
    },
  )
  try {
    res = await fetch(`${ATLAS_URL}/agent/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: sessionId,
        teamId,
        messages: window.messages,
        baseIndex: window.baseIndex && window.baseIndex > 0 ? window.baseIndex : undefined,
        streamId,
        resume: shouldResume,
        resumeFrom: state.resumeFrom,
        credentialAccess: args.credentialAccess,
        permissionMode: args.permissionMode,
        agentRuntime: args.agentRuntime,
        runtimeId: args.runtimeId,
        clientCapabilities: { localTools: true },
        // Only the very first POST of an auto-resumed run carries the
        // nudge; subsequent reconnects within that same run are
        // transport-level resumes against an already-running agent loop
        // and must not re-inject the system message.
        continueAfterInterruption:
          continueAfterInterruption && state.resumeFrom === 0 && !state.continuationAccepted
            ? true
            : undefined,
        resumeReason:
          resumeReason && state.resumeFrom === 0 && !state.continuationAccepted
            ? resumeReason
            : undefined,
      }),
      signal: attemptAc.signal,
    })
  } catch (fetchErr) {
    if (!firstByteTimedOut || ctx.signal.aborted) {
      traceStream(
        'post_failed',
        { streamId, sessionId },
        {
          error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          aborted: ctx.signal.aborted,
          elapsed_ms: Date.now() - attemptStartedAt,
        },
        'warn',
      )
      throw fetchErr
    }
    state.firstByteTimeouts += 1
    traceStream(
      'first_byte_timeout',
      { streamId, sessionId },
      {
        attempt: state.firstByteTimeouts,
        timeout_ms: effectiveTimeout,
        resume_from: state.resumeFrom,
      },
      'warn',
    )
    if (state.firstByteTimeouts > CHAT_STREAM_FIRST_BYTE_MAX_ATTEMPTS) {
      traceStream(
        'first_byte_timeout_exhausted',
        { streamId, sessionId },
        {
          attempts: state.firstByteTimeouts,
        },
        'warn',
      )
      ctx.emit({
        type: 'error',
        error: formatAgentLocalError(
          `Agent chat request got no response headers within ${String(effectiveTimeout)}ms on ${String(state.firstByteTimeouts)} consecutive attempts.`,
          {
            phase: 'first_byte_timeout_exhausted',
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

      return null
    }
    console.warn('[agent] chat request got no response headers; retrying', {
      streamId,
      sessionId,
      resumeFrom: state.resumeFrom,
      attempt: state.firstByteTimeouts,
    })
    throw new Error('Chat request received no response headers before the first-byte deadline', {
      cause: fetchErr,
    })
  } finally {
    clearTimeout(firstByteTimer)
  }
  state.firstByteTimeouts = 0
  traceStream(
    'response_headers',
    { streamId, sessionId },
    {
      status: res.status,
      ok: res.ok,
      ttfb_ms: Date.now() - attemptStartedAt,
      resume_from: state.resumeFrom,
    },
  )

  return res
}

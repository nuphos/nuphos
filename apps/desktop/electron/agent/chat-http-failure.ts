import {
  CHAT_INITIAL_GATEWAY_RETRY_BASE_MS,
  CHAT_INITIAL_GATEWAY_RETRY_MAX_ATTEMPTS,
  CHAT_INITIAL_GATEWAY_RETRY_MAX_MS,
  traceStream,
} from './chat-shared.ts'
import {
  abortableSleep,
  agentHttpProductEvent,
  formatAgentHttpError,
  isAgentGatewayStatus,
  readAgentHttpError,
} from './stream-errors.ts'
import { storedMessageCountFromDetails } from './transcript-window.ts'

import type { ChatStreamCtx } from './chat-shared'
import type { AgentErrorContext, AgentHttpErrorPayload } from './stream-errors'

// The tail did not line up with the stored transcript. When the rejection
// carries the server's stored count, retry the same tail once claiming that
// count as baseIndex; otherwise the error surfaces like any other.
function rebaseOntoStoredCount(ctx: ChatStreamCtx, httpError: AgentHttpErrorPayload): boolean {
  const { streamId, sessionId, state } = ctx
  const storedCount = storedMessageCountFromDetails(httpError.details)

  if (storedCount === undefined || state.rebaseBaseIndex !== undefined) return false
  state.rebaseBaseIndex = storedCount
  traceStream(
    'transcript_rebase',
    { streamId, sessionId },
    { status: httpError.status, code: httpError.code, stored_message_count: storedCount },
    'warn',
  )
  console.warn('[agent] transcript window rejected; rebasing onto the stored count', {
    streamId,
    sessionId,
    storedCount,
  })

  return true
}

// A send that failed in transport before the backend stored the conversation
// leaves nothing to resume: the reconnect's resume POST gets a 404.
function isMissingResumeTarget(status: number, code: string | undefined): boolean {
  return (
    (status === 409 && code === 'stream_not_resumable') || (status === 404 && code === 'not_found')
  )
}

/** Handle a non-OK chat POST response: 'retry' re-enters the loop, 'stop' ends the turn. */
export async function handleChatHttpFailure(
  ctx: ChatStreamCtx,
  res: Response,
  shouldResume: boolean,
): Promise<'retry' | 'stop'> {
  const { streamId, sessionId, teamId, explicitResume, state, emit } = ctx
  const httpError = await readAgentHttpError(res)
  const errorContext: AgentErrorContext = {
    phase: 'http_response',
    streamId,
    sessionId,
    teamId,
    resumeFrom: state.resumeFrom,
    reconnectAttempts: state.reconnectAttempts,
    freshRetryAttempts: state.freshRetryAttempts,
    initialGatewayRetryAttempts: state.initialGatewayRetryAttempts,
    explicitResume,
    shouldResume,
  }
  const productEvent = agentHttpProductEvent(httpError)

  if (productEvent) {
    emit(productEvent)

    return 'stop'
  }

  if (
    isMissingResumeTarget(res.status, httpError.code) &&
    shouldResume &&
    state.resumeFrom === 0 &&
    !explicitResume &&
    !state.usedFreshStartFallback
  ) {
    state.usedFreshStartFallback = true
    state.forceFreshStart = true
    state.reconnectAttempts = 0
    traceStream(
      'fresh_start_fallback',
      { streamId, sessionId },
      {
        status: res.status,
        code: httpError.code,
      },
      'warn',
    )
    console.warn('[agent] resume state was missing before any events; retrying as a fresh stream', {
      streamId,
      sessionId,
    })

    return 'retry'
  }
  if (
    res.status === 409 &&
    httpError.code === 'transcript_out_of_sync' &&
    rebaseOntoStoredCount(ctx, httpError)
  ) {
    return 'retry'
  }
  if (state.reconnectAttempts === 0 && isAgentGatewayStatus(httpError.status)) {
    state.initialGatewayRetryAttempts += 1
    traceStream(
      'initial_gateway_retry',
      { streamId, sessionId },
      {
        status: httpError.status,
        attempt: state.initialGatewayRetryAttempts,
      },
      'warn',
    )
    const formatted = formatAgentHttpError(httpError, {
      ...errorContext,
      phase: 'initial_http_gateway_retry',
      initialGatewayRetryAttempts: state.initialGatewayRetryAttempts,
    })

    if (state.initialGatewayRetryAttempts > CHAT_INITIAL_GATEWAY_RETRY_MAX_ATTEMPTS) {
      emit({ type: 'error', error: formatted })

      return 'stop'
    }
    const delay = Math.min(
      CHAT_INITIAL_GATEWAY_RETRY_MAX_MS,
      CHAT_INITIAL_GATEWAY_RETRY_BASE_MS * 2 ** (state.initialGatewayRetryAttempts - 1),
    )

    console.warn('[agent] initial chat request hit gateway error; retrying', {
      streamId,
      sessionId,
      status: httpError.status,
      statusText: httpError.statusText,
      code: httpError.code,
      requestId: httpError.requestId,
      attempt: state.initialGatewayRetryAttempts,
      delay,
    })
    state.forceFreshStart = !explicitResume
    state.resumeFrom = explicitResume ? state.resumeFrom : 0
    state.reconnectAttempts = 0
    try {
      await abortableSleep(delay, ctx.signal)
    } catch {
      state.aborted = true
      emit({ type: 'aborted' })

      return 'stop'
    }

    return 'retry'
  }
  emit({ type: 'error', error: formatAgentHttpError(httpError, errorContext) })

  return 'stop'
}

export class OpenAbRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'OpenAbRpcError'
  }
}

/** The runtime transport closed under in-flight calls, with the close reason when one was given. */
export class OpenAbConnectionLostError extends Error {
  constructor(readonly reason = '') {
    super(reason ? `OpenAB ACP connection closed: ${reason}` : 'OpenAB ACP connection closed')
    this.name = 'OpenAbConnectionLostError'
  }

  get userMessage(): string {
    const detail = this.reason ? `: ${this.reason}` : ''

    return `Lost the connection to the agent runtime${detail}.`
  }
}

type SocketFailureEvent = { code?: number; message?: string; reason?: string }
type PendingSessionCall = {
  reject: (error: Error) => void
  sessionId?: string
  timer: ReturnType<typeof setTimeout>
}
type SessionSocket = { send: (data: string) => void }

export const SESSION_OUTPUT_SINK_UNAVAILABLE = 'ACP session output sink is unavailable'
export const SESSION_OUTPUT_SINK_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000]

/**
 * ACP assigns -32000 to `auth_required`: the agent holds no provider credential it
 * can bill, so a sign-in unblocks the turn and a retry never does. There is no
 * cheaper pre-flight — the agent CLI re-reads its own credential store, so a
 * session that was signed in a minute ago can raise this on the next turn.
 */
const ACP_AUTH_REQUIRED_CODE = -32000
/**
 * The prefix `RequestError.authRequired()` always carries, with or without an
 * adapter's own suffix. The code alone does not prove auth: JSON-RPC reserves
 * -32000..-32099 for implementation-defined server errors, and openab already
 * spends neighbours in that range on other conditions (-32003 key rejected,
 * -32004 dormant, -32005 busy). Requiring both fails closed — an adapter that
 * reuses -32000 for something else keeps its diagnostics instead of being
 * mislabelled as a sign-out.
 */
const ACP_AUTH_REQUIRED_MESSAGE = 'Authentication required'

/** Product code every client keys on to render sign-in guidance. */
export const RUNTIME_AUTH_REQUIRED_CODE = 'runtime_auth_required'
export const RUNTIME_AUTH_REQUIRED_MESSAGE =
  'This agent’s sign-in is no longer valid, so it could not start the turn. Sign the agent in again, then resend your message.'

export function isRuntimeAuthRequired(error: unknown): boolean {
  return (
    error instanceof OpenAbRpcError &&
    error.code === ACP_AUTH_REQUIRED_CODE &&
    error.message.includes(ACP_AUTH_REQUIRED_MESSAGE)
  )
}

/**
 * The provider answered the agent with HTTP 402: the account has no usage left
 * (Grok Build reports `usage balance exhausted`). Only credits or a reset fix it,
 * so it is a product state, not a transport failure.
 */
const PROVIDER_PAYMENT_REQUIRED = /\(status 402 Payment Required\): ?([^\n]*)/u

export const RUNTIME_USAGE_EXHAUSTED_CODE = 'runtime_usage_exhausted'

/** The sentence a client shows for a provider that refuses to bill, or undefined. */
export function runtimeUsageExhaustedMessage(error: unknown): string | undefined {
  // A caller may wrap the gateway's refusal, so its causes are read too.
  let match: RegExpExecArray | null = null
  let cause = error

  while (!match && cause instanceof Error) {
    match = PROVIDER_PAYMENT_REQUIRED.exec(cause.message)
    cause = cause.cause
  }
  if (!match) return undefined
  // The gateway appends its request id, which means nothing to the user.
  const reason = match[1]?.split(' requestId=')[0]?.trim()
  const detail = reason ? ` (${reason})` : ''

  return `This agent’s provider account has no usage left${detail}. Add credits or wait for its allowance to reset, or switch to another agent, then resend your message.`
}

export function isSessionOutputSinkUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.includes(SESSION_OUTPUT_SINK_UNAVAILABLE)
}

function retryAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('ACP prompt retry cancelled')
}

function retryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(retryAbortError(signal))

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(retryAbortError(signal))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

/** The gateway rejects this error before dispatching the prompt, so retrying
 * after the previous sink drains cannot duplicate model work. */
export async function retrySessionPromptWhenBusy<T>(
  prompt: () => Promise<T>,
  options: {
    delaysMs?: number[]
    signal?: AbortSignal
    onRetry?: (attempt: number, delayMs: number) => void
  } = {},
): Promise<T> {
  const delays = options.delaysMs ?? SESSION_OUTPUT_SINK_RETRY_DELAYS_MS

  for (let attempt = 0; ; attempt++) {
    try {
      return await prompt()
    } catch (error) {
      const delayMs = delays[attempt]

      if (!isSessionOutputSinkUnavailable(error) || delayMs === undefined) throw error
      options.onRetry?.(attempt + 1, delayMs)
      await retryDelay(delayMs, options.signal)
    }
  }
}

export function cancelSession(socket: SessionSocket, sessionId: string): boolean {
  try {
    socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId },
      }),
    )

    return true
  } catch {
    // The prompt remains pending until the socket disconnect or its deadline;
    // neither path may be replaced with a synthetic successful cancellation.
    return false
  }
}

export function connectionFailureMessage(event: SocketFailureEvent): string {
  const detail =
    (typeof event.reason === 'string' && event.reason) ||
    (typeof event.message === 'string' && event.message) ||
    ''
  const safeDetail = detail.replaceAll(/\s+/gu, ' ').trim().slice(0, 200)
  const closeCode = typeof event.code === 'number' ? `close code ${String(event.code)}` : ''
  const context = [closeCode, safeDetail].filter(Boolean).join(': ')
  const suffix = context ? ` (${context})` : ''

  return `Failed to connect to OpenAB ACP endpoint${suffix}`
}

/** Resolve or reject a pending JSON-RPC call from its response frame. */
export function settlePendingCall(
  pending: PendingSessionCall & {
    resolve: (value: Record<string, unknown>) => void
    onTextDelta?: (text: string) => void
  },
  message: Record<string, unknown>,
  cancelledSessions?: Set<string>,
): void {
  clearTimeout(pending.timer)
  const error = message.error

  if (error && typeof error === 'object') {
    const detail = error as Record<string, unknown>

    // Fence late cancellation output before the caller's catch can run.
    // A busy rejection must leave the other live prompt's observer intact.
    if (
      pending.sessionId &&
      pending.onTextDelta &&
      detail.message !== SESSION_OUTPUT_SINK_UNAVAILABLE &&
      detail.code !== -32001
    ) {
      cancelledSessions?.add(pending.sessionId)
    }
    pending.reject(
      new OpenAbRpcError(
        typeof detail.message === 'string' ? detail.message : 'OpenAB ACP error',
        typeof detail.code === 'number' ? detail.code : undefined,
      ),
    )

    return
  }
  const result = message.result

  pending.resolve(result && typeof result === 'object' ? (result as Record<string, unknown>) : {})
}

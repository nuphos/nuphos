import { AppError } from '@/lib/errors'

/** The adapter's own JSON-RPC error, relayed by the gateway in `error.data` under -32603. */
export type AcpAdapterError = { code: number; message: string }

export class OpenAbRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly adapter?: AcpAdapterError,
  ) {
    super(message)
    this.name = 'OpenAbRpcError'
  }
}

/** The runtime transport closed under in-flight calls, with the close reason when one was given. */
export class OpenAbConnectionLostError extends Error {
  /** `admitted`: the runtime had accepted this prompt, so the turn outlives the transport. */
  constructor(
    readonly reason = '',
    readonly admitted = false,
  ) {
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

// Runtimes before v0.1.50 send the adapter's error only in openab-core's display wrapper,
// `**<Label>** (code: N)\n<message>`. Delete this fallback once they are unsupported.
const ACP_WRAPPED = /^\*\*[^*\n]+\*\* \(code: (-?\d+)\)\n([\s\S]*)/u

/** The adapter's own error behind the gateway's -32603, from runtime v0.1.50 on its `data`. */
function adapterError(error: OpenAbRpcError): AcpAdapterError | undefined {
  if (error.code !== -32603) return undefined
  if (error.adapter) return error.adapter
  const wrapped = ACP_WRAPPED.exec(error.message)

  return wrapped ? { code: Number(wrapped[1]), message: wrapped[2] ?? '' } : undefined
}

export function acpErrorCode(error: OpenAbRpcError): number | undefined {
  return adapterError(error)?.code ?? error.code
}

/**
 * The provider answered the agent with HTTP 402: the account has no usage left
 * (Grok Build reports `usage balance exhausted`). Only credits or a reset fix it,
 * so it is a product state, not a transport failure.
 */
const PROVIDER_PAYMENT_REQUIRED = /\(status 402 Payment Required\): ?([^\n]*)/u

/**
 * Claude Code refuses a turn it cannot bill with its own one-line notice: it streams
 * it, then fails the prompt with -32603 `Internal error: <notice>` (first line only).
 */
const CLAUDE_NOTICE = /^Internal error: ([^\n]*)/u
/** The SDK's `USAGE_LIMIT_ERROR_PREFIXES` that name a limit; the notice already names the reset. */
const CLAUDE_USAGE_LIMIT =
  /^(?:You've hit your|You've reached your|You're out of usage credits|Your org is out of usage)/u
/** A credential the CLI holds but can no longer use, e.g. `Failed to authenticate: OAuth session expired …`. */
const CLAUDE_AUTH_FAILED = /^(?:Failed to authenticate\b|Invalid API key\b|.*Please run \/login\b)/u

/** The runtime's own reason for a failed turn: the first line after `Internal error: `. */
export function claudeNotice(error: unknown): string | undefined {
  const adapter = error instanceof OpenAbRpcError ? adapterError(error) : undefined

  return adapter?.code === -32603 ? CLAUDE_NOTICE.exec(adapter.message)?.[1]?.trim() : undefined
}

/** Claude Code's notice when it names a usage limit or a sign-in failure, or undefined. */
export function claudeProductStateNotice(error: unknown): string | undefined {
  const notice = claudeNotice(error)

  return notice && (CLAUDE_USAGE_LIMIT.test(notice) || CLAUDE_AUTH_FAILED.test(notice))
    ? notice
    : undefined
}

export function isRuntimeAuthRequired(error: unknown): boolean {
  if (!(error instanceof OpenAbRpcError)) return false
  if (CLAUDE_AUTH_FAILED.test(claudeNotice(error) ?? '')) return true

  const { code, message } = adapterError(error) ?? error

  return code === ACP_AUTH_REQUIRED_CODE && message.includes(ACP_AUTH_REQUIRED_MESSAGE)
}

export const RUNTIME_USAGE_EXHAUSTED_CODE = 'runtime_usage_exhausted'

/** The sentence a client shows for a provider that refuses to bill, or undefined. */
export function runtimeUsageExhaustedMessage(error: unknown): string | undefined {
  const notice = claudeNotice(error)

  if (notice && CLAUDE_USAGE_LIMIT.test(notice)) return notice
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

/** The runtime itself cannot take the turn, as opposed to the conversation being busy. */
const RUNTIME_UNAVAILABLE = /(?:^|_)runtime_(?:offline|unreachable|unavailable|login_required)$/u

/** Why an agent could not take a turn, when the cause was the agent itself; `other` when it was not. */
export type TurnFailureCause = 'usage_limit' | 'auth' | 'offline' | 'other'

export function turnFailureCause(error: unknown): TurnFailureCause {
  if (runtimeUsageExhaustedMessage(error)) return 'usage_limit'
  if (isRuntimeAuthRequired(error)) return 'auth'
  if (!(error instanceof AppError) || !RUNTIME_UNAVAILABLE.test(error.code)) return 'other'

  return error.code.endsWith('login_required') ? 'auth' : 'offline'
}

/** The sentence for a runtime that cannot bill a turn — signed out or out of usage — or undefined. */
export function runtimeProductStateMessage(error: unknown): string | undefined {
  return isRuntimeAuthRequired(error)
    ? RUNTIME_AUTH_REQUIRED_MESSAGE
    : runtimeUsageExhaustedMessage(error)
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
    const data = detail.data as Partial<AcpAdapterError> | null | undefined

    pending.reject(
      new OpenAbRpcError(
        typeof detail.message === 'string' ? detail.message : 'OpenAB ACP error',
        typeof detail.code === 'number' ? detail.code : undefined,
        typeof data?.code === 'number' && typeof data.message === 'string'
          ? { code: data.code, message: data.message }
          : undefined,
      ),
    )

    return
  }
  const result = message.result

  pending.resolve(result && typeof result === 'object' ? (result as Record<string, unknown>) : {})
}

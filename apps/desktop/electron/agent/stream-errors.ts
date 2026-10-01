import { inspect } from 'node:util'

export function parseSseEvent(raw: string): unknown {
  const dataLines: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null
  const data = dataLines.join('\n')

  if (data === '[DONE]') return null

  return JSON.parse(data)
}

export type AgentHttpErrorPayload = {
  code?: string
  message: string
  status: number
  statusText?: string
  requestId?: string
  upstreamStatus?: number
  details?: unknown
  rawBody?: string
}

export type AgentHttpProductEvent =
  | { type: 'agent-setup-required'; message: string; reason?: 'reauthentication' }
  | { type: 'conversation-busy'; message: string }
  | { type: 'runtime-not-ready'; message: string }

// ACP can wrap a revoked credential in JSON-RPC -32603 (Internal Error).
// Classify the credential failure, not that generic, potentially transient code.
export function agentReauthenticationEvent(error: {
  code?: unknown
  errorCode?: unknown
  message?: unknown
  errorText?: unknown
}): AgentHttpProductEvent | null {
  const code = error.errorCode ?? error.code
  const message = [error.message, error.errorText]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
  const terminalCode =
    typeof code === 'string' && /^refresh_token_(revoked|expired|reused)$/i.test(code)
  const terminalMessage =
    /\brefresh[ _-]token\b[^.\n]{0,160}\b(revoked|expired|reused|already been used)\b/i.test(
      message,
    )

  if (!terminalCode && !terminalMessage) return null

  return {
    type: 'agent-setup-required',
    reason: 'reauthentication',
    message:
      'Your agent sign-in is no longer valid. Open Settings → Agent and sign in again for this conversation’s agent, then resend your message. For an external agent, update its credentials on the host.',
  }
}

// Setup and busy states have dedicated UI; other failures retain diagnostics.
export function agentHttpProductEvent(error: AgentHttpErrorPayload): AgentHttpProductEvent | null {
  const reauthentication = agentReauthenticationEvent(error)

  if (reauthentication) return reauthentication
  if (error.code === 'claude_code_setup_required' || error.code === 'codex_setup_required') {
    return { type: 'agent-setup-required', message: error.message }
  }
  // A Slack-bound conversation whose session is mid-turn on the Slack side:
  // an expected product state, not a stream failure.
  if (error.code === 'conversation_busy') {
    return { type: 'conversation-busy', message: error.message }
  }
  if (error.code === 'runtime_not_accepting_message') {
    return { type: 'runtime-not-ready', message: error.message }
  }

  return null
}

export type AgentErrorContext = {
  phase: string
  streamId: string
  sessionId: string
  teamId?: string
  resumeFrom?: number
  reconnectAttempts?: number
  freshRetryAttempts?: number
  initialGatewayRetryAttempts?: number
  explicitResume?: boolean
  shouldResume?: boolean
}

function truncateDiagnostic(value: string, max = 1200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function stringifyDiagnostic(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return truncateDiagnostic(value)
  try {
    return truncateDiagnostic(JSON.stringify(value))
  } catch {
    return truncateDiagnostic(inspect(value, { depth: 2 }))
  }
}

function httpStatusLine(status: number, statusText?: string): string {
  const suffix = statusText ? ` ${statusText}` : ''

  return `HTTP ${String(status)}${suffix}`
}

export async function readAgentHttpError(res: Response): Promise<AgentHttpErrorPayload> {
  const rawBody = await res.text().catch(() => '')
  let message = httpStatusLine(res.status, res.statusText)
  let code: string | undefined
  let requestId: string | undefined
  let upstreamStatus: number | undefined
  let details: unknown

  if (rawBody.trim()) {
    try {
      const j = JSON.parse(rawBody) as {
        error?: {
          code?: string
          message?: string
          requestId?: string
          upstreamStatus?: number
          details?: unknown
        }
      }

      if (j.error?.code) code = j.error.code
      if (j.error?.message) message = j.error.message
      if (j.error?.requestId) requestId = j.error.requestId
      if (typeof j.error?.upstreamStatus === 'number') upstreamStatus = j.error.upstreamStatus
      if (j.error && 'details' in j.error) details = j.error.details
    } catch {
      // Preserve the gateway/proxy body as diagnostics instead of replacing it
      // with a generic retry message.
    }
  }

  return {
    code,
    message,
    status: res.status,
    statusText: res.statusText,
    requestId,
    upstreamStatus,
    details,
    rawBody: rawBody.trim() ? rawBody : undefined,
  }
}

export function isAgentGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504
}

function formatAgentErrorContext(context: AgentErrorContext): string {
  const fields = [
    `phase=${context.phase}`,
    `streamId=${context.streamId}`,
    `sessionId=${context.sessionId}`,
    context.teamId ? `teamId=${context.teamId}` : undefined,
    context.resumeFrom !== undefined ? `resumeFrom=${String(context.resumeFrom)}` : undefined,
    context.reconnectAttempts !== undefined
      ? `reconnectAttempts=${String(context.reconnectAttempts)}`
      : undefined,
    context.freshRetryAttempts !== undefined
      ? `freshRetryAttempts=${String(context.freshRetryAttempts)}`
      : undefined,
    context.initialGatewayRetryAttempts !== undefined
      ? `initialGatewayRetryAttempts=${String(context.initialGatewayRetryAttempts)}`
      : undefined,
    context.explicitResume !== undefined
      ? `explicitResume=${String(context.explicitResume)}`
      : undefined,
    context.shouldResume !== undefined ? `shouldResume=${String(context.shouldResume)}` : undefined,
  ].filter(Boolean)

  return fields.join(' ')
}

export function formatAgentHttpError(
  error: AgentHttpErrorPayload,
  context: AgentErrorContext,
): string {
  const status = httpStatusLine(error.status, error.statusText)
  const headline = error.code
    ? `Agent chat request failed with ${error.code} (${status}).`
    : `Agent chat request failed (${status}).`
  const lines = [headline, error.message]

  if (error.requestId) lines.push(`requestId=${error.requestId}`)
  if (error.upstreamStatus !== undefined)
    lines.push(`upstreamStatus=${String(error.upstreamStatus)}`)
  lines.push(`context=${formatAgentErrorContext(context)}`)
  const details = stringifyDiagnostic(error.details)

  if (details) lines.push(`details=${details}`)
  if (!error.code && error.rawBody) {
    lines.push(`rawResponse=${truncateDiagnostic(error.rawBody.replace(/\s+/g, ' ').trim())}`)
  }

  return lines.join('\n')
}

export function formatAgentSseError(
  error: Record<string, unknown>,
  context: AgentErrorContext,
): string {
  const errorText =
    typeof error.errorText === 'string' && error.errorText.trim()
      ? error.errorText.trim()
      : 'Agent stream emitted an error frame without errorText'
  const code = typeof error.errorCode === 'string' ? error.errorCode : undefined
  const requestId = typeof error.requestId === 'string' ? error.requestId : undefined
  const upstreamStatus = typeof error.upstreamStatus === 'number' ? error.upstreamStatus : undefined
  const details = stringifyDiagnostic(error.details ?? error.diagnostics)
  const lines = [code ? `Agent stream failed with ${code}.` : 'Agent stream failed.', errorText]

  if (requestId) lines.push(`requestId=${requestId}`)
  if (upstreamStatus !== undefined) lines.push(`upstreamStatus=${String(upstreamStatus)}`)
  lines.push(`context=${formatAgentErrorContext(context)}`)
  if (details) lines.push(`details=${details}`)

  return lines.join('\n')
}

export function formatAgentLocalError(message: string, context: AgentErrorContext): string {
  return `${message}\ncontext=${formatAgentErrorContext(context)}`
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // AbortSignal does not re-dispatch the abort event to listeners attached
    // after it has already fired — check up-front so a sleep that starts on an
    // already-aborted signal rejects immediately instead of waiting the full
    // delay.
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))

      return
    }
    const timeout = setTimeout(resolve, ms)

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

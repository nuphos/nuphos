import type { AgentRunTrace } from './types'
import type { MessageMetadata } from '@/lib/agent/message-metadata'

import { AppError } from '@/lib/errors'
import { errorTelemetryProperties } from '@/lib/observability'

export function serializeMessageDoc(message: {
  messageId: string
  role: 'user' | 'assistant'
  parts: unknown[]
  feedback?: { rating: 'up' | 'down' }
  createdAt?: Date
  metadata?: MessageMetadata
  turnOrigin?: 'autonomous'
  turnKind?: 'plan-approval'
}) {
  return {
    id: message.messageId,
    role: message.role,
    parts: message.parts,
    ...(message.metadata ? { metadata: message.metadata } : {}),
    // First-persisted time: turn start for user messages, turn end for
    // assistant messages — the pair yields a "worked for" duration client-side.
    createdAt: message.createdAt?.toISOString(),
    ...(message.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
    ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
    ...(message.feedback ? { feedback: message.feedback.rating } : {}),
  }
}

function getErrorMessage(error: unknown): string {
  if (error == null) return 'Unknown error'
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    const parts = [error.message]
    const cause = (error as Error & { cause?: unknown }).cause

    if (cause) {
      const causeMessage = getErrorMessage(cause)

      if (causeMessage && causeMessage !== error.message) {
        parts.push(`Cause: ${causeMessage}`)
      }
    }

    return parts.filter(Boolean).join('\n')
  }

  return JSON.stringify(error)
}

export function formatAgentStreamError(error: unknown): string {
  const message = getErrorMessage(error)

  // The Bedrock provider sometimes prefixes messages with a literal
  // "undefined: " when the upstream error type is missing — pure noise for
  // the user-facing frame.
  return message.trim().replace(/^undefined:\s*/, '') || 'Unknown error'
}

export function formatAgentStreamErrorForRequest(
  error: unknown,
  _requestId: string | undefined,
): string {
  return formatAgentStreamError(error)
}

function agentStreamErrorDiagnostics(error: unknown): Record<string, unknown> {
  const props = { ...errorTelemetryProperties(error) }

  delete props.error_stack

  return props
}

function agentStreamErrorCode(
  error: unknown,
  diagnostics: Record<string, unknown>,
): string | undefined {
  if (error instanceof AppError) return error.code
  const providerCode = diagnostics.provider_error_code

  if (typeof providerCode === 'string' && providerCode.length > 0) return providerCode

  return undefined
}

export function agentStreamErrorFrame(
  error: unknown,
  trace: AgentRunTrace | undefined,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const details = {
    ...agentStreamErrorDiagnostics(error),
    ...extras,
  }
  const code = agentStreamErrorCode(error, details)

  return {
    type: 'error',
    errorText: formatAgentStreamError(error),
    ...(code ? { errorCode: code } : {}),
    ...(typeof details.error_name === 'string' ? { errorName: details.error_name } : {}),
    ...(typeof details.error_status === 'number' ? { errorStatus: details.error_status } : {}),
    requestId: trace?.requestId,
    userId: trace?.userId,
    sessionId: trace?.sessionId,
    teamId: trace?.teamId,
    streamId: trace?.streamId,
    details,
  }
}

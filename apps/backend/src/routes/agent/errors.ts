import { CodexTurnFailedError } from '@/lib/claude-code-preview/codex-turn-failure'
import {
  acpErrorCode,
  claudeNotice,
  isRuntimeAuthRequired,
  OpenAbRpcError,
  RUNTIME_AUTH_REQUIRED_CODE,
  RUNTIME_USAGE_EXHAUSTED_CODE,
  runtimeProductStateMessage,
  runtimeUsageExhaustedMessage,
} from '@/lib/claude-code-preview/openab-acp-errors'
import { runtimeFailure } from '@/lib/claude-code-preview/runtime-failure'
import { AppError } from '@/lib/errors'
import { errorTelemetryProperties } from '@/lib/observability'

import type { AgentRunTrace } from './types'
import type { MessageMetadata } from '@/lib/agent/message-metadata'

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

/**
 * The stored copy of this turn: everything from its prompt on, with the index
 * the first message holds in the conversation. Earlier messages are left out
 * because the client already holds them, and a long conversation would make
 * this one frame tens of megabytes.
 */
export function transcriptTailFrame(
  stored: Parameters<typeof serializeMessageDoc>[0][],
  promptCount: number,
): Record<string, unknown> {
  const messagesFirstIndex = Math.max(
    0,
    stored.slice(0, promptCount).findLastIndex((message) => message.role === 'user'),
  )

  return {
    type: 'atlas-transcript-tail',
    messages: stored.slice(messagesFirstIndex).map(serializeMessageDoc),
    messagesFirstIndex,
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

/** A provider that failed the turn is not a runtime fault, whatever its notice says. */
function agentRuntimeFailure(error: unknown) {
  return error instanceof CodexTurnFailedError ? undefined : runtimeFailure(error)
}

export function formatAgentStreamError(error: unknown): string {
  // A signed-out or out-of-usage runtime is a product state with its own UI,
  // not a transport failure. Every client — including those that do not read
  // errorCode yet — gets the sentence instead of the gateway's wrapper.
  const productState = runtimeProductStateMessage(error)

  if (productState) return productState
  // A known runtime fault names the next step; the raw error stays in the frame's details.
  const failure = agentRuntimeFailure(error)

  if (failure) return failure.message
  const message = claudeNotice(error) ?? getErrorMessage(error)

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
  // The ACP refusal carries its code as a JSON-RPC number, which telemetry
  // normalization drops (it only lifts string codes), so name it here.
  if (isRuntimeAuthRequired(error)) return RUNTIME_AUTH_REQUIRED_CODE
  if (runtimeUsageExhaustedMessage(error)) return RUNTIME_USAGE_EXHAUSTED_CODE
  const failure = agentRuntimeFailure(error)

  if (failure) return failure.code
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
  const acpCode = error instanceof OpenAbRpcError ? acpErrorCode(error) : undefined
  const details: Record<string, unknown> = {
    ...agentStreamErrorDiagnostics(error),
    // Telemetry normalization drops numeric codes; the adapter's own one tells causes apart.
    ...(acpCode === undefined ? {} : { acp_error_code: acpCode }),
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

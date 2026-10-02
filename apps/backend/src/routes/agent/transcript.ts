import { config } from '@/config'
import { syncConversationTranscript } from '@/lib/agent/db'
import { persistedImagePart } from '@/lib/agent/image-parts'
import { stripInlineFileData } from '@/lib/agent/inbound-files'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { parseAgentMessageOrigin } from '@/lib/agent/message-origin'
import { withCostUsd } from '@/lib/agent/model-pricing'
import { withCachePoint } from '@/lib/agent/model-provider'
import { AppError } from '@/lib/errors'

import type { ConversationTriggerRun } from '@/lib/agent/conversation-trigger-run'
import type { AgentClientMeta, AgentConversation, AgentCredentialAccess } from '@/lib/agent/db'
import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { AgentMessageOrigin } from '@/lib/agent/message-origin'
import type { ProviderOptions } from '@/lib/agent/model-provider'
import type { AgentTokenUsageSummary } from '@/lib/agent/token-usage'
import type { UIMessage } from 'ai'

export { getFirstUserMessage, getUserMessageTexts } from './transcript-text'

export function userMessageContainsBlock(
  messages: { role: string; content?: unknown }[],
  block: string,
): boolean {
  return messages.some((message) => {
    if (message.role !== 'user') return false
    if (typeof message.content === 'string') return message.content.includes(block)

    return (
      Array.isArray(message.content) &&
      message.content.some(
        (part: { type?: string; text?: unknown }) =>
          part?.type === 'text' && typeof part.text === 'string' && part.text.includes(block),
      )
    )
  })
}

export type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: unknown[]
  metadata?: MessageMetadata
  origin?: AgentMessageOrigin
  turnOrigin?: 'autonomous'
  turnKind?: 'plan-approval'
}

// The content-filter fallback transform lives in a sibling file (this one is at
// the max-lines limit); re-exported so existing import paths hold.
export {
  CONTENT_FILTER_FALLBACK_TEXT,
  withContentFilterFallback,
} from './transcript-content-filter'

export function getFirstTranscriptMessage(messages: TranscriptMessage[], fallback: string): string {
  const userMessage = messages.find((m) => m.role === 'user')

  if (!userMessage) return fallback
  for (const part of userMessage.parts) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string' &&
      (part as { text: string }).text.trim()
    ) {
      return (part as { text: string }).text
    }
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'local-file' &&
      typeof (part as { path?: unknown }).path === 'string'
    ) {
      return `Local file: ${(part as { path: string }).path}`
    }
  }

  return fallback
}

export function normalizeTranscriptMessages(value: unknown): TranscriptMessage[] {
  if (!Array.isArray(value)) {
    throw new AppError(400, 'invalid_request', 'Body must include messages[]')
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new AppError(400, 'invalid_request', `Invalid message at index ${String(index)}`)
    }
    const message = raw as Record<string, unknown>

    if (typeof message.id !== 'string' || !message.id.trim()) {
      throw new AppError(400, 'invalid_request', `Missing message id at index ${String(index)}`)
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new AppError(400, 'invalid_request', `Invalid message role at index ${String(index)}`)
    }
    if (!Array.isArray(message.parts)) {
      throw new AppError(400, 'invalid_request', `Invalid message parts at index ${String(index)}`)
    }

    // Structurally validated, NOT server-verified. Unlike the three Slack event
    // handlers — where every identifier comes from a Slack-signed envelope —
    // an origin arriving here is whatever the client asserted. That is
    // acceptable only because the endpoint is owner-scoped (a caller can shape
    // just their own conversation, which they can already do by typing) and
    // because nothing downstream makes an authorization or routing decision
    // from a persisted origin. Do not add such a decision without first making
    // this path prove the origin, or reject one supplied here.
    const origin = parseAgentMessageOrigin(message.origin)

    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      ...(origin ? { origin } : {}),
      ...(message.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
      ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
    }
  })
}

// Attach the second static cache breakpoint to the last message of a
// system-segment span (ADR-0002 §3): the span's tail varies by conversation
// (URL context, kube context, diagrams are optional), and the breakpoint must
// exist in EVERY conversation, not only those with URL context.
export function withCachePointOnLast<
  T extends { role: 'system'; content: string; providerOptions?: ProviderOptions },
>(messages: T[]): T[] {
  const last = messages[messages.length - 1]

  if (last) last.providerOptions = withCachePoint(last.providerOptions)

  return messages
}

function isToolPartState(
  value: unknown,
): value is 'input-streaming' | 'input-available' | 'output-available' | 'output-error' {
  return (
    value === 'input-streaming' ||
    value === 'input-available' ||
    value === 'output-available' ||
    value === 'output-error'
  )
}

function normalizeUiMessagePartForTranscript(part: unknown): unknown {
  if (!part || typeof part !== 'object') return part
  const value = part as Record<string, unknown>

  if (
    value.type === 'data-attachment' &&
    value.data &&
    typeof value.data === 'object' &&
    (value.data as { type?: unknown }).type === 'transfer-upload'
  )
    return value.data
  if (typeof value.type !== 'string') return part
  const toolName = value.type.startsWith('tool-')
    ? value.type.slice('tool-'.length)
    : value.type === 'tool' && typeof value.toolName === 'string'
      ? value.toolName
      : null

  if (!toolName || typeof value.toolCallId !== 'string') return part

  return {
    type: 'tool',
    toolCallId: value.toolCallId,
    toolName,
    state: isToolPartState(value.state)
      ? value.state
      : value.errorText !== undefined
        ? 'output-error'
        : value.output !== undefined
          ? 'output-available'
          : value.input !== undefined
            ? 'input-available'
            : 'input-streaming',
    ...(value.input !== undefined ? { input: value.input } : {}),
    ...(value.output !== undefined ? { output: value.output } : {}),
    ...(typeof value.errorText === 'string' ? { errorText: value.errorText } : {}),
    ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
    ...(typeof value.completedAt === 'number' ? { completedAt: value.completedAt } : {}),
  }
}

function normalizeUiMessagePartsForTranscript(parts: unknown): unknown[] {
  if (!Array.isArray(parts)) return []

  return stripInlineFileData(parts.map(normalizeUiMessagePartForTranscript).map(persistedImagePart))
}

export function uiMessagesToTranscript(messages: UIMessage[]): TranscriptMessage[] {
  return messages.flatMap((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []

    // The bridge that received the message parks its origin on UIMessage
    // metadata; it is validated here rather than trusted, because the same
    // array is rebuilt from stored documents on every later turn.
    const origin = parseAgentMessageOrigin(
      (message.metadata as { origin?: unknown } | undefined)?.origin,
    )
    const { turnOrigin, turnKind } = (message.metadata ?? {}) as Record<string, unknown>

    return [
      {
        id:
          typeof message.id === 'string' && message.id.trim()
            ? message.id
            : `${message.role}-${String(index)}`,
        role: message.role,
        parts: normalizeUiMessagePartsForTranscript(message.parts),
        ...(parseMessageMetadata(message.metadata)
          ? { metadata: parseMessageMetadata(message.metadata) }
          : {}),
        ...(origin ? { origin } : {}),
        ...(turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' as const } : {}),
        ...(turnKind === 'plan-approval' ? { turnKind: 'plan-approval' as const } : {}),
      },
    ]
  })
}

export async function persistAcceptedConversationTurn(args: {
  sessionId: string
  userId: string
  teamId: string | undefined
  messages: UIMessage[]
  firstMessage: string
  locale: string
  credentialAccess: AgentCredentialAccess | undefined
  source?: string
  trigger?: ConversationTriggerRun
  client?: AgentClientMeta
  agentRuntime?: NonNullable<AgentConversation['agentRuntime']>
  runtimeId?: string
  runtimeLabel?: string
}): Promise<{ isNew: boolean } | null> {
  const transcriptMessages = uiMessagesToTranscript(args.messages)

  if (transcriptMessages.length === 0) return null

  return await syncConversationTranscript({
    sessionId: args.sessionId,
    userId: args.userId,
    teamId: args.teamId,
    title: '',
    firstMessage: getFirstTranscriptMessage(transcriptMessages, args.firstMessage || 'New chat'),
    messages: transcriptMessages,
    locale: args.locale,
    provider:
      args.agentRuntime === 'codex' || args.agentRuntime === 'claude-code'
        ? args.agentRuntime
        : config.agent.modelProvider,
    source: args.source,
    trigger: args.trigger,
    client: args.client,
    preserveTitle: true,
    credentialAccess: args.credentialAccess,
    agentRuntime: args.agentRuntime,
    runtimeId: args.runtimeId,
    runtimeLabel: args.runtimeLabel,
  })
}

export function serializeConversationDoc(conversation: Record<string, unknown>) {
  const {
    _id,
    runtimeOperation: _runtimeOperation,
    previousRuntimeUrls: _previousRuntimeUrls,
    ...rest
  } = conversation

  if (rest.tokenUsage && typeof rest.tokenUsage === 'object') {
    rest.tokenUsage = withCostUsd(rest.tokenUsage as AgentTokenUsageSummary)
  }

  return rest
}

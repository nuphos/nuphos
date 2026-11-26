import { t } from '../../../i18n/index.ts'
import { trustedAvatarURL } from '../../../lib/avatarUrl.ts'
import { AGENT_PROVIDERS } from '../../../types/runtime.ts'

import { parseMentions } from './messageMentionText.ts'

import type { AgentMessageMetadata } from '../../../api/agent-types'

function parseChannelPost(value: unknown): AgentMessageMetadata['channelPost'] {
  const p = (value ?? {}) as Partial<NonNullable<AgentMessageMetadata['channelPost']>>
  const s = p.sender

  if (typeof p.id !== 'string' || !p.id || typeof p.text !== 'string') return undefined
  if (!Number.isInteger(p.more) || !s || typeof s.id !== 'string' || !s.id) return undefined
  if (!['user', 'agent', 'system'].includes(s.type) || typeof s.displayName !== 'string')
    return undefined
  const agentRuntime = AGENT_PROVIDERS.find((provider) => provider === s.agentRuntime)
  const avatarURL = trustedAvatarURL(s.avatarURL)

  return {
    id: p.id,
    sender: {
      type: s.type,
      id: s.id,
      displayName: s.displayName,
      ...(agentRuntime ? { agentRuntime } : {}),
      ...(avatarURL ? { avatarURL } : {}),
    },
    text: p.text,
    more: Math.max(0, p.more!),
  }
}

function parseCreatedTriggers(value: unknown): AgentMessageMetadata['createdTriggers'] {
  if (!Array.isArray(value)) return undefined
  const triggers = value
    .slice(0, 64)
    .flatMap((item: { id?: unknown; name?: unknown } | null) =>
      item && typeof item.id === 'string' && item.id && typeof item.name === 'string' && item.name
        ? [{ id: item.id, name: item.name }]
        : [],
    )

  return triggers.length > 0 ? triggers : undefined
}

const SOURCES = new Set(['nuphos', 'slack', 'discord', 'lark', 'agent.thread', 'agent.resource'])

function parseReplyTo(value: unknown): AgentMessageMetadata['replyTo'] {
  const r = value as Partial<NonNullable<AgentMessageMetadata['replyTo']>> | undefined

  return typeof r?.authorName === 'string' && r.authorName && typeof r.text === 'string' && r.text
    ? {
        ...(typeof r.id === 'string' && r.id ? { id: r.id } : {}),
        authorName: r.authorName,
        text: r.text,
      }
    : undefined
}

/** Accept only the server-authored attribution shape; anything else is dropped. */
export function parseMessageMetadata(value: unknown): AgentMessageMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const m = value as Partial<AgentMessageMetadata>

  if (m.version !== 1 || !m.source || !SOURCES.has(m.source)) return undefined
  const via = m.sender?.onBehalfOf
  const onBehalfOf =
    m.source === 'nuphos' && typeof via?.id === 'string' && via.id
      ? { id: via.id, displayName: typeof via.displayName === 'string' ? via.displayName : '' }
      : undefined
  const senderType =
    m.source === 'agent.thread' || onBehalfOf
      ? 'agent'
      : m.source === 'agent.resource'
        ? 'system'
        : 'user'

  if (m.sender?.type !== senderType || typeof m.sender.id !== 'string' || !m.sender.id)
    return undefined
  if (typeof m.sender.displayName !== 'string' || typeof m.sentAt !== 'string') return undefined
  const agentRuntime = AGENT_PROVIDERS.find((p) => p === m.sender?.agentRuntime)
  const avatarURL = trustedAvatarURL(m.sender.avatarURL)
  const replyTo = parseReplyTo(m.replyTo)
  const mentions = m.source === 'nuphos' ? parseMentions(m.mentions) : undefined
  const channelPost =
    m.source === 'agent.resource' && m.sender.id.startsWith('channel:')
      ? parseChannelPost(m.channelPost)
      : undefined
  const createdTriggers =
    m.source === 'agent.thread' ? parseCreatedTriggers(m.createdTriggers) : undefined

  return {
    version: 1,
    sender: {
      type: senderType,
      id: m.sender.id,
      displayName: m.sender.displayName,
      ...(m.source === 'agent.thread' && agentRuntime ? { agentRuntime } : {}),
      ...(avatarURL ? { avatarURL } : {}),
      ...(onBehalfOf ? { onBehalfOf } : {}),
    },
    source: m.source,
    sentAt: m.sentAt,
    ...(typeof m.sourceSessionId === 'string' && m.sourceSessionId
      ? { sourceSessionId: m.sourceSessionId }
      : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(m.source === 'nuphos' && typeof m.requestId === 'string' && m.requestId
      ? {
          requestId: m.requestId,
          ...(m.answeredIn === 'inbox' ? { answeredIn: m.answeredIn } : {}),
        }
      : {}),
    ...(m.source === 'discord' && m.unattested === true ? { unattested: true as const } : {}),
    ...(mentions ? { mentions } : {}),
    ...(channelPost ? { channelPost } : {}),
    ...(createdTriggers ? { createdTriggers } : {}),
  }
}

/** "Grok Bot · via Yuanlin Lin" for an agent token's message, else the sender. */
export function senderLabel(sender: AgentMessageMetadata['sender']): string {
  return sender.onBehalfOf?.displayName
    ? t('{name} · via {behalf}', {
        name: sender.displayName,
        behalf: sender.onBehalfOf.displayName,
      })
    : sender.displayName
}

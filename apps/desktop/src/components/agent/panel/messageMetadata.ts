import { trustedAvatarURL } from '../../../lib/avatarUrl.ts'
import { AGENT_PROVIDERS } from '../../../types/runtime.ts'

import type { AgentMessageMetadata } from '../../../api/agent-types'

const SOURCES = new Set(['nuphos', 'slack', 'discord', 'lark', 'agent.thread', 'agent.resource'])

function parseReplyTo(value: unknown): AgentMessageMetadata['replyTo'] {
  const r = value as Partial<NonNullable<AgentMessageMetadata['replyTo']>> | undefined

  return typeof r?.authorName === 'string' && r.authorName && typeof r.text === 'string' && r.text
    ? { authorName: r.authorName, text: r.text }
    : undefined
}

/** Accept only the server-authored attribution shape; anything else is dropped. */
export function parseMessageMetadata(value: unknown): AgentMessageMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const m = value as Partial<AgentMessageMetadata>

  if (m.version !== 1 || !m.source || !SOURCES.has(m.source)) return undefined
  const senderType =
    m.source === 'agent.thread' ? 'agent' : m.source === 'agent.resource' ? 'system' : 'user'

  if (m.sender?.type !== senderType || typeof m.sender.id !== 'string' || !m.sender.id)
    return undefined
  if (typeof m.sender.displayName !== 'string' || typeof m.sentAt !== 'string') return undefined
  const agentRuntime = AGENT_PROVIDERS.find((p) => p === m.sender?.agentRuntime)
  const avatarURL = trustedAvatarURL(m.sender.avatarURL)
  const replyTo = parseReplyTo(m.replyTo)

  return {
    version: 1,
    sender: {
      type: senderType,
      id: m.sender.id,
      displayName: m.sender.displayName,
      ...(m.source === 'agent.thread' && agentRuntime ? { agentRuntime } : {}),
      ...(avatarURL ? { avatarURL } : {}),
    },
    source: m.source,
    sentAt: m.sentAt,
    ...(typeof m.sourceSessionId === 'string' && m.sourceSessionId
      ? { sourceSessionId: m.sourceSessionId }
      : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(m.source === 'discord' && m.unattested === true ? { unattested: true as const } : {}),
  }
}

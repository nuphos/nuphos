import { trustedAvatarURL } from '../../../lib/avatarUrl.ts'

import type { AgentMessageMetadata } from '../../../api/agent-types'

const SOURCES = ['nuphos', 'slack', 'discord', 'lark']

/** Accept only the server-authored attribution shape; anything else is dropped. */
export function parseMessageMetadata(value: unknown): AgentMessageMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const m = value as Partial<AgentMessageMetadata>

  if (m.version !== 1 || !m.source || !SOURCES.includes(m.source)) return undefined
  if (m.sender?.type !== 'user' || typeof m.sender.id !== 'string' || !m.sender.id) return undefined
  if (typeof m.sender.displayName !== 'string' || typeof m.sentAt !== 'string') return undefined
  const avatarURL = trustedAvatarURL(m.sender.avatarURL)

  return {
    version: 1,
    sender: {
      type: 'user',
      id: m.sender.id,
      displayName: m.sender.displayName,
      ...(avatarURL ? { avatarURL } : {}),
    },
    source: m.source,
    sentAt: m.sentAt,
  }
}

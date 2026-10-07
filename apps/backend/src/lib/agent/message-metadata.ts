import { trustedAvatarURL } from '../identity/avatar-url'

/** Server-authored attribution. Never derive authorization from these fields. */
export type MessageMetadata = {
  version: 1
  sender: { type: 'user'; id: string; displayName: string; email?: string; avatarURL?: string }
  /** Self-reported by the sender's registered Desktop; never proof of anything. */
  device?: MessageDevice
  source: 'nuphos' | 'slack'
  sentAt: string
}

export type MessageDevice = { label: string; platform: string }

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''

function parseDevice(value: unknown): MessageDevice | undefined {
  if (!value || typeof value !== 'object') return undefined
  const d = value as Partial<MessageDevice>

  if (!nonEmpty(d.label) || typeof d.platform !== 'string') return undefined

  return { label: d.label, platform: d.platform }
}

export function parseMessageMetadata(value: unknown): MessageMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const m = value as Partial<MessageMetadata>

  if (m.version !== 1 || (m.source !== 'nuphos' && m.source !== 'slack')) return undefined
  if (!m.sender || m.sender.type !== 'user' || typeof m.sender.id !== 'string' || !m.sender.id)
    return undefined
  if (
    typeof m.sender.displayName !== 'string' ||
    typeof m.sentAt !== 'string' ||
    !Number.isFinite(Date.parse(m.sentAt))
  )
    return undefined

  const device = parseDevice(m.device)

  return {
    version: 1,
    sender: {
      type: 'user',
      id: m.sender.id,
      displayName: m.sender.displayName,
      ...(nonEmpty(m.sender.email) ? { email: m.sender.email } : {}),
      ...(trustedAvatarURL(m.sender.avatarURL) ? { avatarURL: m.sender.avatarURL } : {}),
    },
    ...(device ? { device } : {}),
    source: m.source,
    sentAt: m.sentAt,
  }
}

/** Called only at the model boundary; never store this prefix in message parts. */
export function renderAttributedMessage(id: string, text: string, metadata: unknown): string {
  const attribution = parseMessageMetadata(metadata)

  if (!attribution) return text
  const { avatarURL: _avatarURL, ...sender } = attribution.sender
  const json = JSON.stringify({
    ...attribution,
    sender,
    messageId: id,
  }).replaceAll('<', '\\u003c')

  return `<nuphos_message_metadata>\n${json}\n</nuphos_message_metadata>\n\n${text}`
}

/** Restore trusted fields by stable message ID, never by transcript position. */
export function restoreAppMessageMetadata(
  messages: { id: string; metadata?: unknown; role?: string; parts?: unknown[] }[],
  stored: {
    messageId: string
    metadata?: unknown
    origin?: unknown
    turnOrigin?: string
    role?: string
    parts?: unknown[]
  }[],
  fresh?: MessageMetadata,
): void {
  const byId = new Map(stored.map((message) => [message.messageId, message]))

  for (const message of messages) {
    const previous = (message.metadata ?? {}) as Record<string, unknown>
    const saved = byId.get(message.id)
    const verified = parseMessageMetadata(saved?.metadata)

    if (verified && saved?.role === 'user' && saved.parts) {
      message.role = 'user'
      message.parts = saved.parts
    }
    const metadata = verified ?? (message === messages.at(-1) ? fresh : undefined)

    message.metadata = {
      ...(previous.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' } : {}),
      ...(saved?.origin ? { origin: saved.origin } : {}),
      ...(saved?.turnOrigin ? { turnOrigin: saved.turnOrigin } : {}),
      ...metadata,
    }
  }
}

// Where an inbound message actually came from, kept per MESSAGE rather than per
// conversation.
//
// The conversation already records a creation `source` ('slack.mention', …),
// but that is one value for the whole thread, and a Slack thread is shared:
// several teammates talk to the agent in the same conversation, each from their
// own Slack identity. Answering "who sent this one, in which channel" needed
// the rendered prose, which is display names only — not something a query or a
// tool call can use.
//
// Only Slack populates this today. The shape is a discriminated union on
// `surface` so the other bridges (Lark, Discord) can be added
// without a schema change; they do not currently carry their identifiers into
// the turn, so they are deliberately absent rather than half-filled.
import { stripPromptControlChars } from '@/lib/agent/prompt-text'

export type AgentMessageOrigin = {
  surface: 'slack'
  /** Slack team/workspace the message was posted in. */
  workspaceId: string
  channelId: string
  /** Human-readable channel name at receipt time, when the lookup succeeded. */
  channelName?: string
  /** Root of the thread the message belongs to; absent for a channel-level post. */
  threadTs?: string
  /** The message's own Slack timestamp — its stable per-channel identifier. */
  messageTs?: string
  /** Author's Slack user id. Verified by Slack, never inferred from a name. */
  userId?: string
  /** Display name at receipt time, when the lookup succeeded. */
  userName?: string
}

function optional(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// Drops blank/missing optionals so a stored origin never carries empty strings
// that later read as "we knew this and it was empty".
export function buildSlackMessageOrigin(args: {
  workspaceId: string
  channelId: string
  channelName?: string | null
  threadTs?: string | null
  messageTs?: string | null
  userId?: string | null
  userName?: string | null
}): AgentMessageOrigin | null {
  if (!args.workspaceId.trim() || !args.channelId.trim()) return null
  const channelName = optional(args.channelName)
  const threadTs = optional(args.threadTs)
  const messageTs = optional(args.messageTs)
  const userId = optional(args.userId)
  const userName = optional(args.userName)

  return {
    surface: 'slack',
    workspaceId: args.workspaceId.trim(),
    channelId: args.channelId.trim(),
    ...(channelName ? { channelName } : {}),
    ...(threadTs ? { threadTs } : {}),
    ...(messageTs ? { messageTs } : {}),
    ...(userId ? { userId } : {}),
    ...(userName ? { userName } : {}),
  }
}

// Validates an origin read back off a stored document. Old messages have no
// origin at all, and a shape written by a future version must not be trusted
// into the model's context unchecked.
export function parseAgentMessageOrigin(value: unknown): AgentMessageOrigin | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  if (record.surface !== 'slack') return null
  if (typeof record.workspaceId !== 'string' || typeof record.channelId !== 'string') return null

  return buildSlackMessageOrigin({
    workspaceId: record.workspaceId,
    channelId: record.channelId,
    channelName: typeof record.channelName === 'string' ? record.channelName : null,
    threadTs: typeof record.threadTs === 'string' ? record.threadTs : null,
    messageTs: typeof record.messageTs === 'string' ? record.messageTs : null,
    userId: typeof record.userId === 'string' ? record.userId : null,
    userName: typeof record.userName === 'string' ? record.userName : null,
  })
}

// Slack ids are opaque tokens ([A-Z0-9]) and timestamps are digits and a dot,
// so anything else in a field means it is not what it claims to be — a display
// name is the one member-controlled value here, and it lands in the model's
// context, so it gets the same treatment as the other untrusted strings in the
// system prompt (control characters stripped, length capped).
function safeName(value: string): string {
  return stripPromptControlChars(value)
    .replace(/[[\]\n]/g, ' ')
    .trim()
    .slice(0, 80)
}

// The model-visible form. Deliberately one compact bracketed line rather than
// prose: the surrounding rendered message already says who wrote it in words,
// and what this adds is the machine-usable ids the agent needs to act on the
// message (reply into the right thread, @-mention the sender, name the channel).
export function renderMessageOriginLine(origin: AgentMessageOrigin | null): string {
  if (!origin) return ''
  const parts = [
    `workspace ${origin.workspaceId}`,
    origin.channelName
      ? `channel ${origin.channelId} (#${safeName(origin.channelName)})`
      : `channel ${origin.channelId}`,
    ...(origin.threadTs ? [`thread ${origin.threadTs}`] : []),
    ...(origin.messageTs ? [`message ${origin.messageTs}`] : []),
    ...(origin.userId
      ? [
          origin.userName
            ? `sender ${origin.userId} (${safeName(origin.userName)})`
            : `sender ${origin.userId}`,
        ]
      : []),
  ]

  return `[Slack origin — ${parts.join(' · ')}]`
}

export function appendMessageOriginLine(
  renderedText: string,
  origin: AgentMessageOrigin | null,
): string {
  const line = renderMessageOriginLine(origin)

  return line ? `${renderedText}\n\n${line}` : renderedText
}

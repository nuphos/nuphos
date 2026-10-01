import { randomUUID } from 'node:crypto'

import { getConversationWithMessages } from '@/lib/agent/db'

import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { UIMessage } from 'ai'

function persistedMessage(message: {
  messageId: string
  role: string
  parts: unknown[]
}): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const parts = message.parts.filter((part) => {
    if (!part || typeof part !== 'object') return false
    const type = (part as { type?: unknown }).type

    return (
      typeof type === 'string' &&
      (type === 'text' || type === 'step-start' || type.startsWith('tool-'))
    )
  })

  return parts.length ? ({ id: message.messageId, role: message.role, parts } as UIMessage) : null
}

export async function buildMessagesForDiscordTurn(args: {
  sessionId: string
  ownerUserId: string
  teamId: string
  renderedText: string
}): Promise<UIMessage[]> {
  const existing = await getConversationWithMessages(args.sessionId, args.ownerUserId, args.teamId)
  const prior = (existing?.messages ?? [])
    .map(persistedMessage)
    .filter((message): message is UIMessage => message !== null)

  return [
    ...prior,
    {
      id: `discord-${randomUUID()}`,
      role: 'user',
      parts: [{ type: 'text', text: args.renderedText }],
    },
  ] as UIMessage[]
}

export const composeDiscordCarriedText = (carried: PendingUserMessage[], current: string) =>
  [...carried.map((entry) => entry.renderedText), current].join('\n\n')

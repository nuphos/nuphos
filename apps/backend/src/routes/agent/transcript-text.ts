import { parseMessageMetadata } from '@/lib/agent/message-metadata'

import type { UIMessage } from 'ai'

export function getFirstUserMessage(messages: UIMessage[]): string {
  const userMessage = messages.find((m) => m.role === 'user')

  if (!userMessage) return ''
  for (const part of userMessage.parts) {
    if (part.type === 'text' && part.text) return part.text
  }

  return ''
}

/**
 * Text of every user message, newest-first (first text part of each). An
 * unattested message is third-party talk, not the user's: it never steers the
 * language, the recall query or the memory query.
 */
export function getUserMessageTexts(messages: UIMessage[]): string[] {
  const texts: string[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]

    if (!m || m.role !== 'user' || parseMessageMetadata(m.metadata)?.unattested) continue
    for (const part of m.parts) {
      if (part.type === 'text' && part.text) {
        texts.push(part.text)
        break
      }
    }
  }

  return texts
}

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
 * Text of every message a person typed, newest-first (first text part of
 * each), so it steers the response language. An unattested message is
 * third-party talk, and an agent's or a system's (a parent agent, a Trigger,
 * GitHub) is no one's language: neither counts.
 */
export function getUserMessageTexts(
  messages: readonly Pick<UIMessage, 'role' | 'parts' | 'metadata'>[],
): string[] {
  const texts: string[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const metadata = m && parseMessageMetadata(m.metadata)

    // An unattributed (legacy) message still counts as the user's.
    if (
      !m ||
      m.role !== 'user' ||
      metadata?.unattested ||
      (metadata?.sender.type ?? 'user') !== 'user'
    )
      continue
    for (const part of m.parts) {
      if (part.type === 'text' && part.text) {
        texts.push(part.text)
        break
      }
    }
  }

  return texts
}

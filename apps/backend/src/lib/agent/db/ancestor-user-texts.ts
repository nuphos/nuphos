import { inferUserFacingLanguage } from '@/lib/agent/language'
import { getUserMessageTexts } from '@/routes/agent/transcript-text'

import { agentConversations, agentMessages } from './shared'

import type { UIMessage } from 'ai'

/** Enough recent messages to read a language from. */
const RECENT = 20

/**
 * What the owner typed, newest first, in the nearest ancestor of `sessionId`
 * where they typed anything. A sub-agent thread hears only its parent agent,
 * so this is where its owner's language comes from. Only the same owner's
 * ancestors count; empty when there is none.
 */
export async function ancestorUserTexts(sessionId: string): Promise<string[]> {
  const seen = new Set([sessionId])
  let link = await agentConversations().findOne(
    { sessionId },
    { projection: { userId: 1, parentSessionId: 1 } },
  )

  while (link?.parentSessionId && !seen.has(link.parentSessionId)) {
    const { userId } = link

    seen.add(link.parentSessionId)
    link = await agentConversations().findOne(
      { sessionId: link.parentSessionId, userId },
      { projection: { sessionId: 1, userId: 1, parentSessionId: 1 } },
    )
    if (!link) break
    const recent = await agentMessages()
      // Agents' and systems' deliveries can outnumber what the owner typed; skip them here.
      .find({
        sessionId: link.sessionId,
        userId,
        role: 'user',
        'metadata.sender.type': { $nin: ['agent', 'system'] },
      })
      .sort({ index: -1 })
      .limit(RECENT)
      .toArray()
    const texts = getUserMessageTexts(recent.toReversed() as unknown as UIMessage[])

    if (texts.length > 0) return texts
  }

  return []
}

/**
 * The language a turn's user-facing words are in: what people typed in this
 * conversation (`typed`, newest first), or, in a sub-agent thread that only
 * hears agents, in its nearest ancestor.
 */
export async function turnLanguage(
  sessionId: string,
  typed: string[],
  locale: string,
): Promise<string> {
  const texts = typed.length > 0 ? typed : await ancestorUserTexts(sessionId).catch(() => [])

  return inferUserFacingLanguage(texts, locale)
}

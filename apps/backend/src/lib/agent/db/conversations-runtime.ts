import { agentConversations, liveAttachment } from './shared'

import type { AgentConversation, BackgroundWorkLoss, ConversationPreviewAttachment } from './shared'

/**
 * Write-once runtime stamp for legacy conversations and accepted-turn races.
 * The filter is the immutability guard: concurrent callers may agree on the
 * first value, but no later Team setting change can overwrite it.
 */
export async function stampConversationAgentRuntime(
  sessionId: string,
  runtime: NonNullable<AgentConversation['agentRuntime']>,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, agentRuntime: { $exists: false } },
    { $set: { agentRuntime: runtime } },
  )
}

export async function clearConversationPreviewTurn(
  sessionId: string,
  teamId: string,
  turnKey: string,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, teamId, 'claudeCodePreviewContext.activeTurnKey': turnKey },
    {
      $unset: {
        'claudeCodePreviewContext.activeTurnKey': '',
        'claudeCodePreviewContext.activeTurnOrigin': '',
      },
    },
  )
}

/**
 * Revoke the stored Desktop-tool capability on its own, so a failed context
 * write cannot leave an earlier Desktop turn's `true` readable by a client
 * that runs no local tools.
 */
export async function clearConversationPreviewLocalTools(
  sessionId: string,
  teamId: string,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, teamId },
    { $unset: { 'claudeCodePreviewContext.localTools': '' } },
  )
}

/**
 * Record what became of this conversation's background work. Any replica's
 * next prompt reads it, so the notice outlives both the in-memory session
 * object and the backend pod that observed the loss. A mere loss of contact
 * never overwrites a confirmed one: the weaker wording must not displace the
 * stronger claim already on the record.
 */
export async function markConversationWorkLost(
  sessionId: string,
  teamId: string,
  reason: BackgroundWorkLoss,
): Promise<void> {
  const confirmed = { 'claudeCodePreviewWorkLost.reason': { $ne: 'session_lost' } }

  await agentConversations().updateOne(
    { sessionId, teamId, ...(reason === 'session_lost' ? {} : confirmed) },
    { $set: { claudeCodePreviewWorkLost: { at: new Date(), reason } } },
  )
}

/** Reads and clears the mark atomically; the reason when this turn owns it. */
export async function consumeConversationWorkLost(
  sessionId: string,
  teamId: string,
): Promise<BackgroundWorkLoss | null> {
  const previous = await agentConversations().findOneAndUpdate(
    { sessionId, teamId, claudeCodePreviewWorkLost: { $exists: true } },
    { $unset: { claudeCodePreviewWorkLost: '' } },
    { projection: { claudeCodePreviewWorkLost: 1 } },
  )

  return previous?.claudeCodePreviewWorkLost?.reason ?? null
}

/**
 * Offer the runtime's next-prompt guess to the composer. It lives in the
 * per-turn context, so the next turn's context write clears it.
 */
export async function setConversationPromptSuggestion(
  sessionId: string,
  teamId: string,
  suggestion: string,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, teamId },
    { $set: { 'claudeCodePreviewContext.promptSuggestion': suggestion } },
  )
}

export async function stampConversationRuntimeInstance(
  sessionId: string,
  runtimeId: string,
  runtimeLabel?: string,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, runtimeId: { $exists: false } },
    {
      $set: { runtimeId, ...(runtimeLabel ? { runtimeLabel } : {}) },
    },
  )
}

export async function getConversationPreviewAttachment(
  sessionId: string,
  teamId: string,
): Promise<ConversationPreviewAttachment | null> {
  const doc = await agentConversations().findOne(
    { sessionId, teamId },
    { projection: { claudeCodePreview: 1 } },
  )

  return liveAttachment(doc)
}

export async function setConversationPreviewAttachment(
  sessionId: string,
  teamId: string,
  attachment: ConversationPreviewAttachment,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, teamId },
    { $set: { claudeCodePreview: attachment } },
  )
}

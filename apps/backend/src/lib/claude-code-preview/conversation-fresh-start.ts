import {
  forgetConversationPreviewSession,
  getConversationMessages,
  getConversationPreviewAttachment,
  recordAgentEvent,
  recordBotStartedFresh,
  updateCompactionSummary,
} from '@/lib/agent/db'
import { claimAgentRunForSession } from '@/lib/agent/run-admission'
import { AppError } from '@/lib/errors'

import { closePreviewConversationSession } from './agent-chat-registry'
import { freshStartSummary } from './preview-history-preamble'
import { storedPick } from './session-config-options'

import type { AgentConversation } from '@/lib/agent/db'
import type { UIMessage } from 'ai'

/** The newest messages a fresh start quotes in its summary, at most. */
const CARRIED_MESSAGES = 4

/**
 * Starts a Bot fresh and keeps everything else about it. Its compaction summary
 * takes in every message so far and its inner session is dropped, as a lost one
 * is: the next turn opens a new session whose history starts here.
 */
export async function startConversationFresh(
  conversation: AgentConversation & { teamId: string },
  actorId: string,
): Promise<{ at: string; messageCount: number }> {
  const { sessionId, userId: ownerId, teamId } = conversation
  const release = await claimAgentRunForSession(ownerId, sessionId)

  if (!release)
    throw new AppError(
      409,
      'conversation_busy',
      `Wait for ${conversation.title || 'the Bot'} to finish replying, then start it fresh.`,
    )
  try {
    const at = new Date()
    const tail = await getConversationMessages(sessionId, ownerId, { tail: CARRIED_MESSAGES })
    const messageCount = (tail.at(-1)?.index ?? -1) + 1
    const quoted = tail.map(
      ({ messageId, role, parts, metadata }) =>
        ({ id: messageId, role, parts, metadata }) as UIMessage,
    )

    if (messageCount > 0)
      await updateCompactionSummary(
        sessionId,
        ownerId,
        freshStartSummary(quoted, messageCount, at),
        messageCount,
      )
    const attachment = await getConversationPreviewAttachment(sessionId, teamId)

    if (attachment)
      await forgetConversationPreviewSession(
        sessionId,
        teamId,
        attachment.openabSessionId,
        storedPick(attachment),
        { actorId, via: 'fresh_start' },
      )
    // Its runtime would keep the idle session for hours; ending it is best effort.
    void closePreviewConversationSession(teamId, sessionId)
    await recordBotStartedFresh(conversation, actorId, at)
    recordAgentEvent({
      conversationId: sessionId,
      event: 'bot.started_fresh',
      userId: actorId,
      data: { messageCount },
    })

    return { at: at.toISOString(), messageCount }
  } finally {
    release()
  }
}

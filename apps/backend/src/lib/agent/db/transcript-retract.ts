import { agentConversations, agentMessages, withTeamScope } from './shared'
import { withTranscriptWriteLock } from './transcript-write-lock'

import type { AgentMessage } from './shared'

import { withoutEmptyTurnSentinel } from '@/lib/claude-code-preview/codex-turn-failure'

export type RetractOutcome = 'retracted' | 'not_found' | 'not_sender' | 'answered'

type Stored = Pick<AgentMessage, 'messageId' | 'role' | 'parts' | 'metadata'>

/** Parts that are only a turn's bookkeeping, not anything the agent said or did. */
function isOutput(part: unknown): boolean {
  const type = (part as { type?: unknown }).type

  if (type === 'text' || type === 'reasoning')
    return Boolean((part as { text?: string }).text?.trim())

  return (
    type === 'file' ||
    type === 'dynamic-tool' ||
    type === 'data-steering' ||
    (typeof type === 'string' && type.startsWith('tool-'))
  )
}

/**
 * Whether `actorUserId` may take back `messageId`: it must be the last user
 * message, sent by them, and whatever the turn appended after it carries no
 * output. Returns the index to cut the transcript at.
 */
export function retractableAt(
  stored: Stored[],
  messageId: string,
  actorUserId: string,
  ownerUserId: string,
): { outcome: Exclude<RetractOutcome, 'retracted'> } | { outcome: 'retracted'; index: number } {
  const index = stored.findIndex((message) => message.messageId === messageId)
  const message = stored[index]

  if (!message || message.role !== 'user') return { outcome: 'not_found' }
  const sender = message.metadata?.sender

  if (sender ? sender.type !== 'user' || sender.id !== actorUserId : actorUserId !== ownerUserId)
    return { outcome: 'not_sender' }
  const answered = stored
    .slice(index + 1)
    .some(
      (next) =>
        next.role === 'user' ||
        withoutEmptyTurnSentinel(next.parts as never).some((part) => isOutput(part)),
    )

  return answered ? { outcome: 'answered' } : { outcome: 'retracted', index }
}

/** Remove a just-sent user message (and the empty turn after it) from the transcript. */
export async function retractTrailingUserMessage(args: {
  sessionId: string
  ownerUserId: string
  teamId: string
  messageId: string
  actorUserId: string
  /** Only report what a retraction would do; change nothing. */
  dryRun?: boolean
}): Promise<RetractOutcome> {
  const { sessionId, ownerUserId } = args

  return await withTranscriptWriteLock(sessionId, ownerUserId, async () => {
    const stored = await agentMessages()
      .find({ sessionId, userId: ownerUserId })
      .sort({ index: 1 })
      .toArray()
    const verdict = retractableAt(stored, args.messageId, args.actorUserId, ownerUserId)

    if (verdict.outcome !== 'retracted' || args.dryRun) return verdict.outcome
    await agentMessages().deleteMany({
      sessionId,
      userId: ownerUserId,
      messageId: { $in: stored.slice(verdict.index).map((message) => message.messageId) },
    })
    await agentConversations().updateOne(
      withTeamScope({ sessionId, userId: ownerUserId }, args.teamId),
      // The runtime's own session still holds the prompt; its next prompt there
      // is told to drop it (consumeConversationRetracted). Set under the same
      // lock, so no turn can start between the removal and the mark.
      {
        $set: {
          messageCount: verdict.index,
          transcriptUpdatedAt: new Date(),
          claudeCodePreviewRetractedAt: new Date(),
        },
      },
    )

    return 'retracted'
  })
}

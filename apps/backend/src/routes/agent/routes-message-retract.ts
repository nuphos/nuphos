import { getReadableConversation, retractTrailingUserMessage } from '@/lib/agent/db'
import { canReply, conversationAccess } from '@/lib/agent/db/access'
import { liveTurnHasOutput } from '@/lib/agent/live-turn'
import { turnCarried } from '@/lib/agent/retract-marks'
import { cancelConversationRuntime } from '@/lib/claude-code-preview/session-execution-state'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import { agent } from './router'
import { resolveVerifiedTeamId, readTeamIdCandidate } from './team-scope'

/** How long a retract waits for the stopped turn to write its end; tests shorten it. */
export const retractTurnEndWait = { ms: 15_000, pollMs: 250 }

/**
 * Take back the caller's own just-sent message: stop its turn, wait for the
 * turn to write its (empty) end, then drop the message. Refused once the turn
 * produced any output or took in anyone else's queued message, so nothing
 * anyone saw is erased and no turn with work in flight is stopped.
 */
agent.post('/conversations/:sessionId/messages/:messageId/retract', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const messageId = c.req.param('messageId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const read = () => getReadableConversation(sessionId, userId, teamId)
  const conversation = await read()

  if (!conversation?.teamId) throw new AppError(404, 'not_found', 'Conversation not found')
  if (!canReply(conversationAccess(conversation, userId)))
    throw new AppError(403, 'conversation_read_only', 'You can only view this conversation')
  const turn = conversation.claudeCodePreviewContext

  if (!turn?.activeTurnKey)
    throw new AppError(409, 'turn_not_running', 'The message has no running turn to take back')
  const { teamId: conversationTeamId, userId: ownerUserId } = conversation
  const answered = () =>
    new AppError(409, 'message_answered', 'The agent already answered this message')
  const retract = async (dryRun: boolean) => {
    const outcome = await retractTrailingUserMessage({
      sessionId,
      ownerUserId,
      teamId: conversationTeamId,
      messageId,
      actorUserId: userId,
      dryRun,
    })

    if (outcome === 'not_found') throw new AppError(404, 'not_found', 'Message not found')
    if (outcome === 'not_sender')
      throw new AppError(403, 'not_message_sender', 'Only the sender can take back a message')
    if (outcome === 'answered') throw answered()
  }

  // All checked before stopping: the stored transcript, the running turn's
  // frames (it persists nothing until it ends), and messages it carried in.
  await retract(true)
  if ((await turnCarried(turn.activeTurnKey)) || (await liveTurnHasOutput(ownerUserId, sessionId)))
    throw answered()
  await cancelConversationRuntime(conversation)
  for (let waited = 0; ; waited += retractTurnEndWait.pollMs) {
    if (!(await read())?.claudeCodePreviewContext?.activeTurnKey) break
    if (waited >= retractTurnEndWait.ms)
      throw new AppError(409, 'turn_still_running', 'The turn did not stop in time')
    await Bun.sleep(retractTurnEndWait.pollMs)
  }
  await retract(false)
  logEvent('info', 'agent.message.retracted', {
    trace_id: c.get('requestId'),
    user_id: userId,
    team_id: teamId,
    session_id: sessionId,
  })

  return c.json({ ok: true })
})

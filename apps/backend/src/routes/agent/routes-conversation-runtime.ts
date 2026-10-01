import { agent } from './router'
import { resolveVerifiedTeamId, readTeamIdCandidate } from './team-scope'

import { getReadableConversation } from '@/lib/agent/db'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import { cancelConversationRuntime } from '@/lib/claude-code-preview/session-execution-state'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

agent.post('/conversations/:sessionId/cancel-runtime', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  if (conversation.userId !== userId) {
    const active = await getActiveAgentRunForSession(conversation.userId, sessionId)

    if (active?.actorUserId !== userId)
      throw new AppError(403, 'forbidden', 'You can only stop your own active turn')
  }
  await cancelConversationRuntime(conversation)
  logEvent('info', 'agent.runtime.cancel_requested', {
    trace_id: c.get('requestId'),
    auth_source: 'authenticated_http',
    user_id: userId,
    team_id: teamId,
    session_id: sessionId,
    runtime_id: conversation.runtimeId,
  })

  return c.json({ ok: true, status: 'requested' })
})

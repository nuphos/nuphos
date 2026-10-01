import { AppError } from '@/lib/errors'
import { pickUpConversationInSlack } from '@/lib/slack/session-pickup'

import { agent } from './router'
import {
  assertConversationWritable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'

// "Pick up in Slack" from the desktop app: post a root message into the
// owner's Slack DM and bind this conversation to it, so replies from Slack
// continue the same session. Owner-only — the binding routes future turns and
// flips transcript authority to the server, which is not a viewer's call.
agent.post('/conversations/:sessionId/slack-pickup', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  // The Slack installation is per-team, so an unscoped conversation has no
  // workspace to pick the session up in.
  if (!teamId) {
    throw new AppError(400, 'invalid_request', 'teamId is required')
  }
  const conversation = await assertConversationWritable(sessionId, userId, teamId)

  if (!conversation) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  const result = await pickUpConversationInSlack({
    userId,
    teamId,
    sessionId,
    conversationTitle: conversation.title.trim() || 'New chat',
  })

  return c.json({
    status: result.status,
    slackThread: result.thread,
  })
})

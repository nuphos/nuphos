import { canManage, conversationAccess } from '@/lib/agent/db/access'
import { resourceConversation, unlinkSessionResource } from '@/lib/agent/session-resources'
import { AppError } from '@/lib/errors'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

agent.get('/conversations/:sessionId/resources', async (c) => {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  if (!teamId) throw new AppError(400, 'team_required', 'A team is required')
  const conversation = await resourceConversation({
    userId: c.get('userId'),
    teamId,
    sessionId: c.req.param('sessionId'),
  })

  return c.json({
    resources: conversation.linkedResources ?? [],
    canManage:
      !conversation.archivedAt && canManage(conversationAccess(conversation, c.get('userId'))),
  })
})

agent.delete('/conversations/:sessionId/resources/:resourceId', async (c) => {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  if (!teamId) throw new AppError(400, 'team_required', 'A team is required')

  return c.json(
    await unlinkSessionResource(
      { userId: c.get('userId'), teamId, sessionId: c.req.param('sessionId') },
      c.req.param('resourceId'),
    ),
  )
})

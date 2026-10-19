import { getReadableConversation, setConversationWatched } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

// PUT watches the conversation for the caller; DELETE unwatches it and every
// thread nested below it. Anyone who can read a conversation may watch it.
agent.on(['PUT', 'DELETE'], '/conversations/:sessionId/watch', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  const watching = c.req.method === 'PUT'

  await setConversationWatched(sessionId, conversation.teamId, userId, watching)

  return c.json({ ok: true, watching })
})

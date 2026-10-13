import { getSessionBypass, setSessionBypass } from '@/lib/agent/auto-mode/store'
import { getConversationBySessionId, recordAgentEvent } from '@/lib/agent/db'
import { managesConversation } from '@/lib/agent/db/access'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'

import { agent } from './router'

// Desktop builds up to 0.77 ask this whether to show the permission-mode picker
// on the home composer. Standing rules are gone, so the list is always empty.
// Remove once those builds are no longer in use.
agent.get('/auto-mode/policy/rules', (c) => c.json({ enabled: true, rules: [] }))

// Full Access: a per-conversation switch that allows the runtime's permission
// requests without asking. Each person has their own, applied to the turns they
// send; the owner and managers may set theirs.
async function assertCanSetMode(sessionId: string, userId: string) {
  const conversation = await getConversationBySessionId(sessionId)
  const isTeamMember =
    conversation?.userId !== userId && conversation?.teamId
      ? Boolean(await getTeamMembership(userId, conversation.teamId))
      : false

  if (!conversation || !managesConversation(conversation, userId, isTeamMember)) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
}

agent.get('/auto-mode/bypass', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.query('sessionId')

  if (!sessionId) throw new AppError(400, 'invalid_request', 'sessionId is required')
  await assertCanSetMode(sessionId, userId)
  const bypass = await getSessionBypass(sessionId, userId)

  return c.json({ enabled: true, bypass })
})

agent.put('/auto-mode/bypass', async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string; bypass?: boolean }

  if (!body.sessionId || typeof body.sessionId !== 'string' || typeof body.bypass !== 'boolean') {
    throw new AppError(400, 'invalid_request', 'sessionId and bypass are required')
  }
  await assertCanSetMode(body.sessionId, userId)
  await setSessionBypass(body.sessionId, userId, body.bypass)
  recordAgentEvent({
    conversationId: body.sessionId,
    userId,
    event: body.bypass ? 'auth.bypass_enabled' : 'auth.bypass_disabled',
  })

  return c.json({ ok: true, bypass: body.bypass })
})

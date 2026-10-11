import { getSessionBypass, setSessionBypass } from '@/lib/agent/auto-mode/store'
import { getConversationBySessionId, recordAgentEvent } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'

import { agent } from './router'

// Desktop builds up to 0.77 ask this whether to show the permission-mode picker
// on the home composer. Standing rules are gone, so the list is always empty.
// Remove once those builds are no longer in use.
agent.get('/auto-mode/policy/rules', (c) => c.json({ enabled: true, rules: [] }))

// Full Access: a per-conversation switch that allows the runtime's permission
// requests without asking.
agent.get('/auto-mode/bypass', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.query('sessionId')

  if (!sessionId) throw new AppError(400, 'invalid_request', 'sessionId is required')
  const conversation = await getConversationBySessionId(sessionId)

  if (!conversation || conversation.userId !== userId) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  const bypass = await getSessionBypass(sessionId, userId)

  return c.json({ enabled: true, bypass })
})

agent.put('/auto-mode/bypass', async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string; bypass?: boolean }

  if (!body.sessionId || typeof body.sessionId !== 'string' || typeof body.bypass !== 'boolean') {
    throw new AppError(400, 'invalid_request', 'sessionId and bypass are required')
  }
  const conversation = await getConversationBySessionId(body.sessionId)

  if (!conversation || conversation.userId !== userId) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  await setSessionBypass(body.sessionId, userId, body.bypass)
  recordAgentEvent({
    conversationId: body.sessionId,
    userId,
    event: body.bypass ? 'auth.bypass_enabled' : 'auth.bypass_disabled',
  })

  return c.json({ ok: true, bypass: body.bypass })
})

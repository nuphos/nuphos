import { isAutoModeApprovalEnabled as isAutoModeEnabled } from '@/lib/agent/auto-mode/approval'
import {
  RULE_DESCRIPTION_MAX_LENGTH,
  activateRule as activateAutoModeRule,
  addRule as addAutoModeRule,
  addSessionApproval as addAutoModeSessionApproval,
  getSessionBypass as getAutoModeSessionBypass,
  listRules as listAutoModeRules,
  removeRule as removeAutoModeRule,
  setSessionBypass as setAutoModeSessionBypass,
} from '@/lib/agent/auto-mode/store'
import { getConversationBySessionId, recordAgentEvent } from '@/lib/agent/db'
import { notePreviewDecision } from '@/lib/claude-code-preview/preview-decision-notes'
import { AppError } from '@/lib/errors'

import { agent } from './router'

agent.get('/auto-mode/policy/rules', async (c) => {
  const userId = c.get('userId')
  const rules = await listAutoModeRules(userId)

  return c.json({ enabled: isAutoModeEnabled(), rules })
})

// GUI: add a rule directly (active immediately — an explicit user action).
agent.post('/auto-mode/policy/rules', async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as { description?: string }

  if (!body.description?.trim()) {
    throw new AppError(400, 'invalid_request', 'description is required')
  }
  if (body.description.trim().length > RULE_DESCRIPTION_MAX_LENGTH) {
    throw new AppError(
      400,
      'rule_description_too_long',
      `Rule description must be ${String(RULE_DESCRIPTION_MAX_LENGTH)} characters or fewer`,
    )
  }
  const rule = await addAutoModeRule(userId, body.description.trim(), userId, 'active')

  return c.json({ rule })
})

// "Approve for session": persist the approved command for this conversation so
// the decision engine (exact match) and the judge (same-effect retries) stop
// re-prompting for it within the session.
agent.post('/auto-mode/session-approvals', async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string; command?: string }
  const command = typeof body.command === 'string' ? body.command.trim() : ''

  if (!body.sessionId || typeof body.sessionId !== 'string' || !command) {
    throw new AppError(400, 'invalid_request', 'sessionId and command are required')
  }
  if (command.length > 20_000) {
    throw new AppError(400, 'invalid_request', 'command too long')
  }
  const conversation = await getConversationBySessionId(body.sessionId)

  if (!conversation || conversation.userId !== userId) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  await addAutoModeSessionApproval(body.sessionId, userId, command)

  return c.json({ ok: true })
})

// Bypass Permissions: a per-conversation switch that disarms the authorization
// gate — every governed command auto-allows (journaled as layer `bypass`).
agent.get('/auto-mode/bypass', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.query('sessionId')

  if (!sessionId) throw new AppError(400, 'invalid_request', 'sessionId is required')
  const conversation = await getConversationBySessionId(sessionId)

  if (!conversation || conversation.userId !== userId) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  const bypass = await getAutoModeSessionBypass(sessionId, userId)

  return c.json({ enabled: isAutoModeEnabled(), bypass })
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
  await setAutoModeSessionBypass(body.sessionId, userId, body.bypass)
  recordAgentEvent({
    conversationId: body.sessionId,
    userId,
    event: body.bypass ? 'auth.bypass_enabled' : 'auth.bypass_disabled',
  })

  return c.json({ ok: true, bypass: body.bypass })
})

// GUI: confirm a proposed rule → active.
agent.post('/auto-mode/policy/rules/:ruleId/activate', async (c) => {
  const userId = c.get('userId')
  const ok = await activateAutoModeRule(userId, c.req.param('ruleId'))

  if (!ok) throw new AppError(404, 'not_found', 'rule_not_found')
  await notePreviewDecision('authorization-rule', c.req.param('ruleId'), 'approved', userId)

  return c.json({ ok: true })
})

agent.delete('/auto-mode/policy/rules/:ruleId', async (c) => {
  const userId = c.get('userId')

  await removeAutoModeRule(userId, c.req.param('ruleId'))
  await notePreviewDecision('authorization-rule', c.req.param('ruleId'), 'rejected', userId)

  return c.json({ ok: true })
})

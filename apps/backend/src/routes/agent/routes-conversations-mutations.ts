import { z } from 'zod'

import { config } from '@/config'
import {
  getConversationBySessionId,
  getReadableConversation,
  recordAgentEvent,
  renameConversation,
  setConversationArchived,
  setMessageFeedback,
  syncConversationTranscript,
  updateConversationCredentialAccess,
} from '@/lib/agent/db'
import { conversationAccess } from '@/lib/agent/db/access'
import { moveConversationRuntime } from '@/lib/claude-code-preview/conversation-runtime-move'
import { requireRuntimeInstance } from '@/lib/claude-code-preview/runtime-catalog'
import {
  isServerAuthoritativeTranscript,
  validateRequestedAgentRuntime,
  validateRequestedRuntimeId,
} from '@/lib/claude-code-preview/runtime-routing'
import { AppError } from '@/lib/errors'

import { isTranscriptSyncBlockedBySlackBinding } from './chat-slack-bound'
import { hydrateStoredPrefix } from './chat-validate'
import { credentialAccessResponse } from './credential-access'
import { resolveAgentCredentialAccess, resolveManagerCredentialAccess } from './credential-resolve'
import { agent } from './router'
import {
  assertConversationWritable,
  readTeamIdCandidate,
  resolveVerifiedTeamId,
} from './team-scope'
import { getFirstTranscriptMessage, normalizeTranscriptMessages } from './transcript'

agent.post('/conversations/:sessionId/messages/:messageId/feedback', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const messageId = c.req.param('messageId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))
  const rating = body.rating

  if (rating !== 'up' && rating !== 'down' && rating !== null) {
    throw new AppError(400, 'invalid_request', "rating must be 'up', 'down', or null")
  }
  const comment =
    typeof body.comment === 'string' && body.comment.trim()
      ? body.comment.trim().slice(0, 4000)
      : undefined
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  // Feedback is a single per-message record; only the conversation owner may
  // write it, so team viewers can't overwrite each other's votes.
  if (conversation.userId !== userId) {
    throw new AppError(403, 'forbidden', 'Only the conversation owner can rate messages')
  }
  const updated = await setMessageFeedback({
    sessionId,
    ownerUserId: conversation.userId,
    messageId,
    rating,
    comment,
    voterUserId: userId,
  })

  if (!updated) {
    throw new AppError(404, 'not_found', 'Message not found')
  }
  // Only signal comment presence here — the free-text itself stays on the
  // message doc, not in the append-only events log.
  recordAgentEvent({
    conversationId: sessionId,
    event: 'message.feedback',
    userId,
    data: {
      messageId,
      rating,
      hasComment: Boolean(comment),
    },
  })

  return c.json({ ok: true })
})

agent.patch('/conversations/:sessionId/credentials', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const body = await c.req.json()
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))
  const stored = await getConversationBySessionId(sessionId)
  const manager =
    stored &&
    teamId &&
    stored.userId !== userId &&
    stored.teamId === teamId &&
    conversationAccess(stored, userId) === 'manage'
  const { access, options } = manager
    ? await resolveManagerCredentialAccess({
        teamId,
        managerId: userId,
        ownerId: stored.userId,
        selection: body.credentialAccess,
        stored: stored.credentialAccess,
      })
    : await resolveAgentCredentialAccess({
        teamId,
        userId,
        selection: body.credentialAccess,
        ...(stored?.userId === userId ? { stored: stored.credentialAccess } : {}),
      })
  const conversation = await updateConversationCredentialAccess(
    sessionId,
    manager ? stored.userId : userId,
    teamId,
    access,
  )

  if (!conversation) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }

  return c.json({ credentialAccess: credentialAccessResponse(access), options })
})

agent.patch('/conversations/:sessionId/title', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const title = z.string().trim().min(1).max(120).safeParse(body.title)

  if (!title.success)
    throw new AppError(400, 'invalid_request', 'Title must contain 1–120 characters')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))
  const found = await renameConversation(
    c.req.param('sessionId'),
    c.get('userId'),
    teamId,
    title.data,
  )

  if (!found) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json({ title: title.data })
})

agent.patch('/conversations/:sessionId/archive', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  if (typeof body.archived !== 'boolean') {
    throw new AppError(400, 'invalid_request', 'archived must be a boolean')
  }
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))
  const found = await setConversationArchived(sessionId, userId, teamId, body.archived)

  if (!found) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }

  return c.json({ ok: true, archived: body.archived })
})

agent.put('/conversations/:sessionId/transcript', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const locale = c.req.header('X-Atlas-Locale') ?? 'en-US'
  const body = await c.req.json<Record<string, unknown>>()

  validateRequestedAgentRuntime(body.agentRuntime)
  validateRequestedRuntimeId(body.runtimeId)
  let messages = normalizeTranscriptMessages(body.messages)
  const baseIndex = typeof body.baseIndex === 'number' ? body.baseIndex : 0

  if (!Number.isInteger(baseIndex) || baseIndex < 0) {
    throw new AppError(400, 'invalid_request', 'baseIndex must be a non-negative integer')
  }
  // Verify the caller is a member of the resolved team before tagging the
  // conversation. Every input is client-supplied (body, query, URL headers),
  // so we ask Nuphos whether the caller actually belongs to that team rather
  // than trusting any of those sources directly. If verification fails the
  // conversation is stored without a teamId rather than reassigned.
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  const existing = await assertConversationWritable(sessionId, userId, teamId)
  const instance =
    !existing && body.runtimeId && teamId
      ? await requireRuntimeInstance(teamId, body.runtimeId, userId)
      : undefined

  if (!existing && body.runtimeId && !teamId)
    throw new AppError(400, 'invalid_request', 'An agent requires a workspace')
  if (instance?.status === 'disabled')
    throw new AppError(409, 'runtime_disabled', 'This agent is disabled')
  if (await isTranscriptSyncBlockedBySlackBinding(sessionId)) {
    return c.json({ ok: true, skipped: 'slack_bound' })
  }
  // Native runtimes persist their complete exchange on the server. A delayed
  // renderer snapshot must never replace it, even after the run has finished.
  // This includes new sessions: a PUT racing ahead of /chat would store the
  // first message without attribution, making /chat treat it as legacy history.
  if (isServerAuthoritativeTranscript(existing, instance?.provider ?? body.agentRuntime)) {
    return c.json({ ok: true, skipped: 'server_authoritative' })
  }
  if (baseIndex > 0) {
    // Same suffix protocol as /chat: hydrate the stored prefix so the sync
    // below still receives the full transcript and can't delete messages the
    // client simply hasn't loaded.
    messages = [...(await hydrateStoredPrefix(sessionId, userId, baseIndex, messages)), ...messages]
  }
  // The sync deletes whatever the body omits, and the prefix is hydrated above,
  // so only the tail can go missing — which means a shorter transcript is
  // always the stale one. A second device that ran a turn this client never saw
  // must not lose it to this client's older view.
  if (existing && messages.length < existing.messageCount) {
    return c.json({ ok: true, skipped: 'stale' })
  }
  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : 'New chat'
  const firstMessage = getFirstTranscriptMessage(messages, title)

  await syncConversationTranscript({
    sessionId,
    userId,
    teamId,
    title,
    firstMessage,
    messages,
    locale,
    provider: config.agent.modelProvider,
    agentRuntime: instance?.provider ?? body.agentRuntime,
    runtimeId: instance?.id,
    runtimeLabel: instance?.label,
  })

  return c.json({ ok: true })
})

agent.delete('/conversations/:sessionId', async () => {
  throw new AppError(405, 'method_not_allowed', 'Conversation deletion is disabled')
})

// Receives the run's SSE frames as they are appended, in order. Used by
// trigger surfaces that mirror the live run elsewhere (e.g. the Slack stream
// translator in lib/slack/stream-sink.ts). Both callbacks are invoked

agent.post('/conversations/:sessionId/runtime', async (c) => {
  const body = z
    .object({
      runtimeId: z.string().min(1).max(200),
      mode: z.enum(['history', 'workspace']),
      teamId: z.string().optional(),
    })
    .strict()
    .parse(await c.req.json())
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))
  // moveConversationRuntime decides who may move it: the owner or a manager.
  const conversation = await getReadableConversation(c.req.param('sessionId'), userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')

  return c.json(await moveConversationRuntime(conversation, body.runtimeId, body.mode, userId))
})

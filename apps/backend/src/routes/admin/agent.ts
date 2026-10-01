import {
  getAdminConversationStats,
  getAdminConversationWithMessages,
  getAdminConversations,
  getAdminFeedback,
  listAgentEvents,
} from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { signNuphosToken } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'
import {
  cleanQuery,
  parseFilterOp,
  parseLimit,
  serializeConversation,
} from '@/routes/admin/helpers'
import { claimAgentRunForSession, runAgentForTrigger } from '@/routes/agent'
import { persistedMessageToUiMessage } from '@/routes/slack'

import type { AdminVars } from '@/routes/admin/auth'
import type { UIMessage } from 'ai'
import type { Hono } from 'hono'

export function registerAdminAgentRoutes(adminRoutes: Hono<{ Variables: AdminVars }>) {
  adminRoutes.get('/agent/stats', async (c) => {
    return c.json(await getAdminConversationStats())
  })

  adminRoutes.get('/agent/events/:conversationId', async (c) => {
    const conversationId = c.req.param('conversationId')

    if (!conversationId) throw new AppError(400, 'invalid_request', 'Missing conversationId')
    let mongoEvents

    try {
      const docs = await listAgentEvents(conversationId)

      mongoEvents = docs.map((doc) => ({
        id: doc._id?.toHexString() ?? '',
        event: doc.event,
        ts: doc.ts.toISOString(),
        replicaId: doc.replicaId,
        ...(doc.userId ? { userId: doc.userId } : {}),
        ...(doc.data ? { data: doc.data } : {}),
      }))
    } catch {
      throw new AppError(503, 'agent_events_unavailable', 'Agent events backend unavailable')
    }

    return c.json({ conversationId, events: mongoEvents })
  })

  adminRoutes.get('/agent/conversations', async (c) => {
    const result = await getAdminConversations({
      limit: parseLimit(c.req.query('limit')),
      cursor: c.req.query('cursor') ?? undefined,
      q: cleanQuery(c.req.query('q')),
      userId: cleanQuery(c.req.query('userId')),
      userOp: parseFilterOp(c.req.query('userOp')),
      teamId: cleanQuery(c.req.query('teamId')),
      teamOp: parseFilterOp(c.req.query('teamOp')),
      sessionId: cleanQuery(c.req.query('sessionId')),
    })

    return c.json({
      ...result,
      conversations: result.conversations.map(serializeConversation),
    })
  })

  adminRoutes.get('/agent/feedback', async (c) => {
    const rating = c.req.query('rating')

    return c.json(
      await getAdminFeedback({
        limit: parseLimit(c.req.query('limit')),
        cursor: cleanQuery(c.req.query('cursor')),
        rating: rating === 'up' || rating === 'down' ? rating : undefined,
      }),
    )
  })

  adminRoutes.get('/agent/conversations/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')
    const result = await getAdminConversationWithMessages(sessionId)

    if (!result) throw new AppError(404, 'not_found', 'Conversation not found')

    return c.json({
      ...serializeConversation(result.conversation),
      messages: result.messages.map((message) => ({
        id: message.messageId,
        role: message.role,
        parts: message.parts,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        ...(message.feedback ? { feedback: message.feedback } : {}),
      })),
    })
  })

  // Support tool: re-run the agent loop for a session whose last stored message
  // is a user turn that never got a reply (crashed run, wedged transcript — e.g.
  // session 3c2e03db, where a skipped tool approval dead-locked every retry).
  // Reuses the trigger/Slack headless pipeline: history is rebuilt from the
  // stored transcript AS-IS (no user data is mutated, nothing is appended), the
  // run executes under the session owner's identity with the conversation's own
  // credential scope, and the assistant reply persists exactly like any other
  // turn — the user just sees their question answered next time they look.
  // Fires detached and returns immediately; progress is observable via the
  // admin session detail page and agent.chat.* events (source=admin.rewake).
  adminRoutes.post('/agent/conversations/:sessionId/rewake', async (c) => {
    const sessionId = c.req.param('sessionId')
    const result = await getAdminConversationWithMessages(sessionId)

    if (!result) throw new AppError(404, 'not_found', 'Conversation not found')
    const { conversation, messages } = result

    const uiMessages = messages
      .map((message) =>
        persistedMessageToUiMessage({
          messageId: message.messageId,
          role: message.role,
          parts: message.parts,
        }),
      )
      .filter((message): message is UIMessage => message !== null)
    const last = uiMessages[uiMessages.length - 1]

    if (!last || last.role !== 'user') {
      throw new AppError(
        409,
        'nothing_to_rewake',
        'The last stored message is not a user turn — there is nothing pending to re-run.',
      )
    }

    // Same per-session claim as interactive/Slack turns: never race a run the
    // user's own client (or another admin) already has in flight.
    const release = await claimAgentRunForSession(conversation.userId, sessionId)

    if (!release) {
      throw new AppError(409, 'run_in_flight', 'An agent run is already active for this session.')
    }

    const adminUserId = c.get('adminUserId')

    logEvent('info', 'admin.agent.rewake', {
      session_id: sessionId,
      user_id: conversation.userId,
      team_id: conversation.teamId,
      admin_user_id: adminUserId,
      message_count: uiMessages.length,
      last_active_at: conversation.lastActiveAt.toISOString(),
    })

    void (async () => {
      try {
        await runAgentForTrigger({
          userId: conversation.userId,
          // Short-lived token scoped to the session owner: the rewoken turn runs
          // with exactly the permissions the user's own retry would have had.
          nuphosToken: signNuphosToken(conversation.userId, 60 * 60 * 2),
          teamId: conversation.teamId,
          sessionId,
          messages: uiMessages,
          firstMessage: conversation.firstMessage,
          credentialAccess: conversation.credentialAccess,
          source: 'admin.rewake',
          locale: conversation.metadata?.locale,
        })
      } catch (err) {
        logError('admin.agent.rewake.error', err, {
          session_id: sessionId,
          user_id: conversation.userId,
          admin_user_id: adminUserId,
        })
      } finally {
        release()
      }
    })()

    return c.json({
      ok: true,
      sessionId,
      userId: conversation.userId,
      teamId: conversation.teamId ?? null,
      messageCount: uiMessages.length,
    })
  })
}

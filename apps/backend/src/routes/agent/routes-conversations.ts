import './routes-conversation-runtime'

import {
  buildConversationOwnerMap,
  buildSlackThreadLink,
  serializeConversationForViewer,
} from './conversation-view'
import { parseArchivedParam, parseSortParam } from './conversations-list-params'
import { serializeConversationList } from './conversations-list-view'
import { parseTriggerIdsParam } from './conversations-trigger-param'
import {
  allCredentialAccessFromOptions,
  hasCredentialOptions,
  isEmptyCredentialAccess,
} from './credential-access'
import { serializeTimelineEvents, timelineEventUserIds } from './conversation-timeline'
import { getAgentCredentialOptions } from './credential-options'
import { serializeMessageDoc } from './errors'
import { agent } from './router'
import { getLocalActiveAgentRun } from './run-registry'
import { normalizeOptionalTeamId, readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import {
  getConversationMessages,
  getConversationWithMessages,
  getConversations,
  getReadableConversation,
  updateConversationCredentialAccess,
} from '@/lib/agent/db'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import {
  conversationExecutionState,
  steerConversationRuntime,
} from '@/lib/claude-code-preview/session-execution-state'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'
import { isTeamIdShape } from '@/lib/team-id'

agent.get('/conversations', async (c) => {
  const userId = c.get('userId')
  const limitParam = c.req.query('limit')
  const cursor = c.req.query('cursor') ?? undefined
  // Listing is team-scoped, always. A missing or unverifiable teamId is an
  // error, never a wider default: both used to degrade into the viewer's chats
  // across every team — a list that looked right and silently crossed the team
  // boundary the caller believed it was inside.
  const requestedTeamId = normalizeOptionalTeamId(c.req.query('teamId'))

  if (!requestedTeamId) {
    throw new AppError(400, 'invalid_request', 'teamId is required')
  }
  // A malformed id is a bad request, not a denied one — 403 on `teamId=garbage`
  // reads as "this team exists and you can't have it".
  if (!isTeamIdShape(requestedTeamId)) {
    throw new AppError(400, 'invalid_request', 'teamId must be a valid team id')
  }
  const teamId = await resolveVerifiedTeamId(c, requestedTeamId)

  if (!teamId) {
    throw new AppError(403, 'forbidden', 'You are not a member of this team')
  }
  // `scope` only matters when teamId is present — see getConversations. We
  // accept it unconditionally so the desktop doesn't have to special-case the
  // personal feed; the db layer ignores it there.
  const scopeParam = c.req.query('scope')

  if (
    scopeParam != null &&
    scopeParam !== 'mine' &&
    scopeParam !== 'team' &&
    scopeParam !== 'shared'
  ) {
    throw new AppError(400, 'invalid_request', "scope must be 'mine', 'team' or 'shared'")
  }
  const scope = scopeParam ?? undefined
  // Optional single-member filter for the Chats reader. Only narrows team
  // scope — in 'mine' the viewer is already the only owner — and it grants
  // nothing new: team scope lists every member's conversations already.
  const ownerId = c.req.query('ownerId')?.trim() || undefined

  // User ids share the team id's 24-hex ObjectId shape.
  if (ownerId && !isTeamIdShape(ownerId)) {
    throw new AppError(400, 'invalid_request', 'ownerId must be a valid user id')
  }
  // Optional title/first-message substring filter for the history page.
  // Capped so a client can't submit an unbounded regex source string.
  const search = c.req.query('search')?.trim().slice(0, 200) || undefined
  const archived = parseArchivedParam(c.req.query('archived'))
  const sort = parseSortParam(c.req.query('sort'), archived)
  // Present = one trigger's (or one Watch group's) run history; absent = Chats,
  // which excludes trigger runs. See conversations-trigger-param.ts.
  const triggerIds = parseTriggerIdsParam(c.req.query('triggerId'))
  let limit: number | undefined

  if (limitParam != null) {
    const parsed = Number(limitParam)

    if (!Number.isFinite(parsed)) {
      throw new AppError(400, 'invalid_request', 'limit must be a number')
    }
    limit = Math.max(1, Math.min(100, Math.trunc(parsed)))
  }
  const result = await getConversations(userId, {
    limit,
    cursor,
    teamId,
    scope,
    ownerId,
    search,
    archived,
    sort,
    ...(triggerIds ? { triggerIds } : {}),
  })

  return c.json({
    ...result,
    conversations: await serializeConversationList(
      result.conversations as unknown as (Record<string, unknown> & {
        userId: string
        sessionId: string
      })[],
      c.get('user'),
      teamId,
    ),
  })
})

agent.get('/conversations/:sessionId', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  // Opt-in transcript truncation: `?tail=N` returns only the last N messages, plus
  // `messagesFirstIndex` so the client can page backwards. Omitting it keeps the
  // full transcript for existing consumers (fork, old clients).
  const tailRaw = c.req.query('tail')
  const tail = tailRaw !== undefined ? Number.parseInt(tailRaw, 10) : undefined

  if (tailRaw !== undefined && (!Number.isInteger(tail) || tail! < 1 || tail! > 1000)) {
    throw new AppError(400, 'invalid_request', 'tail must be an integer between 1 and 1000')
  }
  const result = await getConversationWithMessages(sessionId, userId, teamId, { tail })

  if (!result) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  const transportRun =
    getLocalActiveAgentRun(result.conversation.userId, sessionId) ??
    (await getActiveAgentRunForSession(result.conversation.userId, sessionId))
  // Opening a chat (`runtimeState=omit`) probes the runtime only to confirm a run.
  const probe = transportRun || c.req.query('runtimeState') !== 'omit'
  const runtimeState = probe ? await conversationExecutionState(result.conversation) : undefined
  const activeRun = runtimeState?.state === 'active' ? transportRun : null
  const startedAtMs = activeRun?.startedAt ? Number(activeRun.startedAt) : NaN
  const viewer = c.get('user')
  const ownerById = await buildConversationOwnerMap(teamId, [
    result.conversation.userId,
    ...timelineEventUserIds(result.conversation.timelineEvents),
  ])
  let slackThreadLookupFailed = false
  const slackThreadRecord = await getSlackAgentThreadBySessionId(sessionId).catch(
    (err: unknown) => {
      slackThreadLookupFailed = true
      logError('agent.conversation.slack_enrichment.error', err, {
        user_id: result.conversation.userId,
        session_id: sessionId,
        team_id: teamId,
      })

      return null
    },
  )
  const slackThread = await buildSlackThreadLink(slackThreadRecord)

  if (slackThread && teamId && isEmptyCredentialAccess(result.conversation.credentialAccess)) {
    try {
      const options = await getAgentCredentialOptions(teamId, result.conversation.userId)

      if (hasCredentialOptions(options)) {
        const access = allCredentialAccessFromOptions(options, result.conversation.userId)
        const updated = await updateConversationCredentialAccess(
          sessionId,
          result.conversation.userId,
          teamId,
          access,
        )

        result.conversation.credentialAccess = updated?.credentialAccess ?? access
      }
    } catch (err) {
      logError('agent.conversation.slack_default_credentials.error', err, {
        user_id: result.conversation.userId,
        session_id: sessionId,
        team_id: teamId,
      })
    }
  }
  const conversationForViewer = serializeConversationForViewer(
    result.conversation,
    viewer,
    ownerById,
    slackThreadRecord,
  )

  return c.json({
    ...conversationForViewer,
    // A resolved Slack binding no longer forces read-only: the owner continues
    // the conversation from the app and the turn is mirrored into the thread
    // (the Slack-bound branch in routes-chat-post.ts). Non-owners stay
    // read-only via the base flag. A FAILED lookup still fails closed: the
    // send path could not build the mirror either, so a turn would run
    // invisible to the thread — a transient read-only view is the cheaper
    // failure.
    readOnly: slackThreadLookupFailed ? true : conversationForViewer.readOnly,
    canCancelRun: conversationForViewer.isOwner || activeRun?.actorUserId === userId,
    canRespondToRun: activeRun?.actorUserId === userId,
    slackThread,
    messages: result.messages.map(serializeMessageDoc),
    transcriptUpdatedAt: result.conversation.transcriptUpdatedAt?.toISOString() ?? null,
    timelineEvents: serializeTimelineEvents(result.conversation.timelineEvents, ownerById),
    runtimeState,
    promptSuggestion: result.conversation.claudeCodePreviewContext?.promptSuggestion || null,
    // Absolute index of messages[0] in the stored transcript. 0 unless a
    // `tail` cut off earlier messages; then it doubles as the "there are
    // earlier messages" signal and the `before` cursor for the messages route.
    messagesFirstIndex: result.messages[0]?.index ?? 0,
    activeRun: activeRun
      ? {
          streamId: activeRun.streamId,
          startedAt: Number.isFinite(startedAtMs)
            ? new Date(startedAtMs).toISOString()
            : activeRun.startedAt,
        }
      : null,
  })
})

agent.post('/conversations/:sessionId/steer', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) throw new AppError(404, 'not_found', 'Conversation not found')
  const body = await c.req.json<{ text?: unknown; groupId?: unknown }>()
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const groupId = typeof body.groupId === 'string' ? body.groupId : ''

  if (!text && !groupId) throw new AppError(400, 'invalid_request', 'text or groupId is required')
  const runtime = await conversationExecutionState(conversation)

  if (!runtime.actions?.steer)
    throw new AppError(409, 'runtime_steering_unavailable', 'This agent cannot accept steering')
  const active = await getActiveAgentRunForSession(conversation.userId, sessionId)

  // This guard protects the actor's credential scope, not runtime activity.
  if (!active?.actorUserId || active.actorUserId !== userId)
    throw new AppError(
      409,
      'conversation_actor_unavailable',
      'The running turn is not owned by your current credential context',
    )
  const messageId = crypto.randomUUID()
  const sent = await steerConversationRuntime(conversation, { text, groupId, userId }, messageId)

  return c.json({ ok: true, messageId, text: sent })
})

// Page backwards through transcript messages before the absolute `before`
// index; `firstIndex` becomes the cursor until it reaches zero.
agent.get('/conversations/:sessionId/messages', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('sessionId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const before = Number.parseInt(c.req.query('before') ?? '', 10)

  if (!Number.isInteger(before) || before < 1) {
    throw new AppError(400, 'invalid_request', 'before must be a positive integer')
  }
  const limitRaw = c.req.query('limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : 100

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new AppError(400, 'invalid_request', 'limit must be an integer between 1 and 1000')
  }
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (!conversation) {
    throw new AppError(404, 'not_found', 'Conversation not found')
  }
  const messages = await getConversationMessages(sessionId, conversation.userId, {
    beforeIndex: before,
    tail: limit,
  })

  return c.json({
    messages: messages.map(serializeMessageDoc),
    firstIndex: messages[0]?.index ?? 0,
  })
})

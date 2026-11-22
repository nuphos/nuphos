import { getSessionBypass, modeSource, setSessionBypass } from '@/lib/agent/auto-mode/store'
import { getConversationBySessionId, getConversations, recordAgentEvent } from '@/lib/agent/db'
import { openInputRequests } from '@/lib/agent/db/pending-decision'
import { setThreadModel } from '@/lib/agent/thread-runtime'
import { getTeamMembership } from '@/lib/identity'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { hasActiveAgentRunForSession } from '@/routes/agent'

import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '')

export async function nuphosListSessions(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const teamId = text(args.team_id)

  if (!teamId) return toolError('`team_id` is required. Call nuphos_list_teams to see your teams.')
  if (!(await getTeamMembership(ctx.userId, teamId))) {
    return toolError(`You are not a member of team ${teamId}.`)
  }
  const limit = typeof args.limit === 'number' ? Math.min(Math.max(args.limit, 1), 30) : 15
  const { conversations, nextCursor } = await getConversations(ctx.userId, {
    teamId,
    limit,
    scope: args.scope === 'shared' ? 'shared' : 'mine',
    archived: 'exclude',
    ...(text(args.search) ? { search: text(args.search) } : {}),
    ...(text(args.cursor) ? { cursor: text(args.cursor) } : {}),
    ...(args.waiting_for_input === true ? { pendingDecision: true } : {}),
    // A Bot's Tasks, or a Task's sub-agents, whoever started them, as far as
    // the caller may read them.
    ...(text(args.parent_session_id)
      ? { parentSessionId: text(args.parent_session_id), scope: 'team' as const }
      : {}),
  })

  return toolResult({
    sessions: await Promise.all(
      conversations.map(async (c) => ({
        session_id: c.sessionId,
        title: c.title,
        last_active_at: c.lastActiveAt.toISOString(),
        message_count: c.messageCount,
        running: await hasActiveAgentRunForSession(c.userId, c.sessionId),
        waiting_for_input: openInputRequests(c).length > 0,
        ...(c.runtimeLabel ? { agent: c.runtimeLabel } : {}),
        ...(c.parentSessionId ? { parent_session_id: c.parentSessionId } : {}),
        ...(c.avatar ? { bot: true } : {}),
        ...(c.userId === ctx.userId ? {} : { owner: 'teammate' }),
      })),
    ),
    next_cursor: nextCursor,
  })
}

export async function nuphosUpdateSession(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const sessionId = text(args.session_id)
  const model = text(args.model)
  const effort = text(args.effort)
  const fullAccess = typeof args.full_access === 'boolean' ? args.full_access : undefined

  if (!sessionId) return toolError('`session_id` is required and must be a non-empty string.')
  if (!model && !effort && fullAccess === undefined) {
    return toolError('Set model, effort or full_access.')
  }
  // As in the app: only its owner changes a session's model or permission mode.
  const conversation = await getConversationBySessionId(sessionId)

  if (
    conversation?.userId !== ctx.userId ||
    !conversation.teamId ||
    !(await getTeamMembership(ctx.userId, conversation.teamId))
  ) {
    return toolError(`Session not found: ${sessionId}`)
  }

  // A Task under a Bot runs in its Bot's permission mode. Refused before
  // anything changes, like update_task.
  const modeFrom = await modeSource(sessionId)

  if (fullAccess !== undefined && modeFrom !== sessionId) {
    return toolError(
      `This Task runs in the permission mode of its Bot (session ${modeFrom}) and has none of its own. Change Full Access on the Bot.`,
    )
  }
  let pick: Awaited<ReturnType<typeof setThreadModel>>

  try {
    pick = await setThreadModel(
      sessionId,
      ctx.userId,
      {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      },
      {
        actorId: ctx.userId,
        via: 'mcp_update',
        ...(ctx.client?.name ? { client: ctx.client.name.slice(0, 80) } : {}),
      },
    )
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err))
  }
  if (fullAccess !== undefined) {
    await setSessionBypass(sessionId, ctx.userId, fullAccess)
    recordAgentEvent({
      conversationId: sessionId,
      userId: ctx.userId,
      event: fullAccess ? 'auth.bypass_enabled' : 'auth.bypass_disabled',
      data: { via: 'mcp', ...(ctx.client?.name ? { client: ctx.client.name } : {}) },
    })
  }

  return toolResult({
    session_id: sessionId,
    ...pick,
    full_access: await getSessionBypass(sessionId, ctx.userId),
    ...(modeFrom === sessionId ? {} : { full_access_follows: modeFrom }),
  })
}

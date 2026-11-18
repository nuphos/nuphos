// Driving a session from an MCP client as the app does: the agents it may run
// on, Stop, the waiting messages, and the run's events after a cursor. Each
// tool checks access as the app's route for the same action does.

import { getReadableConversation } from '@/lib/agent/db'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'
import { frameEvent } from '@/lib/agent/live-turn'
import { agentRuns, getLocalActiveAgentRun } from '@/lib/agent/run-admission'
import { getActiveAgentRunForSession, readAgentRunFramesAfter } from '@/lib/agent/run-store'
import {
  listRuntimeInstances,
  withRuntimeReadiness,
} from '@/lib/claude-code-preview/runtime-catalog'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { queued, takeOwnQueued } from '@/routes/agent/routes-conversation-queue'
import { stopConversationTurn } from '@/routes/agent/run-cancel'

import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '')

const EVENTS_PAGE = 200

export async function nuphosListRuntimes(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const teamId = text(args.team_id)

  if (!teamId) return toolError('`team_id` is required. Call nuphos_list_teams to see your teams.')
  if (!(await getTeamMembership(ctx.userId, teamId)))
    return toolError(`You are not a member of team ${teamId}.`)
  const runtimes = await withRuntimeReadiness(
    teamId,
    await listRuntimeInstances(teamId, ctx.userId),
  )

  return toolResult({
    runtimes: runtimes.map((runtime) => ({
      runtime_id: runtime.id,
      label: runtime.label,
      agent: runtime.provider,
      kind: runtime.kind,
      // Only an active, reachable agent takes a new conversation; a computer must be online.
      available:
        runtime.status === 'active' &&
        !runtime.notReady &&
        !runtime.deletion &&
        runtime.local?.online !== false &&
        runtime.local?.signedIn !== false,
      ...(runtime.local ? { computer: runtime.local.deviceLabel } : {}),
    })),
  })
}

/** The session as the caller may read it, or the tool error to return. */
async function readable(args: Record<string, unknown>, ctx: McpCallContext) {
  const sessionId = text(args.session_id)

  if (!sessionId) return toolError('`session_id` is required and must be a non-empty string.')

  return (
    (await getReadableConversation(sessionId, ctx.userId)) ??
    toolError(`Session not found: ${sessionId}`)
  )
}

const isError = (value: unknown): value is ToolResult =>
  typeof value === 'object' && value !== null && 'isError' in value

export async function nuphosStop(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const conversation = await readable(args, ctx)

  if (isError(conversation)) return conversation
  if (!(await canReplyIn(conversation, ctx.userId)))
    return toolError('You can only view this session, so you cannot stop it.')
  const status = await stopConversationTurn(conversation)

  return toolResult({ session_id: conversation.sessionId, status })
}

export async function nuphosListQueue(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const conversation = await readable(args, ctx)

  if (isError(conversation)) return conversation
  const owner = conversation.userId

  return toolResult({
    session_id: conversation.sessionId,
    queued: (await queued(conversation)).map((message) => ({
      queued_id: message.id,
      text: message.renderedText,
      mine: (message.actorUserId ?? owner) === ctx.userId,
      received_at: new Date(message.receivedAt).toISOString(),
    })),
  })
}

export async function nuphosRemoveQueued(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const conversation = await readable(args, ctx)
  const queuedId = text(args.queued_id)

  if (isError(conversation)) return conversation
  if (!queuedId) return toolError('`queued_id` is required. See nuphos_list_queue.')
  try {
    const message = await takeOwnQueued(conversation, ctx.userId, queuedId)

    return toolResult({
      session_id: conversation.sessionId,
      removed: true,
      text: message.renderedText,
    })
  } catch (err) {
    if (err instanceof AppError) return toolError(err.message)
    throw err
  }
}

/** `<streamId>/<entryId>`: one run's stream and the last entry read from it. */
function parseCursor(value: string): { streamId: string; after: string } | null {
  const [streamId, after, extra] = value.split('/')

  return streamId && after && extra === undefined ? { streamId, after } : null
}

/**
 * Without Redis (one replica, as a self-hosted compose stack runs) the run's
 * frames are only in this process: an entry id is the frame's position.
 */
function localFramesAfter(owner: string, streamId: string, after: string, count: number) {
  // eslint-disable-next-line sonarjs/no-empty-collection -- populated by registerAgentRun
  const run = [...agentRuns.values()].find((r) => r.userId === owner && r.streamId === streamId)
  const start = after === '-' ? 0 : Number(after)

  if (!run || !Number.isInteger(start) || start < 0) return []

  return run.frames
    .slice(start, start + count)
    .map((frame, i) => ({ id: String(start + i + 1), frame }))
}

export async function nuphosEvents(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const conversation = await readable(args, ctx)

  if (isError(conversation)) return conversation
  const raw = text(args.cursor)
  const cursor = raw ? parseCursor(raw) : null

  if (raw && !cursor) return toolError('`cursor` is not one this tool returned.')
  // Runs are keyed by the conversation owner, whoever reads them.
  const owner = conversation.userId
  const active =
    getLocalActiveAgentRun(owner, conversation.sessionId) ??
    (await getActiveAgentRunForSession(owner, conversation.sessionId))
  const base = {
    session_id: conversation.sessionId,
    running: Boolean(active),
    // The stored transcript has every finished turn: nuphos_check from_index reads it.
    message_count: conversation.messageCount,
  }
  // A cursor on a finished turn reads that turn to its end before the next one starts.
  const streamId = cursor?.streamId ?? active?.streamId

  if (!streamId) return toolResult({ ...base, events: [], cursor: null })
  const after = cursor?.streamId === streamId ? cursor.after : '-'
  const entries =
    (await readAgentRunFramesAfter(owner, streamId, after, EVENTS_PAGE)) ??
    localFramesAfter(owner, streamId, after, EVENTS_PAGE)
  const events = entries.flatMap((entry) => frameEvent(entry.frame) ?? [])
  const last = entries.at(-1)?.id ?? after
  // Read to the end of a turn that is no longer the running one: continue on the new one.
  const ended = streamId !== active?.streamId && entries.length < EVENTS_PAGE

  return toolResult({
    ...base,
    events,
    // Always a point to resume from: a new turn is picked up from it once one starts.
    cursor: ended && active ? `${active.streamId}/-` : `${streamId}/${last}`,
    ...(ended ? { turn_ended: true } : {}),
  })
}

import { randomUUID } from 'node:crypto'

import {
  getConversationBySessionId,
  getConversationWithMessages,
  getReadableConversation,
  recordAgentEvent,
} from '@/lib/agent/db'
import { answerDecision } from '@/lib/agent/decision-answer'
import { canReplyIn } from '@/lib/agent/devices/conversation-computer'
import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { buildPendingUserMessage } from '@/lib/agent/pending-messages'
import { AppError } from '@/lib/errors'
import { getTeamMembership, signNuphosToken } from '@/lib/identity'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { logError } from '@/lib/observability'
import { claimAgentRunOrEnqueue, runAgentForTrigger } from '@/routes/agent'
import { persistedMessageToUiMessage, readLatestAnswer } from '@/routes/mcp/transcript'

import type { AgentConversation } from '@/lib/agent/db'
import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'
import type { UIMessage } from 'ai'

// Token TTL for the minted per-call Nuphos identity. Mirrors executeTrigger's
// 8h window — long enough to outlive a slow run, short enough to stay bounded.
const NUPHOS_TOKEN_TTL_SECONDS = 60 * 60 * 8

/**
 * Continuing a session: the caller's own, or one they take part in and may
 * reply in, in the same team it was started in. Its turns stay its owner's.
 */
async function maySendTo(
  conversation: AgentConversation,
  teamId: string,
  userId: string,
): Promise<boolean> {
  if ((conversation.teamId ?? undefined) !== teamId) return false
  if (conversation.userId === userId) return true

  return (
    (await getReadableConversation(conversation.sessionId, userId, teamId)) !== null &&
    (await canReplyIn(conversation, userId))
  )
}

/**
 * An answer to an open question is not a message: the question is resolved and
 * the agent that asked is woken with it, as when a person answers its card.
 */
async function answerQuestion(
  conversation: AgentConversation,
  teamId: string,
  requestId: string,
  text: string,
  ctx: McpCallContext,
): Promise<ToolResult> {
  try {
    const { sender } = await createMessageMetadata(ctx.userId, 'nuphos')

    await answerDecision({
      conversation,
      requestId,
      answer: { text },
      actor: { id: ctx.userId, displayName: sender.displayName, avatarURL: sender.avatarURL },
      teamId,
    })
    recordAgentEvent({
      conversationId: conversation.sessionId,
      userId: ctx.userId,
      event: 'decision.answered',
      data: { requestId, via: 'mcp', ...(ctx.client?.name ? { client: ctx.client.name } : {}) },
    })
  } catch (err) {
    if (err instanceof AppError) return toolError(err.message)
    throw err
  }

  return toolResult({
    status: 'running',
    session_id: conversation.sessionId,
    progress: {
      message: 'The answer was delivered and the Nuphos Agent carries on. Poll nuphos_check.',
    },
  })
}

/** Resolves once the conversation exists, or after five seconds without it. */
async function untilStored(sessionId: string): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    if (await getConversationBySessionId(sessionId)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export async function nuphosAsk(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''

  if (!prompt) return toolError('`prompt` is required and must be a non-empty string.')

  // Required: every conversation must belong to a team so it stays visible and
  // governable in that team's workspace (teamless sessions are invisible to
  // team admins and audit).
  const teamId =
    typeof args.team_id === 'string' && args.team_id.trim() ? args.team_id.trim() : undefined

  if (!teamId) {
    return toolError(
      '`team_id` is required. Call nuphos_list_teams to see your teams and pass ' +
        'one of the returned team_id values.',
    )
  }
  const membership = await getTeamMembership(ctx.userId, teamId)

  if (!membership) return toolError(`You are not a member of team ${teamId}.`)

  const sessionId =
    typeof args.session_id === 'string' && args.session_id.trim()
      ? args.session_id.trim()
      : randomUUID()

  const existing = await getConversationBySessionId(sessionId)

  if (existing && !(await maySendTo(existing, teamId, ctx.userId))) {
    return toolError(
      existing.userId === ctx.userId
        ? `Session ${sessionId} was started with a different team_id; pass the same team_id to continue it.`
        : `Session not found: ${sessionId}`,
    )
  }
  const ownerUserId = existing?.userId ?? ctx.userId
  const requestId = typeof args.request_id === 'string' ? args.request_id.trim() : ''

  if (requestId) {
    return existing
      ? answerQuestion(existing, teamId, requestId, prompt, ctx)
      : toolError(`Session not found: ${sessionId}`)
  }

  // Fold optional structured context into the user turn. The agent takes plain
  // text turns, so we wrap the JSON in a tagged block it can read.
  const contextBlock =
    args.context && typeof args.context === 'object'
      ? `\n\n<context>\n${JSON.stringify(args.context).replaceAll('<', '\\u003c')}\n</context>`
      : ''

  // runAgentForTrigger syncs the DB transcript to exactly the messages it is
  // given, so a multi-turn continuation must replay the prior turns.
  const prior = existing
    ? (await getConversationWithMessages(sessionId, ctx.userId, teamId))?.messages
        .map(persistedMessageToUiMessage)
        .filter((message): message is UIMessage => message !== null)
    : undefined

  const renderedText = `${prompt}${contextBlock}`
  // The caller's own request, made through their MCP client: attributed to them.
  // Resolved before the claim below, which nothing would release if this threw.
  const attribution = await createMessageMetadata(ctx.userId, 'nuphos')
  // A prompt sent while this session is already running is handed to the turn
  // in flight instead of being refused: the agent sees it at its next step and
  // decides whether to ignore it, finish first, or change course.
  const claim = await claimAgentRunOrEnqueue({
    userId: ownerUserId,
    sessionId,
    message: buildPendingUserMessage({
      renderedText,
      source: 'mcp',
      actorUserId: ctx.userId,
    }),
  })

  if (claim.mode === 'dropped') {
    return toolResult({
      status: 'failed',
      session_id: sessionId,
      error: {
        code: 'prompt_not_queued',
        message:
          'The Nuphos Agent is busy with this session and the prompt could not be queued. Retry once the current turn completes.',
      },
    })
  }
  if (claim.mode === 'queued') {
    return toolResult({
      status: 'running',
      session_id: sessionId,
      progress: {
        message:
          'The Nuphos Agent is already working on this session; your prompt was handed ' +
          'to the run in progress. Poll nuphos_check for the answer.',
      },
    })
  }
  const release = claim.release

  // Each waiting message stays its own, with its own sender, ahead of the caller's.
  const messages: UIMessage[] = [
    ...(prior ?? []),
    ...claim.carried.map((message): UIMessage => ({
      id: message.id,
      role: 'user',
      metadata: message.metadata,
      parts: [{ type: 'text', text: message.renderedText }],
    })),
    {
      id: randomUUID(),
      role: 'user',
      metadata: attribution,
      parts: [{ type: 'text', text: renderedText }],
    },
  ]

  // runAgentForTrigger drives its own AbortController, so a dropped HTTP
  // connection does not cancel the run: it finishes and persists, and
  // nuphos_check can retrieve the answer.
  // The claim is released however the run ends, also when it fails to start.
  const run = (async () => {
    try {
      await runAgentForTrigger({
        userId: ctx.userId,
        conversationOwnerUserId: ownerUserId,
        nuphosToken: signNuphosToken(ctx.userId, NUPHOS_TOKEN_TTL_SECONDS),
        teamId,
        sessionId,
        messages,
        firstMessage: prompt,
        source: 'mcp',
        client: ctx.client,
      })
    } finally {
      release()
    }
  })()

  if (args.wait === false) {
    const settled = run.catch((err: unknown) => {
      logError('mcp.ask.background_run_failed', err, { session_id: sessionId })
    })

    // A new session is stored as its first turn starts. Return once it is, so
    // the nuphos_check that follows finds it.
    if (!existing) await Promise.race([settled, untilStored(sessionId)])

    return toolResult({
      status: 'running',
      session_id: sessionId,
      progress: { message: 'The Nuphos Agent started on this request. Poll nuphos_check.' },
    })
  }

  try {
    await run
  } catch (err) {
    return toolResult({
      status: 'failed',
      session_id: sessionId,
      error: {
        code: 'agent_run_failed',
        message: err instanceof Error ? err.message : String(err),
      },
    })
  }

  const answer = await readLatestAnswer(sessionId, ctx.userId, teamId)

  return toolResult({ status: 'completed', session_id: sessionId, answer: answer ?? '' })
}

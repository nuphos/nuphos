import { randomUUID } from 'node:crypto'

import { getConversationBySessionId, getConversationWithMessages } from '@/lib/agent/db'
import { buildPendingUserMessage } from '@/lib/agent/pending-messages'
import { getTeamMembership, signNuphosToken } from '@/lib/identity'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import {
  claimAgentRunOrEnqueue,
  hasActiveAgentRunForSession,
  runAgentForTrigger,
} from '@/routes/agent'
import { partsToText, persistedMessageToUiMessage, readLatestAnswer } from '@/routes/mcp/transcript'

import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'
import type { UIMessage } from 'ai'

// Token TTL for the minted per-call Nuphos identity. Mirrors executeTrigger's
// 8h window — long enough to outlive a slow run, short enough to stay bounded.
const NUPHOS_TOKEN_TTL_SECONDS = 60 * 60 * 8

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

  // Continuing a session: it must be the caller's own, in the same team it was
  // started in — otherwise the transcript sync below would clobber it.
  const existing = await getConversationBySessionId(sessionId)

  if (existing && existing.userId !== ctx.userId) {
    return toolError(`Session not found: ${sessionId}`)
  }
  if (existing && (existing.teamId ?? undefined) !== teamId) {
    return toolError(
      `Session ${sessionId} was started with a different team_id; pass the same team_id to continue it.`,
    )
  }

  // Fold optional structured context into the user turn. The agent takes plain
  // text turns, so we wrap the JSON in a tagged block it can read.
  const contextBlock =
    args.context && typeof args.context === 'object'
      ? `\n\n<context>\n${JSON.stringify(args.context)}\n</context>`
      : ''

  // runAgentForTrigger syncs the DB transcript to exactly the messages it is
  // given, so a multi-turn continuation must replay the prior turns.
  const prior = existing
    ? (await getConversationWithMessages(sessionId, ctx.userId, teamId))?.messages
        .map(persistedMessageToUiMessage)
        .filter((message): message is UIMessage => message !== null)
    : undefined

  const renderedText = `${prompt}${contextBlock}`
  // A prompt sent while this session is already running is handed to the turn
  // in flight instead of being refused: the agent sees it at its next step and
  // decides whether to ignore it, finish first, or change course.
  const claim = await claimAgentRunOrEnqueue({
    userId: ctx.userId,
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

  const messages: UIMessage[] = [
    ...(prior ?? []),
    {
      id: randomUUID(),
      role: 'user',
      parts: [
        {
          type: 'text',
          text: [...claim.carried.map((message) => message.renderedText), renderedText].join(
            '\n\n',
          ),
        },
      ],
    },
  ]

  try {
    // Blocks until the run completes. runAgentForTrigger drives its own
    // AbortController, so a dropped HTTP connection does not cancel the run —
    // it finishes and persists, and nuphos_check can retrieve the answer.
    await runAgentForTrigger({
      userId: ctx.userId,
      nuphosToken: signNuphosToken(ctx.userId, NUPHOS_TOKEN_TTL_SECONDS),
      teamId,
      sessionId,
      messages,
      firstMessage: prompt,
      source: 'mcp',
      client: ctx.client,
    })
  } catch (err) {
    return toolResult({
      status: 'failed',
      session_id: sessionId,
      error: {
        code: 'agent_run_failed',
        message: err instanceof Error ? err.message : String(err),
      },
    })
  } finally {
    release()
  }

  const answer = await readLatestAnswer(sessionId, ctx.userId, teamId)

  return toolResult({ status: 'completed', session_id: sessionId, answer: answer ?? '' })
}

export async function nuphosCheck(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const sessionId =
    typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : ''

  if (!sessionId) return toolError('`session_id` is required and must be a non-empty string.')

  const result = await getConversationWithMessages(sessionId, ctx.userId)

  if (!result) return toolError(`Session not found: ${sessionId}`)

  // Active-run lookup keys on the conversation owner (the creator), which is the
  // caller for their own sessions.
  if (await hasActiveAgentRunForSession(result.conversation.userId, sessionId)) {
    return toolResult({
      status: 'running',
      session_id: sessionId,
      progress: { message: 'The Nuphos Agent is still working on this request.' },
    })
  }

  const assistant = [...result.messages].reverse().find((m) => m.role === 'assistant')

  if (assistant) {
    return toolResult({
      status: 'completed',
      session_id: sessionId,
      answer: partsToText(assistant.parts),
    })
  }

  // No active run and no assistant turn: the run either failed or never started.
  return toolResult({
    status: 'failed',
    session_id: sessionId,
    error: {
      code: 'no_result',
      message:
        'No assistant response found and no run is active. The request may have ' +
        'failed or not started.',
    },
  })
}

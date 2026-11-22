import {
  getConversationTranscriptForAgent,
  getLatestAssistantMessage,
  getReadableConversation,
  liveTurnTranscriptLine,
} from '@/lib/agent/db'
import { openInputRequests } from '@/lib/agent/db/pending-decision'
import { transcriptTurnDiagnostics } from '@/lib/agent/db/transcript-diagnostics'
import { getLiveTurn } from '@/lib/agent/live-turn'
import { queuedAnswers } from '@/lib/agent/pending-queue'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { hasActiveAgentRunForSession } from '@/routes/agent'
import { toolAuthorizations } from '@/routes/mcp/tool-authorizations'
import { partsToText } from '@/routes/mcp/transcript'

import type { AgentConversation } from '@/lib/agent/db'
import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

/** The questions a session waits on a person for, but those an answer already on its way settles. */
export async function openRequests(conversation: AgentConversation) {
  const answering = new Set(
    (await queuedAnswers(conversation.userId, conversation.sessionId)).keys(),
  )

  return openInputRequests(conversation, answering).map((request) => ({
    request_id: request.id,
    category: request.category,
    question: request.question,
    ...(request.body ? { body: request.body } : {}),
    ...(request.options ? { options: request.options } : {}),
    asked_at: new Date(request.askedAt).toISOString(),
  }))
}

export async function nuphosCheck(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const sessionId =
    typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : ''

  if (!sessionId) return toolError('`session_id` is required and must be a non-empty string.')

  const conversation = await getReadableConversation(sessionId, ctx.userId)

  if (!conversation) return toolError(`Session not found: ${sessionId}`)
  const includeToolDetails = args.include_tool_details === true
  // Active-run lookup keys on the conversation owner (the creator).
  const running = await hasActiveAgentRunForSession(conversation.userId, sessionId)
  const live = running ? await getLiveTurn(conversation.userId, sessionId) : null
  // A tool call waits for approval only while its turn runs.
  const approvals = running ? await toolAuthorizations(sessionId, ctx.userId, live) : []
  const requests = [...(await openRequests(conversation)), ...approvals]
  const page =
    typeof args.from_index === 'number'
      ? await getConversationTranscriptForAgent(ctx.userId, {
          teamId: conversation.teamId ?? undefined,
          sessionId,
          fromIndex: args.from_index,
          includeToolDetails,
        })
      : null
  const assistant = await getLatestAssistantMessage(sessionId, conversation.userId)
  const answer = assistant ? partsToText(assistant.parts) : undefined
  // The last turn ended on an error, a timeout or a stop rather than an answer.
  const [interrupted] = assistant ? await transcriptTurnDiagnostics(assistant) : []
  const details = {
    session_id: sessionId,
    // What the turn in flight has done so far: its text and tool calls.
    ...(live
      ? {
          in_progress: liveTurnTranscriptLine(conversation.messageCount, live, {
            includeToolDetails,
          }),
        }
      : {}),
    ...(requests.length ? { requests } : {}),
    ...(page ? { transcript: { lines: page.lines, next_index: page.nextIndex } } : {}),
  }

  // Its turn holds on a tool call until the caller approves or denies it.
  if (approvals.length) return toolResult({ status: 'waiting_for_input', ...details })
  if (running) {
    return toolResult({
      status: 'running',
      ...details,
      progress: { message: 'The Nuphos Agent is still working on this request.' },
    })
  }
  // Stopped on a question: nothing more happens until it is answered.
  if (requests.length) {
    return toolResult({ status: 'waiting_for_input', ...details, answer: answer ?? '' })
  }
  if (interrupted) {
    return toolResult({
      status: 'failed',
      ...details,
      error: { code: 'turn_interrupted', ...interrupted },
    })
  }
  if (answer !== undefined) return toolResult({ status: 'completed', ...details, answer })

  // No active run and no assistant turn: the run either failed or never started.
  return toolResult({
    status: 'failed',
    ...details,
    error: {
      code: 'no_result',
      message:
        'No assistant response found and no run is active. The request may have ' +
        'failed or not started.',
    },
  })
}

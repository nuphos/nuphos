import { config } from '@/config'
import { getConversationBySessionId } from '@/lib/agent/db'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'
import { OpenAbConnectionLostError } from '@/lib/claude-code-preview/openab-acp-errors'
import { queueRuntimeHandoff } from '@/lib/claude-code-preview/runtime-handoff'
import { RunHandoff } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'

import { persistHandedOffPreviewTurn } from './chat-preview-finish'

import type { AgentRun } from './types'
import type { UIMessage } from 'ai'

export const HANDED_OFF = Symbol('handed-off')
export const HANDED_OFF_TOOL_ERROR =
  'Nuphos restarted before this tool reported back. The agent kept running; its reply continues below.'
export const CONNECTION_LOST_TOOL_ERROR =
  'The connection to the agent dropped before this tool reported back. The agent kept running; its reply continues below once it reconnects.'

/**
 * The runtime keeps an admitted turn running when its transport drops, and the
 * session observer reattaches and carries the rest as an autonomous run. Only
 * a prompt the runtime accepted has that owner; a drop during initialize,
 * session setup, or before admission stays an actionable failure.
 */
export function lostToReattach(error: unknown, signal: AbortSignal): boolean {
  return error instanceof OpenAbConnectionLostError && error.admitted && !signal.aborted
}

export const LOST_TURN_PROMPT =
  'Your previous turn was cut off: the agent runtime restarted while you were working, and anything still running then was stopped. Check the state of what you were doing, then continue the task from where it stopped.'
const CONTINUED = ':continued'

type LostTurn = {
  sessionId: string
  teamId: string
  userId: string
  locale: string
  messages: UIMessage[]
}

/**
 * `lostToReattach` trusts the runtime to finish an admitted turn. When the
 * runtime process itself died (an OOMKill restarts the container), the session
 * reattaches idle and the turn is simply gone. A person in the app sees that and
 * sends again; an agent thread or a resource event has nobody to, so it sat idle
 * and its parent never heard back. Those get exactly one continuation, through
 * the same durable path their message arrived on.
 */
export async function continueLostTurn(
  turn: LostTurn,
  deliver: typeof deliverContinuation = deliverContinuation,
): Promise<void> {
  const last = turn.messages.findLast((message) => message.role === 'user')
  const metadata = parseMessageMetadata(last?.metadata)

  if (!last || (metadata?.source !== 'agent.thread' && metadata?.source !== 'agent.resource'))
    return
  // A continuation lost again is left alone: a task that keeps killing its runtime must not loop.
  if (last.id.endsWith(CONTINUED)) return
  const session = sessionsByConversation.get(`${turn.teamId}:${turn.sessionId}`)

  if (!session || !(await session.reattached)) return
  const { state } = await session.client.getSessionExecutionState(session.openabSessionId)

  // Anything but idle means the runtime still has the turn; the observer carries it as before.
  if (state !== 'idle') return
  logEvent('info', 'agent.openab_session.lost_turn_continued', {
    team_id: turn.teamId,
    session_id: turn.sessionId,
    source: metadata.source,
  })
  await deliver(turn, `${last.id}${CONTINUED}`, {
    ...metadata,
    sentAt: new Date().toISOString(),
  })
}

async function deliverContinuation(
  turn: LostTurn,
  messageId: string,
  metadata: NonNullable<ReturnType<typeof parseMessageMetadata>>,
): Promise<void> {
  const target = await getConversationBySessionId(turn.sessionId)

  if (!target) return
  const { startConversationTurn } = await import('@/lib/agent/conversation-turn')
  const { run } = await startConversationTurn(
    {
      userId: turn.userId,
      teamId: turn.teamId,
      targetSessionId: turn.sessionId,
      messageId,
      locale: turn.locale,
    },
    target,
    LOST_TURN_PROMPT,
    metadata.source as 'agent.thread' | 'agent.resource',
    metadata,
  )

  await run
}

/** Fire-and-forget wrapper for the turn's catch path. */
export function continueLostTurnLater(turn: LostTurn): void {
  continueLostTurn(turn).catch((error: unknown) => {
    logError('agent.openab_session.lost_turn_continue_failed', error, {
      team_id: turn.teamId,
      session_id: turn.sessionId,
    })
  })
}

/** Settles only when a draining replica lets go of the turn; a user stop still cancels it. */
export function handedOff(signal: AbortSignal): Promise<typeof HANDED_OFF> {
  return new Promise((resolve) => {
    const settle = () => {
      if (signal.reason instanceof RunHandoff) resolve(HANDED_OFF)
    }

    if (signal.aborted) settle()
    else signal.addEventListener('abort', settle, { once: true })
  })
}

type PreviewHandoffArgs = {
  run: AgentRun
  sessionId: string
  teamId: string
  userId: string
  actorUserId: string
  messages: UIMessage[]
  firstMessage: string
  locale: string
  /** Still running on the runtime; this replica stops listening to it. */
  prompt: Promise<unknown>
  /** Tools still running on the runtime are marked as handed off by the caller. */
  orderedParts: UIMessage['parts']
  steered: UIMessage[]
}

/** Save what streamed so far and leave the rest of the turn to the adopting replica. */
export async function handOffPreviewTurn(args: PreviewHandoffArgs): Promise<void> {
  args.prompt.catch(() => {})
  await persistHandedOffPreviewTurn({
    ...args,
    provider: config.agent.modelProvider,
  })
  queueRuntimeHandoff({
    teamId: args.teamId,
    conversationId: args.sessionId,
    ownerUserId: args.userId,
    actorUserId: args.actorUserId,
    locale: args.locale,
  })
}

// Mid-turn steering, for every runtime. One turn at a time per conversation:
// a message that arrives mid-turn is parked in the pending-messages queue and
// delivered by the running turn itself at its next prompt boundary — inside
// the same AgentRun, so the stream never breaks. The sender's POST attaches to
// that live stream instead of erroring or starting a second, concurrent run
// that would interleave into the same transcript.

import type { UIMessage } from 'ai'

import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import {
  buildPendingUserMessage,
  drainPendingUserMessages,
  enqueuePendingUserMessage,
  hasPendingUserMessage,
  removePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import { AppError } from '@/lib/errors'

/** One steered exchange never runs away: after this many injected prompts the
 *  rest of the queue is left for the next turn. */
export const MAX_STEERED_ROUNDS = 5

export type PreviewSteeringOutcome = { mode: 'attach'; streamId: string } | { mode: 'launch' }
export type PreviewTurnAdmission =
  { mode: 'attach'; streamId: string } | { mode: 'launch'; releaseClaim: () => void }

type ClaimPreviewSession = (userId: string, sessionId: string) => Promise<(() => void) | null>

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Park one explicit in-app instruction onto the currently running turn without
 * opening a second SSE subscription. This is the renderer's "Steer now" path:
 * the original stream remains the sole source of output while the model picks
 * the message up at its next prompt boundary.
 */
export async function enqueuePreviewSteer(args: {
  runOwnerUserId: string
  userId: string
  sessionId: string
  text: string
}): Promise<{ messageId: string }> {
  const active = await getActiveAgentRunForSession(args.runOwnerUserId, args.sessionId)

  if (!active) {
    throw new AppError(409, 'conversation_not_running', 'This conversation is no longer running')
  }
  if (!active.actorUserId || active.actorUserId !== args.userId) {
    throw new AppError(
      409,
      'conversation_in_use_by_teammate',
      'Another teammate is currently using this conversation. Retry after their turn finishes.',
    )
  }
  const message = buildPendingUserMessage({
    renderedText: args.text,
    metadata: await createMessageMetadata(args.userId, 'nuphos'),
    source: 'app',
    actorUserId: args.userId,
  })

  if (!(await enqueuePendingUserMessage(args.runOwnerUserId, args.sessionId, message))) {
    throw new AppError(503, 'steer_queue_unavailable', 'Could not queue this steering message')
  }
  const stillActive = await getActiveAgentRunForSession(args.runOwnerUserId, args.sessionId)

  if (stillActive?.actorUserId === args.userId) return { messageId: message.id }
  // The active turn may have drained the message while it was finishing. In
  // that case it has accepted ownership even though its heartbeat is gone.
  if (!(await hasPendingUserMessage(args.runOwnerUserId, args.sessionId, message.id))) {
    return { messageId: message.id }
  }
  await removePendingUserMessage(args.runOwnerUserId, args.sessionId, message.id)
  throw new AppError(409, 'conversation_not_running', 'This conversation is no longer running')
}

function lastUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages.at(index)

    if (message?.role !== 'user') continue

    // Desktop appends the file-transfer group and pull command as another text
    // part. Keep them when a new upload arrives during an active turn too.
    return message.parts
      .filter(
        (part): part is { type: 'text'; text: string } =>
          part.type === 'text' && Boolean(part.text),
      )
      .map((part) => part.text)
      .join('\n\n')
  }

  return ''
}

/**
 * Decide what to do with a plain /agent/chat POST while this conversation's
 * Claude Code turn is running. Null = not a steering situation (no active
 * run, or the conversation is not on the runtime) — launch normally.
 */
export async function interceptPreviewSteering(args: {
  runOwnerUserId: string
  userId: string
  teamId: string | undefined
  sessionId: string
  messages: UIMessage[]
}): Promise<PreviewSteeringOutcome | null> {
  if (!args.teamId) return null
  const active = await getActiveAgentRunForSession(args.runOwnerUserId, args.sessionId)

  if (!active) return null
  if (!active.actorUserId || active.actorUserId !== args.userId) {
    throw new AppError(
      409,
      'conversation_in_use_by_teammate',
      'Another teammate is currently using this conversation. Retry after their turn finishes.',
    )
  }
  const text = lastUserText(args.messages)

  if (!text) return null
  const message = buildPendingUserMessage({
    renderedText: text,
    metadata: parseMessageMetadata(args.messages.findLast((m) => m.role === 'user')?.metadata),
    source: 'app',
    actorUserId: args.userId,
  })

  if (!(await enqueuePendingUserMessage(args.runOwnerUserId, args.sessionId, message))) {
    return null
  }
  // The turn may have ended between the check and the enqueue. Whoever drains
  // owns delivery: if our message comes back to us, run it as a normal turn;
  // if the dying turn took it, its final drain delivers and persists it.
  // Always attach to the run that is live NOW — the first check's streamId can
  // belong to a run that ended and was replaced in the race window.
  const stillActive = await getActiveAgentRunForSession(args.runOwnerUserId, args.sessionId)

  if (stillActive) {
    return { mode: 'attach', streamId: stillActive.streamId }
  }
  const drained = await drainPendingUserMessages(args.runOwnerUserId, args.sessionId, args.userId)

  if (drained.some((entry) => entry.id === message.id)) {
    for (const other of drained) {
      if (other.id !== message.id) {
        await enqueuePendingUserMessage(args.runOwnerUserId, args.sessionId, other)
      }
    }

    return { mode: 'launch' }
  }
  // The dying turn's drain took the message: attach to whatever run is live
  // now, or fall back to the finished stream — Redis resume replays it to its
  // done frame, which is exactly the outcome the sender should see.
  const successor = await getActiveAgentRunForSession(args.runOwnerUserId, args.sessionId)

  return { mode: 'attach', streamId: successor?.streamId ?? active.streamId }
}

/**
 * Atomically choose between steering into the live Claude Code turn and
 * claiming the session for a new one. The first ownership heartbeat is
 * asynchronous, so a losing replica may briefly see neither the active hash
 * nor a claim it can acquire; retry that handshake instead of dispatching a
 * second ACP prompt.
 */
export async function admitPreviewTurn(
  args: Parameters<typeof interceptPreviewSteering>[0],
  options: { claim: ClaimPreviewSession; attempts?: number; retryMs?: number },
): Promise<PreviewTurnAdmission | null> {
  // Total wait must stay under the desktop's 5s first-byte deadline
  // (CHAT_STREAM_FIRST_BYTE_TIMEOUT_MS), or the 409 arrives after the client
  // has already given up and started resuming a stream that never existed.
  const attempts = options.attempts ?? 60
  const retryMs = options.retryMs ?? 50

  for (let attempt = 0; attempt < attempts; attempt++) {
    const steering = await interceptPreviewSteering(args)

    if (steering?.mode === 'attach') return steering
    const releaseClaim = await options.claim(args.runOwnerUserId, args.sessionId)

    if (releaseClaim) return { mode: 'launch', releaseClaim }
    if (attempt + 1 < attempts) await wait(retryMs)
  }

  throw new AppError(
    409,
    'conversation_busy',
    'The agent is already working on this conversation. Try again in a moment.',
  )
}

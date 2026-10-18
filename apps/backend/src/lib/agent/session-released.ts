import { isShuttingDown } from '@/lib/lifecycle'
import { logError } from '@/lib/observability'

import { enqueuePendingUserMessage } from './pending-messages'
import {
  hasQueuedTranscriptMessage,
  requeuePendingAtHead,
  scanQueuedSessions,
} from './pending-queue'

import type { PendingUserMessage } from './pending-message-types'

type QueuedTurnStarter = (userId: string, sessionId: string) => Promise<void>

// Installed at boot: the run locks that call this must not import the turn graph.
let startQueuedTurn: QueuedTurnStarter | null = null

export function installQueuedTurnStarter(start: QueuedTurnStarter): void {
  startQueuedTurn = start
}

const MIN_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000
const backoff = new Map<string, { timer?: ReturnType<typeof setTimeout>; delayMs: number }>()
const backoffKey = (userId: string, sessionId: string) => `${userId}:${sessionId}`

function start(userId: string, sessionId: string): void {
  const run = startQueuedTurn

  // A draining replica cannot start a run; the queue waits for the next turn.
  if (!run || isShuttingDown()) return
  void (async () => {
    if (await hasQueuedTranscriptMessage(userId, sessionId)) await run(userId, sessionId)
  })().catch((error: unknown) => {
    logError('agent.pending_messages.queued_turn_failed', error, {
      user_id: userId,
      session_id: sessionId,
    })
  })
}

/**
 * A session's run or claim was let go. Whatever was queued behind it starts
 * the next turn. Both locks call this, and only the last one to go can claim.
 * While a retry is scheduled, that retry starts it instead.
 */
export function sessionReleased(userId: string, sessionId: string): void {
  if (!backoff.get(backoffKey(userId, sessionId))?.timer) start(userId, sessionId)
}

/** The queue could not run now. Look again later, waiting longer each time. */
export function retryQueuedTurn(userId: string, sessionId: string): void {
  const key = backoffKey(userId, sessionId)
  const entry = backoff.get(key)

  if (entry?.timer) return
  const delayMs = Math.min((entry?.delayMs ?? MIN_RETRY_MS / 2) * 2, MAX_RETRY_MS)
  const timer = setTimeout(() => {
    backoff.set(key, { delayMs })
    start(userId, sessionId)
  }, delayMs)

  timer.unref()
  backoff.set(key, { timer, delayMs })
}

/** A queued turn started or the queue emptied: the next wait starts short again. */
export function queuedTurnSettled(userId: string, sessionId: string): void {
  const key = backoffKey(userId, sessionId)

  if (!backoff.get(key)?.timer) backoff.delete(key)
}

/**
 * A turn took these messages and could not run them. A queued message goes
 * back to the front, counted, and the queue retries after a wait rather than
 * on the release that follows.
 */
export async function requeueTurnQueue(
  userId: string,
  sessionId: string,
  carried: PendingUserMessage[],
  queued?: PendingUserMessage,
): Promise<void> {
  if (!queued) {
    for (const entry of carried) await enqueuePendingUserMessage(userId, sessionId, entry)

    return
  }
  retryQueuedTurn(userId, sessionId)
  await requeuePendingAtHead(userId, sessionId, [
    { ...queued, attempts: (queued.attempts ?? 0) + 1 },
    ...carried,
  ])
}

// A rollout drops in-process retries. This re-finds queues nothing else will
// start, at most once per session per interval and never while a retry waits.
const BACKSTOP_MS = 10_000
const lastBackstop = new Map<string, number>()

/** Called on a periodic tick: start one batch of the queues left waiting. */
export async function sweepQueuedSessions(cursor: string): Promise<string> {
  const page = await scanQueuedSessions(cursor)
  const now = Date.now()

  if (lastBackstop.size > 10_000) lastBackstop.clear()
  for (const { userId, sessionId } of page.sessions) {
    const key = backoffKey(userId, sessionId)

    if (backoff.get(key)?.timer || now - (lastBackstop.get(key) ?? 0) < BACKSTOP_MS) continue
    lastBackstop.set(key, now)
    start(userId, sessionId)
  }

  return page.cursor
}

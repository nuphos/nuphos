import { AppError } from '@/lib/errors'
import { isShuttingDown } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'
import { claimRun } from '@/lib/redis'

import { enqueuePendingUserMessage } from './pending-messages'
import {
  hasQueuedTranscriptMessage,
  requeuePendingAtHead,
  scanQueuedSessions,
} from './pending-queue'

import type { PendingUserMessage } from './pending-message-types'

type QueuedTurnStarter = (userId: string, sessionId: string, released: boolean) => Promise<void>

// Installed at boot: the run locks that call this must not import the turn graph.
let startQueuedTurn: QueuedTurnStarter | null = null

export function installQueuedTurnStarter(start: QueuedTurnStarter): void {
  startQueuedTurn = start
}

const MIN_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000
const QUICK_REFUSALS = 3
const REFUSED_WAIT_MS = 5 * 60_000
const OWN_RELEASE_MS = 5_000
const backoff = new Map<string, { timer?: ReturnType<typeof setTimeout>; delayMs: number }>()
const backoffKey = (userId: string, sessionId: string) => `${userId}:${sessionId}`

function start(userId: string, sessionId: string, released = false): void {
  const run = startQueuedTurn

  // A draining replica cannot start a run; the queue waits for the next turn.
  if (!run || isShuttingDown()) return
  void (async () => {
    if (await hasQueuedTranscriptMessage(userId, sessionId)) await run(userId, sessionId, released)
  })().catch((error: unknown) => {
    const fields = { user_id: userId, session_id: sessionId }

    // Expected, and already reported to whoever sent the messages (runTurn).
    if (error instanceof AppError && error.code === 'runtime_offline')
      logEvent('warn', 'agent.pending_messages.queued_turn_offline', fields)
    else logError('agent.pending_messages.queued_turn_failed', error, fields)
  })
}

/**
 * A session's run or claim was let go. Whatever was queued behind it starts
 * the next turn. Both locks call this, and only the last one to go can claim.
 * While a retry is scheduled, that retry starts it instead.
 */
export function sessionReleased(userId: string, sessionId: string): void {
  if (!backoff.get(backoffKey(userId, sessionId))?.timer) start(userId, sessionId, true)
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
 * A turn took these messages and could not run them. They go back to the
 * front, each counted, and the queue retries after a wait rather than on the
 * release that follows. Only the head's count sets that wait.
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
  const attempts = (queued.attempts ?? 0) + 1
  // Each try reads the whole history. A runtime still refusing after a few quick
  // ones is busy for minutes, so every replica's backstop and retry wait it out.
  const retryAfter =
    !queued.offlineSince && attempts >= QUICK_REFUSALS
      ? new Date(Date.now() + REFUSED_WAIT_MS).toISOString()
      : undefined

  // A waiting head is the backstop's to start, or a release's.
  if (!retryAfter) retryQueuedTurn(userId, sessionId)
  // Counted, each one runs on the retry although the refused turn stored it (turn-history).
  await requeuePendingAtHead(userId, sessionId, [
    { ...queued, attempts, retryAfter },
    ...carried.map((entry) => ({ ...entry, attempts: (entry.attempts ?? 0) + 1 })),
  ])
}

/**
 * Whether the queue's head is waiting out a runtime that kept refusing it. A
 * release means the runtime is free, except the refused turn's own releases
 * (its run's and its claim's), which come in the moments after the refusal.
 */
export function waitingOutRefusal(head: PendingUserMessage | undefined, released: boolean) {
  const until = Date.parse(head?.retryAfter ?? '')
  const refusedAt = until - REFUSED_WAIT_MS

  return until > Date.now() && (!released || Date.now() - refusedAt < OWN_RELEASE_MS)
}

// A rollout drops in-process retries. This re-finds queues nothing else will
// start, at most once per session per interval and never while a retry waits.
const BACKSTOP_MS = 10_000
const lastBackstop = new Map<string, number>()

// Under the 2 s handoff tick, so each tick one replica reads the shared index.
const SWEEP_CLAIM_MS = 1_500

/** Called on a periodic tick: start one batch of the queues left waiting. */
export async function sweepQueuedSessions(cursor: string): Promise<string> {
  const shared = await claimRun('atlas:agentrun-pending-sweep', SWEEP_CLAIM_MS)
  const page = await scanQueuedSessions(cursor, shared)
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

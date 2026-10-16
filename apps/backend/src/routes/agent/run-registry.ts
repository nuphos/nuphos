import {
  drainPendingUserMessages,
  hasPendingUserMessage,
  removePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { agentRuns, claimAgentRunForSession } from '@/lib/agent/run-admission'
import { startAgentRunOwnership } from '@/lib/agent/run-store'
import { AppError } from '@/lib/errors'
import { isShuttingDown } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'

import { claimAgentRunOrEnqueue } from './claim-or-enqueue'
import { AGENT_RUN_TTL_MS } from './constants'
import { traceAgentChatEvent } from './trace'

import type { AgentRun, AgentRunTrace } from './types'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'

export { claimAgentRunOrEnqueue } from './claim-or-enqueue'
export type { ClaimOrEnqueueResult } from './claim-or-enqueue'
export {
  agentRuns,
  claimAgentRunForSession,
  getLocalActiveAgentRun,
  hasActiveAgentRunForSession,
} from '@/lib/agent/run-admission'

export function agentRunKey(userId: string, streamId: string): string {
  return `${userId}:${streamId}`
}

/**
 * Agent runs still streaming (not yet done) on this replica. Lives here rather
 * than beside its shutdown-drain caller in run-frames: it only reads the map
 * above, and splitting it off put run-frames and run-registry in an import
 * cycle.
 */
export function listInFlightAgentRuns(): AgentRun[] {
  const runs: AgentRun[] = []

  for (const run of agentRuns.values()) if (!run.done) runs.push(run)

  return runs
}

export function createAgentRun(
  userId: string,
  sessionId: string,
  streamId: string,
  trace?: AgentRunTrace,
): AgentRun {
  const now = Date.now()
  const abortController = new AbortController()

  return {
    key: agentRunKey(userId, streamId),
    streamId,
    sessionId,
    userId,
    trace,
    frames: [],
    done: false,
    abortController,
    subscribers: new Set(),
    createdAt: now,
    lastAccessAt: now,
    lastFrameAt: now,
    releaseOwnership: startAgentRunOwnership(userId, sessionId, streamId, {
      actorUserId: trace?.userId ?? userId,
      teamId: trace?.teamId,
      onCancellationRequested: () => {
        abortController.abort()
      },
    }),
  }
}

/** Register a new run, rejecting if the process is draining for shutdown so the
 *  drainer can't miss a freshly created run. Shared by every run-creation path. */
export function registerAgentRun(run: AgentRun): void {
  if (isShuttingDown()) {
    // The run already allocated an ownership lease (heartbeat timer + Redis owner
    // keys) in createAgentRun. Release it before rejecting, otherwise an unregistered
    // run leaks its setInterval and lingering owner keys. Covers every call site.
    run.releaseOwnership()
    traceAgentChatEvent('error', 'agent.chat.run.register_rejected_draining', run.trace, {
      run_age_ms: Date.now() - run.createdAt,
      frame_count: run.frames.length,
      done: run.done,
    })
    throw new AppError(503, 'server_draining', 'Server is shutting down; please retry')
  }
  agentRuns.set(run.key, run)
  traceAgentChatEvent('info', 'agent.chat.run.registered', run.trace, {
    run_key: run.key,
    frame_count: run.frames.length,
    in_flight_run_count: listInFlightAgentRuns().length,
  })
}

export type AgentRunFrameSink = {
  frame: (raw: string) => void
  // Called once, after the run's terminal frame has been delivered.
  done: () => void
}

/**
 * Mirror the run's frames into a caller's sink by adding it as one more run
 * subscriber, alongside whatever SSE responses are attached. The sink contract
 * is non-throwing, but guard anyway: subscribers are poked synchronously from
 * appendAgentRunFrame, so a sink bug must never break the pump loop or the
 * other subscribers.
 */
export function attachAgentRunFrameSink(
  run: AgentRun,
  frameSink: AgentRunFrameSink,
  logEventName: string,
  logMeta: Record<string, unknown>,
): void {
  let nextFrameIndex = 0
  let sinkDone = false
  const sinkSubscriber = {
    poke: () => {
      try {
        while (nextFrameIndex < run.frames.length) {
          frameSink.frame(run.frames[nextFrameIndex++]!)
        }
        if (run.done && !sinkDone) {
          sinkDone = true
          run.subscribers.delete(sinkSubscriber)
          frameSink.done()
        }
      } catch (err) {
        logError(logEventName, err, logMeta)
      }
    },
  }

  run.subscribers.add(sinkSubscriber)
  sinkSubscriber.poke()
}

const QUEUED_TURN_POLL_MS = 500
const QUEUED_TURN_TIMEOUT_MS = 50 * 60_000

type QueuedTurnTiming = { pollMs: number; timeoutMs: number }

export type QueuedTurnResult =
  | { mode: 'run'; release: () => void; carried: PendingUserMessage[] }
  // Another turn drained the message and answers it.
  | { mode: 'taken' }
  // It never got a turn; it is off the queue so it cannot surface later.
  | { mode: 'expired' }

export type ChannelTurnResult = QueuedTurnResult | { mode: 'dropped' }

/**
 * The one admission path for a channel message (Slack, Lark, Discord): run it
 * now, or queue it and wait for the busy turn to end. `onQueued` runs before
 * the wait. `carried` never includes the message itself.
 */
export async function admitChannelTurn(
  args: {
    userId: string
    sessionId: string
    message: PendingUserMessage
    actorUserId?: string
    onQueued?: (activeActorUserId?: string) => Promise<void>
  },
  timing?: QueuedTurnTiming,
): Promise<ChannelTurnResult> {
  const claim = await claimAgentRunOrEnqueue(args)

  if (claim.mode === 'run') {
    return { ...claim, carried: claim.carried.filter((entry) => entry.id !== args.message.id) }
  }
  if (claim.mode === 'dropped') return claim
  await args.onQueued?.(claim.activeActorUserId)

  return awaitQueuedTurn({ ...args, messageId: args.message.id }, timing)
}

/**
 * Waits out the busy turn a channel message (Slack, Lark, Discord) was queued
 * behind, then claims the next turn for it. The release-time starter leaves
 * channel messages alone, because only the handler that got one can reply in
 * its channel. `carried` is everything else queued, without this message.
 */
export async function awaitQueuedTurn(
  args: { userId: string; sessionId: string; messageId: string; actorUserId?: string },
  timing: QueuedTurnTiming = { pollMs: QUEUED_TURN_POLL_MS, timeoutMs: QUEUED_TURN_TIMEOUT_MS },
): Promise<QueuedTurnResult> {
  const deadline = Date.now() + timing.timeoutMs

  while (await hasPendingUserMessage(args.userId, args.sessionId, args.messageId)) {
    const release = await claimAgentRunForSession(args.userId, args.sessionId)

    if (release) {
      // A busy turn's step boundary may have taken it before the claim landed.
      if (!(await hasPendingUserMessage(args.userId, args.sessionId, args.messageId))) {
        release()
        continue
      }
      const carried = await drainPendingUserMessages(
        args.userId,
        args.sessionId,
        args.actorUserId ?? args.userId,
      )

      return {
        mode: 'run',
        release,
        carried: carried.filter((entry) => entry.id !== args.messageId),
      }
    }
    if (Date.now() >= deadline) {
      await removePendingUserMessage(args.userId, args.sessionId, args.messageId)

      return { mode: 'expired' }
    }
    await new Promise((resolve) => setTimeout(resolve, timing.pollMs))
  }

  return { mode: 'taken' }
}

export function scheduleAgentRunCleanup(run: AgentRun) {
  if (run.cleanupTimer) clearTimeout(run.cleanupTimer)
  run.cleanupTimer = setTimeout(() => {
    if (agentRuns.get(run.key) === run && run.done) agentRuns.delete(run.key)
  }, AGENT_RUN_TTL_MS)
}

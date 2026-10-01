import { drainPendingUserMessages, enqueuePendingUserMessage } from '@/lib/agent/pending-messages'
import { agentRuns, activeRunForSession, claimAgentRunForSession } from '@/lib/agent/run-admission'
import { startAgentRunOwnership } from '@/lib/agent/run-store'
import { AppError } from '@/lib/errors'
import { isShuttingDown } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'

import { AGENT_RUN_TTL_MS } from './constants'
import { traceAgentChatEvent } from './trace'

import type { AgentRun, AgentRunTrace } from './types'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'

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

export type ClaimOrEnqueueResult =
  | { mode: 'run'; release: () => void; carried: PendingUserMessage[] }
  | { mode: 'queued'; activeActorUserId?: string }
  // The caller must surface that this message could not be parked.
  | { mode: 'dropped' }

/**
 * Claims an idle session or hands a participant message to its live turn.
 * `carried` recovers messages when the previous turn ended during admission.
 */
export async function claimAgentRunOrEnqueue(args: {
  userId: string
  sessionId: string
  message: PendingUserMessage
  actorUserId?: string
}): Promise<ClaimOrEnqueueResult> {
  const claim = await claimAgentRunForSession(args.userId, args.sessionId)

  if (claim) return { mode: 'run', release: claim, carried: [] }

  const queuedMessage: PendingUserMessage = {
    ...args.message,
    actorUserId: args.message.actorUserId ?? args.actorUserId ?? args.userId,
  }
  const queued = await enqueuePendingUserMessage(args.userId, args.sessionId, queuedMessage)

  if (!queued) return { mode: 'dropped' }

  // Race: the turn may have finished in the window between the failed claim and
  // the enqueue, so the queue would sit until its TTL with no one to drain it.
  // Whoever can claim the session now owns whatever is queued.
  const activeAfterEnqueue = await activeRunForSession(args.userId, args.sessionId)

  if (activeAfterEnqueue) {
    return {
      mode: 'queued',
      ...(activeAfterEnqueue.actorUserId
        ? { activeActorUserId: activeAfterEnqueue.actorUserId }
        : {}),
    }
  }
  const recovered = await claimAgentRunForSession(args.userId, args.sessionId)

  if (!recovered) return { mode: 'queued' }
  const carried = await drainPendingUserMessages(
    args.userId,
    args.sessionId,
    queuedMessage.actorUserId,
  )

  if (carried.length === 0) {
    // Another claimer drained first; nothing of ours is left to run.
    recovered()

    return { mode: 'queued' }
  }
  logEvent('info', 'agent.run.pending_messages_recovered', {
    user_id: args.userId,
    session_id: args.sessionId,
    recovered_count: carried.length,
  })

  return { mode: 'run', release: recovered, carried }
}

export function scheduleAgentRunCleanup(run: AgentRun) {
  if (run.cleanupTimer) clearTimeout(run.cleanupTimer)
  run.cleanupTimer = setTimeout(() => {
    if (agentRuns.get(run.key) === run && run.done) agentRuns.delete(run.key)
  }, AGENT_RUN_TTL_MS)
}

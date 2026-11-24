import { getConversationBySessionId } from '@/lib/agent/db'
import { isBot } from '@/lib/agent/db/read-state'
import { liveAttachment } from '@/lib/agent/db/shared'
import { sameRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store/ownership'
import { backfillRunIndexes, sweepAbandonedAgentRuns } from '@/lib/agent/run-store/run-index'
import { ownerKey } from '@/lib/agent/run-store/shared'
import { sweepQueuedSessions } from '@/lib/agent/session-released'
import { AppError } from '@/lib/errors'
import { isShuttingDown } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'
import { withRedis } from '@/lib/redis'

import { sessionsByConversation } from './agent-chat-registry'
import { resolveConversationChatRuntime } from './conversation-chat-route'
import { previewSessionAccess } from './credentials-mcp'
import { nuphosToolsVersion } from './nuphos-tools-mcp'
import { openConversationSession } from './open-conversation-session'
import { parseSessionExecutionState } from './runtime-execution-snapshot'
import { claimRuntimeHandoffs } from './runtime-handoff-claim'
import {
  RUNTIME_HANDOFFS_KEY as HANDOFFS_KEY,
  advertiseRuntimeHandoffs,
  runtimeHandoffField as field,
  sessionHandoff,
} from './runtime-handoff-store'

import type { RuntimeHandoff } from './runtime-handoff-store'
import type { TeamPreviewClient, TeamSession } from './team-openab-runtime'

export type { RuntimeHandoff } from './runtime-handoff-store'

const ADOPT_INTERVAL_MS = 2_000
const MAX_ADOPT_ATTEMPTS = 5
const OFFLINE_RETRY_DELAY_MS = 10_000
/** Shutdown has seconds to spare; a runtime that cannot answer by then is not waited for. */
const RUNTIME_STATE_PROBE_MS = 1_000
const RUNTIME_OWNED_PHASES = new Set([
  'resume_disconnected',
  'resume_pending',
  'resuming',
  'background_tools',
])

/**
 * The sessions whose output this replica still carries. A turn that runs here
 * (a person's turn force-paused by the drain keeps running on the runtime, and
 * its output keeps coming to this replica's connection) or a runtime-started
 * turn whose transcript is open here needs a new carrier. So does a session
 * whose runtime owns work it will continue on its own: its output goes to the
 * connection that last resumed it, and once this replica exits the runtime
 * parks it as "output connection lost" until something resumes the session
 * again. An idle session needs nobody.
 */
async function sessionsToHandOff(): Promise<TeamSession[]> {
  const sessions = await Promise.all(
    [...sessionsByConversation.values()].map(async (session) => {
      if (session.activeTurn && !session.activeTurn.cancelled) return session
      if (session.autonomousTranscriptOpen) return session
      const state = await Promise.race([
        session.client
          .getSessionExecutionState(session.openabSessionId)
          .then(parseSessionExecutionState)
          .catch(() => null),
        Bun.sleep(RUNTIME_STATE_PROBE_MS).then(() => null),
      ])

      return RUNTIME_OWNED_PHASES.has(state?.phase ?? '') ? session : undefined
    }),
  )

  return sessions.filter((session) => session !== undefined)
}

/**
 * Close this replica's transports to the handed-off sessions, then advertise
 * them. Closing first matters: the gateway routes a running turn's output to
 * the connection that started it until that connection goes away.
 */
export async function publishRuntimeHandoffs(): Promise<number> {
  const sessions = await sessionsToHandOff()
  const at = Date.now()
  const handoffs = sessions.map((session) => ({ ...sessionHandoff(session), at }))
  const clients = new Set<TeamPreviewClient>()

  for (const session of sessions) {
    session.stopObserving?.()
    clients.add(session.client)
  }
  for (const client of clients) client.close()

  if (handoffs.length === 0) return 0
  await advertiseRuntimeHandoffs(handoffs)

  return handoffs.length
}

/**
 * Resume the session on this replica. Its observer then carries the rest of
 * the turn: output opens an autonomous run clients attach to, and the runtime
 * going idle persists it as the next assistant message.
 */
export async function adoptRuntimeHandoff(handoff: RuntimeHandoff): Promise<void> {
  const conversation = await getConversationBySessionId(handoff.conversationId)

  if (conversation?.teamId !== handoff.teamId || conversation.userId !== handoff.ownerUserId)
    throw new Error('The handed-off conversation is not in this team')
  if (handoff.abandonedStreamId) {
    // A new turn or a runtime move supersedes this stale lease. Never create a
    // replacement runtime session as a side effect of crash recovery.
    if (!liveAttachment(conversation)) return
    if (await getActiveAgentRunForSession(handoff.ownerUserId, handoff.conversationId)) return
  }
  const { endpoint } = await resolveConversationChatRuntime(handoff.teamId, conversation, {
    userId: handoff.actorUserId,
  })

  if (!endpoint) throw new Error('The handed-off conversation has no runtime to resume on')
  if (
    handoff.abandonedStreamId &&
    !sameRuntimeUrl(liveAttachment(conversation)?.runtimeUrl, endpoint.url)
  )
    return
  const access = await previewSessionAccess(
    handoff.conversationId,
    handoff.teamId,
    handoff.actorUserId,
    handoff.ownerUserId,
    {
      external: endpoint.external,
      backendUrl: endpoint.backendUrl,
      humanTurn: handoff.humanTurn,
      parentSessionId: conversation.parentSessionId,
      sessionHomeEpoch: conversation.sessionHomeEpoch,
      bot: isBot(conversation),
      agentRuntime: endpoint.provider,
      toolsVersion: await nuphosToolsVersion({
        userId: handoff.actorUserId,
        conversationOwnerUserId: handoff.ownerUserId,
        teamId: handoff.teamId,
        sessionId: handoff.conversationId,
      }),
    },
  )
  const abandonedStreamId = handoff.abandonedStreamId

  if (
    abandonedStreamId &&
    (await withRedis((redis) => redis.get(ownerKey(handoff.ownerUserId, abandonedStreamId))))
  )
    return
  // A replica that served this conversation before would reuse its entry
  // without a session/load, and the output sink left with the draining one.
  const stale = sessionsByConversation.get(field(handoff))

  if (stale && !stale.activeTurn) {
    stale.stopObserving?.()
    sessionsByConversation.delete(field(handoff))
  }
  const session = await openConversationSession(
    handoff.teamId,
    handoff.conversationId,
    handoff.actorUserId,
    conversation.metadata?.locale ?? handoff.locale,
    endpoint,
    access.mcpServers,
    undefined,
    { provider: endpoint.provider ?? 'claude-code', env: access.runtimeEnv },
    undefined,
    handoff.ownerUserId,
  )

  session.conversationOwnerUserId = handoff.ownerUserId
  logEvent('info', 'agent.runtime_handoff.adopted', {
    team_id: handoff.teamId,
    session_id: handoff.conversationId,
    handoff_age_ms: Date.now() - handoff.at,
  })
}

export async function adoptRuntimeHandoffs(
  adopt: (handoff: RuntimeHandoff) => Promise<void> = adoptRuntimeHandoff,
): Promise<void> {
  if (isShuttingDown()) return
  for (const handoff of await claimRuntimeHandoffs()) {
    await adopt(handoff).catch(async (error: unknown) => {
      const offline = error instanceof AppError && error.code === 'runtime_offline'
      const attempts = (handoff.attempts ?? 0) + (offline ? 0 : 1)
      const retry = offline || attempts < MAX_ADOPT_ATTEMPTS

      logError('agent.runtime_handoff.adopt_failed', error, {
        team_id: handoff.teamId,
        session_id: handoff.conversationId,
        attempts,
        retry,
        offline_cause: offline
          ? (error.details as { cause?: string } | undefined)?.cause
          : undefined,
      })
      if (retry)
        await withRedis((redis) =>
          redis.hsetnx(
            HANDOFFS_KEY,
            field(handoff),
            JSON.stringify({
              ...handoff,
              attempts,
              ...(offline ? { retryAfter: Date.now() + OFFLINE_RETRY_DELAY_MS } : {}),
            }),
          ),
        )
    })
  }
}

export function startRuntimeHandoffAdoption(): () => void {
  let running = false
  let cursor = '0'
  let queueCursor = '0'
  const tick = () => {
    if (running) return
    running = true
    void (async () => {
      cursor = await sweepAbandonedAgentRuns(cursor)
      await adoptRuntimeHandoffs()
      queueCursor = await sweepQueuedSessions(queueCursor)
    })()
      .catch((error: unknown) => {
        logError('agent.runtime_handoff.scan_failed', error)
      })
      .finally(() => {
        running = false
      })
  }
  const timer = setInterval(tick, ADOPT_INTERVAL_MS)

  void backfillRunIndexes().catch((error: unknown) => {
    logError('agent.run_index.backfill_failed', error)
  })
  tick()

  return () => {
    clearInterval(timer)
  }
}

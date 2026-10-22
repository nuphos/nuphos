import { sweepQueuedSessions } from '@/lib/agent/session-released'
import { getConversationBySessionId } from '@/lib/agent/db'
import { liveAttachment } from '@/lib/agent/db/shared'
import {
  getActiveAgentRunForSession,
  sweepAbandonedAgentRuns,
} from '@/lib/agent/run-store/ownership'
import { ownerKey } from '@/lib/agent/run-store/shared'
import { isShuttingDown } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'
import { withRedis } from '@/lib/redis'

import { sessionsByConversation } from './agent-chat-registry'
import { openConversationSession } from './open-conversation-session'
import { resolveConversationChatRuntime } from './conversation-chat-route'
import { previewSessionAccess } from './credentials-mcp'
import { parseSessionExecutionState } from './runtime-execution-snapshot'
import {
  RUNTIME_HANDOFFS_KEY as HANDOFFS_KEY,
  advertiseRuntimeHandoffs,
  runtimeHandoffField as field,
  sessionHandoff,
} from './runtime-handoff-store'

import type { RuntimeHandoff } from './runtime-handoff-store'
import type { TeamPreviewClient } from './team-openab-runtime'

export type { RuntimeHandoff } from './runtime-handoff-store'

/** The gateway ignores a resume while the old connection still owns the turn's output. */
export const HANDOFF_SETTLE_MS = 1_000
/** Past this the turn has long ended; nothing is left to pick up. */
export const HANDOFF_TTL_MS = 30 * 60_000
const ADOPT_INTERVAL_MS = 2_000
const MAX_ADOPT_ATTEMPTS = 5
/** Shutdown has seconds to spare; a runtime that cannot answer by then is not waited for. */
const RUNTIME_STATE_PROBE_MS = 1_000
const RUNTIME_OWNED_PHASES = new Set([
  'resume_disconnected',
  'resume_pending',
  'resuming',
  'background_tools',
])

const queued: RuntimeHandoff[] = []

export function queueRuntimeHandoff(handoff: Omit<RuntimeHandoff, 'at'>): void {
  queued.push({ ...handoff, at: Date.now() })
}

/**
 * A session with no user turn here can still have work the runtime owns: a
 * turn the runtime started itself (a wakeup or a background-task
 * continuation) whose output this replica carries, or a background task whose
 * completion it continues on its own. Its output goes to the connection that
 * last resumed the session, so once this replica exits the runtime parks it as
 * "output connection lost" until something resumes the session again. Hand
 * those on as well; an idle session needs nobody. A user turn is never picked
 * here: it may be running on another replica, and only the turn route knows it
 * runs on this one. A runtime-started turn has no route, but this replica
 * knows it carries one: its transcript is open here.
 */
async function queueRuntimeOwnedWork(): Promise<void> {
  const handedOff = new Set(queued.map(field))

  await Promise.all(
    [...sessionsByConversation.values()]
      .filter((session) => !handedOff.has(field(session)))
      .map(async (session) => {
        if (!session.autonomousTranscriptOpen) {
          const state = await Promise.race([
            session.client
              .getSessionExecutionState(session.openabSessionId)
              .then(parseSessionExecutionState)
              .catch(() => null),
            Bun.sleep(RUNTIME_STATE_PROBE_MS).then(() => null),
          ])

          if (!RUNTIME_OWNED_PHASES.has(state?.phase ?? '')) return
        }
        queueRuntimeHandoff(sessionHandoff(session))
      }),
  )
}

/**
 * Close this replica's transports to the handed-off sessions, then advertise
 * them. Closing first matters: the gateway routes a running turn's output to
 * the connection that started it until that connection goes away.
 */
export async function publishRuntimeHandoffs(): Promise<number> {
  await queueRuntimeOwnedWork()
  const handoffs = queued.splice(0)
  const clients = new Set<TeamPreviewClient>()

  for (const handoff of handoffs) {
    const session = sessionsByConversation.get(field(handoff))

    if (!session) continue
    session.stopObserving?.()
    clients.add(session.client)
  }
  for (const client of clients) client.close()
  if (handoffs.length === 0) return 0
  await advertiseRuntimeHandoffs(handoffs)

  return handoffs.length
}

function parse(raw: string): RuntimeHandoff | null {
  try {
    const value = JSON.parse(raw) as Partial<RuntimeHandoff>

    return typeof value.teamId === 'string' &&
      typeof value.conversationId === 'string' &&
      typeof value.ownerUserId === 'string' &&
      typeof value.actorUserId === 'string' &&
      typeof value.locale === 'string' &&
      typeof value.at === 'number'
      ? (value as RuntimeHandoff)
      : null
  } catch {
    return null
  }
}

/** Each handoff is claimed by exactly one replica: the one whose HDEL removed it. */
export async function claimRuntimeHandoffs(now = Date.now()): Promise<RuntimeHandoff[]> {
  const all = await withRedis((redis) => redis.hgetall(HANDOFFS_KEY))
  const claimed: RuntimeHandoff[] = []

  for (const [key, raw] of Object.entries(all ?? {})) {
    const handoff = parse(raw)

    if (handoff && now - handoff.at < HANDOFF_SETTLE_MS) continue
    const removed = await withRedis((redis) =>
      redis.eval(
        `if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
           return redis.call('HDEL', KEYS[1], ARGV[1])
         end
         return 0`,
        1,
        HANDOFFS_KEY,
        key,
        raw,
      ),
    )

    if (removed === 1 && handoff && now - handoff.at < HANDOFF_TTL_MS) claimed.push(handoff)
  }

  return claimed
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
  if (handoff.abandonedStreamId && liveAttachment(conversation)?.runtimeUrl !== endpoint.url) return
  const access = previewSessionAccess(
    handoff.conversationId,
    handoff.teamId,
    handoff.actorUserId,
    handoff.ownerUserId,
    { external: endpoint.external, backendUrl: endpoint.backendUrl, humanTurn: handoff.humanTurn },
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
      const attempts = (handoff.attempts ?? 0) + 1
      const retry = attempts < MAX_ADOPT_ATTEMPTS

      logError('agent.runtime_handoff.adopt_failed', error, {
        team_id: handoff.teamId,
        session_id: handoff.conversationId,
        attempts,
        retry,
      })
      if (retry)
        await withRedis((redis) =>
          redis.hsetnx(HANDOFFS_KEY, field(handoff), JSON.stringify({ ...handoff, attempts })),
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

  tick()

  return () => {
    clearInterval(timer)
  }
}

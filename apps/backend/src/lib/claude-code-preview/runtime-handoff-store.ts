import { logEvent } from '@/lib/observability'
import { withRedis } from '@/lib/redis'

import type { TeamSession } from './team-openab-runtime'

// Shared wire record: run-lease cleanup and graceful shutdown feed the same adopter.
export const RUNTIME_HANDOFFS_KEY = 'atlas:agent:runtime-handoffs'

export type RuntimeHandoff = {
  teamId: string
  conversationId: string
  ownerUserId: string
  actorUserId: string
  locale: string
  at: number
  attempts?: number
  /** A teammate's own turn; otherwise the turn acts as the conversation owner. */
  humanTurn?: boolean
  /** Crash recovery must never start a fresh session or replace a newer turn. */
  abandonedStreamId?: string
  /** Where the session ran, so an offline computer is waited for instead of tried. */
  runtimeUrl?: string
}

export const runtimeHandoffField = (handoff: Pick<RuntimeHandoff, 'teamId' | 'conversationId'>) =>
  `${handoff.teamId}:${handoff.conversationId}`

export function sessionHandoff(session: TeamSession): Omit<RuntimeHandoff, 'at'> {
  return {
    teamId: session.teamId,
    conversationId: session.conversationId,
    ownerUserId: session.conversationOwnerUserId ?? session.userId,
    actorUserId: session.userId,
    locale: session.locale,
    // Only a teammate's own turn acts as someone other than the owner.
    humanTurn: Boolean(session.runtime?.env?.NUPHOS_SESSION_ACTOR),
    runtimeUrl: session.endpoint.url,
  }
}

export async function advertiseRuntimeHandoffs(handoffs: RuntimeHandoff[]): Promise<void> {
  await withRedis((redis) =>
    redis.hset(
      RUNTIME_HANDOFFS_KEY,
      Object.fromEntries(
        handoffs.map((handoff) => [runtimeHandoffField(handoff), JSON.stringify(handoff)]),
      ),
    ),
  )
  logEvent('info', 'agent.runtime_handoff.published', {
    count: handoffs.length,
    session_ids: handoffs.map((handoff) => handoff.conversationId).join(','),
  })
}

/**
 * A session whose transport dropped while this replica drains has no
 * connection left to close, so it is advertised now instead of at the end of
 * the drain. The drain can take minutes; the runtime waits only 30 s for an
 * output connection before it cancels the turn's tool permission requests.
 */
export async function publishLostSessionHandoff(session: TeamSession): Promise<void> {
  await advertiseRuntimeHandoffs([{ ...sessionHandoff(session), at: Date.now() }])
}

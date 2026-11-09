// Which replica adopts a handed-off turn, and which handoffs are refused
// instead. Split out of runtime-handoff.ts, which had reached the file line
// limit, so the age policy below has somewhere to be explained.
import { getConversationBySessionId, markConversationWorkLost } from '@/lib/agent/db'
import { liveAttachment } from '@/lib/agent/db/shared'
import { sameRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { logError, logEvent } from '@/lib/observability'
import { withRedis } from '@/lib/redis'

import { RUNTIME_HANDOFFS_KEY as HANDOFFS_KEY } from './runtime-handoff-store'
import { isOnline } from './session-reattach'

import type { RuntimeHandoff } from './runtime-handoff-store'

/** The gateway ignores a resume while the old connection still owns the turn's output. */
export const HANDOFF_SETTLE_MS = 1_000
/**
 * How long a handed-off turn is still worth resuming. A handoff normally clears
 * within seconds; this window is for the offline case, where the computer that
 * owns the session comes back after a deploy. Past it nobody is waiting for the
 * turn any more, and resuming it would re-run a teammate's turn unattended,
 * with their credentials, long after it was written.
 */
export const HANDOFF_MAX_AGE_MS = 15 * 60_000

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
    // A handoff nobody adopted while its turn was still current is refused
    // rather than resumed: adoption is unattended and runs as the teammate who
    // wrote the turn, so hours later nobody is there to watch or confirm it.
    const stale = handoff !== null && now - handoff.at >= HANDOFF_MAX_AGE_MS
    let moved = stale

    // An offline computer is waited for, not tried: the handoff stays as it is,
    // spends no attempt and logs nothing, and is adopted once the computer is back.
    // A conversation that has since moved off it never needs it back, so its
    // handoff is removed instead of waiting forever.
    if (
      !moved &&
      typeof handoff?.runtimeUrl === 'string' &&
      !(await isOnline(handoff.runtimeUrl))
    ) {
      const conversation = await getConversationBySessionId(handoff.conversationId)

      if (sameRuntimeUrl(liveAttachment(conversation)?.runtimeUrl, handoff.runtimeUrl)) continue
      moved = true
    }
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

    if (removed !== 1 || !handoff) continue
    if (stale) await refuseStaleRuntimeHandoff(handoff, now)
    else if (!moved) claimed.push(handoff)
  }

  return claimed
}

/**
 * A refused handoff is not dropped silently: the conversation is told its
 * handed-off turn will not resume, so the next turn checks before repeating
 * anything that already had an effect. The notice is bookkeeping, so a
 * database failure must not fail the sweep or hold up the other handoffs.
 */
async function refuseStaleRuntimeHandoff(handoff: RuntimeHandoff, now: number): Promise<void> {
  logEvent('warn', 'agent.runtime_handoff.stale_refused', {
    team_id: handoff.teamId,
    session_id: handoff.conversationId,
    age_ms: now - handoff.at,
    max_age_ms: HANDOFF_MAX_AGE_MS,
  })

  await markConversationWorkLost(handoff.conversationId, handoff.teamId, 'unreachable').catch(
    (error: unknown) => {
      logError('agent.runtime_handoff.stale_notice_failed', error, {
        team_id: handoff.teamId,
        session_id: handoff.conversationId,
      })
    },
  )
}

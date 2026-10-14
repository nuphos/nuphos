import { redisEnabled, withRedis } from '@/lib/redis'

import { parseSessionExecutionState } from './runtime-execution-snapshot'

import type { SessionExecutionState } from './runtime-execution-snapshot'

// The runtime pushes a session's runtime_state to whichever backend connection
// holds the session; the list reads the last one from here instead of opening
// a runtime connection per row. Nobody refreshes an idle session's key, so an
// entry outlives at most one lost connection by this long.
const TTL_SECONDS = 600

const key = (openabSessionId: string) => `agent:runtime-state:${openabSessionId}`

// Without Redis there is one backend (self-hosted Compose, local dev), so its
// own memory holds every session it observes.
const local = new Map<string, { value: string; expiresAt: number }>()

export function rememberRuntimeState(openabSessionId: string, snapshot: SessionExecutionState) {
  const value = JSON.stringify(snapshot)

  if (!redisEnabled()) {
    local.delete(openabSessionId)
    local.set(openabSessionId, { value, expiresAt: Date.now() + TTL_SECONDS * 1_000 })
    // Insertion order is write order, so expired entries sit at the front.
    for (const [id, entry] of local) {
      if (entry.expiresAt > Date.now()) break
      local.delete(id)
    }

    return
  }
  void withRedis((redis) => redis.set(key(openabSessionId), value, 'EX', TTL_SECONDS))
}

/** A `session/update` frame: keep it when it is a valid runtime_state push. */
export function rememberPushedRuntimeState(params: unknown) {
  const { sessionId, update } = (params ?? {}) as {
    sessionId?: unknown
    update?: { sessionUpdate?: unknown; snapshot?: unknown }
  }

  if (typeof sessionId !== 'string' || update?.sessionUpdate !== 'runtime_state') return
  try {
    rememberRuntimeState(
      sessionId,
      parseSessionExecutionState(update.snapshot as Record<string, unknown>),
    )
  } catch {
    // Not a snapshot this backend can read; the list keeps the previous one.
  }
}

export function forgetRuntimeState(openabSessionId: string) {
  local.delete(openabSessionId)
  void withRedis((redis) => redis.del(key(openabSessionId)))
}

/** One round trip for a page; a missing, expired or unreadable entry is null. */
export async function readRuntimeStates(
  openabSessionIds: (string | undefined)[],
): Promise<(SessionExecutionState | null)[]> {
  const ids = openabSessionIds.filter((id): id is string => Boolean(id))
  const values = !redisEnabled()
    ? ids.map((id) => {
        const entry = local.get(id)

        return entry && entry.expiresAt > Date.now() ? entry.value : null
      })
    : ids.length
      ? await withRedis((redis) => redis.mget(ids.map(key)))
      : null
  const byId = new Map(ids.map((id, index) => [id, values?.[index] ?? null]))

  return openabSessionIds.map((id) => {
    const value = id ? byId.get(id) : null

    if (!value) return null
    try {
      return JSON.parse(value) as SessionExecutionState
    } catch {
      return null
    }
  })
}

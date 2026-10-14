import { redisEnabled, withRedis } from '@/lib/redis'

import { parseSessionExecutionState } from './runtime-execution-snapshot'

import type { SessionExecutionState } from './runtime-execution-snapshot'

// The runtime pushes a session's runtime_state to whichever backend connection
// holds the session; the list reads the last one from here instead of opening
// a runtime connection per row. Nobody refreshes an idle session's key, so an
// entry outlives at most one lost connection by this long.
const TTL_SECONDS = 600

// Keyed by team: a write comes only from a session this backend opened for that
// team, and the list reads only its own team's keys.
const key = (teamId: string, openabSessionId: string) =>
  `agent:runtime-state:${teamId}:${openabSessionId}`

// Pushes and the detail probe race; within one runtime epoch the higher
// revision is the newer snapshot, so an older one must never replace it.
function isStale(stored: SessionExecutionState, next: SessionExecutionState) {
  return (
    stored.epoch !== undefined &&
    stored.epoch === next.epoch &&
    (stored.revision ?? -1) >= (next.revision ?? -1)
  )
}

const WRITE_IF_NEWER = `
local stored = redis.call('GET', KEYS[1])
if stored and ARGV[2] ~= '' then
  local ok, prev = pcall(cjson.decode, stored)
  if ok and type(prev) == 'table' and prev.epoch == ARGV[2] then
    local revision = tonumber(prev.revision)
    if revision and revision >= tonumber(ARGV[3]) then return 0 end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
return 1`

// Without Redis there is one backend (self-hosted Compose, local dev), so its
// own memory holds every session it observes.
const local = new Map<string, { snapshot: SessionExecutionState; expiresAt: number }>()

export function rememberRuntimeState(
  teamId: string,
  openabSessionId: string,
  snapshot: SessionExecutionState,
) {
  const id = key(teamId, openabSessionId)

  if (!redisEnabled()) {
    const stored = local.get(id)

    if (stored && stored.expiresAt > Date.now() && isStale(stored.snapshot, snapshot)) return
    local.delete(id)
    local.set(id, { snapshot, expiresAt: Date.now() + TTL_SECONDS * 1_000 })
    // Insertion order is write order, so expired entries sit at the front.
    for (const [entryId, entry] of local) {
      if (entry.expiresAt > Date.now()) break
      local.delete(entryId)
    }

    return
  }
  void withRedis((redis) =>
    redis.eval(
      WRITE_IF_NEWER,
      1,
      id,
      JSON.stringify(snapshot),
      snapshot.epoch ?? '',
      String(snapshot.revision ?? -1),
      String(TTL_SECONDS),
    ),
  )
}

// Sessions this backend opened, with the connection holding each. A runtime,
// including one on a user's device, can push any session id; only the holding
// connection's pushes are stored, under the team the backend opened it for.
const held = new Map<string, { connection: object; teamId: string }>()

export function holdRuntimeState(connection: object, teamId: string, openabSessionId: string) {
  const entry = { connection, teamId }

  held.set(openabSessionId, entry)

  return () => {
    if (held.get(openabSessionId) === entry) held.delete(openabSessionId)
  }
}

/** A `session/update` frame: keep it when it is a valid runtime_state push. */
export function rememberPushedRuntimeState(connection: object, params: unknown) {
  const { sessionId, update } = (params ?? {}) as {
    sessionId?: unknown
    update?: { sessionUpdate?: unknown; snapshot?: unknown }
  }

  if (typeof sessionId !== 'string' || update?.sessionUpdate !== 'runtime_state') return
  const holder = held.get(sessionId)

  if (holder?.connection !== connection) return
  try {
    rememberRuntimeState(
      holder.teamId,
      sessionId,
      parseSessionExecutionState(update.snapshot as Record<string, unknown>),
    )
  } catch {
    // Not a snapshot this backend can read; the list keeps the previous one.
  }
}

export function forgetRuntimeState(teamId: string, openabSessionId: string) {
  const id = key(teamId, openabSessionId)

  local.delete(id)
  void withRedis((redis) => redis.del(id))
}

/** One round trip for a page; a missing, expired or unreadable entry is null. */
export async function readRuntimeStates(
  teamId: string,
  openabSessionIds: (string | undefined)[],
): Promise<(SessionExecutionState | null)[]> {
  const ids = openabSessionIds.flatMap((id) => (id ? [key(teamId, id)] : []))

  if (!redisEnabled()) {
    return openabSessionIds.map((id) => {
      const entry = id ? local.get(key(teamId, id)) : undefined

      return entry && entry.expiresAt > Date.now() ? entry.snapshot : null
    })
  }
  const values = ids.length ? await withRedis((redis) => redis.mget(ids)) : null
  const byId = new Map(ids.map((id, index) => [id, values?.[index] ?? null]))

  return openabSessionIds.map((id) => {
    const value = id ? byId.get(key(teamId, id)) : null

    if (!value) return null
    try {
      return JSON.parse(value) as SessionExecutionState
    } catch {
      return null
    }
  })
}

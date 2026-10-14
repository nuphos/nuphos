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
// revision is the newer snapshot, so an older one must never replace it. The
// same snapshot again (an open tab probing an unchanged session) only extends
// the entry, so a session someone is looking at never falls back to a
// synthesized row.
function compare(stored: SessionExecutionState, next: SessionExecutionState) {
  if (stored.epoch === undefined || stored.epoch !== next.epoch) return 'write'
  const held = stored.revision ?? -1
  const incoming = next.revision ?? -1

  return incoming > held ? 'write' : incoming === held ? 'refresh' : 'skip'
}

const WRITE_IF_NEWER = `
local stored = redis.call('GET', KEYS[1])
if stored and ARGV[2] ~= '' then
  local ok, prev = pcall(cjson.decode, stored)
  if ok and type(prev) == 'table' and prev.epoch == ARGV[2] then
    local revision = tonumber(prev.revision)
    local incoming = tonumber(ARGV[3])
    if revision and revision == incoming then
      redis.call('EXPIRE', KEYS[1], ARGV[4])
      return 0
    end
    if revision and revision > incoming then return 0 end
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
    const live = stored && stored.expiresAt > Date.now() ? stored : undefined
    const verdict = live ? compare(live.snapshot, snapshot) : 'write'

    if (verdict === 'skip') return
    local.delete(id)
    local.set(id, {
      snapshot: verdict === 'refresh' && live ? live.snapshot : snapshot,
      expiresAt: Date.now() + TTL_SECONDS * 1_000,
    })
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

// Sessions this backend opened, per connection that holds them. A runtime,
// including one on a user's device, can push any session id; a push is stored
// only for a session its own connection holds, under the team the backend
// opened it for. Keyed by connection first, so one runtime reusing another
// runtime's session id cannot displace that holder.
const held = new WeakMap<object, Map<string, { teamId: string }>>()

export function holdRuntimeState(connection: object, teamId: string, openabSessionId: string) {
  const sessions = held.get(connection) ?? new Map<string, { teamId: string }>()
  const entry = { teamId }

  held.set(connection, sessions)
  sessions.set(openabSessionId, entry)

  return () => {
    if (sessions.get(openabSessionId) === entry) sessions.delete(openabSessionId)
  }
}

/** A `session/update` frame: keep it when it is a valid runtime_state push. */
export function rememberPushedRuntimeState(connection: object, params: unknown) {
  const { sessionId, update } = (params ?? {}) as {
    sessionId?: unknown
    update?: { sessionUpdate?: unknown; snapshot?: unknown }
  }

  if (typeof sessionId !== 'string' || update?.sessionUpdate !== 'runtime_state') return
  const holder = held.get(connection)?.get(sessionId)

  if (!holder) return
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

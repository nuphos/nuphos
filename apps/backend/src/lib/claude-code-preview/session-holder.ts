import { replicaId, withRedis } from '@/lib/redis'

import { sessionsByConversation } from './agent-chat-registry'

import type { TeamSession } from './team-openab-runtime'

// Every replica that served a conversation keeps its session, and after a
// dropped transport each would resume it; the gateway gives the output to the
// last, leaving the others with a turn that never ends. Only the replica that
// took the session last gets it back. It renews that claim while it lives, so
// one that died (a rollout) frees its sessions within a TTL for a survivor.
const holderKey = (openabSessionId: string) => `agent:openab-session-holder:${openabSessionId}`
const HOLDER_TTL_SECONDS = 60
const HOLDER_RENEW_MS = 20_000
const CLAIM = `
local holder = redis.call('GET', KEYS[1])
if holder and holder ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`
const RENEW = `
for _, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then redis.call('EXPIRE', key, ARGV[2]) end
end
return 0`
let renewing: ReturnType<typeof setInterval> | undefined

/** This replica took the session: it opened, rebound or reattached it. */
export function holdSession(session: TeamSession): void {
  void withRedis((redis) =>
    redis.set(holderKey(session.openabSessionId), replicaId, 'EX', HOLDER_TTL_SECONDS),
  )
  renewing ??= setInterval(() => void renewHeldSessions(), HOLDER_RENEW_MS)
  renewing.unref()
}

/** False while another live replica holds the session; a lapsed claim goes to the first to ask. */
export async function claimSession(session: TeamSession): Promise<boolean> {
  const claimed = await withRedis((redis) =>
    redis.eval(CLAIM, 1, holderKey(session.openabSessionId), replicaId, String(HOLDER_TTL_SECONDS)),
  )

  return claimed !== 0
}

/** Renews this replica's claims; one another replica took since stays theirs. */
export async function renewHeldSessions(): Promise<void> {
  const keys = [
    ...new Set([...sessionsByConversation.values()].map((s) => holderKey(s.openabSessionId))),
  ]

  if (keys.length === 0) return
  await withRedis((redis) =>
    redis.eval(RENEW, keys.length, ...keys, replicaId, String(HOLDER_TTL_SECONDS)),
  )
}

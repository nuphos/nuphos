import { randomUUID } from 'node:crypto'

import { redisEnabled, withRedis } from '@/lib/redis'

export const MCP_SUBSCRIPTION_LIMIT = 3
// Streams rotate after 55 seconds. The lease also bounds an abandoned claim if a replica dies.
const LEASE_SECONDS = 90
const local = new Map<string, Set<string>>()

type Admission = { release: () => Promise<void> } | 'limited' | 'unavailable'

/** Reserve one per-user slot. Redis coordinates replicas; without it, the limit is per process. */
export async function admitMcpSubscription(userId: string): Promise<Admission> {
  const token = randomUUID()

  if (!redisEnabled()) {
    const slots = local.get(userId) ?? new Set<string>()

    if (slots.size >= MCP_SUBSCRIPTION_LIMIT) return 'limited'
    slots.add(token)
    local.set(userId, slots)
    let released = false

    return {
      release: () => {
        if (released) return Promise.resolve()
        released = true
        slots.delete(token)
        if (slots.size === 0) local.delete(userId)

        return Promise.resolve()
      },
    }
  }

  for (let slot = 0; slot < MCP_SUBSCRIPTION_LIMIT; slot++) {
    const key = `mcp:subscription:${userId}:${String(slot)}`
    const claimed = await withRedis((redis) =>
      redis.eval(
        "if redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 1 end return 0",
        1,
        key,
        token,
        LEASE_SECONDS,
      ),
    )

    if (claimed === null) return 'unavailable'
    if (claimed !== 1) continue

    return {
      release: async () => {
        await withRedis((redis) =>
          redis.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
            1,
            key,
            token,
          ),
        )
      },
    }
  }

  return 'limited'
}

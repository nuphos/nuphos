import { redisEnabled, withRedis } from '@/lib/redis'

import { parseJson } from './protocol'
import { processSingleton } from './singleton'

import type { LocalRuntimeStatus } from './protocol'

export const RUNTIME_PRESENCE_TTL_SEC = 15
export const RUNTIME_PRESENCE_HEARTBEAT_MS = 5_000

/**
 * Exists exactly while a tunnel socket is open: written on open, deleted on
 * close, and kept alive only by the desktop answering the socket's pings.
 */
export type LocalRuntimePresence = {
  /** The tunnel connection currently holding the device; streams are addressed to it. */
  conn: string
  status?: LocalRuntimeStatus
  seenAt: number
}

export type LocalRuntimePresenceStore = {
  get(userId: string, deviceId: string): Promise<LocalRuntimePresence | null>
  claim(userId: string, deviceId: string, conn: string): Promise<string | null>
  put(userId: string, deviceId: string, presence: LocalRuntimePresence): Promise<boolean>
  /** Clears only while `conn` still holds the device, so a newer tunnel is never erased. */
  clear(userId: string, deviceId: string, conn: string): Promise<void>
}

function presenceKey(userId: string, deviceId: string): string {
  return `agent:device:runtime:presence:${userId}:${deviceId}`
}

const CLEAR_IF_CONN = `
local raw = redis.call('GET', KEYS[1])
if raw and cjson.decode(raw).conn == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`

export function createRedisPresenceStore(): LocalRuntimePresenceStore {
  return {
    async get(userId, deviceId) {
      const raw = await withRedis((c) => c.get(presenceKey(userId, deviceId)))

      const presence = raw ? parseJson<LocalRuntimePresence>(raw) : null

      return presence?.seenAt ? presence : null
    },
    async claim(userId, deviceId, conn) {
      const previous = await withRedis((c) =>
        c.eval(
          `local old = redis.call('GET', KEYS[1])
         redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
         return old or ''`,
          1,
          presenceKey(userId, deviceId),
          JSON.stringify({ conn, seenAt: 0 }),
          RUNTIME_PRESENCE_TTL_SEC,
        ),
      )

      if (previous == null) throw new Error('Device presence unavailable')

      return typeof previous === 'string'
        ? (parseJson<LocalRuntimePresence>(previous)?.conn ?? null)
        : null
    },
    async put(userId, deviceId, presence) {
      const updated = await withRedis((c) =>
        c.eval(
          `local raw = redis.call('GET', KEYS[1])
         if not raw or cjson.decode(raw).conn ~= ARGV[1] then return 0 end
         redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
         return 1`,
          1,
          presenceKey(userId, deviceId),
          presence.conn,
          JSON.stringify(presence),
          RUNTIME_PRESENCE_TTL_SEC,
        ),
      )

      return updated === 1
    },
    async clear(userId, deviceId, conn) {
      await withRedis((c) => c.eval(CLEAR_IF_CONN, 1, presenceKey(userId, deviceId), conn))
    },
  }
}

export function createMemoryPresenceStore(now = () => Date.now()): LocalRuntimePresenceStore {
  const entries = new Map<string, { presence: LocalRuntimePresence; expiresAt: number }>()

  return {
    get(userId, deviceId) {
      const key = presenceKey(userId, deviceId)
      const entry = entries.get(key)

      if (entry && entry.expiresAt <= now()) entries.delete(key)

      return Promise.resolve(
        entry && entry.expiresAt > now() && entry.presence.seenAt ? entry.presence : null,
      )
    },
    claim(userId, deviceId, conn) {
      const key = presenceKey(userId, deviceId)
      const old = entries.get(key)

      entries.set(key, {
        presence: { conn, seenAt: 0 },
        expiresAt: now() + RUNTIME_PRESENCE_TTL_SEC * 1000,
      })

      return Promise.resolve(old && old.expiresAt > now() ? old.presence.conn : null)
    },
    put(userId, deviceId, presence) {
      const old = entries.get(presenceKey(userId, deviceId))

      if (!old || old.expiresAt <= now() || old.presence.conn !== presence.conn)
        return Promise.resolve(false)
      entries.set(presenceKey(userId, deviceId), {
        presence,
        expiresAt: now() + RUNTIME_PRESENCE_TTL_SEC * 1000,
      })

      return Promise.resolve(true)
    },
    clear(userId, deviceId, conn) {
      const key = presenceKey(userId, deviceId)

      if (entries.get(key)?.presence.conn === conn) entries.delete(key)

      return Promise.resolve()
    },
  }
}

export function runtimePresenceStore(): LocalRuntimePresenceStore {
  return processSingleton('presence', () =>
    redisEnabled() ? createRedisPresenceStore() : createMemoryPresenceStore(),
  )
}

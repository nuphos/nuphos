// Messages sent while a session turn is running. Redis makes the queue visible
// to the replica owning the run; the local map serves single-process setups.
import { randomUUID } from 'node:crypto'

import type { MessageMetadata } from './message-metadata'
import type { Redis } from 'ioredis'

import { config } from '@/config'
import { logEvent } from '@/lib/observability'
import { withRedis } from '@/lib/redis'

export { renderInjectedUserMessages } from './pending-message-render'

export type { PendingUserMessage } from './pending-message-types'
import type { PendingUserMessage } from './pending-message-types'

// Outlive the 45-minute headless ceiling, including human approval waits.
export const PENDING_TTL_SEC = 60 * 60
// Refuse newest when full; never evict an already acknowledged message.
export const PENDING_MAX = 10
const PENDING_TEXT_CHARS = 4_000

function pendingKey(userId: string, sessionId: string): string {
  return `atlas:agentrun-pending:${userId}:${sessionId}`
}

// Never fall back here on Redis errors: another replica may own the run.
const localQueues = new Map<string, PendingUserMessage[]>()

function takeLocal(key: string): PendingUserMessage[] {
  const queue = localQueues.get(key) ?? []

  localQueues.delete(key)

  return queue
}

// withRedis already swallows operation failures, but a client that is missing
// or misbehaving throws before it gets that far. Losing the user's message —
// or failing the bridge handler carrying it — is the one outcome this module
// exists to prevent, so every Redis attempt degrades to null instead.
async function tryRedis<T>(op: (client: Redis) => Promise<T>): Promise<T | null> {
  try {
    return await withRedis(op)
  } catch {
    return null
  }
}

export function buildPendingUserMessage(args: {
  renderedText: string
  source: string
  actorUserId?: string
  metadata?: MessageMetadata
}): PendingUserMessage {
  return {
    id: randomUUID(),
    renderedText: args.renderedText.slice(0, PENDING_TEXT_CHARS),
    source: args.source,
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    receivedAt: new Date().toISOString(),
  }
}

/** False when the message could not be parked anywhere — the caller must not
 *  report it as queued. */
export async function enqueuePendingUserMessage(
  userId: string,
  sessionId: string,
  message: PendingUserMessage,
): Promise<boolean> {
  const key = pendingKey(userId, sessionId)

  // Read from config rather than lib/redis's helper: that helper is mocked
  // process-wide by another suite, and this decision must not depend on which
  // test file ran first.
  if (!config.redis.enabled) {
    const queue = localQueues.get(key) ?? []

    if (queue.length >= PENDING_MAX) return false
    queue.push(message)
    localQueues.set(key, queue)

    return true
  }
  const stored = await tryRedis((c) =>
    c.eval(
      `
        if redis.call('LLEN', KEYS[1]) >= tonumber(ARGV[2]) then
          return 0
        end
        redis.call('RPUSH', KEYS[1], ARGV[1])
        redis.call('EXPIRE', KEYS[1], ARGV[3])
        return 1
      `,
      1,
      key,
      JSON.stringify(message),
      PENDING_MAX,
      PENDING_TTL_SEC,
    ),
  )

  if (stored === 1) return true
  logEvent('error', 'agent.pending_messages.enqueue_failed', {
    user_id: userId,
    session_id: sessionId,
    source: message.source,
    reason: stored === 0 ? 'queue_full' : 'redis_error',
  })

  return false
}

/** Remove one parked message by id. Used when the active execution principal
 * changes during the claim/enqueue handshake; the sender is then told to
 * retry instead of leaving an undeliverable instruction behind. */
export async function removePendingUserMessage(
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  const key = pendingKey(userId, sessionId)
  const local = localQueues.get(key) ?? []
  const localRemaining = local.filter((message) => message.id !== messageId)
  const removedLocal = localRemaining.length !== local.length

  if (localRemaining.length > 0) localQueues.set(key, localRemaining)
  else localQueues.delete(key)
  const removedRedis = await tryRedis((c) =>
    c.eval(
      `
        local items = redis.call('LRANGE', KEYS[1], 0, -1)
        redis.call('DEL', KEYS[1])
        local removed = 0
        for _, raw in ipairs(items) do
          local ok, item = pcall(cjson.decode, raw)
          if ok and item.id == ARGV[1] then
            removed = 1
          else
            redis.call('RPUSH', KEYS[1], raw)
          end
        end
        if redis.call('LLEN', KEYS[1]) > 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
        return removed
      `,
      1,
      key,
      messageId,
      PENDING_TTL_SEC,
    ),
  )

  return removedLocal || removedRedis === 1
}

/** Takes everything queued and empties the queue in one atomic step, so two
 *  drains racing (a step boundary and the round boundary) cannot both deliver
 *  the same message. */
export async function drainPendingUserMessages(
  userId: string,
  sessionId: string,
  actorUserId?: string,
): Promise<PendingUserMessage[]> {
  const key = pendingKey(userId, sessionId)
  const allowActorless = actorUserId === userId
  const result = await tryRedis((c) =>
    actorUserId
      ? c.eval(
          `
            local items = redis.call('LRANGE', KEYS[1], 0, -1)
            redis.call('DEL', KEYS[1])
            local selected = {}
            for _, raw in ipairs(items) do
              local ok, item = pcall(cjson.decode, raw)
              local matches = ok and (
                item.actorUserId == ARGV[1] or
                (item.actorUserId == nil and ARGV[2] == '1')
              )
              if matches then
                table.insert(selected, raw)
              else
                redis.call('RPUSH', KEYS[1], raw)
              end
            end
            if redis.call('LLEN', KEYS[1]) > 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
            return selected
          `,
          1,
          key,
          actorUserId,
          allowActorless ? '1' : '0',
          PENDING_TTL_SEC,
        )
      : c.eval(
          `
            local items = redis.call('LRANGE', KEYS[1], 0, -1)
            redis.call('DEL', KEYS[1])
            return items
          `,
          1,
          key,
        ),
  )
  const local = actorUserId ? (localQueues.get(key) ?? []) : takeLocal(key)
  const selectedLocal = actorUserId
    ? local.filter(
        (message) =>
          message.actorUserId === actorUserId || (!message.actorUserId && allowActorless),
      )
    : local

  if (actorUserId) {
    const selected = new Set(selectedLocal.map((message) => message.id))
    const remaining = local.filter((message) => !selected.has(message.id))

    if (remaining.length > 0) localQueues.set(key, remaining)
    else localQueues.delete(key)
  }
  const messages: PendingUserMessage[] = []

  for (const raw of Array.isArray(result) ? result : []) {
    if (typeof raw !== 'string') continue
    try {
      const parsed = JSON.parse(raw) as PendingUserMessage

      if (typeof parsed?.renderedText === 'string') messages.push(parsed)
    } catch {
      // A single unreadable entry must not swallow the rest of the queue.
    }
  }

  return [...selectedLocal, ...messages]
}

export async function hasPendingUserMessages(
  userId: string,
  sessionId: string,
  actorUserId?: string,
): Promise<boolean> {
  const key = pendingKey(userId, sessionId)

  if (actorUserId) {
    const allowActorless = actorUserId === userId
    const matchesActor = (message: PendingUserMessage) =>
      message.actorUserId === actorUserId || (!message.actorUserId && allowActorless)

    if ((localQueues.get(key) ?? []).some(matchesActor)) return true
    const raw = await tryRedis((c) => c.lrange(key, 0, -1))

    return (Array.isArray(raw) ? raw : []).some((value) => {
      if (typeof value !== 'string') return false
      try {
        return matchesActor(JSON.parse(value) as PendingUserMessage)
      } catch {
        return false
      }
    })
  }

  if ((localQueues.get(key)?.length ?? 0) > 0) return true
  const length = await tryRedis((c) => c.llen(key))

  return typeof length === 'number' && length > 0
}

/** Whether one acknowledged message is still waiting for a turn to consume it. */
export async function hasPendingUserMessage(
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  const key = pendingKey(userId, sessionId)
  const matches = (message: PendingUserMessage) => message.id === messageId

  if ((localQueues.get(key) ?? []).some(matches)) return true
  const raw = await tryRedis((c) => c.lrange(key, 0, -1))

  return (Array.isArray(raw) ? raw : []).some((value) => {
    if (typeof value !== 'string') return false
    try {
      return matches(JSON.parse(value) as PendingUserMessage)
    } catch {
      return false
    }
  })
}

export async function clearPendingUserMessages(userId: string, sessionId: string): Promise<void> {
  const key = pendingKey(userId, sessionId)

  localQueues.delete(key)
  await tryRedis((c) => c.del(key))
}

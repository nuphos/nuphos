// Messages sent while a session turn is running. Redis makes the queue visible
// to the replica owning the run; the local map serves single-process setups.
import { randomUUID } from 'node:crypto'

import type { MessageMetadata } from './message-metadata'
import type { Redis } from 'ioredis'

import { config } from '@/config'
import { logEvent } from '@/lib/observability'
import { withRedis } from '@/lib/redis'

import { parkedFor, wakeUpKey } from './pending-message-types'

export { renderInjectedUserMessages } from './pending-message-render'

export { TRANSCRIPT_SOURCES } from './pending-message-types'
export type { PendingUserMessage } from './pending-message-types'
import type { PendingUserMessage } from './pending-message-types'

// Outlive the 45-minute headless ceiling, including human approval waits.
export const PENDING_TTL_SEC = 60 * 60
// Refuse newest when full; never evict an already acknowledged message.
export const PENDING_MAX = 10
const PENDING_TEXT_CHARS = 4_000

export function pendingKey(userId: string, sessionId: string): string {
  return `atlas:agentrun-pending:${userId}:${sessionId}`
}

// Never fall back here on Redis errors: another replica may own the run.
export const localQueues = new Map<string, PendingUserMessage[]>()

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
  const wakeUp = wakeUpKey(message)

  // Read from config rather than lib/redis's helper: that helper is mocked
  // process-wide by another suite, and this decision must not depend on which
  // test file ran first.
  if (!config.redis.enabled) {
    const queue = localQueues.get(key) ?? []

    if (wakeUp && queue.some((parked) => wakeUpKey(parked) === wakeUp)) return true
    if (queue.length >= PENDING_MAX) return false
    queue.push(message)
    localQueues.set(key, queue)

    return true
  }
  const stored = await tryRedis((c) =>
    c.eval(
      `
        for _, raw in ipairs(ARGV[4] ~= '' and redis.call('LRANGE', KEYS[1], 0, -1) or {}) do
          local ok, item = pcall(cjson.decode, raw)
          local parked = ''
          if ok and type(item) == 'table' and item.source == 'app' then
            parked = 'app ' .. tostring(item.id)
          elseif ok and type(item) == 'table' and item.source == 'agent.resource'
            and type(item.metadata) == 'table' then
            parked = tostring(item.metadata.resourceUrl) .. ' ' .. tostring(item.renderedText)
          end
          if parked == ARGV[4] then
            return redis.call('EXPIRE', KEYS[1], ARGV[3])
          end
        end
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
      wakeUp,
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
  sources?: readonly string[],
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
            local sources = ARGV[4] ~= '' and cjson.decode(ARGV[4]) or nil
            for _, raw in ipairs(items) do
              local ok, item = pcall(cjson.decode, raw)
              local matches = ok and (
                item.actorUserId == ARGV[1] or
                (item.actorUserId == nil and ARGV[2] == '1')
              )
              if matches and sources then
                local listed = false
                for _, source in ipairs(sources) do
                  if item.source == source then listed = true end
                end
                matches = listed
              end
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
          sources ? JSON.stringify(sources) : '',
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
  const selectedLocal = actorUserId ? local.filter(parkedFor(userId, actorUserId, sources)) : local

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
  sources?: readonly string[],
): Promise<boolean> {
  const key = pendingKey(userId, sessionId)

  if (actorUserId) return await someParked(key, parkedFor(userId, actorUserId, sources))

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
  return await someParked(pendingKey(userId, sessionId), (message) => message.id === messageId)
}

async function someParked(key: string, matches: (message: PendingUserMessage) => boolean) {
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

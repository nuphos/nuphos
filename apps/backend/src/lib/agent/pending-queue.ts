// A session's one message queue, read in arrival order. Human sends and agent
// messages wait in the same list; the turn that starts next takes its head.

import { config } from '@/config'
import { withRedis } from '@/lib/redis'

import { TRANSCRIPT_SOURCES } from './pending-message-types'
import {
  drainPendingUserMessages,
  enqueuePendingUserMessage,
  localQueues,
  PENDING_TTL_SEC,
  pendingKey,
} from './pending-messages'

import type { PendingUserMessage } from './pending-message-types'
import type { Redis } from 'ioredis'

async function tryRedis<T>(op: (client: Redis) => Promise<T>): Promise<T | null> {
  try {
    return await withRedis(op)
  } catch {
    return null
  }
}

function parse(raw: unknown): PendingUserMessage | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as PendingUserMessage

    return typeof parsed?.renderedText === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** Everything queued for a session, oldest first. */
export async function listPendingUserMessages(
  userId: string,
  sessionId: string,
): Promise<PendingUserMessage[]> {
  const key = pendingKey(userId, sessionId)
  const raw = await tryRedis((c) => c.lrange(key, 0, -1))
  const stored = (Array.isArray(raw) ? raw : []).map(parse).filter((m) => m !== null)

  return [...(localQueues.get(key) ?? []), ...stored]
}

const isTranscriptMessage = (message: PendingUserMessage) =>
  (TRANSCRIPT_SOURCES as readonly string[]).includes(message.source)

/** Whether a transcript message waits; a new one must queue behind it, not overtake it. */
export async function hasQueuedTranscriptMessage(userId: string, sessionId: string) {
  return (await listPendingUserMessages(userId, sessionId)).some(isTranscriptMessage)
}

/**
 * The messages the next turn answers: the oldest transcript message, plus the
 * agent messages right behind it from the same actor. An app send always runs
 * alone, as its sender's own chat turn. A channel message stays where it is.
 * With `actorUserId`, only a head that actor's turn may fold in.
 */
export function queueHead(
  queue: readonly PendingUserMessage[],
  ownerUserId: string,
  actorUserId?: string,
): PendingUserMessage[] {
  const actorOf = (message: PendingUserMessage) => message.actorUserId ?? ownerUserId
  const waiting = queue.filter(isTranscriptMessage)
  const first = waiting[0]

  if (!first || (actorUserId && actorOf(first) !== actorUserId)) return []
  if (first.chat) return actorUserId ? [] : [first]
  const head = [first]

  for (const next of waiting.slice(1)) {
    if (next.chat || actorOf(next) !== actorOf(first)) break
    head.push(next)
  }

  return head
}

/** Remove exactly these messages; one a concurrent drain took first is left out. */
export async function takePendingUserMessages(
  userId: string,
  sessionId: string,
  messages: readonly PendingUserMessage[],
): Promise<PendingUserMessage[]> {
  if (messages.length === 0) return []
  const key = pendingKey(userId, sessionId)
  const ids = new Set(messages.map((message) => message.id))
  const local = localQueues.get(key) ?? []
  const takenLocal = local.filter((message) => ids.has(message.id))
  const remaining = local.filter((message) => !ids.has(message.id))

  if (remaining.length > 0) localQueues.set(key, remaining)
  else localQueues.delete(key)
  const taken = await tryRedis((c) =>
    c.eval(
      `
        local taken = {}
        for _, raw in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
          local ok, item = pcall(cjson.decode, raw)
          if ok and type(item) == 'table' and string.find(ARGV[1], '|' .. tostring(item.id) .. '|', 1, true) then
            if redis.call('LREM', KEYS[1], 1, raw) == 1 then table.insert(taken, raw) end
          end
        end
        return taken
      `,
      1,
      key,
      `|${[...ids].join('|')}|`,
    ),
  )
  const takenIds = new Set([
    ...takenLocal.map((message) => message.id),
    ...(Array.isArray(taken) ? taken : []).map(parse).flatMap((m) => (m ? [m.id] : [])),
  ])

  return messages.filter((message) => takenIds.has(message.id))
}

/** Put messages a refused turn took back at the front, in their order. */
export async function requeuePendingAtHead(
  userId: string,
  sessionId: string,
  messages: readonly PendingUserMessage[],
): Promise<void> {
  if (messages.length === 0) return
  const key = pendingKey(userId, sessionId)

  if (!config.redis.enabled) {
    localQueues.set(key, [...messages, ...(localQueues.get(key) ?? [])])

    return
  }
  const raws = [...messages].reverse().map((message) => JSON.stringify(message))

  await tryRedis(async (c) => {
    await c.lpush(key, ...raws)

    return c.expire(key, PENDING_TTL_SEC)
  })
}

/**
 * What a starting turn folds in besides its own input: the agent messages at
 * the head of the queue from its actor. A channel turn takes everything its
 * actor parked, since only it can answer there.
 */
export async function takeTurnQueue(
  userId: string,
  sessionId: string,
  actorUserId: string,
  channelTurn?: boolean,
): Promise<PendingUserMessage[]> {
  if (channelTurn) return drainPendingUserMessages(userId, sessionId, actorUserId)
  const queue = await listPendingUserMessages(userId, sessionId)

  return takePendingUserMessages(userId, sessionId, queueHead(queue, userId, actorUserId))
}

/** A refused turn never reached the agent: what it took goes back where it was. */
export async function requeueTurnQueue(
  userId: string,
  sessionId: string,
  carried: PendingUserMessage[],
  queued?: PendingUserMessage,
): Promise<void> {
  if (queued) return requeuePendingAtHead(userId, sessionId, [queued, ...carried])
  for (const entry of carried) await enqueuePendingUserMessage(userId, sessionId, entry)
}

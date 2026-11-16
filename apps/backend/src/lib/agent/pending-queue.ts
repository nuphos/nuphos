// A session's one message queue, read in arrival order. Human sends and agent
// messages wait in the same list; the turn that starts next takes its head.

import { config } from '@/config'
import { withRedis } from '@/lib/redis'

import { TRANSCRIPT_SOURCES } from './pending-message-types'
import { localQueues, pendingKey, QUEUED_SESSIONS_KEY, queuedSession } from './pending-messages'

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

/** The questions queued messages answer, each with the message answering it. */
export async function queuedAnswers(
  userId: string,
  sessionId: string,
): Promise<Map<string, string>> {
  const answers = new Map<string, string>()

  for (const message of await listPendingUserMessages(userId, sessionId)) {
    const id = message.chat?.decisionReplyTo

    if (id && !answers.has(id)) answers.set(id, message.id)
  }

  return answers
}

const isTranscriptMessage = (message: PendingUserMessage) =>
  (TRANSCRIPT_SOURCES as readonly string[]).includes(message.source)

// An agent or a resource event speaks for no person: it never joins a person's turn.
const AGENT_SOURCES: readonly string[] = ['agent.thread', 'agent.resource']

/** Who a message is from: a person, or the session or resource that sent it. */
function senderOf(message: PendingUserMessage, ownerUserId: string): string {
  const person = message.actorUserId ?? ownerUserId

  return AGENT_SOURCES.includes(message.source)
    ? `${message.source}:${message.metadata?.sender?.id ?? person}`
    : person
}

/**
 * The messages the next turn answers: the oldest transcript message, plus the
 * messages right behind it from the same sender. An app send always runs
 * alone, as its sender's own chat turn. A channel message stays where it is,
 * and so does an older client's steering message from a teammate: only that
 * teammate's own turn may answer it.
 */
export function queueHead(
  queue: readonly PendingUserMessage[],
  ownerUserId: string,
): PendingUserMessage[] {
  const waiting = queue.filter(
    (message) =>
      isTranscriptMessage(message) &&
      (message.chat !== undefined || (message.actorUserId ?? ownerUserId) === ownerUserId),
  )
  const first = waiting[0]

  if (!first) return []
  if (first.chat) return [first]
  const head = [first]

  for (const next of waiting.slice(1)) {
    if (next.chat || senderOf(next, ownerUserId) !== senderOf(first, ownerUserId)) break
    head.push(next)
  }

  return head
}

/** Whether a turn waits to start; a new message must queue behind it, not overtake it. */
export async function hasQueuedTranscriptMessage(userId: string, sessionId: string) {
  return queueHead(await listPendingUserMessages(userId, sessionId), userId).length > 0
}

/** Whether this person sent a message that waits: only that supersedes their own turn's prompt. */
export async function hasWaitingMessageFrom(
  userId: string,
  sessionId: string,
  actorUserId: string,
) {
  return (await listPendingUserMessages(userId, sessionId)).some(
    (message) =>
      !AGENT_SOURCES.includes(message.source) && (message.actorUserId ?? userId) === actorUserId,
  )
}

/**
 * Remove exactly these messages. Each stored entry is removed by its own value,
 * so of two drains racing for one message only one gets it.
 */
export async function takePendingUserMessages(
  userId: string,
  sessionId: string,
  messages: readonly PendingUserMessage[],
): Promise<PendingUserMessage[]> {
  if (messages.length === 0) return []
  const key = pendingKey(userId, sessionId)
  const ids = new Set(messages.map((message) => message.id))
  const taken = new Set<string>()
  const local = localQueues.get(key) ?? []
  const remaining = local.filter((message) => !ids.has(message.id))

  for (const message of local) if (ids.has(message.id)) taken.add(message.id)
  if (remaining.length > 0) localQueues.set(key, remaining)
  else localQueues.delete(key)
  const raw = await tryRedis((c) => c.lrange(key, 0, -1))

  for (const value of Array.isArray(raw) ? raw : []) {
    const id = parse(value)?.id

    if (!id || !ids.has(id) || taken.has(id)) continue
    if ((await tryRedis((c) => c.lrem(key, 1, value))) === 1) taken.add(id)
  }

  return messages.filter((message) => taken.has(message.id))
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

  await tryRedis((c) =>
    c
      .multi()
      .lpush(key, ...raws)
      .sadd(QUEUED_SESSIONS_KEY, queuedSession(userId, sessionId))
      .exec(),
  )
}

/**
 * What a starting turn folds in besides its own input: only messages its own
 * sender parked, never an agent's. A channel turn also takes its actor's
 * channel messages, since only it can answer there.
 */
export async function takeTurnQueue(
  userId: string,
  sessionId: string,
  actorUserId: string,
  channelTurn?: boolean,
): Promise<PendingUserMessage[]> {
  const queue = await listPendingUserMessages(userId, sessionId)
  const own = queue.filter(
    (message) =>
      !AGENT_SOURCES.includes(message.source) &&
      senderOf(message, userId) === actorUserId &&
      !message.chat &&
      (channelTurn || isTranscriptMessage(message)),
  )

  return takePendingUserMessages(userId, sessionId, own)
}

const PENDING_PREFIX = 'atlas:agentrun-pending:'

/**
 * One batch of sessions whose queue has a message a turn would start, and the
 * cursor for the next batch. `shared` reads the index all replicas share; without
 * it only this process's in-memory queues are looked at.
 */
export async function scanQueuedSessions(
  cursor: string,
  shared = true,
): Promise<{ cursor: string; sessions: { userId: string; sessionId: string }[] }> {
  const local =
    cursor === '0' ? [...localQueues.keys()].map((key) => key.slice(PENDING_PREFIX.length)) : []
  const page = shared
    ? await tryRedis((c) => c.sscan(QUEUED_SESSIONS_KEY, cursor, 'COUNT', 200))
    : null
  const members = [...new Set([...local, ...(page?.[1] ?? [])])]
  // Every queue of the page in one round trip.
  const stored =
    page && members.length
      ? await tryRedis((c) =>
          members
            .reduce((write, member) => write.lrange(PENDING_PREFIX + member, 0, -1), c.pipeline())
            .exec(),
        )
      : null
  const sessions: { userId: string; sessionId: string }[] = []

  for (const [i, member] of members.entries()) {
    const [userId, ...rest] = member.split(':')
    const sessionId = rest.join(':')

    if (!userId || !sessionId) continue
    const key = pendingKey(userId, sessionId)
    const [error, raw] = stored?.[i] ?? [null, null]
    const read = Array.isArray(raw) && !error

    if (read && raw.length === 0 && !localQueues.has(key)) {
      // Gone: leave the index, unless a queue was stored since the read.
      await tryRedis((c) =>
        c.eval(
          `if redis.call('EXISTS', KEYS[1]) == 0 then return redis.call('SREM', KEYS[2], ARGV[1]) end return 0`,
          2,
          key,
          QUEUED_SESSIONS_KEY,
          member,
        ),
      )
      continue
    }
    const queue = [
      ...(localQueues.get(key) ?? []),
      ...(read ? raw : []).map(parse).filter((m) => m !== null),
    ]

    // A queue that could not be read is tried; start() reads it again.
    if ((!read && page) || queueHead(queue, userId).length > 0) sessions.push({ userId, sessionId })
  }

  return { cursor: page ? page[0] : cursor, sessions }
}

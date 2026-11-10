import { redisEnabled, withRedis } from '@/lib/redis'

import { parseMessageMetadata } from './message-metadata'

import type { MessageMetadata } from './message-metadata'

// The runtime echoes a steer back as only its id and text, possibly to another
// replica than the one that sent it. So the sender goes on record by that id
// when the steer is sent, and the turn's receipt reads it back.
const TTL_SEC = 10 * 60
const key = (sessionId: string, messageId: string) =>
  `atlas:agent-steer-sender:${sessionId}:${messageId}`
const local = new Map<string, MessageMetadata>()

export async function recordSteerSender(
  sessionId: string,
  messageId: string,
  metadata: MessageMetadata,
): Promise<void> {
  if (!redisEnabled()) {
    local.set(key(sessionId, messageId), metadata)

    return
  }
  await withRedis((c) => c.set(key(sessionId, messageId), JSON.stringify(metadata), 'EX', TTL_SEC))
}

export async function takeSteerSender(
  sessionId: string,
  messageId: string,
): Promise<MessageMetadata | undefined> {
  if (!redisEnabled()) {
    const metadata = local.get(key(sessionId, messageId))

    local.delete(key(sessionId, messageId))

    return metadata
  }
  const raw = await withRedis((c) => c.get(key(sessionId, messageId)))

  try {
    return raw ? parseMessageMetadata(JSON.parse(raw)) : undefined
  } catch {
    return undefined
  }
}

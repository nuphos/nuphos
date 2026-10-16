// Short-lived marks a message retraction reads and leaves. Redis-backed like
// the pending queue they guard; without Redis there is no queue to carry from.
import { withRedis } from '@/lib/redis'

import type { PendingUserMessage } from './pending-message-types'

const HOUR_S = 3_600
const carriedKey = (turnKey: string) => `atlas:agent-turn-carried:${turnKey}`
const retractedKey = (sessionId: string) => `atlas:agent-retracted:${sessionId}`

/** Note that the turn took in queued messages, so its prompt is not taken back with them. */
export function markCarried(turnKey: string) {
  return async (drained: PendingUserMessage[]) => {
    if (drained.length > 0) await withRedis((c) => c.set(carriedKey(turnKey), '1', 'EX', HOUR_S))

    return drained
  }
}

export async function turnCarried(turnKey: string): Promise<boolean> {
  return (await withRedis((c) => c.exists(carriedKey(turnKey)))) === 1
}

/** The runtime still holds a taken-back prompt; its next prompt there says to drop it. */
export async function markRetracted(sessionId: string): Promise<void> {
  await withRedis((c) => c.set(retractedKey(sessionId), '1', 'EX', 7 * 24 * HOUR_S))
}

export async function consumeRetracted(sessionId: string): Promise<boolean> {
  return Boolean(await withRedis((c) => c.getdel(retractedKey(sessionId))))
}

// Which turns took in queued messages, so a retraction never stops one of them.
// Redis-backed like the queue itself; without Redis there is nothing to carry.
import { withRedis } from '@/lib/redis'

import type { PendingUserMessage } from './pending-message-types'

const HOUR_S = 3_600
const carriedKey = (turnKey: string) => `atlas:agent-turn-carried:${turnKey}`

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

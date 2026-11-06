// One-off migration for #1691: every top-level agent conversation people use
// directly becomes a Bot, by storing the face it already shows. Sub-threads
// and trigger runs stay Tasks; so do archived conversations.
// scripts/migrate-agents-to-bots.ts does the reads and writes.

import type { AgentConversation } from './db'
import type { Filter } from 'mongodb'

export { derivedAvatar } from './bot-avatars'

/** Conversations the migration promotes; also re-checked on every write. */
export const botMigrationFilter: Filter<AgentConversation> = {
  kind: { $ne: 'channel' },
  archivedAt: { $exists: false },
  parentSessionId: { $exists: false },
  'metadata.trigger': { $exists: false },
  avatar: { $exists: false },
}

/** The median of counts already sorted ascending (the lower one when even). */
export function lowerMedian(sorted: number[]): number {
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) : 0
}

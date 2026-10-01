import { config } from '@/config'
import { agentConversations } from '@/lib/agent/db/shared'
import { logError, logEvent } from '@/lib/observability'

import type { AgentConversation } from '@/lib/agent/db/shared'
import type { Filter } from 'mongodb'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const WARMUP_DELAY_MS = 60 * 1000

/** Unarchived conversations whose last activity — and last manual restore, if
 *  any — both fall before the idle cutoff. */
export function idleConversationFilter(now: Date, idleDays: number): Filter<AgentConversation> {
  const cutoff = new Date(now.getTime() - idleDays * 24 * 60 * 60 * 1000)

  return {
    archivedAt: { $exists: false },
    lastActiveAt: { $lt: cutoff },
    $or: [{ archiveRestoredAt: { $exists: false } }, { archiveRestoredAt: { $lt: cutoff } }],
  }
}

export async function archiveIdleConversations(now = new Date()): Promise<number> {
  const idleDays = config.agent.autoArchiveIdleDays

  if (idleDays <= 0) return 0
  const result = await agentConversations().updateMany(idleConversationFilter(now, idleDays), {
    $set: { archivedAt: now },
  })

  if (result.modifiedCount > 0) {
    logEvent('info', 'agent.conversation_auto_archive.swept', {
      archived: result.modifiedCount,
      idle_days: idleDays,
    })
  }

  return result.modifiedCount
}

let warmupTimer: ReturnType<typeof setTimeout> | undefined
let sweepTimer: ReturnType<typeof setInterval> | undefined

function runSweep() {
  void archiveIdleConversations().catch((err: unknown) => {
    logError('agent.conversation_auto_archive.failed', err)
  })
}

/** Plain hourly interval on every replica: the sweep is one idempotent
 *  updateMany, so concurrent runs only repeat a no-op. */
export const conversationAutoArchive = {
  init(): void {
    if (config.agent.autoArchiveIdleDays <= 0) return
    warmupTimer = setTimeout(runSweep, WARMUP_DELAY_MS)
    sweepTimer = setInterval(runSweep, SWEEP_INTERVAL_MS)
    logEvent('info', 'backend.conversation_auto_archive.ready', {
      idle_days: config.agent.autoArchiveIdleDays,
    })
  },
  shutdown(): void {
    if (warmupTimer) clearTimeout(warmupTimer)
    if (sweepTimer) clearInterval(sweepTimer)
  },
}

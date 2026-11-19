import { config } from '@/config'
import { withdrawQuestionsAbout } from '@/lib/agent/db/archive'
import { agentConversations } from '@/lib/agent/db/shared'
import { reclaimSessionHomes } from '@/lib/claude-code-preview/runtime-session-home'
import { logError, logEvent } from '@/lib/observability'
import { claimRun } from '@/lib/redis'

import type { AgentConversation } from '@/lib/agent/db/shared'
import type { Filter } from 'mongodb'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const WARMUP_DELAY_MS = 60 * 1000

/** Unarchived Tasks whose last activity — and last manual restore, if any —
 *  both fall before the idle cutoff. A Bot (a conversation with an `avatar`)
 *  is persistent and never archives itself, unless nobody ever wrote to it:
 *  a "New Bot" made with "+" and left empty files away like a Task. */
export function idleConversationFilter(now: Date, idleDays: number): Filter<AgentConversation> {
  const cutoff = new Date(now.getTime() - idleDays * 24 * 60 * 60 * 1000)

  return {
    archivedAt: { $exists: false },
    lastActiveAt: { $lt: cutoff },
    $and: [
      { $or: [{ avatar: { $exists: false } }, { messageCount: 0 }] },
      { $or: [{ archiveRestoredAt: { $exists: false } }, { archiveRestoredAt: { $lt: cutoff } }] },
    ],
  }
}

export async function archiveIdleConversations(now = new Date()): Promise<number> {
  const idleDays = config.agent.autoArchiveIdleDays

  if (idleDays <= 0) return 0
  const result = await agentConversations().updateMany(idleConversationFilter(now, idleDays), {
    $set: { archivedAt: now },
  })

  if (result.modifiedCount > 0) {
    const archived = await agentConversations()
      .find({ archivedAt: now }, { projection: { sessionId: 1, userId: 1 } })
      .toArray()

    for (const userId of new Set(archived.map((one) => one.userId)))
      await withdrawQuestionsAbout(
        userId,
        archived.filter((one) => one.userId === userId).map((one) => one.sessionId),
      )
    logEvent('info', 'agent.conversation_auto_archive.swept', {
      archived: result.modifiedCount,
      idle_days: idleDays,
    })
  }

  return result.modifiedCount
}

let warmupTimer: ReturnType<typeof setTimeout> | undefined
let sweepTimer: ReturnType<typeof setInterval> | undefined

let sweeping = false

/** The hourly sweep, on one replica: every replica ticks, the first to claim
 *  the hour archives and reclaims. Manual archives are reclaimed even when idle
 *  archiving is off. */
export async function sweepOnOneReplica(): Promise<void> {
  if (!(await claimRun('agent:conversation-auto-archive', SWEEP_INTERVAL_MS - 5 * 60 * 1000)))
    return
  await archiveIdleConversations().catch((err: unknown) => {
    logError('agent.conversation_auto_archive.failed', err)
  })
  await reclaimSessionHomes().catch((err: unknown) => {
    logError('agent.session_home_reclaim.failed', err)
  })
}

function runSweep() {
  // A slow reclaim must not overlap the next interval.
  if (sweeping) return
  sweeping = true
  void sweepOnOneReplica().finally(() => {
    sweeping = false
  })
}

export const conversationAutoArchive = {
  init(): void {
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

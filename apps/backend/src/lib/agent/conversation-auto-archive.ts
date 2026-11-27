import { config } from '@/config'
import { retryArchivedHomes, retryArchivedTaskTriggers } from '@/lib/agent/archive-cleanup'
import {
  archiveUpdate,
  isBotChat,
  restoreArchivedConversation,
  withdrawQuestionsAbout,
} from '@/lib/agent/db/archive'
import { agentConversations } from '@/lib/agent/db/shared'
import { reclaimSessionHomes } from '@/lib/claude-code-preview/runtime-session-home'
import { logError, logEvent } from '@/lib/observability'
import { claimRun } from '@/lib/redis'

import type { AgentConversation } from '@/lib/agent/db/shared'
import type { Filter } from 'mongodb'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000
// After a start, and after a tick another replica's claim refused.
const RETRY_DELAY_MS = 60 * 1000

/** Unarchived Tasks whose last activity — and last manual restore, if any —
 *  both fall before the idle cutoff. A Bot (a conversation with an `avatar`)
 *  is persistent and never archives itself, unless nobody ever wrote to it:
 *  a "New Bot" made with "+" and left empty files away like a Task. A Bot's
 *  chat (a channel that is not a group chat) is part of its Bot and only ever
 *  moves with it (see `botUnit`), so it never archives itself either. */
export function idleConversationFilter(now: Date, idleDays: number): Filter<AgentConversation> {
  const cutoff = new Date(now.getTime() - idleDays * 24 * 60 * 60 * 1000)

  return {
    archivedAt: { $exists: false },
    lastActiveAt: { $lt: cutoff },
    $nor: [{ kind: 'channel', group: { $exists: false } }],
    $and: [
      { $or: [{ avatar: { $exists: false } }, { messageCount: 0 }] },
      { $or: [{ archiveRestoredAt: { $exists: false } }, { archiveRestoredAt: { $lt: cutoff } }] },
    ],
  }
}

export async function archiveIdleConversations(now = new Date()): Promise<number> {
  const idleDays = config.agent.autoArchiveIdleDays

  if (idleDays <= 0) return 0
  const result = await agentConversations().updateMany(
    idleConversationFilter(now, idleDays),
    archiveUpdate(now, { source: 'auto_archive' }),
  )

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

/**
 * Run at start. Before #5277 the sweep filed a Bot's chat away without its Bot,
 * which left the Bot in Bots but impossible to open. Each Bot that is open and
 * has only archived chats gets them back, as restoring any of them does (see
 * `botUnit`). Idempotent: a no-op once no such Bot remains.
 */
export async function restoreStrandedBotChats(): Promise<void> {
  const chats = await agentConversations()
    .find(
      { kind: 'channel', group: { $exists: false } },
      {
        projection: {
          sessionId: 1,
          userId: 1,
          teamId: 1,
          kind: 1,
          agentSessionIds: 1,
          participantIds: 1,
          archivedAt: 1,
        },
      },
    )
    .toArray()
  const byBot = Map.groupBy(chats.filter(isBotChat), (chat) => chat.agentSessionIds?.[0])
  const bots = await agentConversations()
    .find(
      {
        sessionId: { $in: [...byBot.keys()].filter((botId) => botId !== undefined) },
        kind: { $exists: false },
        avatar: { $exists: true },
        archivedAt: { $exists: false },
      },
      { projection: { sessionId: 1, userId: 1, teamId: 1 } },
    )
    .toArray()
  let restored = 0

  for (const bot of bots) {
    // Its owner's chats with it, as `botUnit` counts them.
    const own = (byBot.get(bot.sessionId) ?? []).filter(
      (chat) => chat.userId === bot.userId && chat.teamId === bot.teamId,
    )
    const [first] = own

    if (!first || own.some((chat) => !chat.archivedAt)) continue
    if (await restoreArchivedConversation(first.sessionId, { source: 'bot_chat_stranded' }))
      restored += 1
  }
  if (restored > 0) logEvent('info', 'backend.migration.bot_chats_restored', { bots: restored })
}

let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false

/** The hourly sweep, on one replica: every replica ticks, the first to claim
 *  the hour archives and reclaims. Manual archives are reclaimed even when idle
 *  archiving is off. False when another replica holds the hour. */
export async function sweepOnOneReplica(): Promise<boolean> {
  if (!(await claimRun('agent:conversation-auto-archive', SWEEP_INTERVAL_MS - 5 * 60 * 1000)))
    return false
  await archiveIdleConversations().catch((err: unknown) => {
    logError('agent.conversation_auto_archive.failed', err)
  })
  await retryArchivedTaskTriggers().catch((err: unknown) => {
    logError('agent.archive_trigger_cleanup.failed', err)
  })
  await retryArchivedHomes().catch((err: unknown) => {
    logError('agent.session_home_reclaim.failed', err)
  })
  await reclaimSessionHomes().catch((err: unknown) => {
    logError('agent.session_home_reclaim.failed', err)
  })

  return true
}

/** How long after a tick the next one comes. A refused claim may be one a replica
 *  that is gone took just before a deploy, so it is asked again soon: waiting the
 *  full interval leaves almost two hours between sweeps. */
export const nextSweepDelay = (swept: boolean) => (swept ? SWEEP_INTERVAL_MS : RETRY_DELAY_MS)

// One timer, set again only when a tick ends: a slow reclaim cannot overlap the next.
function schedule(delayMs: number) {
  timer = setTimeout(() => {
    void sweepOnOneReplica()
      .catch((err: unknown) => {
        logError('agent.conversation_auto_archive.failed', err)

        return false
      })
      .then((swept) => {
        if (!stopped) schedule(nextSweepDelay(swept))
      })
  }, delayMs)
}

export const conversationAutoArchive = {
  init(): void {
    stopped = false
    schedule(RETRY_DELAY_MS)
    logEvent('info', 'backend.conversation_auto_archive.ready', {
      idle_days: config.agent.autoArchiveIdleDays,
    })
  },
  shutdown(): void {
    stopped = true
    if (timer) clearTimeout(timer)
  },
}

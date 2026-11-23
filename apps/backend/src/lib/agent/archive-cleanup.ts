import { logError } from '@/lib/observability'

import { descendantSessionIds } from './db/archive'
import { agentConversations } from './db/shared'
import { agentTriggers } from './trigger-db'
import { deleteTrigger } from './trigger-service/delete'

import type { AgentTrigger } from './trigger-db'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

/** What an archive leaves to finish, and the generations that keep it apart from a restore. */
export type ArchiveCleanupState = {
  archiveTriggersPendingAt?: Date // Archive Trigger cleanup still to finish.
  triggerBindingFence?: string // Serializes Trigger creation with archive.
  triggerArchiveEpoch?: number // Advances on each archive.
  archiveHomePendingEpochs?: { epoch: number; runtimeId: string | null; provider: OpenAbProvider }[] // Homes awaiting cleanup.
  sessionHomeEpoch?: number // Advanced atomically when restoring.
}

type ArchivedTrigger = Pick<AgentTrigger, '_id' | 'userId'>
type CleanupDeps = {
  find: (sessionIds: string[], epoch: number) => Promise<ArchivedTrigger[]>
  remove: (id: string, owner: string) => Promise<void>
}

const deps: CleanupDeps = {
  find: (sessionIds, epoch) =>
    agentTriggers()
      .find(
        {
          targetSessionId: { $in: sessionIds },
          $or: [{ archiveEpoch: { $exists: false } }, { archiveEpoch: { $lt: epoch } }],
        },
        { projection: { _id: 1, userId: 1 } },
      )
      .toArray(),
  remove: deleteTrigger,
}

/** Remove both enabled and disabled Triggers of the archived Tasks using the audited delete path. */
export async function removeArchivedTaskTriggers(
  sessionIds: string[],
  epoch: number,
  cleanup: CleanupDeps = deps,
): Promise<void> {
  if (sessionIds.length === 0) return
  for (const trigger of await cleanup.find(sessionIds, epoch)) {
    if (trigger._id) await cleanup.remove(trigger._id.toHexString(), trigger.userId)
  }
}

/** Retry records written by an archive even if that request failed or the Task was restored. */
export async function retryArchivedTaskTriggers(sessionIds?: string[]): Promise<void> {
  const pending = await agentConversations()
    .find(
      { archiveTriggersPendingAt: { $exists: true }, ...inSessions(sessionIds) },
      { projection: { sessionId: 1, archiveTriggersPendingAt: 1, triggerArchiveEpoch: 1 } },
    )
    .toArray()

  for (const conversation of pending) {
    const cutoff = conversation.archiveTriggersPendingAt

    if (!cutoff) continue
    try {
      await removeArchivedTaskTriggers(
        [conversation.sessionId],
        conversation.triggerArchiveEpoch ?? 1,
      )
      await agentConversations().updateOne(
        {
          sessionId: conversation.sessionId,
          archiveTriggersPendingAt: cutoff,
          triggerArchiveEpoch: conversation.triggerArchiveEpoch,
        },
        { $unset: { archiveTriggersPendingAt: '' } },
      )
    } catch (error) {
      logError('agent.archive_trigger_cleanup.failed', error, {
        session_id: conversation.sessionId,
      })
    }
  }
}

/**
 * The sweep reclaims the home generations archives queued; one whose runtime is
 * offline waits. Only the sweep: two reclaims of one home at once let the second
 * find it set aside and call it gone while the first is still removing it (#4629).
 */
export async function retryArchivedHomes(): Promise<void> {
  const { reclaimPendingArchiveHome } =
    await import('@/lib/claude-code-preview/runtime-session-home')
  const pending = await agentConversations()
    .find({ 'archiveHomePendingEpochs.0': { $exists: true } }, { projection: { sessionId: 1 } })
    .toArray()

  for (const { sessionId } of pending) {
    await reclaimPendingArchiveHome(sessionId).catch((error: unknown) => {
      logError('agent.session_home_reclaim.failed', error, { session_id: sessionId })
    })
  }
}

const inSessions = (sessionIds?: string[]) => (sessionIds ? { sessionId: { $in: sessionIds } } : {})

/**
 * Removes the Triggers an archive of these Tasks, and of the threads archived
 * with them, queued. Whatever fails here stays queued for the sweep, which also
 * reclaims their homes.
 */
export async function cleanUpArchived(sessionIds: string[]): Promise<void> {
  const roots = await agentConversations()
    .find(
      { sessionId: { $in: sessionIds } },
      { projection: { sessionId: 1, userId: 1, teamId: 1 } },
    )
    .toArray()
  const ids: string[] = []

  for (const root of roots) {
    ids.push(
      root.sessionId,
      ...(await descendantSessionIds(root.sessionId, {
        userId: root.userId,
        teamId: root.teamId ?? { $exists: false },
      })),
    )
  }
  await retryArchivedTaskTriggers(ids)
}

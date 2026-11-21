import { logError } from '@/lib/observability'

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
export async function retryArchivedTaskTriggers(): Promise<void> {
  const pending = await agentConversations()
    .find(
      { archiveTriggersPendingAt: { $exists: true } },
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
 * Archives a Task and queues its cleanup: the Trigger epoch advances so Triggers
 * created before it are removed, and the current home generation is queued for
 * reclaim on the runtime that holds it.
 */
export const archiveUpdate = (at: Date) => [
  {
    $set: {
      archivedAt: at,
      archiveTriggersPendingAt: at,
      triggerArchiveEpoch: { $add: [{ $ifNull: ['$triggerArchiveEpoch', 0] }, 1] },
      archiveHomePendingEpochs: {
        $setUnion: [
          { $ifNull: ['$archiveHomePendingEpochs', []] },
          [
            {
              epoch: { $ifNull: ['$sessionHomeEpoch', 0] },
              runtimeId: { $ifNull: ['$runtimeId', null] },
              provider: { $ifNull: ['$agentRuntime', 'claude-code'] },
            },
          ],
        ],
      },
    },
  },
]

/**
 * Removes the Triggers and homes of the Tasks `archiveUpdate(at)` just archived.
 * Whatever fails here stays queued for the sweep to retry.
 */
export async function cleanUpArchived(sessionIds: string[], at: Date): Promise<string[]> {
  const archived = await agentConversations()
    .find(
      { sessionId: { $in: sessionIds }, archivedAt: at },
      { projection: { sessionId: 1, triggerArchiveEpoch: 1 } },
    )
    .toArray()
  const ids = archived.map((one) => one.sessionId)

  for (const one of archived)
    await removeArchivedTaskTriggers([one.sessionId], one.triggerArchiveEpoch ?? 1)
  await agentConversations().updateMany(
    { sessionId: { $in: ids }, archiveTriggersPendingAt: at },
    { $unset: { archiveTriggersPendingAt: '' } },
  )
  const { reclaimPendingArchiveHome } =
    await import('@/lib/claude-code-preview/runtime-session-home')

  for (const id of ids) {
    await reclaimPendingArchiveHome(id).catch((error: unknown) => {
      logError('agent.session_home_reclaim.failed', error, { session_id: id })
    })
  }

  return ids
}

/** Retry the home generations archives queued; one whose runtime is offline waits. */
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

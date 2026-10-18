// A send to an offline Box waits in the session queue while the Box resumes.
import { stampConversationRuntimeInstance } from '@/lib/agent/db'
import { wakeOfflineBox } from '@/lib/agent/devices/box-wake'
import { AppError } from '@/lib/errors'

import { admitQueueableChat } from './session-queue-turn'

import type { QueueableChat } from './session-queue-turn'

/** The placement runtime resolution authorized before finding its Box offline. */
function offlinePlacement(error: unknown): { runtimeId: string; runtimeLabel?: string } | null {
  if (!(error instanceof AppError) || error.code !== 'runtime_offline') return null
  const details = error.details as { runtimeId?: unknown; runtimeLabel?: unknown } | undefined

  if (typeof details?.runtimeId !== 'string') return null

  return {
    runtimeId: details.runtimeId,
    ...(typeof details.runtimeLabel === 'string' ? { runtimeLabel: details.runtimeLabel } : {}),
  }
}

/**
 * A send whose Box is offline waits in the queue while the Box resumes, so the
 * request answers at once; null once it is queued. Anything else is rethrown.
 * Only the placement resolution authorized is woken and kept for the queue.
 */
export async function queueForOfflineBox(
  error: unknown,
  args: Omit<QueueableChat, 'snapshot' | 'runtimeOffline'>,
): Promise<null> {
  const placement = offlinePlacement(error)
  const conversation = args.conversation

  if (!placement || !conversation || !(await wakeOfflineBox(placement.runtimeId))) throw error
  // The queue starts the turn from the conversation's placement: keep the one chosen here.
  if (!conversation.runtimeId)
    await stampConversationRuntimeInstance(
      conversation.sessionId,
      placement.runtimeId,
      placement.runtimeLabel,
    )
  const queued = await admitQueueableChat({ ...args, snapshot: undefined, runtimeOffline: true })

  if (queued?.mode === 'queued') return null
  throw error
}

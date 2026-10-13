import { agentConversations } from '@/lib/agent/db/shared'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import type { OpenAbProvider } from './runtime-provider'
import type { ObjectId } from 'mongodb'

export type RuntimeDeletion = {
  _id: string
  teamId: string
  provider: OpenAbProvider
  requestedBy: string
  requestedAt: Date
  placements: {
    id: string
    url: string
    state: 'pending' | 'deleting' | 'deleted' | 'abandoned'
    volumeName?: string
    volumeUid?: string
    claimUid?: string
    deploymentUid?: string
    workspaceClaimUid?: string
    workspaceVolumeName?: string
    workspaceVolumeUid?: string
  }[]
  error?: string
  completedAt?: Date
}
export const runtimeDeletions = () => db().collection<RuntimeDeletion>('agent_runtime_deletions')

export type WorkspaceArchive = {
  _id: string
  teamId: string
  sessionId: string
  runtimeUrl: string
  fileId: ObjectId
  sha256: string
  size: number
  createdAt: Date
}
export const workspaceArchives = () => db().collection<WorkspaceArchive>('agent_workspace_archives')

export async function assertRuntimeNotDeleting(
  teamId: string,
  runtimeId?: string,
  runtimeUrl?: string,
) {
  if (!runtimeId && !runtimeUrl) return
  const deletion = await runtimeDeletions().findOne(
    {
      teamId,
      completedAt: { $exists: false },
      $or: [
        ...(runtimeId ? [{ _id: runtimeId }] : []),
        ...(runtimeUrl ? [{ 'placements.url': runtimeUrl }] : []),
      ],
    },
    { projection: { _id: 1 } },
  )

  if (deletion)
    throw new AppError(
      409,
      'runtime_deleting',
      'This agent is being deleted. Move the conversation to another agent to continue.',
    )
}

/** Checked after turn admission as well as before attaching a native session. */
export async function assertConversationRuntimeAvailable(sessionId: string) {
  const conversation = await agentConversations().findOne(
    { sessionId },
    {
      projection: { teamId: 1, runtimeId: 1, claudeCodePreview: 1, runtimeOperation: 1 },
    },
  )

  if (conversation?.runtimeOperation && conversation.runtimeOperation.expiresAt > new Date())
    throw new AppError(
      409,
      'runtime_moving',
      'This conversation is being moved. Please wait for the move to finish.',
    )
  if (conversation?.teamId)
    await assertRuntimeNotDeleting(
      conversation.teamId,
      conversation.runtimeId,
      conversation.claudeCodePreview?.runtimeUrl,
    )
}

import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { getTransferGroup, resolveDownloads } from '@/lib/file-transfer/service'

import { agentMessages } from './db/shared'
import { parseMessageMetadata } from './message-metadata'

import type { AgentConversation } from './db/shared'
import type { TransferScope } from '@/lib/file-transfer/service-shared'

type Channel = Pick<AgentConversation, 'sessionId' | 'userId' | 'teamId'>

/**
 * The poster's own finished upload, as the part a conversation stores for it.
 * Its files come from the store, not from what the client says it sent.
 */
export async function channelUploadPart(teamId: string, userId: string, groupId: string) {
  const group = await getTransferGroup({ teamId: new ObjectId(teamId), userId }, groupId)

  if (group.direction !== 'upload' || group.status !== 'ready')
    throw new AppError(400, 'invalid_request', 'The upload is not finished')

  return {
    type: 'transfer-upload' as const,
    groupId: group.groupId,
    status: 'ready' as const,
    files: group.files.map((file) => ({
      fileName: file.fileName,
      size: file.size,
      status: 'ready' as const,
    })),
  }
}

/**
 * An upload is only ever read through the chat it was posted to, under its
 * uploader's scope: whoever may read the chat, and its agents, see what was
 * posted there, and a group id from anywhere else finds nothing.
 */
async function uploaderScope(channel: Channel, groupId: string): Promise<TransferScope> {
  const doc = await agentMessages().findOne(
    {
      sessionId: channel.sessionId,
      userId: channel.userId,
      parts: { $elemMatch: { type: 'transfer-upload', groupId } },
    },
    { projection: { metadata: 1 } },
  )
  const sender = parseMessageMetadata(doc?.metadata)?.sender

  if (!doc || !channel.teamId || sender?.type !== 'user')
    throw new AppError(404, 'not_found', 'Attachment not found')

  return { teamId: new ObjectId(channel.teamId), userId: sender.id }
}

/** The files of an upload posted to this chat, with fresh download links. */
export async function resolveChannelUpload(channel: Channel, groupId: string) {
  return await resolveDownloads(await uploaderScope(channel, groupId), groupId)
}

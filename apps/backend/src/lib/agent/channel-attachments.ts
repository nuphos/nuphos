import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { getTransferGroup, listTransferGroups, resolveDownloads } from '@/lib/file-transfer/service'

import { agentConversations, agentMessages } from './db/shared'
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
 * A chat's files are only ever read through the chat they were posted to, under
 * their poster's scope: a person's upload as that person, an agent's pushed files
 * as its owner. Whoever may read the chat, and its agents, see what was posted
 * there, and a group id from anywhere else finds nothing.
 */
async function posterScope(channel: Channel, groupId: string): Promise<TransferScope> {
  const doc = await agentMessages().findOne(
    {
      sessionId: channel.sessionId,
      userId: channel.userId,
      parts: { $elemMatch: { type: { $in: ['transfer-upload', 'transfer-download'] }, groupId } },
    },
    { projection: { metadata: 1 } },
  )
  const metadata = parseMessageMetadata(doc?.metadata)
  const agent =
    metadata?.sender.type === 'agent'
      ? await agentConversations().findOne(
          { sessionId: metadata.sourceSessionId ?? metadata.sender.id, teamId: channel.teamId },
          { projection: { userId: 1 } },
        )
      : null
  const userId = metadata?.sender.type === 'user' ? metadata.sender.id : agent?.userId

  if (!channel.teamId || !userId) throw new AppError(404, 'not_found', 'Attachment not found')

  return { teamId: new ObjectId(channel.teamId), userId }
}

/** The files of a group posted to this chat, with fresh download links. */
export async function resolveChannelFiles(channel: Channel, groupId: string) {
  return await resolveDownloads(await posterScope(channel, groupId), groupId)
}

/** What an agent pushed for download since `since` (its turn), as parts for its chat post. */
export async function pushedFileParts(
  agent: Pick<AgentConversation, 'sessionId' | 'userId' | 'teamId'>,
  since: Date,
) {
  if (!agent.teamId) return []
  const groups = await listTransferGroups(
    { teamId: new ObjectId(agent.teamId), userId: agent.userId, sessionId: agent.sessionId },
    'download',
  )

  return groups
    .filter((group) => Date.parse(group.createdAt) >= since.getTime())
    .reverse()
    .map((group) => ({ type: 'transfer-download' as const, groupId: group.groupId }))
}

/**
 * Files an agent names to post, as parts: only finished groups its own session
 * (or one of its sub-agents) produced, so it cannot post someone else's files.
 */
export async function agentFileParts(
  agent: Pick<AgentConversation, 'sessionId' | 'userId' | 'teamId'>,
  groupIds: readonly string[],
) {
  if (!agent.teamId) return []
  const scope = {
    teamId: new ObjectId(agent.teamId),
    userId: agent.userId,
    sessionId: agent.sessionId,
  }

  return await Promise.all(
    [...new Set(groupIds)].map(async (groupId) => {
      const group = await getTransferGroup(scope, groupId)

      if (group.direction !== 'download' || group.status !== 'ready')
        throw new AppError(400, 'invalid_request', `Files ${groupId} are not finished uploading`)

      return { type: 'transfer-download' as const, groupId: group.groupId }
    }),
  )
}

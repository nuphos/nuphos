import { resolveConversationAccessList } from '../devices/conversation-computer'
import { parseMessageMetadata } from '../message-metadata'

import { canReply, readableConversationScope } from './access'
import { isChannel, postText } from './channels'
import { agentConversations, agentMessages } from './shared'

/**
 * Where the viewer was @mentioned or invited and has not posted since, the newest first.
 * Not where they cannot reply now: they could never post to clear it.
 */
export async function listChannelMentions(teamId: string, viewerId: string) {
  const mentioning = await agentConversations()
    .find(
      readableConversationScope({ [`mentions.${viewerId}`]: { $exists: true } }, viewerId, teamId),
    )
    .toArray()
  const access = await resolveConversationAccessList(mentioning, viewerId)
  const channels = mentioning.filter((_, index) => canReply(access[index] ?? null))
  const found = await Promise.all(
    channels.map(async (channel) => {
      const mention = channel.mentions?.[viewerId]
      const invitedBy = mention?.invitedBy
      const message =
        mention &&
        !invitedBy &&
        (await agentMessages().findOne({
          sessionId: channel.sessionId,
          userId: channel.userId,
          messageId: mention.messageId,
        }))

      if (!mention || (!message && !invitedBy)) return []
      const metadata = message ? parseMessageMetadata(message.metadata) : null

      return [
        {
          channelId: channel.sessionId,
          kind: isChannel(channel) ? 'channel' : 'agent',
          title: channel.title,
          messageId: mention.messageId,
          at: mention.at.toISOString(),
          ...(invitedBy ? { invited: true } : {}),
          sender: invitedBy
            ? { type: 'user', ...invitedBy }
            : metadata
              ? {
                  type: metadata.sender.type,
                  id: metadata.sender.id,
                  name: metadata.sender.displayName,
                }
              : null,
          text: message ? postText(message.parts) : '',
        },
      ]
    }),
  )

  return found.flat().sort((a, b) => b.at.localeCompare(a.at))
}

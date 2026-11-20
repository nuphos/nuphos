import { api } from '../../api'
import { openInApp } from '../../app/workspace/openInApp'
import { t } from '../../i18n'
import { pickAgentAvatar } from '../../lib/agentAvatarChoices'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { botAvatarName, derivedBotAvatar } from '../../lib/botAvatars'
import { announceChatArchived, announceChatUnarchived } from '../../lib/chatArchiveEvents'
import { toast } from '../ui/toast'

import { chooseBotChat, openBotChats, readBotChats } from './botChats'
import { markChannel } from './channelKind'
import { listedConversation } from './channelShared'

import type { ChannelAgent } from '../../api'

export { botOfChannel } from './botChats'

/** Whether the viewer owns a chat's Bot: by the chat's agents, or by the sidebar's row
 *  of the Bot until the chat loads. */
export function ownsBot(
  teamId: string,
  botId: string | undefined,
  viewerId: string,
  agents: ChannelAgent[] | null,
): boolean {
  return agents
    ? agents.some((agent) => agent.sessionId === botId && agent.ownerId === viewerId)
    : listedConversation(teamId, botId)?.isOwner === true
}

const making = new Map<string, Promise<string>>()

/** Makes a Bot's chat: a new channel with the Bot in it. One at a time per Bot. */
export function createBotChannel(teamId: string, botId: string): Promise<string> {
  const made =
    making.get(botId) ??
    api.agentCreateChannel(teamId).then(async ({ sessionId }) => {
      markChannel(sessionId)
      try {
        await api.agentAddChannelAgent(sessionId, teamId, botId)
      } catch (error) {
        // A chat the Bot could not join is an empty channel: file it away again.
        await api.agentSetConversationArchived(sessionId, true, teamId).catch(() => null)
        throw error
      }

      return sessionId
    })

  making.set(botId, made)
  void made.finally(() => making.delete(botId))

  return made
}

/** Every chat the Bot has, archived ones too. */
function listBotChats(teamId: string, botId: string) {
  return readBotChats(
    (cursor) =>
      api.agentListConversations(teamId, {
        scope: 'mine',
        kind: 'channel',
        limit: 100,
        sort: 'activity',
        ...(cursor ? { cursor } : {}),
      }),
    botId,
  )
}

const opening = new Map<string, Promise<string | null>>()

/**
 * The Bot's chat, made only when it never had one, so opening a Bot never piles
 * up empty chats. When every chat it had is archived, the Bot was archived with
 * them: only making it a Bot again (`restore`) brings the latest back. A list that
 * has not caught up with the archive gets null, not the Bot back (#4203).
 */
function ensureBotChannel(teamId: string, botId: string, restore = false) {
  const found =
    opening.get(botId) ??
    listBotChats(teamId, botId).then(async (chats) => {
      const choice = chooseBotChat(chats)

      if (!choice) return createBotChannel(teamId, botId)
      if (!choice.archived) return choice.chatId
      if (!restore) return null
      await api.agentSetConversationArchived(choice.chatId, false, teamId)
      announceChatUnarchived(choice.chatId)

      return choice.chatId
    })

  opening.set(botId, found)
  void found.finally(() => opening.delete(botId)).catch(() => null)

  return found
}

/** Opens a Bot from Bots: its chat, made the first time. An archived Bot leaves the list. */
export function openBotChannel(teamId: string, botId: string, open: (key: string) => void) {
  ensureBotChannel(teamId, botId).then(
    (chatId) =>
      chatId ? open(`agent-session:${chatId}`) : announceChatArchived({ sessionId: botId, teamId }),
    (error: unknown) => toast.apiError(t('Failed to open task'), error),
  )
}

/**
 * "Make this a Bot": the face shows at once, the server sets the same one and
 * asks the agent to name itself, and the Bot's chat opens in the focused pane.
 * Making a Bot again is harmless: the server keeps its face and the chat it had opens.
 */
export function makeBot(teamId: string, sessionId: string) {
  return pickAgentAvatar(sessionId, botAvatarName(derivedBotAvatar(sessionId)), () =>
    api.agentMakeBot(sessionId, teamId),
  )
    .then(() => ensureBotChannel(teamId, sessionId, true))
    .then((chatId) =>
      openInApp(
        pageLocationForNavigation(
          emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: chatId }),
        ).href,
      ),
    )
    .catch((err: unknown) => toast.apiError(t('Could not change avatar'), err))
}

/**
 * "Turn into a Task": the face goes, and the server files away the Bot's open
 * chats, which would otherwise stay in Bots under a Task's name; the sidebar
 * hears of each. Making it a Bot again brings back the latest of them.
 */
export function turnIntoTask(teamId: string, sessionId: string) {
  return listBotChats(teamId, sessionId)
    .then((chats) =>
      pickAgentAvatar(sessionId, null, () =>
        api.agentSetConversationAvatar(sessionId, null, teamId),
      ).then(() => {
        for (const chatId of openBotChats(chats))
          announceChatArchived({ sessionId: chatId, teamId })
      }),
    )
    .catch((err: unknown) => toast.apiError(t('Could not change avatar'), err))
}

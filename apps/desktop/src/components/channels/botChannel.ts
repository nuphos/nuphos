import { api } from '../../api'
import { openInApp } from '../../app/workspace/openInApp'
import { t } from '../../i18n'
import { pickAgentAvatar } from '../../lib/agentAvatarChoices'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { botAvatarName, derivedBotAvatar } from '../../lib/botAvatars'
import { toast } from '../ui/toast'

import { markChannel } from './channelKind'

import type { ChannelFace } from '../../api'
import type { AgentConversation } from '../../api/agent-types'

/** A Bot's chat is a channel whose one other member is the Bot: its face and name. */
export function botOfChannel(faces: ChannelFace[] | undefined): string | undefined {
  return faces?.length === 1 && faces[0]?.agent ? faces[0].id : undefined
}

/** A Bot's own chat among these conversations, if it has one. */
export function chatOfBot(
  conversations: readonly AgentConversation[] | null | undefined,
  botId: string,
): string | undefined {
  return conversations?.find(
    (conversation) => conversation.kind === 'channel' && botOfChannel(conversation.faces) === botId,
  )?.sessionId
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

/** Opens a Bot that has no chat yet: its chat is made the first time. */
export function openBotChannel(teamId: string, botId: string, open: (key: string) => void) {
  createBotChannel(teamId, botId).then(
    (sessionId) => open(`agent-session:${sessionId}`),
    (error: unknown) => toast.apiError(t('Failed to open agent'), error),
  )
}

/** "Make this a Bot": the Bot gets its chat at once, in the focused pane. */
async function openNewBotChat(teamId: string, botId: string) {
  const chatId = await createBotChannel(teamId, botId)

  openInApp(
    pageLocationForNavigation(
      emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: chatId }),
    ).href,
  )
}

/**
 * "Make this a Bot": the face shows at once, the server sets the same one and
 * asks the agent to name itself, and the Bot's chat is made and opened.
 */
export function makeBot(teamId: string, sessionId: string) {
  return pickAgentAvatar(sessionId, botAvatarName(derivedBotAvatar(sessionId)), () =>
    api.agentMakeBot(sessionId, teamId),
  )
    .then(() => openNewBotChat(teamId, sessionId))
    .catch((err: unknown) => toast.apiError(t('Could not change avatar'), err))
}

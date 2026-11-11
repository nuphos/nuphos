import { api } from '../../api'
import { openInApp } from '../../app/workspace/openInApp'
import { t } from '../../i18n'
import { agentAvatarPick, pickAgentAvatar } from '../../lib/agentAvatarChoices'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { botAvatarName, derivedBotAvatar } from '../../lib/botAvatars'
import { announceChatArchived, announceChatUnarchived } from '../../lib/chatArchiveEvents'
import { toast } from '../ui/toast'

import { botOfChannel, chooseBotChat, openBotChats, readBotChats } from './botChats'
import { markChannel } from './channelKind'

import type { AgentConversation } from '../../api/agent-types'

export { botOfChannel } from './botChats'

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

/** How the Bot came by the chat it opens: it had it, it was brought back, or it is new. */
type BotChat = { chatId: string; made: 'existing' | 'restored' | 'created' }
const opening = new Map<string, Promise<BotChat>>()

/**
 * The Bot's chat, made only when it never had one: an open chat is reused and
 * an archived one brought back, so opening a Bot never piles up empty chats.
 */
export function ensureBotChannel(teamId: string, botId: string): Promise<BotChat> {
  const found =
    opening.get(botId) ??
    listBotChats(teamId, botId).then(async (chats): Promise<BotChat> => {
      const choice = chooseBotChat(chats)

      if (!choice) return { chatId: await createBotChannel(teamId, botId), made: 'created' }
      if (!choice.archived) return { chatId: choice.chatId, made: 'existing' }
      await api.agentSetConversationArchived(choice.chatId, false, teamId)
      announceChatUnarchived(choice.chatId)

      return { chatId: choice.chatId, made: 'restored' }
    })

  opening.set(botId, found)
  void found.finally(() => opening.delete(botId)).catch(() => null)

  return found
}

/** Opens a Bot from Bots: its chat, made the first time. */
export function openBotChannel(teamId: string, botId: string, open: (key: string) => void) {
  ensureBotChannel(teamId, botId).then(
    ({ chatId }) => open(`agent-session:${chatId}`),
    (error: unknown) => toast.apiError(t('Failed to open agent'), error),
  )
}

/** The Bot's chat, in the focused pane. */
function openChat(teamId: string, chatId: string) {
  openInApp(
    pageLocationForNavigation(
      emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: chatId }),
    ).href,
  )
}

/** Files chats away or brings them back, telling the sidebar as each lands. */
async function setChatsArchived(teamId: string, chatIds: string[], archived: boolean) {
  await Promise.all(
    chatIds.map(async (sessionId) => {
      await api.agentSetConversationArchived(sessionId, archived, teamId)
      if (archived) announceChatArchived({ sessionId, teamId })
      else announceChatUnarchived(sessionId)
    }),
  )
}

/** A receipt whose Undo runs once at a time and can be tried again if it fails. */
function offerUndo(title: string, failed: string, undo: () => Promise<unknown>) {
  let undoing = false

  toast.success(title, undefined, {
    dedupe: false,
    action: {
      label: t('Undo'),
      onClick: () => {
        if (undoing) return
        undoing = true
        void undo().catch((err: unknown) => {
          undoing = false
          toast.apiError(failed, err)
        })
      },
    },
  })
}

/**
 * "Make this a Bot": the face shows at once, the server sets the same one and
 * asks the agent to name itself, and the Bot's chat opens. A Bot already is
 * one, so it only opens its chat. Undo takes the face away and files away a
 * chat this opened; the naming turn the server started is not taken back.
 */
export async function makeBot(teamId: string, sessionId: string) {
  try {
    if (agentAvatarPick(sessionId)) {
      openChat(teamId, (await ensureBotChannel(teamId, sessionId)).chatId)

      return
    }
    await pickAgentAvatar(sessionId, botAvatarName(derivedBotAvatar(sessionId)), () =>
      api.agentMakeBot(sessionId, teamId),
    )
    const chat = ensureBotChannel(teamId, sessionId)

    offerUndo(t('Made this a Bot'), t('Could not turn it back into a Task'), async () => {
      await pickAgentAvatar(sessionId, null, () =>
        api.agentSetConversationAvatar(sessionId, null, teamId),
      )
      // A chat that could not be opened was never made, so there is none to file away.
      const opened = await chat.catch(() => null)

      if (opened && opened.made !== 'existing')
        await setChatsArchived(teamId, [opened.chatId], true)
    })
    openChat(teamId, (await chat).chatId)
  } catch (err) {
    toast.apiError(t('Could not change avatar'), err)
  }
}

/**
 * "Turn into a Task": the face goes, and so do the Bot's chats, which would
 * otherwise stay in Bots under a Task's name. Undo brings back both.
 */
export async function turnIntoTask(teamId: string, sessionId: string) {
  const avatar = agentAvatarPick(sessionId)

  try {
    await pickAgentAvatar(sessionId, null, () =>
      api.agentSetConversationAvatar(sessionId, null, teamId),
    )
    const chats = openBotChats(await listBotChats(teamId, sessionId))

    await setChatsArchived(teamId, chats, true)
    offerUndo(t('Turned into a Task'), t('Could not turn it back into a Bot'), async () => {
      if (avatar)
        await pickAgentAvatar(sessionId, avatar, () =>
          api.agentSetConversationAvatar(sessionId, avatar, teamId),
        )
      await setChatsArchived(teamId, chats, false)
    })
  } catch (err) {
    toast.apiError(t('Could not change avatar'), err)
  }
}

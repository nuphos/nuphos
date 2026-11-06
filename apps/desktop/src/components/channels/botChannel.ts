import { api } from '../../api'
import { t } from '../../i18n'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { toast } from '../ui/toast'

import { markChannel } from './channelKind'

import type { ChannelFace } from '../../api'

/** A Bot's chat is a channel whose one other member is the Bot: its face and name. */
export function botOfChannel(faces: ChannelFace[] | undefined): string | undefined {
  return faces?.length === 1 && faces[0]?.agent ? faces[0].id : undefined
}

const making = new Map<string, Promise<string>>()

/** Makes a Bot's chat: a new channel with the Bot in it. One at a time per Bot. */
export function createBotChannel(teamId: string, botId: string): Promise<string> {
  const made =
    making.get(botId) ??
    api.agentCreateChannel(teamId).then(async ({ sessionId }) => {
      markChannel(sessionId)
      await api.agentAddChannelAgent(sessionId, teamId, botId)

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

/** "Make this a Bot": the Bot gets its chat at once, opened like "+" opens a new one. */
export async function openNewBotChat(teamId: string, botId: string) {
  const channelId = await createBotChannel(teamId, botId)
  const { href } = pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: channelId }),
  )

  window.dispatchEvent(new CustomEvent('nuphos:open-in-app', { detail: href }))
}

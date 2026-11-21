import { useQuery } from '@tanstack/react-query'

import { botOfChannel } from '../components/channels/botChats'
import { agentSessionsQuery } from '../components/sidebar/agentSessions'
import { t } from '../i18n'
import { isBotRow } from '../lib/agentAvatarChoices'

/**
 * What a link to `sessionId` opens, "Open Bot" or "Open Task", read from the chats the
 * sidebar already listed; it asks the backend nothing. A chat it has not listed is a Task.
 */
export function useOpenChatLabel(teamId: string | undefined, sessionId: string | undefined) {
  const { data } = useQuery({ ...agentSessionsQuery(teamId ?? ''), enabled: false })
  const target = data?.find((chat) => chat.sessionId === sessionId)

  return target && (isBotRow(target) || botOfChannel(target)) ? t('Open Bot') : t('Open Task')
}

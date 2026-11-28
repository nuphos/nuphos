import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'

import { t } from '../../i18n'
import { botOfChannel } from '../channels/botChats'
import { agentSessionsQuery } from '../sidebar/agentSessions'

import { AgentAvatar } from './AgentAvatar'

/**
 * What a link to a Task or Bot opens: its face or Runtime icon and its title, from the
 * chats the sidebar already listed. Never asks the backend; a chat it has not listed
 * (archived, not loaded, not shared) reads "Open". A Bot's 1:1 chat shows the Bot.
 */
export function SessionLinkLabel({ teamId, sessionId }: { teamId: string; sessionId: string }) {
  const { data } = useQuery({ ...agentSessionsQuery(teamId), enabled: false })
  const target = data?.find((chat) => chat.sessionId === sessionId)
  const bot = botOfChannel(target) ? target?.faces?.[0] : undefined
  const shown = bot
    ? {
        agentId: bot.id,
        title: bot.name,
        avatar: bot.agent?.avatar,
        avatarBackground: bot.agent?.avatarBackground,
        provider: bot.agent?.provider,
      }
    : target && {
        agentId: sessionId,
        // Named as the sidebar names it.
        title: target.title || target.firstMessage || t('Untitled task'),
        avatar: target.avatar,
        avatarBackground: target.avatarBackground,
        provider: target.agentRuntime,
      }

  return (
    <>
      {shown ? (
        <>
          <AgentAvatar
            agentId={shown.agentId}
            avatar={shown.avatar}
            avatarBackground={shown.avatarBackground}
            provider={shown.provider}
            size={16}
            showBadge={false}
          />
          <span className="min-w-0 truncate">{shown.title}</span>
        </>
      ) : (
        t('Open')
      )}
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
    </>
  )
}

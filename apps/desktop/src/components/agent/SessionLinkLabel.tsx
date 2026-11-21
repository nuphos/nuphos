import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'

import { t } from '../../i18n'
import { agentSessionsQuery } from '../sidebar/agentSessions'

import { AgentAvatar } from './AgentAvatar'

/**
 * What a link to a Task or Bot opens: its face or Runtime icon and its title, from the
 * chats the sidebar already listed. Never asks the backend; a chat it has not listed
 * (archived, not loaded, not shared) reads "Open".
 */
export function SessionLinkLabel({ teamId, sessionId }: { teamId: string; sessionId: string }) {
  const { data } = useQuery({ ...agentSessionsQuery(teamId), enabled: false })
  const target = data?.find((chat) => chat.sessionId === sessionId)

  return (
    <>
      {target ? (
        <>
          <AgentAvatar
            agentId={sessionId}
            avatar={target.avatar}
            provider={target.agentRuntime}
            size={16}
          />
          <span className="min-w-0 truncate">{target.title}</span>
        </>
      ) : (
        t('Open')
      )}
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
    </>
  )
}

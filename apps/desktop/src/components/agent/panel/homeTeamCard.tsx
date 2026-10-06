import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { formatAge } from '../../../utils'
import { Avatar } from '../../Avatar'
import { AGENT_SESSIONS_POLL_MS } from '../../sidebar/state'

import { summarizeTeamActivity } from './teamActivity'

import type { ActivityStatus } from './teamActivity'
import type { AgentConversation } from '../../../api'

// Enough recent chats to find everyone who is active right now.
const LIST_LIMIT = 50
const MAX_ROWS = 10

const STATUS: Record<ActivityStatus, { label: string; dot: string }> = {
  waiting: { label: 'Needs input', dot: 'bg-amber-400' },
  running: { label: 'Running', dot: 'bg-[#73bf69] animate-pulse' },
  background: { label: 'Background', dot: 'bg-[#73bf69]/60' },
  idle: { label: 'Idle', dot: 'bg-zGray-600' },
}

/**
 * Everyone on the team, one row each: what their agent is doing now and in
 * which chat. Polls at the sidebar's pace, because a runtime snapshot older
 * than a few seconds no longer counts as running.
 */
export function TeamActivityCard({
  teamId,
  onOpenConversation,
}: {
  teamId: string
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const [chats, setChats] = useState<AgentConversation[] | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = () =>
      void api
        .agentListConversations(teamId, { scope: 'team', archived: 'exclude', limit: LIST_LIMIT })
        .then(
          (page) => alive && setChats(page.conversations),
          () => alive && setChats((prev) => prev ?? []),
        )

    refresh()
    const timer = setInterval(refresh, AGENT_SESSIONS_POLL_MS)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [teamId])

  const rows = chats ? summarizeTeamActivity(chats) : null
  const busy = rows?.filter((r) => r.status !== 'idle').length ?? 0
  let body = (
    <div className="space-y-1.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 rounded-md bg-zGray-800/40 animate-pulse" />
      ))}
    </div>
  )

  if (rows?.length === 0) {
    body = <div className="px-1 py-1.5 text-[12px] text-tertiary">No conversations yet</div>
  } else if (rows) {
    body = (
      <div className="space-y-0.5">
        {rows.slice(0, MAX_ROWS).map(({ owner, status, conversation, busy: count }) => (
          <BaseButton
            key={owner.id}
            onClick={() => onOpenConversation?.(conversation.sessionId, conversation.title)}
            className="group flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left outline-none transition-colors hover:bg-zGray-800/60 focus-visible:bg-zGray-800/60"
          >
            <Avatar src={owner.avatarURL} name={owner.name} size={20} className="rounded-full" />
            <span className="w-28 flex-shrink-0 truncate text-[13px] text-secondary">
              {owner.name}
            </span>
            <span className="flex w-24 flex-shrink-0 items-center gap-1.5 text-[11.5px] text-tertiary">
              <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS[status].dot)} />
              {STATUS[status].label}
              {count > 1 && <span className="tabular-nums">×{count}</span>}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-tertiary group-hover:text-main">
              {conversation.title || conversation.firstMessage}
            </span>
            <span className="flex-shrink-0 font-mono text-[11px] text-tertiary">
              {status === 'idle' ? formatAge(conversation.lastActiveAt) : ''}
            </span>
          </BaseButton>
        ))}
      </div>
    )
  }

  return (
    <section className="min-w-0 rounded-lg border border-zGray-800/60 p-3 md:col-span-2">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>Team activity</span>
        {rows && <span className="text-tertiary tabular-nums">{busy} active</span>}
      </div>
      {body}
    </section>
  )
}

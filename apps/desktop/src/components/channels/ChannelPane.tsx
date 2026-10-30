import { clsx } from 'clsx'
import { useEffect, useRef } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Composer } from '../agent/panel/Composer'
import { composerDraftKey } from '../agent/panel/composerDrafts'
import { SessionParticipants } from '../agent/SessionParticipants'
import { toast } from '../ui/toast'

import { ChannelAgentsButton } from './ChannelAgentsButton'
import { ChannelMessages } from './ChannelMessages'
import { ChannelMark } from './channelParts'
import { useChannel } from './useChannel'

import type { UserInfo } from '../../types'
import type { ReactNode } from 'react'

/**
 * A channel: people and agents talking. It runs no agent of its own; each
 * agent here answers from its own session, which "Open session" shows.
 */
export function ChannelPane({
  teamId,
  channelId,
  user,
  dockOpen,
  grip,
  onOpenSession,
}: {
  teamId: string
  channelId: string
  user: UserInfo
  dockOpen: boolean
  grip?: ReactNode
  onOpenSession: (sessionId: string) => void
}) {
  const { detail, agents, setAgents, refresh } = useChannel(teamId, channelId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const title = detail?.title ?? ''
  const messages = detail?.messages ?? []
  const soloAgent = agents.length === 1 ? agents[0] : undefined

  // Open at the latest post, and follow new ones.
  useEffect(() => {
    const scroller = scrollRef.current

    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [messages.length])

  const send = async (text: string) => {
    if (!text.trim()) return
    try {
      await api.agentPostChannelMessage(channelId, teamId, text, crypto.randomUUID())
      await refresh()
    } catch (error) {
      toast.apiError(t('Could not send the message'), error)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={clsx(
          'workspace-agent-titlebar relative flex h-[44px] flex-shrink-0 items-center gap-2 border-b border-zGray-800/60 pl-3',
          dockOpen ? 'pr-3' : 'pr-12',
        )}
      >
        <div className="titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 overflow-hidden text-[13px] font-medium text-secondary">
          {soloAgent ? (
            <AgentAvatar agentId={soloAgent.sessionId} avatar={soloAgent.avatar} animated />
          ) : (
            <ChannelMark size={22} />
          )}
          <span className="truncate text-main">{title}</span>
        </div>
        <SessionParticipants
          key={channelId}
          sessionId={channelId}
          teamId={teamId}
          title={title}
          currentUserId={user.id}
          canManage={detail?.isOwner === true || detail?.canManage === true}
          warnLocalAgent={false}
          compact={false}
        />
        {detail && (
          <ChannelAgentsButton
            teamId={teamId}
            channelId={channelId}
            channelOwnerId={detail.owner?.id ?? (detail.isOwner ? user.id : '')}
            viewerId={user.id}
            agents={agents}
            onAgentsChange={setAgents}
          />
        )}
        {grip}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 pt-5 pb-4 selectable"
      >
        {detail && messages.length === 0 && (
          <div className="mx-auto flex w-full max-w-[760px] flex-col items-start gap-3 px-3 pt-10">
            {soloAgent ? (
              <AgentAvatar agentId={soloAgent.sessionId} avatar={soloAgent.avatar} size={44} />
            ) : (
              <ChannelMark size={44} className="rounded-xl" />
            )}
            <div className="text-lg font-semibold leading-snug text-main">{title}</div>
            <div className="max-w-[560px] text-[13px] leading-relaxed text-secondary">
              {t(
                'Every agent here reads each message and decides for itself whether to answer, from its own session.',
              )}
            </div>
          </div>
        )}
        <ChannelMessages
          messages={messages}
          agents={agents}
          viewerId={user.id}
          teamId={teamId}
          onOpenSession={onOpenSession}
        />
      </div>
      <div className="mx-auto w-full max-w-[760px] px-3 pb-3">
        <Composer
          onSend={(text) => void send(text)}
          onStop={() => {}}
          draftKey={composerDraftKey(teamId, channelId)}
          mentionScope={{ teamId, sessionId: channelId }}
          placeholder={t('Message {name}', { name: soloAgent ? title : `#${title}` })}
        />
      </div>
    </div>
  )
}

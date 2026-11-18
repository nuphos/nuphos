import { useRef } from 'react'

import { useWorkspacePane } from '../../app/workspace/WorkspacePaneContext'
import { t } from '../../i18n'
import { dismissBotDetails, setBotDetailsOpen, useBotDetailsOpen } from '../../lib/botDetailsPanel'
import { sessionDesktopsOf } from '../agent/panel/shells'
import { ChatSummaryPanel } from '../agent/summary/ChatSummaryPanel'
import { useChatSummaryShortcut } from '../agent/summary/useChatSummaryShortcut'
import { useSessionInputRequests } from '../agent/summary/useSessionInputRequests'
import { useAgentSessions } from '../sidebar/agentSessions'

import { botOfChannel } from './botChats'
import { BotDetailsCard } from './BotDetailsCard'
import { ChatHeaderIcon } from './channelParts'

import type { ChannelAgent, ChannelFace } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

/** A Bot chat's face and name: one button for the Bot's details beside the chat, as ⌘I is. */
function BotDetailsToggle({
  bot,
  faces,
  title,
  visible,
}: {
  bot: string
  faces?: ChannelFace[]
  title: string
  visible: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const open = useBotDetailsOpen(bot)
  const paneActive = useWorkspacePane()?.active !== false

  // A Task opened over the chat leaves it inert and takes ⌘I for its own panel.
  useChatSummaryShortcut(visible && paneActive, () => {
    if (ref.current?.closest('[inert]')) return false
    setBotDetailsOpen(!open)

    return true
  })

  return (
    <button
      ref={ref}
      type="button"
      data-summary-toggle
      aria-expanded={open}
      aria-label={t('Bot details')}
      onClick={() => setBotDetailsOpen(!open)}
      className="titlebar-no-drag -ml-1 flex h-7 min-w-0 shrink items-center gap-2 rounded-lg pr-2 pl-1 text-main outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-line-focus aria-expanded:bg-state-selected"
    >
      <ChatHeaderIcon faces={faces} title={title} loading={false} />
      <span className="min-w-0 truncate">{title}</span>
    </button>
  )
}

/** A chat's face and name in its header; a Bot's open the Bot's details. */
export function ChannelHeading({
  chat,
  title,
  visible,
}: {
  /** Undefined while the chat loads. */
  chat: { faces?: ChannelFace[]; group?: true } | undefined
  title: string
  visible: boolean
}) {
  const bot = botOfChannel(chat)

  if (bot) return <BotDetailsToggle bot={bot} faces={chat?.faces} title={title} visible={visible} />

  return (
    <>
      <ChatHeaderIcon faces={chat?.faces} title={title} loading={!chat} />
      <span className="min-w-0 truncate text-main">{title}</span>
    </>
  )
}

/** The Task summary panel of the Bot's own session, led by a card of the Bot. `loading`: the chat has not loaded yet. */
export function BotDetailsPanel({
  teamId,
  bot,
  title,
  agents,
  loading,
  owned,
  botState,
  onOpenTask,
  onEdited,
  onOpenSession,
  onOpenLink,
}: {
  teamId: string
  bot: string
  title: string
  agents: ChannelAgent[]
  loading: boolean
  owned: boolean
  botState: RuntimeExecution | undefined
  onOpenTask?: (sessionId: string) => void
  onEdited: () => void
  onOpenSession: (sessionId: string) => void
  onOpenLink?: (href: string) => void
}) {
  const inputQueue = useSessionInputRequests(bot, teamId)
  // The sidebar's row of the Bot stands in until the chat loads.
  const listed = useAgentSessions(teamId).data?.find((row) => row.sessionId === bot)
  const agent = agents.find((face) => face.sessionId === bot) ?? {
    avatar: listed?.avatar,
    provider: listed?.agentRuntime,
  }

  return (
    <ChatSummaryPanel
      open={useBotDetailsOpen(bot)}
      label={t('Bot details')}
      onClose={() => setBotDetailsOpen(false)}
      onDismiss={() => dismissBotDetails(bot)}
      sessionId={bot}
      teamId={teamId}
      onOpenLink={(url) => onOpenLink?.(url)}
      onOpenSession={onOpenSession}
      onOpenRequest={(sessionId) => onOpenSession(sessionId)}
      requests={inputQueue.requests}
      requestsLoaded={inputQueue.loaded}
      requestsFailed={inputQueue.failed}
      lead={
        <BotDetailsCard
          teamId={teamId}
          bot={bot}
          title={title}
          agent={agent}
          runtimeLabel={listed?.runtimeLabel}
          loading={loading && !listed}
          owned={owned}
          onOpenTask={onOpenTask && (() => onOpenTask(bot))}
          canOpenDesktop={
            sessionDesktopsOf(teamId, { runtimeState: botState, foreign: !owned }).canOpen === true
          }
          onEdited={onEdited}
        />
      }
    />
  )
}

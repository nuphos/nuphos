import { useEffect, useLayoutEffect, useRef } from 'react'

import { usePaneId, useWorkspacePane } from '../../app/workspace/WorkspacePaneContext'
import { t } from '../../i18n'
import {
  dismissBotDetails,
  setBotDetailsNarrow,
  setBotDetailsOpen,
  useBotDetailsOpen,
} from '../../lib/botDetailsPanel'
import { useChatSummaryDocked } from '../../lib/chatSummaryPanel'
import { selectInboxQuestion } from '../../views/inbox/inboxSelection'
import { sessionDesktopsOf } from '../agent/panel/shells'
import { ChatSummaryPanel } from '../agent/summary/ChatSummaryPanel'
import { useNoRoomBeside } from '../agent/summary/summaryPlacement'
import { useChatSummaryShortcut } from '../agent/summary/useChatSummaryShortcut'
import { useSessionInputRequests } from '../agent/summary/useSessionInputRequests'
import { useAgentSessions } from '../sidebar/agentSessions'
import { setSidebarMode } from '../sidebar/sidebarModeStore'

import { BotAccessSection } from './BotAccessSection'
import { botOfChannel } from './botChats'
import { BotDetailsCard } from './BotDetailsCard'
import { ChatHeaderIcon } from './channelParts'

import type { ChannelAgent, ChannelFace } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'
import type { ComponentProps } from 'react'

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
    setBotDetailsOpen(bot, !open)

    return true
  })

  return (
    <button
      ref={ref}
      type="button"
      data-summary-toggle
      aria-expanded={open}
      aria-label={t('Bot details')}
      onClick={() => setBotDetailsOpen(bot, !open)}
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
  onEditTrigger,
  credentials,
  bypassControl,
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
  /** Starts this message to the Bot in the chat's composer. */
  onEditTrigger?: (message: string) => void
  /** The Bot's selection, for its Access section; undefined until it loads. */
  credentials: CredentialSelectorControl | undefined
  bypassControl?: ComponentProps<typeof BotAccessSection>['bypassControl']
}) {
  const frameRef = useRef<HTMLSpanElement>(null)
  const narrow = useNoRoomBeside(frameRef, useChatSummaryDocked(usePaneId()))
  const inputQueue = useSessionInputRequests(bot, teamId)
  // The sidebar's row of the Bot stands in until the chat loads.
  const listed = useAgentSessions(teamId).data?.find((row) => row.sessionId === bot)
  const agent = agents.find((face) => face.sessionId === bot) ?? {
    avatar: listed?.avatar,
    provider: listed?.agentRuntime,
  }

  const open = useBotDetailsOpen(bot)

  useLayoutEffect(() => {
    if (narrow !== undefined) setBotDetailsNarrow(bot, narrow)
  }, [bot, narrow])
  useEffect(() => () => setBotDetailsNarrow(bot, false), [bot])

  return (
    <>
      {/* Fills the area under the header, open or closed, to tell whether the details fit beside. */}
      <span ref={frameRef} aria-hidden className="pointer-events-none absolute inset-0" />
      <ChatSummaryPanel
        // Closed until measured, so a narrow window does not show them beside first.
        open={narrow !== undefined && open}
        popover={narrow === true}
        label={t('Bot details')}
        onClose={() => setBotDetailsOpen(bot, false)}
        onDismiss={() => dismissBotDetails(bot)}
        sessionId={bot}
        teamId={teamId}
        onOpenLink={(url) => onOpenLink?.(url)}
        onOpenSession={onOpenSession}
        onEditTrigger={onEditTrigger}
        onOpenRequest={(sessionId) => onOpenSession(sessionId)}
        // A Bot's questions, its own and its Tasks', are answered in the Inbox, open on the one picked.
        onSelectRequest={(request) => {
          // As the Inbox tab and then the question would: the sidebar shows the Inbox list too.
          setSidebarMode(teamId, 2)
          selectInboxQuestion(teamId, request.inputRequest.id)
          onOpenLink?.(`/teams/${teamId}/inbox`)
        }}
        requests={inputQueue.requests}
        requestsLoaded={inputQueue.loaded}
        requestsFailed={inputQueue.failed}
        access={
          <BotAccessSection credentials={credentials} bypassControl={bypassControl} owned={owned} />
        }
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
              sessionDesktopsOf(teamId, { runtimeState: botState, foreign: !owned }).canOpen ===
              true
            }
            onEdited={onEdited}
          />
        }
      />
    </>
  )
}

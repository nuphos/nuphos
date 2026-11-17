import { clsx } from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { botIsOnboarding } from '../../lib/agentInputRequests'
import { runtimeStateOf, subscribeRuntimeStates } from '../../lib/agentRuntimeStates'
import { runtimeTurnActive } from '../../lib/runtimeExecution'
import { forgetSessionDesktops, publishSessionDesktops } from '../../lib/sessionDesktops'
import { makeAttachmentTurn } from '../agent/panel/attachments'
import { ChatColumn } from '../agent/panel/ChatColumn'
import { Composer } from '../agent/panel/Composer'
import { composerDraftKey } from '../agent/panel/composerDrafts'
import { FileDropZone } from '../agent/panel/FileDropZone'
import { sessionDesktopsOf } from '../agent/panel/shells'
import { useConversationRead } from '../agent/panel/useConversationRead'
import { SessionParticipants } from '../agent/SessionParticipants'
import { useAgentSessions } from '../sidebar/agentSessions'
import { HeaderEdge } from '../ui/header-edge'
import { toast } from '../ui/toast'

import { botOfChannel, ownsBot } from './botChannel'
import { BotDesktopButton } from './BotDesktopButton'
import { BotModelControl } from './BotModelControl'
import { BotStatusPill } from './BotStatusPill'
import { BotTaskButton } from './BotTaskButton'
import { BotTriggers } from './BotTriggers'
import { ChannelEmptyState } from './ChannelEmptyState'
import { ChannelMessages } from './ChannelMessages'
import { ChatHeaderIcon, ReplyingBanner } from './channelParts'
import { ChannelTitle } from './ChannelTitle'
import { sendingPost, stillSending } from './sendingPosts'
import { useBotChatQuestions } from './useBotChatQuestions'
import { useBotRuntimeControl } from './useBotRuntimeControl'
import { useBotTaskAccess } from './useBotTaskAccess'
import { useChannel } from './useChannel'
import { useStickToBottom } from './useStickToBottom'

import type { ChannelFixes } from './ChannelReplyFix'
import type { AgentMessageReply, AgentPersistedMessage } from '../../api'
import type { UserInfo } from '../../types'
import type { ComposerSend } from '../agent/panel/composerMentionChips'
import type { AgentPromptSeed } from '../agent/panel/model'
import type { ReactNode } from 'react'

export function ChannelPane({
  teamId,
  channelId,
  user,
  dockOpen,
  visible = true,
  grip,
  titlebarLeading,
  titlebarClassName,
  onOpenSession,
  onOpenTask,
  onOpenNuphosLink,
  fixes,
}: {
  teamId: string
  channelId: string
  user: UserInfo
  dockOpen: boolean
  visible?: boolean
  grip?: ReactNode
  titlebarLeading?: ReactNode
  titlebarClassName?: string
  onOpenSession: (sessionId: string) => void
  onOpenTask?: (sessionId: string) => void
  onOpenNuphosLink?: (href: string, beside?: boolean) => boolean
  /** What the workspace lends to repair an agent that could not reply. */
  fixes?: ChannelFixes
}) {
  const { detail, chat, agents, refresh } = useChannel(teamId, channelId)

  useConversationRead(channelId, visible)
  const [restore, setRestore] = useState<AgentPromptSeed | null>(null)
  const unsent = useRef<{ key: string; id: string } | null>(null)
  const [sending, setSending] = useState<AgentPersistedMessage[]>([])
  const [replying, setReplying] = useState<AgentMessageReply | null>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<((dt: DataTransfer) => void) | null>(null)
  const title = chat ? chat.title || t('New Group Chat') : ''
  const bot = botOfChannel(chat)
  const botState = useSyncExternalStore(subscribeRuntimeStates, () => runtimeStateOf(bot))
  const preparingFirstReply = runtimeTurnActive(botState)
  const firstReplyFailed =
    detail?.timelineEvents?.some((event) => event.kind === 'agent_reply_failed') ?? false
  const botOwned = ownsBot(teamId, bot, user.id, detail && agents)
  const botProvider = agents.find((agent) => agent.sessionId === bot)?.provider
  const manage = fixes?.onOpenAgentSettings
  const control = useBotRuntimeControl(teamId, bot, botOwned, user, botState, refresh, manage)
  const sessions = useAgentSessions(teamId).data
  const settingUp = sessions?.some((row) => row.sessionId === bot && botIsOnboarding(row))
  const taskAccess = useBotTaskAccess(teamId, bot, botOwned)
  const canOpenTask = taskAccess && !settingUp
  const canOpenBotDesktop =
    bot !== undefined &&
    sessionDesktopsOf(teamId, { runtimeState: botState, foreign: !botOwned }).canOpen

  useEffect(() => {
    if (!bot) return
    publishSessionDesktops(bot, {
      ...sessionDesktopsOf(teamId, { runtimeState: botState, foreign: !botOwned }),
      dock: channelId,
    })

    return () => forgetSessionDesktops(bot, channelId)
  }, [bot, teamId, botState, botOwned, channelId])
  const stored = detail?.messages ?? []
  const pending = stillSending(stored, sending)

  if (pending !== sending) setSending(pending)
  const messages = [...stored, ...pending]
  const stickToBottom = useStickToBottom(scrollRef)
  const questions = useBotChatQuestions(teamId, bot, botOwned, onOpenSession)
  const send: ComposerSend = (text, filePaths, mentions, options) => {
    void postDraft(text, filePaths, mentions, options)

    return true
  }

  function focusComposer() {
    requestAnimationFrame(() =>
      composerRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(),
    )
  }

  async function postDraft(...[text, paths, mentions, options]: Parameters<ComposerSend>) {
    if (!text.trim() && paths.length === 0) return
    const reply = replying ?? undefined
    const key = [reply?.id, text, ...paths].join('\n')
    const id = unsent.current?.key === key ? unsent.current.id : crypto.randomUUID()
    const files = paths.length
      ? makeAttachmentTurn(text, paths, teamId, { previews: options?.imageThumbs })
      : null

    unsent.current = { key, id }
    stickToBottom()
    setReplying(null)
    setSending((posts) => [
      ...posts,
      sendingPost(id, text, user, files?.optimisticPart(), mentions, reply),
    ])
    try {
      const upload = files ? (await files.runUpload()).groupId : undefined

      await api.agentPostChannelMessage(
        channelId,
        teamId,
        text,
        id,
        upload,
        mentions?.map((mention) => mention.id),
        reply?.id,
      )
    } catch (error) {
      setSending((posts) => posts.filter((post) => post.id !== id))
      toast.apiError(t('Could not send the message'), error)
      setRestore({ text, filePaths: paths, nonce: Date.now() })
      setReplying(reply ?? null)

      return
    }
    unsent.current = null
    refresh()
  }

  return (
    <FileDropZone target={dropRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={clsx(
          'workspace-agent-titlebar sheet-titlebar-row @container/titlebar relative flex flex-shrink-0 items-center gap-2 pl-3',
          titlebarClassName,
          dockOpen ? 'pr-3' : 'pr-12',
        )}
      >
        {titlebarLeading}
        <div className="titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 overflow-hidden text-[13px] font-medium text-secondary">
          <ChatHeaderIcon faces={chat?.faces} title={title} loading={!chat} />
          <ChannelTitle
            bot={bot}
            title={title}
            teamId={teamId}
            canRename={botOwned}
            onRenamed={refresh}
          />
          <BotStatusPill
            teamId={teamId}
            botId={bot}
            channelId={channelId}
            chat={scrollRef}
            onOpenTask={canOpenTask ? (onOpenTask ?? onOpenSession) : undefined}
            onOpenLink={onOpenNuphosLink}
          />
        </div>
        {bot && <BotTriggers key={bot} teamId={teamId} botId={bot} />}
        {bot && canOpenTask && (
          <>
            <BotModelControl teamId={teamId} botId={bot} provider={botProvider} owned={botOwned} />
            <BotTaskButton
              provider={botProvider}
              onClick={() => (onOpenTask ?? onOpenSession)(bot)}
            />
          </>
        )}
        {bot && canOpenBotDesktop && <BotDesktopButton teamId={teamId} botId={bot} />}
        {/* A Bot's 1:1 chat stays the two of you; a group chat starts from "+" on Bots. */}
        {!bot && (
          <SessionParticipants
            key={channelId}
            sessionId={channelId}
            teamId={teamId}
            title={title}
            currentUserId={user.id}
            canManage={detail?.isOwner === true || detail?.canManage === true}
            compact={false}
            channel={
              detail
                ? {
                    agents,
                    ownerId: detail.owner?.id ?? (detail.isOwner ? user.id : ''),
                    onAgentsChange: refresh,
                  }
                : undefined
            }
          />
        )}
        {grip}
      </div>
      <HeaderEdge
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin pt-5 pb-4 selectable"
      >
        {/* The column: one box, so its height says when anything below grows, and
            the one width every row takes, the composer's own. */}
        <ChatColumn>
          {detail && messages.length === 0 && (
            <ChannelEmptyState
              faces={detail.faces}
              title={title}
              bot={Boolean(bot)}
              preparingFirstReply={preparingFirstReply}
              firstReplyFailed={firstReplyFailed}
            />
          )}
          {detail && (
            <ChannelMessages
              botId={bot}
              messages={messages}
              events={detail?.timelineEvents ?? []}
              agents={agents}
              viewerId={user.id}
              teamId={teamId}
              onOpenSession={onOpenSession}
              onOpenNuphosLink={onOpenNuphosLink}
              channelId={channelId}
              extraRows={questions.rows}
              fixes={fixes}
              onReply={
                detail.readOnly
                  ? undefined
                  : (reply) => {
                      setReplying(reply)
                      focusComposer()
                    }
              }
            />
          )}
        </ChatColumn>
      </HeaderEdge>
      <ChatColumn>
        {/* Inset past the faces on both sides, so the reply bar and the composer
            line up with the bubbles: a face and its gap (2.375rem) on each side. */}
        <div
          ref={composerRef}
          className="px-[2.375rem]"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && replying && !event.defaultPrevented) setReplying(null)
          }}
        >
          {replying && <ReplyingBanner reply={replying} onCancel={() => setReplying(null)} />}
          <Composer
            onSend={send}
            onStop={() => {}}
            readOnly={detail?.readOnly === true}
            pendingSeed={restore}
            onSeedConsumed={() => setRestore(null)}
            draftKey={composerDraftKey(teamId, channelId)}
            dropRegisterRef={dropRef}
            mentionScope={{
              teamId,
              sessionId: channelId,
              only: { agentIds: agents.map((agent) => agent.sessionId), selfId: user.id },
            }}
            placeholder={t('Message {name}', { name: title })}
            credentialSelector={questions.credentials}
            runtimeControl={control}
          />
        </div>
      </ChatColumn>
    </FileDropZone>
  )
}

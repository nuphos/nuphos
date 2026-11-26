import { clsx } from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
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
import { HeaderEdge } from '../ui/header-edge'
import { toast } from '../ui/toast'

import { botOfChannel, ownsBot } from './botChannel'
import { BotDetailsPanel, ChannelHeading } from './BotDetails'
import { BotStatusPill } from './BotStatusPill'
import { ChannelEmptyState } from './ChannelEmptyState'
import { ChannelMessages } from './ChannelMessages'
import { ReplyingBanner } from './channelParts'
import { sendingPost, stillSending } from './sendingPosts'
import { toolApprovalRows } from './toolApprovalRows'
import { useBotChatQuestions } from './useBotChatQuestions'
import { useBotComposerControls } from './useBotComposerControls'
import { useBotTaskEntry } from './useBotTaskEntry'
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
  const [composer, setComposer] = useState<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<((dt: DataTransfer) => void) | null>(null)
  const title = chat ? chat.title || t('New Group Chat') : ''
  const bot = botOfChannel(chat)
  const botState = useSyncExternalStore(subscribeRuntimeStates, () => runtimeStateOf(bot))
  const preparingFirstReply = runtimeTurnActive(botState)
  const firstReplyFailed =
    detail?.timelineEvents?.some((event) => event.kind === 'agent_reply_failed') ?? false
  const botOwned = ownsBot(teamId, bot, user.id, detail && agents)
  const lent = { manage: fixes?.onOpenAgentSettings, agents }
  const controls = useBotComposerControls(teamId, bot, botOwned, user, refresh, lent)
  const { canOpenTask, earlier } = useBotTaskEntry(teamId, bot, botOwned, detail)

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
  const stickToBottom = useStickToBottom(scrollRef, composer)
  const questions = useBotChatQuestions(teamId, bot, botOwned, onOpenSession, !messages.length)
  const approvals = toolApprovalRows(teamId, bot, botOwned, botState)
  const send: ComposerSend = (text, filePaths, mentions, options) => {
    void postDraft(text, filePaths, mentions, options)

    return true
  }

  function focusComposer() {
    requestAnimationFrame(() =>
      composer?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(),
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
          'workspace-agent-titlebar sheet-titlebar-row relative flex flex-shrink-0 items-center gap-2 pl-3',
          titlebarClassName,
          dockOpen ? 'pr-3' : 'pr-[var(--dock-toggle-pad)]',
        )}
      >
        {titlebarLeading}
        <div className="titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 overflow-hidden text-[13px] font-medium text-secondary">
          <ChannelHeading teamId={teamId} chat={chat} title={title} visible={visible} />
          <BotStatusPill
            teamId={teamId}
            botId={bot}
            channelId={channelId}
            chat={scrollRef}
            onOpenTask={canOpenTask ? (onOpenTask ?? onOpenSession) : undefined}
            onOpenLink={onOpenNuphosLink}
          />
        </div>
        {/* A Bot's 1:1 chat stays the two of you; a group chat starts from "+" on Bots. */}
        {!bot && (
          <SessionParticipants
            key={channelId}
            sessionId={channelId}
            teamId={teamId}
            title={title}
            currentUserId={user.id}
            canManage={detail?.isOwner === true || detail?.canManage === true}
            onOpenComputers={fixes?.onOpenAgentSettings}
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
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <HeaderEdge
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto scrollbar-thin pt-8 selectable"
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
                  banner={questions.banner}
                  onOpenEarlier={
                    earlier && bot ? () => (onOpenTask ?? onOpenSession)(bot) : undefined
                  }
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
                  extraRows={[...questions.rows, ...approvals]}
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
            {/* Inset the composer past the faces on both sides. */}
            <div
              ref={setComposer}
              className="relative px-[2.375rem]"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && replying && !event.defaultPrevented) setReplying(null)
              }}
            >
              <Composer
                aboveStatus={replying && <ReplyingBanner reply={replying} onCancel={setReplying} />}
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
                runtimeControl={controls.runtimeControl}
              />
            </div>
          </ChatColumn>
        </div>
        {bot && (
          <BotDetailsPanel
            teamId={teamId}
            bot={bot}
            title={title}
            agents={agents}
            loading={!detail}
            owned={botOwned}
            botState={botState}
            onOpenTask={canOpenTask ? (onOpenTask ?? onOpenSession) : undefined}
            onEdited={refresh}
            onOpenSession={onOpenSession}
            onOpenLink={onOpenNuphosLink}
            onEditTrigger={(text) => setRestore({ text, nonce: Date.now() })}
            credentials={questions.credentials}
            runtime={controls.runtime}
          />
        )}
      </div>
    </FileDropZone>
  )
}

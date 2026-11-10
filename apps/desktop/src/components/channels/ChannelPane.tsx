import { clsx } from 'clsx'
import { CornerUpLeft, Monitor, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { api } from '../../api'
import { openSessionDesktop } from '../../app/workspace/openSessionDesktop'
import { t } from '../../i18n'
import { runtimeStateOf, subscribeRuntimeStates } from '../../lib/agentRuntimeStates'
import { forgetSessionDesktops, publishSessionDesktops } from '../../lib/sessionDesktops'
import { makeAttachmentTurn } from '../agent/panel/attachments'
import { Composer } from '../agent/panel/Composer'
import { composerDraftKey } from '../agent/panel/composerDrafts'
import { FileDropZone } from '../agent/panel/FileDropZone'
import { sessionDesktopsOf } from '../agent/panel/shells'
import { useConversationRead } from '../agent/panel/useConversationRead'
import { SessionParticipants } from '../agent/SessionParticipants'
import { IconButton } from '../ui/icon-button'
import { toast } from '../ui/toast'

import { botOfChannel } from './botChannel'
import { BotChatQuestions } from './BotChatQuestions'
import { ChannelMessages } from './ChannelMessages'
import { ChannelTitle } from './ChannelTitle'
import { ChatHeaderIcon, ChatIcon } from './channelParts'
import { sendingPost, stillSending } from './sendingPosts'
import { useChannel } from './useChannel'
import { useStickToBottom } from './useStickToBottom'
import { HeaderEdge } from '../ui/header-edge'

import type { AgentMessageMention, AgentMessageReply, AgentPersistedMessage } from '../../api'
import type { UserInfo } from '../../types'
import type { AgentPromptSeed } from '../agent/panel/model'
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
  titlebarLeading,
  titlebarClassName,
  onOpenSession,
  onOpenNuphosLink,
}: {
  teamId: string
  channelId: string
  user: UserInfo
  dockOpen: boolean
  grip?: ReactNode
  /** Leads the header; the sidebar's toggle once this pane holds the window's corner. */
  titlebarLeading?: ReactNode
  /** Extra header classes, such as the corner clearance for the traffic lights. */
  titlebarClassName?: string
  onOpenSession: (sessionId: string) => void
  /** Opens a Nuphos link in the app, as a conversation's messages do. */
  onOpenNuphosLink?: (href: string, beside?: boolean) => boolean
}) {
  const { detail, agents, refresh } = useChannel(teamId, channelId)

  // On screen, the channel is read, as an open conversation is.
  useConversationRead(channelId, true)
  // Text that could not be posted goes back into the composer.
  const [restore, setRestore] = useState<AgentPromptSeed | null>(null)
  // A resend of the same post reuses its id, so a post that did land is not doubled.
  const unsent = useRef<{ key: string; id: string } | null>(null)
  // Posts shown at once, until the channel returns them under the same id.
  const [sending, setSending] = useState<AgentPersistedMessage[]>([])
  // The post the next one answers, quoted above the composer.
  const [replying, setReplying] = useState<AgentMessageReply | null>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Files dropped anywhere on the chat go to its composer, as in a conversation.
  const dropRef = useRef<((dt: DataTransfer) => void) | null>(null)
  const title = detail?.title ?? ''
  // A Bot's chat opens the Bot's desktop in this chat's dock, as its Task page's dock does.
  const bot = botOfChannel(detail?.faces)
  const botState = useSyncExternalStore(subscribeRuntimeStates, () => runtimeStateOf(bot))
  const botOwned = agents.some((agent) => agent.sessionId === bot && agent.ownerId === user.id)
  const canOpenBotDesktop =
    bot !== undefined &&
    sessionDesktopsOf(teamId, { runtimeState: botState, foreign: !botOwned }).canOpen

  // Published as the Bot's Task page publishes it, with this chat's dock holding its tabs.
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

  // Once the channel returns a post, it is shown from there.
  if (pending !== sending) setSending(pending)
  const messages = [...stored, ...pending]

  // Open at the latest post, and follow new ones and the typing bubble.
  const stickToBottom = useStickToBottom(scrollRef)

  // A channel post takes the draft the moment its optimistic card is rendered
  // (in `postDraft` below), so acceptance is reported at once rather than after
  // the round trip. A failure restores the draft through `setRestore`, which is
  // this pane's own path — hence `true` either way.
  const send = (text: string, filePaths: string[], mentions?: AgentMessageMention[]): boolean => {
    void postDraft(text, filePaths, mentions)

    return true
  }

  async function postDraft(text: string, filePaths: string[], mentions?: AgentMessageMention[]) {
    if (!text.trim() && filePaths.length === 0) return
    const reply = replying ?? undefined
    const key = [reply?.id, text, ...filePaths].join('\n')
    const id = unsent.current?.key === key ? unsent.current.id : crypto.randomUUID()
    // Files take the conversation's upload path: shown at once, uploaded, then posted.
    const files = filePaths.length > 0 ? makeAttachmentTurn(text, filePaths, teamId) : null

    unsent.current = { key, id }
    stickToBottom()
    setReplying(null)
    setSending((posts) => [
      ...posts,
      sendingPost(id, text, user, files?.optimisticPart(), mentions, reply),
    ])
    try {
      const upload = files ? (await files.runUpload(undefined)).groupId : undefined

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
      setRestore({ text, filePaths, nonce: Date.now() })
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
          dockOpen ? 'pr-3' : 'pr-12',
        )}
      >
        {titlebarLeading}
        <div className="titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 overflow-hidden text-[13px] font-medium text-secondary">
          <ChatHeaderIcon faces={detail?.faces} title={title} loading={!detail} />
          <ChannelTitle
            bot={bot}
            title={title}
            teamId={teamId}
            canRename={agents.some((agent) => agent.sessionId === bot && agent.ownerId === user.id)}
            onRenamed={refresh}
          />
        </div>
        {bot && canOpenBotDesktop && (
          <IconButton
            label={t('Desktop')}
            icon={<Monitor />}
            onClick={() => {
              openSessionDesktop(teamId, bot, api.openSessionDesktop).catch((error: unknown) =>
                toast.apiError(t('Could not open the desktop'), error),
              )
            }}
          />
        )}
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
        {grip}
      </div>
      <HeaderEdge
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 pt-5 pb-4 selectable"
      >
        {/* One box, so its height says when anything below grows. */}
        <div>
          {detail && messages.length === 0 && (
            <div className="mx-auto flex w-full max-w-[760px] flex-col items-start gap-3 px-3 pt-10">
              <ChatIcon faces={detail.faces} title={title} size={44} />
              <div className="text-lg font-semibold leading-snug text-main">{title}</div>
              <div className="max-w-[560px] text-[13px] leading-relaxed text-secondary">
                {t(
                  'Everyone here sees each message and decides for themselves whether to reply, as in any group chat.',
                )}
              </div>
            </div>
          )}
          {detail && (
            <ChannelMessages
              messages={messages}
              events={detail?.timelineEvents ?? []}
              agents={agents}
              viewerId={user.id}
              teamId={teamId}
              onOpenSession={onOpenSession}
              onOpenNuphosLink={onOpenNuphosLink}
              channelId={channelId}
              onReply={
                detail.readOnly
                  ? undefined
                  : (reply) => {
                      setReplying(reply)
                      // After the menu hands focus back to where it was opened.
                      requestAnimationFrame(() =>
                        composerRef.current
                          ?.querySelector<HTMLElement>('[contenteditable="true"]')
                          ?.focus(),
                      )
                    }
              }
            />
          )}
          {/* What the Bot and the agents under it wait on, answerable here. */}
          {detail && bot && (
            <BotChatQuestions teamId={teamId} botId={bot} onOpenSession={onOpenSession} />
          )}
        </div>
      </HeaderEdge>
      <div
        ref={composerRef}
        className="mx-auto w-full max-w-[760px] px-3 pb-3"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && replying && !event.defaultPrevented) setReplying(null)
        }}
      >
        {replying && (
          <div className="mx-3 mb-1.5 flex items-center gap-2 rounded-xl bg-state-hover py-1 pl-3 pr-1 text-xs leading-4">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2.2} />
            <div className="min-w-0 flex-1 truncate text-tertiary">
              <span className="font-medium text-secondary">
                {t('Replying to {name}', { name: replying.authorName })}
              </span>{' '}
              {replying.text}
            </div>
            <IconButton
              size="sm"
              label={t('Cancel reply')}
              shortcut="Esc"
              icon={<X />}
              onClick={() => setReplying(null)}
            />
          </div>
        )}
        <Composer
          onSend={(text, filePaths, mentions) => send(text, filePaths, mentions)}
          onStop={() => {}}
          readOnly={detail?.readOnly === true}
          pendingSeed={restore}
          onSeedConsumed={() => setRestore(null)}
          draftKey={composerDraftKey(teamId, channelId)}
          dropRegisterRef={dropRef}
          mentionScope={{
            teamId,
            sessionId: channelId,
            channel: true,
            only: { agentIds: agents.map((agent) => agent.sessionId), selfId: user.id },
          }}
          placeholder={t('Message {name}', { name: title })}
        />
      </div>
    </FileDropZone>
  )
}

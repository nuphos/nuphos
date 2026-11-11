import { clsx } from 'clsx'
import { Monitor } from 'lucide-react'
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
import { HeaderEdge } from '../ui/header-edge'
import { IconButton } from '../ui/icon-button'
import { toast } from '../ui/toast'

import { botOfChannel } from './botChannel'
import { BotTaskButton } from './BotTaskButton'
import { ChannelMessages } from './ChannelMessages'
import { ChatHeaderIcon, ChatIcon, ReplyingBanner } from './channelParts'
import { ChannelTitle } from './ChannelTitle'
import { sendingPost, stillSending } from './sendingPosts'
import { useBotChatQuestions } from './useBotChatQuestions'
import { useChannel } from './useChannel'
import { useStickToBottom } from './useStickToBottom'

import type { AgentMessageReply, AgentPersistedMessage } from '../../api'
import type { UserInfo } from '../../types'
import type { ComposerSend } from '../agent/panel/composerMentionChips'
import type { AgentPromptSeed } from '../agent/panel/model'
import type { ReactNode } from 'react'

/** The post a reply quotes, or an agent's question it answers through `answer`. */
type Replying = AgentMessageReply & { answer?: (text: string) => void }

export function ChannelPane({
  teamId,
  channelId,
  user,
  dockOpen,
  grip,
  titlebarLeading,
  titlebarClassName,
  onOpenSession,
  onOpenTask,
  onOpenNuphosLink,
}: {
  teamId: string
  channelId: string
  user: UserInfo
  dockOpen: boolean
  grip?: ReactNode
  titlebarLeading?: ReactNode
  titlebarClassName?: string
  onOpenSession: (sessionId: string) => void
  onOpenTask?: (sessionId: string) => void
  onOpenNuphosLink?: (href: string, beside?: boolean) => boolean
}) {
  const { detail, agents, refresh } = useChannel(teamId, channelId)

  useConversationRead(channelId, true)
  // Text that could not be posted goes back into the composer.
  const [restore, setRestore] = useState<AgentPromptSeed | null>(null)
  // A resend of the same post reuses its id, so a post that did land is not doubled.
  const unsent = useRef<{ key: string; id: string } | null>(null)
  // Posts shown at once, until the channel returns them under the same id.
  const [sending, setSending] = useState<AgentPersistedMessage[]>([])
  // The post the next one answers, quoted above the composer; for a question, sent as its answer.
  const [replying, setReplying] = useState<Replying | null>(null)
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
  const chat = { channelId, user, setSending, stickToBottom, refresh, reply: replyToQuestion }
  const questions = useBotChatQuestions(teamId, bot, botOwned, onOpenSession, chat)

  // A question's answer is its words alone; a post with files is a message quoting nothing.
  const quoted = replying?.answer ? null : replying

  // The optimistic post owns the draft immediately; failure restores it through setRestore.
  const send: ComposerSend = (text, filePaths, mentions, options) => {
    if (replying?.answer && filePaths.length === 0 && text.trim()) {
      setReplying(null)
      replying.answer(text)
    } else void postDraft(text, filePaths, mentions, options)

    return true
  }

  function replyToQuestion(quote: AgentMessageReply, answer: (text: string) => void) {
    setReplying({ ...quote, answer })
    focusComposer()
  }

  // After a menu or card hands focus back to where it was opened.
  function focusComposer() {
    requestAnimationFrame(() =>
      composerRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(),
    )
  }

  async function postDraft(...[text, paths, mentions, options]: Parameters<ComposerSend>) {
    if (!text.trim() && paths.length === 0) return
    const reply = quoted ?? undefined
    const key = [reply?.id, text, ...paths].join('\n')
    const id = unsent.current?.key === key ? unsent.current.id : crypto.randomUUID()
    // Files take the conversation's upload path: shown at once, uploaded, then posted.
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
        {bot && botOwned && (
          <BotTaskButton
            provider={agents.find((agent) => agent.sessionId === bot)?.provider}
            onClick={() => (onOpenTask ?? onOpenSession)(bot)}
          />
        )}
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
        {/* The column: one box, so its height says when anything below grows, and
            the one width every row takes, the composer's own (px-3, 760px). */}
        <div className="mx-auto w-full max-w-[760px]">
          {detail && messages.length === 0 && (
            <div className="flex flex-col items-start gap-3 pt-10">
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
              extraRows={questions.rows}
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
        </div>
      </HeaderEdge>
      <div
        ref={composerRef}
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
            channel: true,
            only: { agentIds: agents.map((agent) => agent.sessionId), selfId: user.id },
          }}
          placeholder={t('Message {name}', { name: title })}
          credentialSelector={questions.credentials}
        />
      </div>
    </FileDropZone>
  )
}

import { clsx } from 'clsx'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { makeAttachmentTurn } from '../agent/panel/attachments'
import { Composer } from '../agent/panel/Composer'
import { composerDraftKey } from '../agent/panel/composerDrafts'
import { FileDropZone } from '../agent/panel/FileDropZone'
import { useConversationRead } from '../agent/panel/useConversationRead'
import { SessionParticipants } from '../agent/SessionParticipants'
import { toast } from '../ui/toast'

import { ChannelMessages } from './ChannelMessages'
import { ChannelMark } from './channelParts'
import { sendingPost, stillSending } from './sendingPosts'
import { useChannel } from './useChannel'
import { useStickToBottom } from './useStickToBottom'

import type { AgentPersistedMessage } from '../../api'
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
  onOpenSession,
  onOpenNuphosLink,
}: {
  teamId: string
  channelId: string
  user: UserInfo
  dockOpen: boolean
  grip?: ReactNode
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
  const scrollRef = useRef<HTMLDivElement>(null)
  // Files dropped anywhere on the chat go to its composer, as in a conversation.
  const dropRef = useRef<((dt: DataTransfer) => void) | null>(null)
  const title = detail?.title ?? ''
  const stored = detail?.messages ?? []
  const pending = stillSending(stored, sending)

  // Once the channel returns a post, it is shown from there.
  if (pending !== sending) setSending(pending)
  const messages = [...stored, ...pending]

  // Open at the latest post, and follow new ones and the typing bubble.
  const stickToBottom = useStickToBottom(scrollRef)

  const send = async (text: string, filePaths: string[]) => {
    if (!text.trim() && filePaths.length === 0) return
    const key = [text, ...filePaths].join('\n')
    const id = unsent.current?.key === key ? unsent.current.id : crypto.randomUUID()
    // Files take the conversation's upload path: shown at once, uploaded, then posted.
    const files = filePaths.length > 0 ? makeAttachmentTurn(text, filePaths, teamId) : null

    unsent.current = { key, id }
    stickToBottom()
    setSending((posts) => [...posts, sendingPost(id, text, user, files?.optimisticPart())])
    try {
      const upload = files ? (await files.runUpload(undefined)).groupId : undefined

      await api.agentPostChannelMessage(channelId, teamId, text, id, upload)
    } catch (error) {
      setSending((posts) => posts.filter((post) => post.id !== id))
      toast.apiError(t('Could not send the message'), error)
      setRestore({ text, filePaths, nonce: Date.now() })

      return
    }
    unsent.current = null
    refresh()
  }

  return (
    <FileDropZone target={dropRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={clsx(
          'workspace-agent-titlebar relative flex h-[44px] flex-shrink-0 items-center gap-2 border-b border-zGray-800/60 pl-3',
          dockOpen ? 'pr-3' : 'pr-12',
        )}
      >
        <div className="titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 overflow-hidden text-[13px] font-medium text-secondary">
          <ChannelMark size={22} />
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
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 pt-5 pb-4 selectable"
      >
        {/* One box, so its height says when anything below grows. */}
        <div>
          {detail && messages.length === 0 && (
            <div className="mx-auto flex w-full max-w-[760px] flex-col items-start gap-3 px-3 pt-10">
              <ChannelMark size={44} className="rounded-xl" />
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
            />
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[760px] px-3 pb-3">
        <Composer
          onSend={(text, filePaths) => void send(text, filePaths)}
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
          placeholder={t('Message {name}', { name: `#${title}` })}
        />
      </div>
    </FileDropZone>
  )
}

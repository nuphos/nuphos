import clsx from 'clsx'
import { Inbox } from 'lucide-react'

import { t } from '../../i18n'
import { trustedAvatarURL } from '../../lib/avatarUrl'
import { AgentAvatar } from '../agent/AgentAvatar'
import { MessageResponse } from '../agent/MessageResponse'
import { linkMentions } from '../agent/panel/messageMentionText'
import { parseMessageMetadata } from '../agent/panel/messageMetadata'
import { ReplyQuote } from '../agent/panel/ReplyQuote'
import { Avatar } from '../Avatar'

import { channelMentions } from './channelMentions'
import { ChannelFiles } from './ChannelFiles'
import { isChannelRecord, speaksInChannel } from './channelSpeakers'
import { textOf } from './channelReply'
import { exactTime } from './chatTime'
import { channelFiles } from './postFiles'
import { ReplyButton } from './ReplyButton'

import type { AgentPersistedMessage, ChannelAgent } from '../../api'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

export type Links = {
  renderLink: (href: string, children: ReactNode) => ReactNode
  onLinkClick?: (href: string, beside?: boolean) => boolean
  /** The chat: its files load through it, so every member sees them. */
  channelId: string
  agents?: ChannelAgent[]
}

/**
 * One post: yours on the right in a bubble a shade apart, everyone else's on
 * the left in one filled bubble, agent or person alike. The first post of a run carries the avatar and name; an agent's open its session.
 */
export function ChannelMessage({
  message,
  at,
  first,
  fresh,
  ownAgent,
  viewerId,
  teamId,
  links,
  onOpenSession,
  onMenu,
  onReply,
  answeredInInbox,
}: {
  message: AgentPersistedMessage
  /** When it was posted: the exact time shows on hover. */
  at: number
  first: boolean
  /** Arrived while the channel was open: it springs in. */
  fresh: boolean
  /** The viewer's own agent: its face and name open its session. */
  ownAgent: boolean
  viewerId: string
  teamId: string
  /** The same link handling as a conversation's messages: Nuphos links open in the app. */
  links: Links
  onOpenSession: (sessionId: string) => void
  /** Right-click: the post's menu, unless text is selected to copy. */
  onMenu?: (event: ReactMouseEvent) => void
  /** Replies to the post from the button beside it on hover; absent where the viewer cannot. */
  onReply?: () => void
  /** The last post of an answer given in the Inbox: it says so beneath. */
  answeredInInbox?: boolean
}) {
  const metadata = parseMessageMetadata(message.metadata)
  const text = textOf(message)
  const posted = channelFiles(message)

  // What Nuphos records in the chat (an answer, a new owner): a muted line, never a person's post.
  if (metadata && isChannelRecord(metadata.sender) && text) return <DecisionRecord text={text} />
  // A channel shows people and agents only; any other sender is not a post.
  if (!metadata || !speaksInChannel(metadata.sender) || (!text && !posted.any)) return null
  const { sender } = metadata
  const agentId = sender.type === 'agent' ? (metadata.sourceSessionId ?? sender.id) : null
  const open = agentId && ownAgent ? () => onOpenSession(agentId) : null
  const body = (
    <MessageResponse
      teamId={teamId}
      className="[&_p]:whitespace-pre-wrap"
      renderLink={links.renderLink}
      onLinkClick={links.onLinkClick}
    >
      {linkMentions(text, channelMentions(metadata.mentions, links.agents ?? []))}
    </MessageResponse>
  )

  const mine = !agentId && sender.id === viewerId
  // A person's files show above their words and an agent's below, as in a conversation.
  const shown = (files: typeof posted) => (
    <ChannelFiles files={files} teamId={teamId} channelId={links.channelId} mine={mine} />
  )
  const files = shown({ ...posted, downloads: [] })
  // In the bubble it replies with; above a reply of files alone.
  const quote = metadata.replyTo && (
    <ReplyQuote reply={metadata.replyTo} mine={mine && Boolean(text)} />
  )
  const answered = answeredInInbox && (
    <span className="flex items-center gap-1 px-1 text-[11px] leading-4 text-tertiary">
      <Inbox size={11} aria-hidden />
      {t('Answered in Inbox')}
    </span>
  )
  const post = {
    'data-post-id': message.id,
    title: exactTime(at),
    onContextMenu: (event: ReactMouseEvent) => {
      if (!onMenu || !window.getSelection()?.isCollapsed) return
      event.preventDefault()
      onMenu(event)
    },
  }

  if (mine)
    return (
      <div className="group/post flex w-full items-start justify-end gap-2.5">
        {onReply && <ReplyButton onReply={onReply} />}
        <div {...post} className="flex min-w-0 max-w-[85%] flex-col items-end gap-1 rounded-2xl">
          {!text && quote}
          {files}
          {text && (
            <div
              className={clsx(
                'user-message-bubble chat-bubble-mine max-w-full rounded-2xl rounded-tr-md px-3.5 py-2 break-words',
                fresh && 't-bubble-in-mine',
              )}
            >
              {quote}
              {body}
            </div>
          )}
          {answered}
        </div>
        <div className="w-7 shrink-0">
          {first && (
            <Avatar
              src={trustedAvatarURL(sender.avatarURL)}
              name={sender.displayName}
              size={28}
              className="rounded-full ring-1 ring-black/5 dark:ring-white/10"
            />
          )}
        </div>
      </div>
    )

  return (
    <div className="group/post flex w-full items-start gap-2.5">
      <div className="w-7 shrink-0">
        {first &&
          (agentId ? (
            // Your own agent's face and name open its session.
            open ? (
              <button type="button" tabIndex={-1} onClick={open} className="rounded-full">
                <AgentAvatar agentId={agentId} provider={sender.agentRuntime} size={28} />
              </button>
            ) : (
              <AgentAvatar agentId={agentId} provider={sender.agentRuntime} size={28} />
            )
          ) : (
            <Avatar
              src={trustedAvatarURL(sender.avatarURL)}
              name={sender.displayName}
              size={28}
              className="rounded-full ring-1 ring-black/5 dark:ring-white/10"
            />
          ))}
      </div>
      <div {...post} className="flex min-w-0 max-w-[85%] flex-col items-start gap-1 rounded-2xl">
        {first && (
          <div className="flex max-w-full items-center gap-2 px-1 text-xs leading-4">
            {open ? (
              <button
                type="button"
                title={t('Open session')}
                onClick={open}
                className="truncate font-medium text-secondary hover:underline"
              >
                {sender.displayName}
              </button>
            ) : (
              <span className="truncate font-medium text-secondary">{sender.displayName}</span>
            )}
          </div>
        )}
        {!text && quote}
        {files}
        {text && (
          <div
            className={clsx(
              'max-w-full rounded-2xl rounded-tl-md bg-state-selected px-3.5 py-2 break-words',
              fresh && 't-bubble-in',
            )}
          >
            {quote}
            {body}
          </div>
        )}
        {shown({ ...posted, uploads: [] })}
        {answered}
      </div>
      {onReply && <ReplyButton onReply={onReply} />}
    </div>
  )
}

/** "Yuanlin answered: Which regions? → us-east", one muted line per question. */
function DecisionRecord({ text }: { text: string }) {
  return (
    <div className="flex flex-col py-1 pl-11 text-[12px] text-tertiary" data-decision-record="">
      {text.split('\n').map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </div>
  )
}

import clsx from 'clsx'

import { t } from '../../i18n'
import { trustedAvatarURL } from '../../lib/avatarUrl'
import { AgentAvatar } from '../agent/AgentAvatar'
import { MessageResponse } from '../agent/MessageResponse'
import { linkMentions } from '../agent/panel/messageMentionText'
import { parseMessageMetadata } from '../agent/panel/messageMetadata'
import { ReplyQuote } from '../agent/panel/ReplyQuote'
import { Avatar } from '../Avatar'

import { ChannelFiles } from './ChannelFiles'
import { speaksInChannel } from './channelSpeakers'
import { textOf } from './channelReply'
import { exactTime } from './chatTime'
import { channelFiles } from './postFiles'
import { ReplyButton } from './ReplyButton'

import type { AgentPersistedMessage } from '../../api'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

/** The sender of the record an answer to a question leaves in the channel it was asked in. */
const DECISION_RECORD = 'nuphos:decision'

export type Links = {
  renderLink: (href: string, children: ReactNode) => ReactNode
  onLinkClick?: (href: string, beside?: boolean) => boolean
  /** The chat: its files load through it, so every member sees them. */
  channelId: string
}

/**
 * One post: yours on the right, everyone else's in a bubble on the left. The
 * first post of a run carries the avatar and name; an agent's open its session.
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
}) {
  const metadata = parseMessageMetadata(message.metadata)
  const text = textOf(message)
  const posted = channelFiles(message)

  // An answer to an agent's question, recorded by Nuphos: a muted line, never a person's post.
  if (metadata?.sender.id === DECISION_RECORD && text) return <DecisionRecord text={text} />
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
      {linkMentions(text, metadata.mentions)}
    </MessageResponse>
  )

  const mine = !agentId && sender.id === viewerId
  // A person's files show above their words and an agent's below, as in a conversation.
  const shown = (files: typeof posted) => (
    <ChannelFiles files={files} teamId={teamId} channelId={links.channelId} mine={mine} />
  )
  const files = shown({ ...posted, downloads: [] })
  const quote = metadata.replyTo && <ReplyQuote reply={metadata.replyTo} />
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
      // The quote sits above the row, so your face stays level with your words.
      <div className="flex w-full flex-col items-end gap-1">
        {quote && <div className="flex max-w-[85%] justify-end pr-[2.375rem]">{quote}</div>}
        <div className="group/post flex w-full items-start justify-end gap-2.5">
          {onReply && <ReplyButton onReply={onReply} />}
          <div {...post} className="flex min-w-0 max-w-[85%] flex-col items-end gap-1 rounded-2xl">
            {files}
            {text && (
              <div
                className={clsx(
                  'user-message-bubble max-w-full rounded-2xl rounded-tr-md px-3.5 py-2 break-words',
                  fresh && 't-bubble-in-mine',
                )}
              >
                {body}
              </div>
            )}
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
            {agentId && (
              <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-tertiary">
                {t('Agent')}
              </span>
            )}
          </div>
        )}
        {quote}
        {files}
        {text && (
          <div
            className={clsx(
              'max-w-full rounded-2xl rounded-tl-md bg-state-selected px-3.5 py-2 break-words',
              fresh && 't-bubble-in',
            )}
          >
            {body}
          </div>
        )}
        {shown({ ...posted, uploads: [] })}
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

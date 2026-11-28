import { Pause } from 'lucide-react'
import { Fragment, useCallback, useState } from 'react'
import { flushSync } from 'react-dom'

import { t } from '../../i18n'
import { useAgentLinks } from '../agent/panel/useAgentLinks'
import { renderAtlasMentionLink, renderMemberMentionLink } from '../agent/panel/messageInlineLinks'
import { AGENT_MENTION } from '../agent/panel/messageMentionText'
import { parseMessageMetadata } from '../agent/panel/messageMetadata'
import { CONVERSATION_TAIL_LIMIT } from '../agent/panel/taskTranscript'
import { ContextMenu } from '../ContextMenu'

import { endsInboxAnswer, replyTo, textOf } from './channelReply'
import { ChannelReplyFailed } from './ChannelReplyFailed'
import { ChannelMessage } from './ChannelPost'
import { sentSinceOpening, startsTimeGap, timeGapLabel } from './chatTime'
import { Typing } from './ChannelTyping'
import { useOpenAtPost, usePostJump } from './postJump'
import { postMenuItems } from './postMenu'

import type {
  AgentMessageReply,
  AgentPersistedMessage,
  AgentTimelineEvent,
  ChannelAgent,
} from '../../api'
import type { ChannelFixes } from './ChannelReplyFix'
import type { PostMenu } from './postMenu'
import type { ReactNode } from 'react'

/** Who posted: the sender's id, so consecutive posts from one sender form a run. */
function senderOf(message: AgentPersistedMessage): string | undefined {
  const metadata = parseMessageMetadata(message.metadata)

  return metadata ? (metadata.sourceSessionId ?? metadata.sender.id) : undefined
}

/** A line from the chat itself: its loop guard paused agents. */
function Notice({ event }: { event: AgentTimelineEvent }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-surface-sunken" />
      <span className="flex items-center gap-1.5 rounded-full border border-line-control/60 bg-main px-3 py-1 text-[12px] text-secondary">
        <Pause className="h-3 w-3 shrink-0 text-warning" strokeWidth={2.5} />
        {t(
          'Bots paused after {count} replies to each other. They pick up again when someone posts.',
          { count: event.turns ?? 10 },
        )}
      </span>
      <span className="h-px flex-1 bg-surface-sunken" />
    </div>
  )
}

/** A line placed in the chat by its time, beside the posts. */
export type TimelineRow = { at: number; key: string; node: ReactNode }

const stamp = (value: string | undefined) => Date.parse(value ?? '') || 0
const postedAt = (message: AgentPersistedMessage) =>
  stamp(parseMessageMetadata(message.metadata)?.sentAt ?? message.createdAt)

/**
 * Where the drawn posts start. Opening draws the latest only, as a Task does: drawing every post
 * held the click that opened the chat (#4382). The rest are drawn on request, or for a link to one.
 */
function useRecentPosts(messages: AgentPersistedMessage[], channelId: string) {
  // The chat whose posts are all drawn: another chat opens with its latest again.
  const [whole, setWhole] = useState<string>()
  const from = whole === channelId ? 0 : Math.max(0, messages.length - CONVERSATION_TAIL_LIMIT)
  const jump = usePostJump(channelId)

  if (from > 0 && jump && messages.slice(0, from).some((message) => message.id === jump))
    setWhole(channelId)

  const showEarlier = () => {
    const top = messages[from]?.id

    flushSync(() => setWhole(channelId))
    // The post that was first stays where the reader was, with the earlier ones above it.
    if (top) document.querySelector(`[data-post-id="${CSS.escape(top)}"]`)?.scrollIntoView()
  }

  return { from, showEarlier }
}

export function ChannelMessages({
  botId,
  messages,
  events,
  agents,
  viewerId,
  teamId,
  onOpenSession,
  onOpenNuphosLink,
  channelId,
  onReply,
  extraRows = [],
  fixes,
}: {
  botId?: string
  messages: AgentPersistedMessage[]
  events: AgentTimelineEvent[]
  agents: ChannelAgent[]
  viewerId: string
  teamId: string
  onOpenSession: (sessionId: string) => void
  onOpenNuphosLink?: (href: string, beside?: boolean) => boolean
  channelId: string
  /** Replies to a post; absent where the viewer cannot post. */
  onReply?: (reply: AgentMessageReply) => void
  /** Other lines in the timeline, such as the questions a Bot's chat waits on. */
  extraRows?: TimelineRow[]
  /** What the workspace lends to repair an agent that could not reply. */
  fixes?: ChannelFixes
}) {
  const renderAgentLink = useAgentLinks(teamId, onOpenNuphosLink)

  useOpenAtPost(channelId)
  // One function across renders: a new one makes every post rebuild its text,
  // which drops a selection the reader is dragging.
  const renderLink = useCallback(
    (href: string, children: ReactNode) =>
      renderMemberMentionLink(href, children, teamId) ??
      renderAtlasMentionLink(href, children, onOpenNuphosLink) ??
      renderAgentLink(href, children),
    [teamId, renderAgentLink, onOpenNuphosLink],
  )
  const links = {
    channelId,
    renderLink,
    onLinkClick: onOpenNuphosLink,
    agentMentions: agents.flatMap((agent) =>
      agent.title ? [{ id: AGENT_MENTION + agent.sessionId, displayName: agent.title }] : [],
    ),
  }
  // What was here on opening stays put; only posts that arrive later spring in.
  const owned = new Set(
    agents.filter((agent) => agent.ownerId === viewerId).map((agent) => agent.sessionId),
  )
  const [openedAt] = useState(Date.now)
  // A post's right-click menu: what it can copy, and the reply it would start.
  const [menu, setMenu] = useState<(PostMenu & { x: number; y: number }) | null>(null)
  // A post of files alone, in a chat the viewer cannot reply in, has nothing to offer.
  const menuItems = menu ? postMenuItems(menu, onReply) : []
  const lastEvent = events.at(-1)
  const lastPostAt = Math.max(0, ...messages.map(postedAt))
  const { from, showEarlier } = useRecentPosts(messages, channelId)
  // Posts and timeline lines in the order they happened.
  const rows: TimelineRow[] = [
    ...messages.slice(from).map((message, shown) => {
      const i = from + shown
      const at = postedAt(message)
      // A time above the post starts a new run, as in iMessage.
      const gap = startsTimeGap(at, i > 0 ? postedAt(messages[i - 1]!) : undefined)

      return {
        at,
        key: message.id,
        node: (
          <>
            {gap && (
              <div className="pt-2 text-center text-[11px] text-tertiary tabular-nums">
                {timeGapLabel(at)}
              </div>
            )}
            <ChannelMessage
              message={message}
              at={at}
              first={gap || i === 0 || senderOf(messages[i - 1]!) !== senderOf(message)}
              fresh={sentSinceOpening(at, openedAt)}
              ownAgent={owned.has(senderOf(message) ?? '')}
              viewerId={viewerId}
              teamId={teamId}
              links={links}
              onOpenSession={onOpenSession}
              answeredInInbox={endsInboxAnswer(messages, i)}
              onMenu={(event, selection) => {
                const reply = onReply && replyTo(message)

                setMenu({
                  x: event.clientX,
                  y: event.clientY,
                  selection,
                  text: textOf(message),
                  ...(reply ? { reply } : {}),
                })
              }}
              onReply={
                onReply &&
                (() => {
                  const reply = replyTo(message)

                  if (reply) onReply(reply)
                })
              }
            />
          </>
        ),
      }
    }),
    ...events
      .filter((event) => event.kind === 'agents_paused' || event.kind === 'agent_reply_failed')
      .filter((event) => from === 0 || stamp(event.at) >= postedAt(messages[from]!))
      .map((event) => ({
        at: stamp(event.at),
        key: `event-${event.kind}-${event.at}`,
        node:
          event.kind === 'agents_paused' ? (
            <Notice event={event} />
          ) : (
            <ChannelReplyFailed
              event={event}
              channelId={channelId}
              teamId={teamId}
              // Only the newest line: anything after it, a post or a reply, moved past it.
              actionable={event === lastEvent && stamp(event.at) >= lastPostAt}
              ownedAgents={owned}
              onOpenSession={onOpenSession}
              fixes={fixes}
            />
          ),
      })),
    ...extraRows,
  ].sort((a, b) => a.at - b.at)

  return (
    <div className="flex flex-col gap-3">
      {from > 0 && (
        // Read by SessionFindBar: part of the chat is not in the DOM.
        <div data-earlier-messages className="flex justify-center py-1 text-[11.5px] text-tertiary">
          <button type="button" onClick={showEarlier} className="hover:text-main transition-colors">
            {t('Load earlier messages')}
          </button>
        </div>
      )}
      {rows.map((row) => (
        <Fragment key={row.key}>{row.node}</Fragment>
      ))}
      <Typing agents={agents} channelId={channelId} botId={botId} />
      {menuItems.length > 0 && menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems} />
      )}
    </div>
  )
}

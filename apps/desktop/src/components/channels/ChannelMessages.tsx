import { CornerUpLeft, Pause } from 'lucide-react'
import { Fragment, useCallback, useState } from 'react'

import { t } from '../../i18n'
import { useAgentLinks } from '../agent/panel/useAgentLinks'
import { renderMemberMentionLink } from '../agent/panel/messageInlineLinks'
import { parseMessageMetadata } from '../agent/panel/messageMetadata'
import { ContextMenu } from '../ContextMenu'

import { replyTo } from './channelReply'
import { ChannelReplyFailed } from './ChannelReplyFailed'
import { ChannelMessage } from './ChannelPost'
import { sentSinceOpening, startsTimeGap, timeGapLabel } from './chatTime'
import { Typing } from './ChannelTyping'
import { BotWorkStatus } from './BotWorkStatus'

import type {
  AgentMessageReply,
  AgentPersistedMessage,
  AgentTimelineEvent,
  ChannelAgent,
} from '../../api'
import type { ChannelFixes } from './ChannelReplyFix'
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
          'Agents paused after {count} replies to each other. They pick up again when someone posts.',
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

export function ChannelMessages({
  messages,
  events,
  agents,
  viewerId,
  teamId,
  onOpenSession,
  onOpenNuphosLink,
  channelId,
  botId,
  onReply,
  extraRows = [],
  fixes,
}: {
  messages: AgentPersistedMessage[]
  events: AgentTimelineEvent[]
  agents: ChannelAgent[]
  viewerId: string
  teamId: string
  onOpenSession: (sessionId: string) => void
  onOpenNuphosLink?: (href: string, beside?: boolean) => boolean
  channelId: string
  /** A Bot's chat: what the Bot is doing shows in place of its typing dots. */
  botId?: string
  /** Replies to a post; absent where the viewer cannot post. */
  onReply?: (reply: AgentMessageReply) => void
  /** Other lines in the timeline, such as the questions a Bot's chat waits on. */
  extraRows?: TimelineRow[]
  /** What the workspace lends to repair an agent that could not reply. */
  fixes?: ChannelFixes
}) {
  const renderAgentLink = useAgentLinks(teamId, onOpenNuphosLink)
  // One function across renders: a new one makes every post rebuild its text,
  // which drops a selection the reader is dragging.
  const renderLink = useCallback(
    (href: string, children: ReactNode) =>
      renderMemberMentionLink(href, children, teamId) ?? renderAgentLink(href, children),
    [teamId, renderAgentLink],
  )
  const links = { channelId, renderLink, onLinkClick: onOpenNuphosLink }
  // What was here on opening stays put; only posts that arrive later spring in.
  const owned = new Set(
    agents.filter((agent) => agent.ownerId === viewerId).map((agent) => agent.sessionId),
  )
  const [openedAt] = useState(Date.now)
  const [menu, setMenu] = useState<{ reply: AgentMessageReply; x: number; y: number } | null>(null)
  const bot = agents.find((agent) => agent.sessionId === botId)
  const lastEvent = events.at(-1)
  const lastPostAt = Math.max(0, ...messages.map(postedAt))
  // Posts and timeline lines in the order they happened.
  const rows: TimelineRow[] = [
    ...messages.map((message, i) => {
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
              onMenu={
                onReply &&
                ((event) => {
                  const reply = replyTo(message)

                  if (reply) setMenu({ reply, x: event.clientX, y: event.clientY })
                })
              }
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
      {rows.map((row) => (
        <Fragment key={row.key}>{row.node}</Fragment>
      ))}
      <Typing agents={agents.filter((agent) => agent !== bot)} channelId={channelId} />
      {bot && (
        <BotWorkStatus
          teamId={teamId}
          channelId={channelId}
          agent={bot}
          onOpenSession={owned.has(bot.sessionId) ? onOpenSession : undefined}
        />
      )}
      {menu && onReply && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'reply',
              label: t('Reply'),
              icon: CornerUpLeft,
              onSelect: () => onReply(menu.reply),
            },
          ]}
        />
      )}
    </div>
  )
}

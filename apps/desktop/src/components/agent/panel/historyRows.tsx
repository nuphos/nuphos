import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { conversationActivityBadges } from '../../../lib/conversationActivityBadges'
import { triggerRunLabel } from '../../../lib/triggerRunLabel'
import { Avatar } from '../../Avatar'

import { ConversationActivityBadgeView, ConversationChannelDot } from './conversationBadges'
import { conversationOwnerName, formatHistoryTime } from './conversationMeta'

import type { AgentConversation } from '../../../api'
import type { ReactNode } from 'react'

export function RevealedHistoryBlock({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))

    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      className={clsx('t-panel-slide t-agent-history-reveal', className)}
      data-open={open ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

function titleTone({ unread, selected }: { unread: boolean; selected: boolean }): string {
  if (unread) return 'font-medium text-main'

  return selected ? 'text-main' : 'text-secondary'
}

export function HistoryConversationRow({
  conversation,
  opening,
  selected = false,
  compact = false,
  rowRef,
  className,
  titleClassName,
  timeClassName,
  avatarSize,
  onOpenConversation,
  onContextMenu,
  trailing,
  unread = false,
}: {
  conversation: AgentConversation
  opening: boolean
  /** Reader layout: this row's conversation is the one shown beside the list. */
  selected?: boolean
  compact?: boolean
  /** Set on the selected row so keyboard walking can keep it on screen. */
  rowRef?: React.RefObject<HTMLDivElement | null>
  className?: string
  titleClassName: string
  timeClassName: string
  avatarSize: number
  onOpenConversation: (sessionId: string, titleHint?: string, newTab?: boolean) => void
  /** Right-click actions (e.g. the All-chats "Pick up in Slack" menu). */
  onContextMenu?: (event: React.MouseEvent) => void
  /** Hover-revealed control after the row's content (e.g. the archive toggle). */
  trailing?: ReactNode
  /** The last turn ended without this conversation being seen. */
  unread?: boolean
}) {
  // A row has room for the title and one line of metadata, so the badges split
  // by what they say about the conversation. Where it came from (Slack, LINE
  // WORKS) belongs to the person who sent it — a dot on their avatar. That it
  // ran unattended is a fact about the conversation, and rides with the rest of
  // the metadata.
  const badges = conversationActivityBadges(conversation.activitySource)
  const channelBadge = badges.find((badge) => badge.kind !== 'trigger')
  // Inside a Trigger's run list every row is a trigger run, so "Trigger" says
  // nothing; how it fired is what tells the rows apart. Where the stamp exists
  // it therefore replaces the generic badge — strictly more specific, so this
  // reads better anywhere a run shows up, not only on the Trigger page.
  const runLabel = triggerRunLabel(conversation.triggerRun)
  const triggerBadge = runLabel ? null : badges.find((badge) => badge.kind === 'trigger')

  return (
    <div
      ref={rowRef}
      onContextMenu={onContextMenu}
      aria-current={selected ? 'true' : undefined}
      className={clsx(
        className,
        // Padding is inside the button, so the hover/selected background spans
        // the full row width.
        'group flex items-center transition-colors',
        compact ? 'rounded-md' : undefined,
        selected ? 'bg-zGray-800/70' : 'hover:bg-zGray-800/40',
        opening && 'bg-zGray-800/55',
      )}
    >
      <button
        onClick={(event) =>
          onOpenConversation(
            conversation.sessionId,
            conversation.title || conversation.firstMessage,
            event.metaKey || event.ctrlKey,
          )
        }
        disabled={opening}
        className={clsx(
          'flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none',
          // Keyboard reachability without the platform ring, which paints in
          // the OS accent colour and fights everything here. A thin inset ring,
          // never a fill: focus lingers on the row you last clicked, and a fill
          // there is indistinguishable from the selected row's own background.
          'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zViolet-accent/40',
          compact ? 'px-2.5 py-2' : 'px-3 py-3.5',
          opening && 'cursor-wait',
        )}
      >
        {opening ? (
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-zViolet-accent" />
        ) : (
          <div className="relative flex-shrink-0">
            <Avatar
              src={conversation.owner?.avatarURL}
              name={conversationOwnerName(conversation)}
              size={avatarSize}
              className={clsx(
                'rounded-full',
                conversation.owner?.deactivated && 'grayscale opacity-60',
              )}
            />
            {channelBadge && (
              <ConversationChannelDot badge={channelBadge} avatarSize={avatarSize} />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className={clsx(
              'min-w-0 truncate group-hover:text-main',
              titleTone({ unread, selected }),
              titleClassName,
            )}
          >
            {conversation.title || conversation.firstMessage || 'Untitled chat'}
          </div>
          <div className={clsx('text-[11.5px] text-tertiary', timeClassName)}>
            {formatHistoryTime(conversation.lastActiveAt)}
            {conversation.messageCount > 0
              ? ` · ${String(conversation.messageCount)} messages`
              : ''}
            {triggerBadge && (
              <>
                {' · '}
                <span title={triggerBadge.description} className="text-zViolet-accent">
                  {triggerBadge.label}
                </span>
              </>
            )}
            {runLabel?.label && (
              <>
                {' · '}
                <span title={runLabel.description} className="text-zViolet-accent">
                  {runLabel.label}
                </span>
              </>
            )}
            {runLabel?.memberKey && <> · {runLabel.memberKey}</>}
          </div>
        </div>
      </button>
      {unread && (
        <span
          aria-label="Unread reply"
          title="Unread reply"
          className="mr-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zViolet-500 group-hover:hidden"
        />
      )}
      {trailing}
    </div>
  )
}

export function ConversationActivityBadges({
  source,
}: {
  source?: AgentConversation['activitySource']
}) {
  const badges = conversationActivityBadges(source)

  if (badges.length === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1">
      {badges.map((badge) => (
        <ConversationActivityBadgeView key={badge.kind} badge={badge} />
      ))}
    </span>
  )
}

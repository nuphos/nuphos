import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { Archive, Loader2, Pencil } from 'lucide-react'
import { useState } from 'react'

import { useAgentUnreadSessions } from '../../../lib/agentUnreadSessions'
import { ContextMenu } from '../../ContextMenu'

import { RenameConversationDialog } from './ConversationTitleEditor'
import { HistoryConversationRow } from './historyRows'
import { pickUpConversationInSlack } from './slackPickup'

import type { AgentConversation } from '../../../api'
import type { MouseEvent, RefObject } from 'react'

type RowMenuState = {
  x: number
  y: number
  conversation: AgentConversation
}

function ArchiveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Archive chat"
      title="Archive chat"
      onClick={onClick}
      className="mr-2 hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary outline-none transition-colors hover:bg-zGray-800/60 hover:text-main focus-visible:inline-flex focus-visible:bg-zGray-800/60 group-hover:inline-flex"
    >
      <Archive className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  )
}

export function HistoryPageList({
  items,
  loading,
  debouncedQuery,
  ownerId,
  historyScope,
  teamId,
  openingSessionId,
  selectedSessionId,
  layout,
  selectedRowRef,
  hasMore,
  sentinelRef,
  loadingMore,
  loadMore,
  emptyLabel,
  onOpenConversation,
  onArchive,
}: {
  items: AgentConversation[]
  loading: boolean
  debouncedQuery: string
  ownerId: string | null
  /** Replaces the "no conversations" copy where the list is not Chats — a
   *  Trigger's runs need to say the trigger hasn't fired, not that nobody has
   *  chatted. Search and loading still speak for themselves. */
  emptyLabel?: string
  historyScope: 'mine' | 'team'
  teamId?: string
  openingSessionId: string | null
  selectedSessionId: string | null
  layout: 'page' | 'rail'
  selectedRowRef: RefObject<HTMLDivElement | null>
  hasMore: boolean
  sentinelRef: RefObject<HTMLDivElement | null>
  loadingMore: boolean
  loadMore: () => Promise<void>
  onOpenConversation: (sessionId: string, titleHint?: string, newTab?: boolean) => void
  onArchive: (conversation: AgentConversation) => Promise<void>
}) {
  const [renameTarget, setRenameTarget] = useState<AgentConversation | null>(null)
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const unreadSessions = useAgentUnreadSessions()

  // Row actions are owner-only: Slack pick-up binds the thread to the
  // owner's DM, and the backend archives only for the owner — so a teammate's
  // row gets neither.
  const isOwn = (conversation: AgentConversation) =>
    historyScope === 'mine' || conversation.isOwner === true

  const openRowMenu = (event: MouseEvent, conversation: AgentConversation) => {
    event.preventDefault()
    setRowMenu({ x: event.clientX, y: event.clientY, conversation })
  }

  if (items.length === 0) {
    return (
      <div className="px-3 py-4 text-[12.5px] text-tertiary">
        {loading
          ? 'Loading…'
          : debouncedQuery
            ? 'No conversations match your search.'
            : (emptyLabel ??
              (ownerId
                ? 'No conversations from this member yet.'
                : historyScope === 'team'
                  ? 'No team conversations yet.'
                  : "You haven't started any conversations yet."))}
      </div>
    )
  }

  return (
    <>
      {items.map((conversation) => (
        <HistoryConversationRow
          key={conversation.sessionId}
          conversation={conversation}
          unread={unreadSessions.has(conversation.sessionId)}
          opening={openingSessionId === conversation.sessionId}
          selected={selectedSessionId === conversation.sessionId}
          rowRef={selectedSessionId === conversation.sessionId ? selectedRowRef : undefined}
          compact={layout === 'rail'}
          className={layout === 'rail' ? undefined : 'sketch-divider-bottom'}
          titleClassName="text-[13px]"
          timeClassName="mt-1"
          avatarSize={layout === 'rail' ? 25 : 28}
          onOpenConversation={(sessionId) =>
            onOpenConversation(sessionId, conversation.title || conversation.firstMessage)
          }
          onContextMenu={
            isOwn(conversation) ? (event) => openRowMenu(event, conversation) : undefined
          }
          trailing={
            isOwn(conversation) ? (
              <ArchiveButton onClick={() => void onArchive(conversation)} />
            ) : undefined
          }
        />
      ))}
      {renameTarget && teamId && (
        <RenameConversationDialog
          key={renameTarget.sessionId}
          sessionId={renameTarget.sessionId}
          teamId={teamId}
          title={renameTarget.title}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={[
            {
              key: 'rename',
              label: 'Rename chat',
              icon: Pencil,
              disabled: !teamId,
              onSelect: () => setRenameTarget(rowMenu.conversation),
            },
            {
              key: 'slack-pickup',
              label: rowMenu.conversation.activitySource?.linkedSlackThread
                ? 'Open Slack thread'
                : 'Pick up in Slack',
              icon: faSlack,
              onSelect: () => pickUpConversationInSlack(rowMenu.conversation.sessionId, teamId),
            },
            { key: 'sep', separator: true },
            {
              key: 'archive',
              label: 'Archive chat',
              icon: Archive,
              onSelect: () => onArchive(rowMenu.conversation),
            },
          ]}
          onClose={() => setRowMenu(null)}
        />
      )}
      {hasMore && (
        <div ref={sentinelRef} className="flex items-center justify-center py-3">
          {loadingMore ? (
            <Loader2 className="h-4 w-4 animate-spin text-zViolet-accent" />
          ) : (
            <button
              onClick={() => void loadMore()}
              className="text-[12px] text-tertiary transition-colors hover:text-main"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </>
  )
}

import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { Archive, Loader2, Pencil } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'
import { useAgentUnreadSessions } from '../../../lib/agentUnreadSessions'
import { ContextMenu } from '../../ContextMenu'

import { RenameConversationDialog } from './ConversationTitleEditor'
import { HistoryConversationRow } from './historyRows'
import { pickUpConversationInSlack } from './slackPickup'

import type { AgentConversation } from '../../../api'
import type { ContextMenuItem } from '../../ContextMenu'
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
      aria-label={t('Archive agent')}
      title={t('Archive agent')}
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

  // Rename and Slack pick-up are the owner's (pick-up binds the thread to the
  // owner's DM); a manager may also archive.
  const isOwn = (conversation: AgentConversation) =>
    historyScope === 'mine' || conversation.isOwner === true
  const canArchive = (conversation: AgentConversation) =>
    isOwn(conversation) || conversation.canManage === true

  const openRowMenu = (event: MouseEvent, conversation: AgentConversation) => {
    event.preventDefault()
    setRowMenu({ x: event.clientX, y: event.clientY, conversation })
  }

  if (items.length === 0) {
    return (
      <div className="px-3 py-4 text-[12.5px] text-tertiary">
        {loading
          ? t('Loading…')
          : debouncedQuery
            ? t('No agents match your search.')
            : (emptyLabel ??
              (ownerId
                ? t('No agents from this member yet.')
                : historyScope === 'team'
                  ? t('No team agents yet.')
                  : t("You haven't started any agents yet.")))}
      </div>
    )
  }

  return (
    <>
      {items.map((conversation) => (
        <HistoryConversationRow
          key={conversation.sessionId}
          conversation={conversation}
          unread={!conversation.parentSessionId && unreadSessions.has(conversation.sessionId)}
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
            canArchive(conversation) ? (event) => openRowMenu(event, conversation) : undefined
          }
          trailing={
            canArchive(conversation) ? (
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
            ...(isOwn(rowMenu.conversation)
              ? ([
                  {
                    key: 'rename',
                    label: t('Rename agent'),
                    icon: Pencil,
                    disabled: !teamId,
                    onSelect: () => setRenameTarget(rowMenu.conversation),
                  },
                  {
                    key: 'slack-pickup',
                    label: rowMenu.conversation.activitySource?.linkedSlackThread
                      ? t('Open Slack thread')
                      : t('Pick up in Slack'),
                    icon: faSlack,
                    onSelect: () =>
                      pickUpConversationInSlack(rowMenu.conversation.sessionId, teamId),
                  },
                  { key: 'sep', separator: true },
                ] satisfies ContextMenuItem[])
              : []),
            {
              key: 'archive',
              label: t('Archive agent'),
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
              {t('Load more')}
            </button>
          )}
        </div>
      )}
    </>
  )
}

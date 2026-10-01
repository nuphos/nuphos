import clsx from 'clsx'
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react'
import { useEffect } from 'react'

import { useSentinelAutoLoad } from '../components/agent/panel/historyPageHooks'
import { HistoryConversationRow } from '../components/agent/panel/historyRows'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/ui/button'

import { archivedAtLabel } from './archived-chats/archivedChatsList'
import { useArchivedChats } from './archived-chats/useArchivedChats'

type Props = {
  teamId: string
  filter: string
  refreshKey: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  onOpenConversation: (sessionId: string) => void
}

export function ArchivedChatsView({
  teamId,
  filter,
  refreshKey,
  onCount,
  onLoading,
  onOpenConversation,
}: Props) {
  const { items, loading, loadingMore, hasMore, search, restoringIds, loadMore, unarchive } =
    useArchivedChats({ teamId, filter, refreshKey, onLoading })
  const { scrollRef, sentinelRef } = useSentinelAutoLoad(hasMore, loadMore)

  useEffect(() => {
    onCount?.(items.length)
  }, [items.length, onCount])

  if (!loading && items.length === 0 && !search) {
    return (
      <EmptyState
        icon={Archive}
        title="No archived chats"
        description="Chats you archive, and chats left idle for a week, are kept here. Unarchive one to put it back in Chats."
      />
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden selectable">
      <div
        ref={scrollRef}
        className="h-full min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin px-6 pt-4"
      >
        <div
          className={clsx(
            'mx-auto w-full max-w-[820px] sketch-line-h pt-px transition-all duration-150',
            loading && items.length > 0 && 'opacity-50 blur-[1.5px] pointer-events-none',
          )}
        >
          {items.length === 0 && (
            <div className="px-3 py-4 text-[12.5px] text-tertiary">
              {loading ? 'Loading…' : 'No archived chats match your search.'}
            </div>
          )}
          {items.map((conversation) => (
            <HistoryConversationRow
              key={conversation.sessionId}
              conversation={conversation}
              opening={false}
              className="sketch-divider-bottom"
              titleClassName="text-[13px]"
              timeClassName="mt-1"
              avatarSize={28}
              onOpenConversation={onOpenConversation}
              trailing={
                <div className="mr-3 flex flex-shrink-0 items-center gap-3">
                  <span className="text-[11.5px] text-tertiary">
                    {archivedAtLabel(conversation.archivedAt)}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={restoringIds.has(conversation.sessionId)}
                    onClick={() => void unarchive(conversation)}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.8} />
                    Unarchive
                  </Button>
                </div>
              }
            />
          ))}
          {hasMore && (
            <div ref={sentinelRef} className="flex items-center justify-center py-3">
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin text-zViolet-accent" />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

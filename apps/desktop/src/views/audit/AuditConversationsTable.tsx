import clsx from 'clsx'

import { Age } from '../../components/Age'
import { JournalIntegrityBadge } from '../../components/agent/JournalEventBody'
import { Avatar } from '../../components/Avatar'
import { Table } from '../../components/Table'

import { EmptyState, LoadMore, SearchScopeHint } from './AuditListChrome'
import { userLabel } from './shared'

import type { ConversationsState, SelectedJournal } from './shared'
import type { AgentAuditConversationRow } from '../../api'

export function AuditConversationsTable({
  conversations,
  conversationRows,
  selectedSessionIds,
  setSelectedSessionIds,
  setSelected,
  needle,
  mutationsOnly,
  loadingMore,
  loadMore,
}: {
  conversations: ConversationsState
  conversationRows: AgentAuditConversationRow[]
  selectedSessionIds: Set<string>
  setSelectedSessionIds: (ids: Set<string>) => void
  setSelected: React.Dispatch<React.SetStateAction<SelectedJournal | null>>
  needle: string
  mutationsOnly: boolean
  loadingMore: boolean
  loadMore: () => Promise<void>
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Table<AgentAuditConversationRow>
        loading={conversations.kind === 'loading'}
        rows={conversationRows}
        rowKey={(r) => r.sessionId}
        selectable
        selectedKeys={selectedSessionIds}
        onSelectedKeysChange={setSelectedSessionIds}
        storageKey="team-audit-conversations"
        onPrimaryAction={(r) =>
          setSelected((current) =>
            current?.sessionId === r.sessionId && !current.focusEventId
              ? null
              : {
                  sessionId: r.sessionId,
                  focusTarget: null,
                  focusEventId: null,
                },
          )
        }
        empty={
          conversations.kind === 'error' ? (
            <div className="py-14 text-center text-xs text-error">{conversations.message}</div>
          ) : needle ? (
            <SearchScopeHint
              hasMore={conversations.kind === 'ready' && Boolean(conversations.nextCursor)}
            />
          ) : (
            <EmptyState mutationsOnly={mutationsOnly} />
          )
        }
        columns={[
          {
            key: 'title',
            header: 'Conversation',
            width: 320,
            sortAccessor: (r) => r.title,
            render: (r) => (
              <span className="block truncate text-main" title={r.title}>
                {r.title}
              </span>
            ),
          },
          {
            key: 'actors',
            header: 'Users',
            width: 200,
            sortAccessor: (r) =>
              conversations.kind === 'ready'
                ? r.userIds.map((id) => userLabel(conversations.users, id)).join(', ')
                : '',
            render: (r) =>
              conversations.kind === 'ready' ? (
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {r.userIds.slice(0, 3).map((id) => {
                    const user = conversations.users[id]

                    return (
                      <span key={id} className="inline-flex min-w-0 items-center gap-1">
                        <Avatar
                          src={user?.avatarURL}
                          name={userLabel(conversations.users, id)}
                          size={16}
                        />
                        <span className="truncate text-[12px] text-secondary">
                          {userLabel(conversations.users, id)}
                        </span>
                      </span>
                    )
                  })}
                  {r.userIds.length > 3 && (
                    <span className="text-[11px] text-tertiary">+{r.userIds.length - 3}</span>
                  )}
                </div>
              ) : null,
          },
          {
            key: 'events',
            header: 'Events',
            width: 80,
            sortAccessor: (r) => r.eventCount,
            render: (r) => (
              <span className="font-mono text-[12px] text-tertiary">{r.eventCount}</span>
            ),
          },
          {
            key: 'mutations',
            header: 'Mutations',
            width: 96,
            sortAccessor: (r) => r.mutationCount,
            render: (r) => (
              <span
                className={clsx(
                  'font-mono text-[12px]',
                  r.mutationCount > 0 ? 'text-amber-300' : 'text-tertiary',
                )}
              >
                {r.mutationCount}
              </span>
            ),
          },
          {
            key: 'integrity',
            header: 'Integrity',
            width: 120,
            sortAccessor: (r) => r.integrityLevel,
            render: (r) => <JournalIntegrityBadge level={r.integrityLevel} compact />,
          },
          {
            key: 'last',
            header: 'Last activity',
            width: 110,
            sortAccessor: (r) => r.lastTs,
            render: (r) => (
              <span className="font-mono text-[12px] text-tertiary">
                <Age value={r.lastTs} />
              </span>
            ),
          },
        ]}
      />
      <LoadMore
        visible={conversations.kind === 'ready' && Boolean(conversations.nextCursor)}
        loading={loadingMore}
        onClick={() => void loadMore()}
      />
    </div>
  )
}

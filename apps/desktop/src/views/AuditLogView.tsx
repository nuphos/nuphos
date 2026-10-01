// Standalone Audit log page: cross-conversation view of the
// tamper-evident agent journal plus resource mutation events. Answers the
// auditor's question — "who changed what, when" — without inventing
// conversations for direct UI/admin actions.
//
// Two tabs over the same filters:
//   Conversations — one row per conversation (actors, counts, integrity)
//   All events    — flat newest-first narrative stream
// Rows link back to their conversation; narrative rendering is shared with
// the in-chat journal panel (JournalEventBody / lib/journalEvent).

import { faFileExport } from '@fortawesome/free-solid-svg-icons'
import { MessageSquare } from 'lucide-react'
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'

import { JournalSidePanel } from '../components/agent/JournalPanel'
import { BulkActionBar } from '../components/BulkActionBar'
import { DetailSidebarTransition } from '../components/DetailSidebarTransition'
import { PageHeader } from '../components/PageHeader'
import { SearchBox } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { useToolbarSlot } from '../hooks/useToolbarControls'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { AuditConversationsTable } from './audit/AuditConversationsTable'
import { AuditEventsStream } from './audit/AuditEventsStream'
import { AuditExportButton, AuditFilterControls } from './audit/AuditToolbarControls'
import { useAuditLogData } from './audit/useAuditLogData'

import type { Range, Scope, SelectedJournal, Tab } from './audit/shared'
import type { JournalChatTarget } from '../lib/journalEvent'

type Props = {
  teamId: string
  refreshKey: number
  /** Toolbar search text — filters titles and user names client-side. */
  filter?: string
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  /**
   * Explicitly open the conversation as a read-only viewer (docked agent
   * panel — no composer/approve/fork, own session or not). Audit
   * rows themselves open the journal panel — viewing the chat is a deliberate
   * action: the footer button, or clicking a journal entry (which additionally
   * scrolls the chat to that entry's message/tool card via `locate`).
   */
  onOpenConversation?: (sessionId: string, locate?: JournalChatTarget) => void
}

const EMPTY_SESSION_SELECTION = new Set<string>()

export function AuditLogView({
  teamId,
  refreshKey,
  filter,
  onCount,
  onLoading,
  onOpenConversation,
}: Props) {
  const [scope, setScope] = useState<Scope>('team')
  const [tab, setTab] = useState<Tab>('conversations')
  // Search text: the toolbar's `filter` drives it in the workspace shell; the
  // Settings overlay has no toolbar, so it falls back to its own search box.
  const [internalFilter, setInternalFilter] = useState('')
  const [mutationsOnly, setMutationsOnly] = useState(false)
  const [range, setRange] = useState<Range>('7d')
  const [sessionSelection, setSessionSelection] = useState<{
    teamId: string
    ids: Set<string>
  }>(() => ({ teamId, ids: new Set() }))
  const selectedSessionIds =
    sessionSelection.teamId === teamId ? sessionSelection.ids : EMPTY_SESSION_SELECTION
  const setSelectedSessionIds = useCallback(
    (ids: Set<string>) => setSessionSelection({ teamId, ids }),
    [teamId],
  )
  // Journal detail panel (the audit "open" action) — read-only, no side
  // effects; a row click must never fork or navigate into the chat.
  const [selected, setSelected] = useState<SelectedJournal | null>(null)
  const { pollTick, isActive } = useWorkspaceTab()
  // Filters (tab / scope / mutations / range) ride the toolbar's left slot and
  // the compliance Export sits in the right slot. Gate on
  // isActive so a keep-alive'd background tab never leaks its controls.
  const filtersSlot = useToolbarSlot('left', isActive)
  const exportSlot = useToolbarSlot('right', isActive)

  // Workspace supplies a `filter`; the Settings overlay does not, so fall back
  // to the internal search box there.
  const searchText = filter ?? internalFilter
  const needle = searchText.trim().toLowerCase()
  const {
    conversations,
    events,
    conversationRows,
    eventRows,
    loadingMore,
    loadMore,
    exporting,
    exportComplianceRecords,
  } = useAuditLogData({
    scope,
    tab,
    teamId,
    mutationsOnly,
    range,
    refreshKey,
    needle,
    pollTick,
    onCount,
    onLoading,
  })

  const filterControls = (
    <AuditFilterControls
      tab={tab}
      setTab={setTab}
      scope={scope}
      setScope={setScope}
      mutationsOnly={mutationsOnly}
      setMutationsOnly={setMutationsOnly}
      range={range}
      setRange={setRange}
      setSelectedSessionIds={setSelectedSessionIds}
    />
  )

  const exportControl = (
    <AuditExportButton exporting={exporting} onExport={() => void exportComplianceRecords()} />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {filtersSlot ? createPortal(filterControls, filtersSlot) : null}
      {exportSlot ? createPortal(exportControl, exportSlot) : null}
      {/* Selecting conversation rows raises the shared floating bar (same as
          Monitoring / the k8s lists); the toolbar Export stays "export the whole
          scope", the bar exports just the selection. */}
      <BulkActionBar
        count={selectedSessionIds.size}
        onClear={() => setSelectedSessionIds(new Set())}
        actions={[
          {
            key: 'export',
            label: 'Export selected',
            icon: faFileExport,
            disabled: exporting,
            onClick: () => exportComplianceRecords([...selectedSessionIds]),
          },
        ]}
      />
      {/* The Settings overlay hosts this view with no `filter` prop and no
          toolbar to publish into. Mirror the workspace's two rows there instead:
          a titled header, then a controls row (search + filters left, export
          right) — matching the Members section beside it. */}
      {filter === undefined && (
        <>
          <PageHeader
            title="Audit log"
            subtitle="Review agent activity and resource changes across conversations"
          />
          <div className="flex h-[42px] flex-shrink-0 items-center gap-2 border-b border-zGray-800/60 px-6">
            <SearchBox
              filter={internalFilter}
              onFilterChange={setInternalFilter}
              count={tab === 'conversations' ? conversationRows.length : eventRows.length}
            />
            <div className="mx-1 h-4 w-px bg-zGray-800" />
            {filterControls}
            <div className="flex-1" />
            {exportControl}
          </div>
        </>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tab === 'conversations' ? (
            <AuditConversationsTable
              conversations={conversations}
              conversationRows={conversationRows}
              selectedSessionIds={selectedSessionIds}
              setSelectedSessionIds={setSelectedSessionIds}
              setSelected={setSelected}
              needle={needle}
              mutationsOnly={mutationsOnly}
              loadingMore={loadingMore}
              loadMore={loadMore}
            />
          ) : (
            <AuditEventsStream
              events={events}
              eventRows={eventRows}
              setSelected={setSelected}
              needle={needle}
              mutationsOnly={mutationsOnly}
              loadingMore={loadingMore}
              loadMore={loadMore}
            />
          )}
        </div>
        {selected && (
          <DetailSidebarTransition
            onClose={() => setSelected(null)}
            className="flex-shrink-0 w-[44%] min-w-[380px] max-w-[680px] flex flex-col bg-zGray-950 min-h-0 overflow-hidden border-l border-zGray-800/60"
          >
            {/* Same journal panel the chat uses — single implementation. It is
              read-only here (no onLocateInChat: there is no transcript beside
              it); entering the chat is the explicit button below. */}
            {(requestClose) => (
              <div className="flex flex-1 min-h-0 flex-col">
                <JournalSidePanel
                  key={selected.sessionId}
                  sessionId={selected.sessionId}
                  teamId={teamId}
                  onClose={requestClose}
                  focusTarget={selected.focusTarget}
                  onLocateInChat={
                    onOpenConversation
                      ? (target) => onOpenConversation(selected.sessionId, target)
                      : undefined
                  }
                />
                {onOpenConversation && (
                  <div className="flex-shrink-0 border-t border-zGray-800/60 p-3">
                    <Button
                      variant="primary"
                      onClick={() => onOpenConversation(selected.sessionId)}
                      className="h-8 w-full gap-1.5 text-[13px]"
                    >
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                      View conversation
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DetailSidebarTransition>
        )}
      </div>
    </div>
  )
}

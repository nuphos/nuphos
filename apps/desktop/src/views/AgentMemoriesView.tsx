import clsx from 'clsx'
import { AlertCircle, Brain } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

import { ContextMenu } from '../components/ContextMenu'
import { EmptyState } from '../components/EmptyState'
import { Table } from '../components/Table'
import { AppAlertDialog } from '../components/ui/alert-dialog'
import { useToolbarSlot } from '../hooks/useToolbarControls'

import { applyFilter } from './cloud/shared'
import { tabs } from './memories/memoriesShared'
import { buildMemoryColumns } from './memories/memoryColumns'
import { MemoryDetailPane } from './memories/MemoryDetailPane'
import { MemoryScorecardStrip } from './memories/MemoryScorecardStrip'
import { useMemoriesList } from './memories/useMemoriesList'
import { useMemoryActions } from './memories/useMemoryActions'
import { useMemoryScorecard } from './memories/useMemoryScorecard'

import type { AgentMemoryItem } from '../api'

type Props = {
  teamId: string
  filter: string
  refreshKey: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function AgentMemoriesView({
  teamId,
  filter,
  refreshKey,
  onCount,
  onLoading,
  onOpenAgentChat,
}: Props) {
  const list = useMemoriesList({ teamId, refreshKey, onLoading })
  const {
    scope,
    setScope,
    stateFilter,
    setStateFilter,
    state,
    setState,
    selectedId,
    setSelectedId,
    selectedMemory,
    setSelectedMemory,
    detailLoading,
    setDetailLoading,
    menu,
    setMenu,
    loadingMore,
    setLoadingMore,
    confirmDelete,
    setConfirmDelete,
    deleteReason,
    setDeleteReason,
    listRequestRef,
    detailRequestRef,
    listState,
    reload,
    isActive,
  } = list
  const { openMemory, deleteMemory, restoreMemory, buildMenu, loadMore } = useMemoryActions({
    teamId,
    scope,
    stateFilter,
    listState,
    state,
    setState,
    selectedId,
    setSelectedId,
    setSelectedMemory,
    setDetailLoading,
    setConfirmDelete,
    loadingMore,
    setLoadingMore,
    listRequestRef,
    detailRequestRef,
    reload,
  })

  const loaded = state.kind === 'ready' ? state.memories : []
  const hasMore = state.kind === 'ready' && state.hasMore
  // Client-side, like every other list in the app. The API has no search
  // parameter, so this only sees what has been paged in — "Load more" stays
  // available under an active filter so the rest can be pulled in and matched.
  const rows = useMemo(
    () => applyFilter(loaded, filter, (m) => `${m.type} ${m.text} ${m.categories.join(' ')}`),
    [loaded, filter],
  )

  useEffect(() => {
    onCount?.(rows.length)
  }, [rows.length, onCount])

  const { summary, scores } = useMemoryScorecard(teamId, rows)
  const selected = useMemo(
    () => selectedMemory ?? rows.find((memory) => memory.id === selectedId) ?? null,
    [rows, selectedId, selectedMemory],
  )

  // Scope tabs + Active/Removed filter used to live in a bespoke header band;
  // they now ride the shared toolbar's left slot. Gate on
  // isActive so a keep-alive'd background tab never leaks its controls, and drop
  // the slot in the error/disabled states below (which render no list) so the
  // controls row doesn't linger as an empty band.
  const showToolbarControls =
    isActive && state.kind !== 'error' && !(state.kind === 'ready' && !state.enabled)
  const controlsSlot = useToolbarSlot('left', showToolbarControls)

  if (state.kind === 'error') {
    return (
      <div className="px-6 py-8 flex items-start gap-2 text-[12px] text-red-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
        <span>Failed to load memories: {state.message}</span>
      </div>
    )
  }

  if (state.kind === 'ready' && !state.enabled) {
    return (
      <EmptyState
        icon={Brain}
        title="Memories"
        description="Cross-conversation memory is not enabled on this backend. The agent will continue to work without it; it just won't recall anything between chats."
      />
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.memory)}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmDelete && (
        <AppAlertDialog
          open
          title="Remove memory"
          description={
            <div className="space-y-2.5">
              <p>Remove this memory? You can restore it later from Removed.</p>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Why remove it? (optional — e.g. wrong, outdated, duplicate)"
                rows={2}
                maxLength={300}
                className="w-full resize-none rounded-md bg-zGray-850 border border-zGray-800 px-2.5 py-1.5 text-[12.5px] text-main placeholder:text-quaternary outline-none focus:border-zGray-600 transition-colors"
              />
            </div>
          }
          confirmLabel="Delete"
          destructive
          onConfirm={() => deleteMemory(confirmDelete, deleteReason.trim() || undefined)}
          onClose={() => {
            setConfirmDelete(null)
            setDeleteReason('')
          }}
        />
      )}
      {controlsSlot &&
        createPortal(
          <div className="flex items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.scope}
                type="button"
                onClick={() => {
                  setScope(tab.scope)
                  setSelectedId(null)
                  setSelectedMemory(null)
                }}
                className={clsx(
                  'h-7 px-2.5 text-[12px] rounded-md transition-colors',
                  scope === tab.scope
                    ? 'bg-zGray-800 text-main'
                    : 'text-tertiary hover:text-secondary hover:bg-zGray-800/50',
                )}
              >
                {tab.label}
              </button>
            ))}
            <div className="mx-1 h-4 w-px bg-zGray-800" />
            {(['live', 'removed'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStateFilter(s)}
                className={clsx(
                  'h-7 px-2.5 text-[12px] rounded-md transition-colors capitalize',
                  stateFilter === s
                    ? 'bg-zGray-800 text-main'
                    : 'text-tertiary hover:text-secondary hover:bg-zGray-800/50',
                )}
              >
                {s === 'live' ? 'Active' : 'Removed'}
              </button>
            ))}
            {summary && stateFilter === 'live' && summary.turns.total > 0 && (
              <>
                <div className="mx-1 h-4 w-px bg-zGray-800" />
                <MemoryScorecardStrip summary={summary} />
              </>
            )}
          </div>,
          controlsSlot,
        )}
      <div
        className={clsx(
          'flex flex-col min-h-0',
          selected ? 'flex-1 min-w-0 border-r border-zGray-800/60' : 'flex-1 min-w-0',
        )}
      >
        {state.kind === 'ready' && rows.length === 0 && !filter && stateFilter === 'live' ? (
          <EmptyState
            icon={Brain}
            title="Memories"
            description="Memories are facts the agent saves about your team and its work as you work together. Chat with the agent and useful context accumulates here."
            agentAction={{
              label: 'Teach the agent something',
              prompt:
                'I want to teach you something about our team or systems so you remember it — ask me what to remember.',
            }}
            onOpenAgentChat={onOpenAgentChat}
          />
        ) : (
          <Table<AgentMemoryItem>
            loading={state.kind === 'loading'}
            rows={rows}
            rowKey={(r) => r.id}
            selectedKey={selectedId}
            onPrimaryAction={(r) => void openMemory(r)}
            onRowContextMenu={(r, e) => setMenu({ memory: r, x: e.clientX, y: e.clientY })}
            storageKey={`agent-memories-${scope}`}
            empty={
              filter
                ? hasMore
                  ? 'No memories match the current filter — only the memories loaded so far were searched; use "Load more" below to pull in the rest.'
                  : 'No memories match the current filter.'
                : 'No removed memories yet — memories you remove can be restored from here.'
            }
            columns={buildMemoryColumns(stateFilter, scores)}
          />
        )}
        {hasMore && (
          <div className="px-6 py-3 border-t border-zGray-800/60 flex-shrink-0">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full px-3 py-2 text-[12px] text-secondary hover:text-main rounded border border-zGray-800/60 hover:border-zGray-700/60 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
      {selected && (
        <MemoryDetailPane
          memory={selected}
          score={scores[selected.id]}
          scope={scope}
          loading={detailLoading}
          onRestore={stateFilter === 'removed' ? () => void restoreMemory(selected) : undefined}
          onDelete={stateFilter === 'live' ? () => setConfirmDelete(selected) : undefined}
          onClose={() => {
            setSelectedId(null)
            setSelectedMemory(null)
          }}
        />
      )}
    </div>
  )
}

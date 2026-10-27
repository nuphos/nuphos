import clsx from 'clsx'
import { Inbox } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { AgentHistoryPage, AgentPanel } from '../components/agent/AgentPanel'
import { EmptyState } from '../components/EmptyState'
import { useElementSize } from '../grafana/useElementSize'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { nextSelection } from './inbox/inboxItems'
import { ShareApprovalRequests } from './inbox/ShareApprovalRequests'
import { useShareApprovals } from './inbox/useShareApprovals'

import type { AgentConversation } from '../api'

// The rail refetches on this beat, so an answered conversation leaves and the next one opens.
const INBOX_REFRESH_MS = 5_000
// Below this the page shows the list alone, and a row opens its conversation.
const TWO_PANE_MIN_WIDTH = 720
const RAIL_WIDTH = 340

type Props = {
  teamId: string
  query: string
  refreshKey: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  onOpenConversation: (sessionId: string) => void
}

/**
 * Teammates asking to use the viewer's own computer, above every conversation
 * waiting on the viewer, beside the one being answered —
 * the Chats reader's own list and panel, listing only `pendingDecision`. The
 * answer names the selected question; only delivery or dismissal clears it.
 */
export function InboxView({
  teamId,
  query,
  refreshKey,
  onCount,
  onLoading,
  onOpenConversation,
}: Props) {
  const { isActive } = useWorkspaceTab()
  const { ref, width } = useElementSize<HTMLDivElement>()
  const twoPane = width === 0 || width >= TWO_PANE_MIN_WIDTH
  const [items, setItems] = useState<AgentConversation[] | null>(null)
  const [selected, setSelected] = useState<{ sessionId: string; index: number } | null>(null)
  const [tick, setTick] = useState(0)
  // Another team's list and open conversation are no answer for this one.
  const [shownTeamId, setShownTeamId] = useState(teamId)

  if (shownTeamId !== teamId) {
    setShownTeamId(teamId)
    setItems(null)
    setSelected(null)
  }
  const shareApprovals = useShareApprovals(teamId)
  const railRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), INBOX_REFRESH_MS)

    return () => clearInterval(interval)
  }, [])
  useEffect(() => onLoading?.(items === null), [items, onLoading])
  useEffect(() => onCount?.(items?.length ?? 0), [items, onCount])

  const select = useCallback((sessionId: string | null, list: AgentConversation[]) => {
    setSelected(
      sessionId
        ? { sessionId, index: list.findIndex((item) => item.sessionId === sessionId) }
        : null,
    )
  }, [])
  const selectedRef = useRef(selected)

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])
  const onListLoaded = useCallback(
    (list: AgentConversation[]) => {
      setItems(list)
      const open = selectedRef.current
      const settle = (stillWaits: boolean) => {
        // The reader moved meanwhile: that choice stands.
        if (selectedRef.current !== open) return
        const next = nextSelection(open, list, stillWaits)

        setSelected(
          next ? { sessionId: next, index: list.findIndex((i) => i.sessionId === next) } : null,
        )
      }

      if (!open || list.some((item) => item.sessionId === open.sessionId)) return settle(false)
      // Not listed is not proof it was answered (a longer list can push it out): ask its own record.
      void api.agentGetConversation(open.sessionId, teamId, { tail: 1, runtimeState: 'omit' }).then(
        (detail) => settle(Boolean(detail.pendingDecision)),
        () => settle(true),
      )
    },
    [teamId],
  )

  // Enter or → moves from the list into the open conversation's composer; Esc comes back.
  useEffect(() => {
    if (!isActive || !twoPane) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      const typing =
        Boolean(target?.isContentEditable) ||
        Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

      if (event.key === 'Escape' && typing && readerRef.current?.contains(target)) {
        event.preventDefault()
        railRef.current?.querySelector<HTMLElement>('[aria-current="true"] button')?.focus()

        return
      }
      if ((event.key === 'Enter' || event.key === 'ArrowRight') && !typing) {
        if (target && target !== document.body && !railRef.current?.contains(target)) return
        // The first match can be a hidden copy; the composer is the one that takes focus.
        const composers = readerRef.current?.querySelectorAll<HTMLElement>('[aria-label="Message"]')

        for (const composer of composers ?? []) {
          composer.focus()
          if (document.activeElement === composer) {
            event.preventDefault()

            return
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isActive, twoPane])

  const empty = items !== null && items.length === 0 && !query
  const caughtUp = empty && shareApprovals.approvals.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShareApprovalRequests teamId={teamId} {...shareApprovals} />
      <div ref={ref} className="flex min-h-0 flex-1">
        {caughtUp && (
          <EmptyState
            icon={Inbox}
            title="You're all caught up"
            description="When an agent needs you to decide something, it shows up here. Answer it there and it leaves the Inbox."
          />
        )}
        {/* Mounted while empty too: its refetch is what brings the next question in. */}
        <div
          ref={railRef}
          className={clsx(
            'flex h-full min-h-0 flex-col',
            empty && 'hidden',
            twoPane ? 'flex-shrink-0 border-r border-zGray-800/70' : 'min-w-0 flex-1',
          )}
          style={twoPane ? { width: RAIL_WIDTH } : undefined}
        >
          <AgentHistoryPage
            teamId={teamId}
            refreshKey={refreshKey + tick}
            query={query}
            openingSessionId={null}
            selectedSessionId={twoPane ? (selected?.sessionId ?? null) : null}
            layout="rail"
            pendingDecision
            historyScope="mine"
            onOpenConversation={(sessionId) =>
              twoPane ? select(sessionId, items ?? []) : onOpenConversation(sessionId)
            }
            onListLoaded={onListLoaded}
            keyboardNavigation={isActive && twoPane}
          />
        </div>
        {twoPane && !empty && (
          <div ref={readerRef} className="flex min-w-0 flex-1 flex-col">
            {selected && (
              <AgentPanel
                key="inbox"
                variant="page"
                open
                focusComposerOnOpen={false}
                teamId={teamId}
                sessionId={selected.sessionId}
                decisionReplyTo={
                  items?.find((item) => item.sessionId === selected.sessionId)?.pendingDecision
                    ?.toolCallId
                }
                onSessionChange={(sessionId) => select(sessionId, items ?? [])}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

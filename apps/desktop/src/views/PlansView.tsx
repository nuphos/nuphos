import clsx from 'clsx'
import { AlertCircle, Ban, ClipboardList, Settings2, ShieldCheck } from 'lucide-react'
import { createPortal } from 'react-dom'

import { ContextMenu } from '../components/ContextMenu'
import { DetailSidebarTransition } from '../components/DetailSidebarTransition'
import { EmptyState } from '../components/EmptyState'
import { Table } from '../components/Table'
import { planNumberFromFilter } from '../lib/planRoute'

import { PlanApprovalPolicyModal } from './plans/PlanApprovalPolicyModal'
import { PermissionRequestDetail } from './plans/PlanCells'
import { buildPlanColumns } from './plans/planColumns'
import { PlanDetailView } from './plans/PlanDetailView'
import { usePlanRowActions } from './plans/usePlanRowActions'
import { usePlansCore } from './plans/usePlansCore'
import { usePlansSelection } from './plans/usePlansSelection'

import type { Row } from './plans/planRows'

type Props = {
  teamId: string
  refreshKey: number
  /**
   * Toolbar search text. Plan deep links (/teams/T/plans/<number>) land here
   * as the bare plan number, which opens that plan's standalone detail page.
   */
  filter?: string
  /** Navigate between the Plans list and a standalone Plan detail page. */
  onOpenPlan: (planNumber: string) => void
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  /** Open a plan in the agent chat (surfaces it in the chat's side panel). */
  onOpenInChat?: (planId: string) => void
  /** Viewer is a team administrator — gates approving permission-grant rows. */
  isTeamAdmin?: boolean
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function PlansView({
  teamId,
  refreshKey,
  filter = '',
  onOpenPlan,
  onCount,
  onLoading,
  onOpenInChat,
  isTeamAdmin = false,
  onOpenAgentChat,
}: Props) {
  const planNumber = planNumberFromFilter(filter)

  if (planNumber) {
    return <PlanDetailView teamId={teamId} planId={planNumber} onOpenInChat={onOpenInChat} />
  }

  return (
    <PlansListView
      teamId={teamId}
      refreshKey={refreshKey}
      filter={filter}
      onOpenPlan={onOpenPlan}
      onCount={onCount}
      onLoading={onLoading}
      onOpenInChat={onOpenInChat}
      isTeamAdmin={isTeamAdmin}
      onOpenAgentChat={onOpenAgentChat}
    />
  )
}

function PlansListView({
  teamId,
  refreshKey,
  filter = '',
  onOpenPlan,
  onCount,
  onLoading,
  onOpenInChat,
  isTeamAdmin = false,
  onOpenAgentChat,
}: Props) {
  const core = usePlansCore({ teamId, refreshKey, filter, onCount, onLoading, isTeamAdmin })
  const {
    state,
    setState,
    proposals,
    members,
    loadingMore,
    setLoadingMore,
    selectedId,
    setSelectedId,
    fetchedPlan,
    setFetchedPlan,
    menu,
    setMenu,
    showDismissed,
    setShowDismissed,
    approvalPolicy,
    policyOpen,
    setPolicyOpen,
    policyMode,
    setPolicyMode,
    policyQuorum,
    setPolicyQuorum,
    policySaving,
    reload,
    openPolicy,
    savePolicy,
    rows,
    dismissedSlot,
    configureSlot,
  } = core
  const { loadMore, selectedRow, membersById } = usePlansSelection({
    teamId,
    filter,
    state,
    setState,
    proposals,
    members,
    loadingMore,
    setLoadingMore,
    selectedId,
    setSelectedId,
    fetchedPlan,
    setFetchedPlan,
  })
  const { copyProposalLink, buildMenu } = usePlanRowActions({
    teamId,
    reload,
    setState,
    setFetchedPlan,
    onOpenInChat,
  })

  if (state.kind === 'error') {
    return (
      <div className="px-6 py-8 flex items-start gap-2 text-[12px] text-red-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
        <span>Failed to load plans: {state.message}</span>
      </div>
    )
  }

  const hasMore = state.kind === 'ready' && state.hasMore

  // Permission requests still use their compact review sidebar. Plans navigate
  // to their own page so the execution detail gets the full workspace width.
  return (
    <div className="flex-1 flex min-h-0">
      <PlanApprovalPolicyModal
        open={policyOpen}
        saving={policySaving}
        mode={policyMode}
        quorum={policyQuorum}
        onModeChange={setPolicyMode}
        onQuorumChange={setPolicyQuorum}
        onClose={() => setPolicyOpen(false)}
        onSave={() => void savePolicy()}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.row)}
          onClose={() => setMenu(null)}
        />
      )}
      <div
        className={clsx(
          'flex flex-col min-h-0',
          selectedRow ? 'flex-1 min-w-0 border-r border-zGray-800/60' : 'flex-1 min-w-0',
        )}
      >
        {dismissedSlot &&
          createPortal(
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-secondary"
            >
              <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
              {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
            </button>,
            dismissedSlot,
          )}
        {configureSlot &&
          createPortal(
            <button
              type="button"
              onClick={openPolicy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12.5px] text-white transition-colors hover:bg-zViolet-400"
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              Configure
            </button>,
            configureSlot,
          )}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-zGray-800/60 px-6 py-2">
          <ShieldCheck className="h-3.5 w-3.5 text-zViolet-accent" strokeWidth={1.8} />
          <span className="text-[12px] text-secondary">Plan approval</span>
          <span className="text-[11.5px] text-tertiary">
            {approvalPolicy
              ? approvalPolicy.minimumOtherApprovals === 0
                ? 'Requester only'
                : `Requester + ${String(approvalPolicy.minimumOtherApprovals)} other member(s)`
              : 'Loading…'}
          </span>
        </div>
        {state.kind === 'ready' &&
        state.plans.length === 0 &&
        proposals.length === 0 &&
        !filter.trim() ? (
          <EmptyState
            icon={ClipboardList}
            title="Plans"
            description="When you ask the agent to do something that needs confirmation, it drafts a plan here for the team to review and approve. Plans are shared, so anyone with access can weigh in."
            agentAction={{
              label: 'Ask the agent to plan a change',
              prompt:
                'Help me plan an infrastructure change — ask me what I want to do, then draft a plan for the team to review.',
            }}
            onOpenAgentChat={onOpenAgentChat}
          />
        ) : (
          <Table<Row>
            loading={state.kind === 'loading'}
            rows={rows}
            rowKey={(r) => r.id}
            storageKey="team-plans"
            onPrimaryAction={(r) => {
              if (r.kind === 'plan') {
                onOpenPlan(String(r.plan.number))

                return
              }
              setSelectedId(r.id === selectedId ? null : r.id)
            }}
            onRowContextMenu={(r, e) => setMenu({ row: r, x: e.clientX, y: e.clientY })}
            empty={
              filter.trim()
                ? 'No plans match the current search.'
                : 'No plans to show — dismissed plans are hidden.'
            }
            columns={buildPlanColumns(membersById)}
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
      {selectedRow?.kind === 'permission' && (
        <DetailSidebarTransition
          onClose={() => setSelectedId(null)}
          className="flex-shrink-0 w-[44%] min-w-[380px] max-w-[680px] flex flex-col bg-zGray-950 min-h-0 overflow-hidden"
        >
          {(requestClose) => (
            <PermissionRequestDetail
              proposalId={selectedRow.id}
              teamId={teamId}
              canApprove={isTeamAdmin}
              onCopyLink={() => copyProposalLink(selectedRow.id)}
              onClose={requestClose}
            />
          )}
        </DetailSidebarTransition>
      )}
    </div>
  )
}

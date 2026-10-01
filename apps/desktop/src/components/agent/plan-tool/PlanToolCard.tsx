import clsx from 'clsx'
import { memo, useMemo, useState } from 'react'

import { PlanActionBar } from './PlanActionBar'
import { initiallyFolded, planCardRegions } from './planCardLayout'
import { PlanHeader } from './PlanHeader'
import {
  PlanCostView,
  PlanDatabaseActionView,
  PlanDecisionsView,
  PlanRiskView,
} from './planSections'
import { PlanStepsList } from './PlanStepView'
import { PlanBuildingView, PlanExecutionErrorView, PlanExecutionPreparingView } from './statusViews'
import { usePlanDecision } from './usePlanDecision'

import type { CommandStatus } from './planData'
import type { Plan, PlanApprovalProgress, PlanLifecycleStatus } from '../../../api'
import type { PlanPayload } from '../planPayload'

type Props = {
  payload: PlanPayload
  /** Whether the Approve button should be shown. Separate from `canChat` so a
   *  plan that's mid-execution can still expose Chat (= interrupt) without
   *  showing a no-op Approve. */
  canApprove?: boolean
  /** Whether a failed plan can be reset back to proposed. */
  canRetry?: boolean
  /** Whether the Chat button should be shown. Independent of `canApprove`. */
  canChat?: boolean
  /** Called when the user clicks Approve — agent should keep executing. */
  onApprove?: () => Promise<Plan | void> | Plan | void
  /** Decline the plan: `'revise'` (Request changes — keep it proposed, agent
   *  revises against the reason) or `'delete'` (Reject — discard it). The reason
   *  is optional for delete. Gated like Approve. */
  onReject?: (reason: string, mode: 'revise' | 'delete') => void
  /** Called when the user clicks Retry — resets a failed plan to proposed. */
  onRetry?: () => void
  retrying?: boolean
  retryError?: string | null
  /** Called when the user clicks Chat — agent should stop and let the user redirect. */
  onChat?: () => void
  /**
   * Linear status per command, in the order they appear in the plan
   * (step → job → command). When provided the card renders a live "todo
   * list" with status icons; jobs/steps inherit their status from the
   * commands beneath them.
   */
  progress?: CommandStatus[]
  /** Lifecycle status of the persisted plan. When set, a status badge renders
   *  in the header next to the plan number. Absent for legacy plans. */
  status?: PlanLifecycleStatus
  /** Server-computed approval quorum. Missing only on legacy transcript cards. */
  approvalProgress?: PlanApprovalProgress
  /** The plan's last-modified timestamp. Used to detect an in-place revision
   *  after "Request changes" so the action bar can come back. */
  updatedAt?: string
  executionError?: string
  /**
   * When true, drops the outer rounded card chrome (border, background,
   * vertical margin). Use this when the card lives inside another container
   * that already provides its own framing — e.g. the page-mode side pane —
   * to avoid a double border.
   */
  embedded?: boolean
  /**
   * Optional control rendered top-right in the card header — used for the
   * inline ↔ side-pane layout toggle. Kept as a slot so PlanTool stays
   * presentational and doesn't know about layout state.
   */
  headerAction?: React.ReactNode
  /** When true, show a fold/expand chevron in the header that collapses the
   *  card down to just its header. For inline cards in the conversation. */
  foldable?: boolean
  /**
   * When true, render the plan as a stack of separate rounded cards floating on
   * a transparent background — one card per block (header, decisions, steps,
   * cost, risk, actions) — instead of one bordered card with internal dividers.
   * Used by the chat side pane so the plan reads as part of the conversation
   * rather than a split-off window. Implies `embedded` layout (fills its host).
   */
  floating?: boolean
}

export const PlanTool = memo(function PlanTool({
  payload,
  canApprove = true,
  canRetry = false,
  onApprove,
  onReject,
  onRetry,
  retrying = false,
  retryError,
  progress,
  status,
  approvalProgress,
  updatedAt,
  executionError,
  embedded = false,
  headerAction,
  foldable = false,
  floating = false,
}: Props) {
  const decisionState = usePlanDecision({ status, updatedAt, onApprove, onReject })
  const { decision } = decisionState
  const [folded, setFolded] = useState(() => initiallyFolded(foldable))
  const totalJobs = useMemo(
    () => payload.steps.reduce((sum, step) => sum + step.jobs.length, 0),
    [payload.steps],
  )
  const totalCommands = useMemo(
    () =>
      payload.steps.reduce(
        (sum, step) => sum + step.jobs.reduce((jSum, job) => jSum + (job.commands?.length ?? 0), 0),
        0,
      ),
    [payload.steps],
  )
  const isPreparingExecution =
    status === 'executing' &&
    totalCommands > 0 &&
    (!progress || progress.length === 0 || progress.every((item) => item === 'pending'))
  const planComplete = Boolean(
    payload.steps.length > 0 && payload.cost && payload.risk && payload.risk.mitigations.length > 0,
  )
  const showBuildingPlan = status === 'proposed' && !planComplete

  const { bodyOpen, showRetry, showApproveBar, showActionBar } = planCardRegions({
    folded,
    decision,
    canApprove,
    canRetry,
    status,
  })

  const actionBar = showActionBar ? (
    <PlanActionBar
      state={decisionState}
      floating={floating}
      showApproveBar={showApproveBar}
      showRetry={showRetry}
      approvalProgress={approvalProgress}
      onReject={onReject}
      onRetry={onRetry}
      retrying={retrying}
      retryError={retryError}
    />
  ) : null

  const stepsOl = <PlanStepsList steps={payload.steps} progress={progress} floating={floating} />

  const body = (
    <>
      {showBuildingPlan && <PlanBuildingView payload={payload} />}

      {payload.decisions && payload.decisions.length > 0 && (
        <PlanDecisionsView decisions={payload.decisions} />
      )}

      {payload.databaseActions?.map((action) => (
        <PlanDatabaseActionView key={action.id} action={action} />
      ))}

      {isPreparingExecution && <PlanExecutionPreparingView />}

      {status === 'failed' && executionError && <PlanExecutionErrorView message={executionError} />}

      {stepsOl}

      {(payload.cost || payload.risk) && (
        <div className="border-t border-zGray-800/70 divide-y divide-zGray-800/60">
          {payload.cost && <PlanCostView cost={payload.cost} />}
          {payload.risk && <PlanRiskView risk={payload.risk} />}
        </div>
      )}
    </>
  )

  const header = (
    <PlanHeader
      payload={payload}
      status={status}
      totalJobs={totalJobs}
      totalCommands={totalCommands}
      floating={floating}
      foldable={foldable}
      folded={folded}
      onToggleFold={() => setFolded((v) => !v)}
      headerAction={headerAction}
    />
  )

  // Floating layout: each block is its own rounded card, stacked with gaps on
  // the host's (transparent) background. No outer card chrome, no dividers — so
  // the plan reads as part of the conversation, not a split-off window.
  if (floating) {
    // Linear-style cards: solid surface (one rung brighter than the page),
    // generous radius, a hairline border plus a faint shadow for lift.
    const cardClass =
      'rounded-lg border border-zGray-800/60 bg-zGray-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden'

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="t-scroll-fade min-h-0 flex-1 overflow-auto scrollbar-thin">
          <div className="flex flex-col gap-3 p-3">
            <div className={cardClass}>{header}</div>
            {showBuildingPlan && (
              <div className={cardClass}>
                <PlanBuildingView payload={payload} />
              </div>
            )}
            {payload.decisions && payload.decisions.length > 0 && (
              <div className={cardClass}>
                <PlanDecisionsView decisions={payload.decisions} floating />
              </div>
            )}
            {payload.databaseActions?.map((action) => (
              <div key={action.id} className={cardClass}>
                <PlanDatabaseActionView action={action} floating />
              </div>
            ))}
            {isPreparingExecution && (
              <div className={cardClass}>
                <PlanExecutionPreparingView />
              </div>
            )}
            {status === 'failed' && executionError && (
              <div className={cardClass}>
                <PlanExecutionErrorView message={executionError} />
              </div>
            )}
            {payload.steps.length > 0 && <div className={cardClass}>{stepsOl}</div>}
            {payload.cost && (
              <div className={cardClass}>
                <PlanCostView cost={payload.cost} floating />
              </div>
            )}
            {payload.risk && (
              <div className={cardClass}>
                <PlanRiskView risk={payload.risk} floating />
              </div>
            )}
          </div>
        </div>
        {actionBar && <div className="flex-shrink-0 px-3 pb-3">{actionBar}</div>}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'overflow-hidden',
        embedded
          ? 'flex h-full min-h-0 flex-col'
          : 'my-2 rounded-lg border border-zGray-800 bg-zGray-900/40',
      )}
    >
      {header}

      {/* card-resize: collapse the body to/from auto height. Always mounted so
          the grid-rows tween has something to animate. The action bar stays
          outside so a folded plan can still be approved. */}
      {foldable ? (
        <>
          <div className="t-collapse" data-open={bodyOpen} inert={!bodyOpen}>
            <div className="t-collapse-inner">{body}</div>
          </div>
          {actionBar}
        </>
      ) : embedded ? (
        <>
          <div className="t-scroll-fade min-h-0 flex-1 overflow-auto scrollbar-thin">{body}</div>
          {actionBar}
        </>
      ) : (
        <>
          {body}
          {actionBar}
        </>
      )}
    </div>
  )
})

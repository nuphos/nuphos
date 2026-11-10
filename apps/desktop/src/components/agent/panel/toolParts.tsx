import { Chart } from '../Chart'
import { tryParseChartPayload } from '../chartPayload'
import { tryParsePlanPayload } from '../planPayload'
import { extractPersistedPlanId } from '../planReference'
import { PlanCard, PlanTool } from '../PlanTool'

import { LoadingText, ToolElapsedBadge } from './partChrome'
import { getToolLabel } from './toolPartUtils'
import { ToolPartView } from './ToolPartView'

import type { ToolPart } from './parts'

export function PlanToolPart({
  part,
  now,
  teamId,
  canApprove,
  canChat,
  keepPolling,
  onChat,
  onApprovePlan,
  onRejectPlan,
}: {
  part: ToolPart
  now: number
  teamId?: string
  canApprove: boolean
  canChat: boolean
  keepPolling?: boolean
  onChat?: () => void
  onApprovePlan?: (planId: string) => void
  onRejectPlan?: (planId: string, reason: string, mode: 'revise' | 'delete') => void
}) {
  const label = getToolLabel(part)
  const errored = part.state === 'output-error'
  const done = part.state === 'output-available' || part.state === 'output-error'

  if (errored) {
    return <ToolPartView part={part} now={now} />
  }

  // Legacy `plan` tool calls (pre-migration conversations) embedded the full
  // payload in input/output and have no DB row. Render them statically — no
  // live status, no actions.
  if (part.toolName === 'plan') {
    const payload = tryParsePlanPayload(part.output) ?? tryParsePlanPayload(part.input)

    if (!payload) {
      if (done) return <ToolPartView part={part} now={now} />

      return (
        <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[12.5px] text-tertiary">
          <LoadingText className="min-w-0 truncate text-left">{label}</LoadingText>
          <ToolElapsedBadge part={part} now={now} />
        </div>
      )
    }

    return <PlanTool payload={payload} canApprove={false} canChat={false} foldable />
  }

  // Persisted Plan-producing tools return either a top-level planId or a typed
  // `{ plan: { id } }` envelope. Everything rendered (title, steps,
  // per-command status, lifecycle) is fetched live from the Plan API.
  const planId = extractPersistedPlanId(part.output)

  if (!planId) {
    return (
      <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[12.5px] text-tertiary">
        <LoadingText className="min-w-0 truncate text-left">{label}</LoadingText>
        <ToolElapsedBadge part={part} now={now} />
      </div>
    )
  }

  return (
    <PlanCard
      planId={planId}
      teamId={teamId}
      canApprove={canApprove}
      canChat={canChat}
      keepPolling={keepPolling}
      onChat={onChat}
      onApprove={onApprovePlan ? () => onApprovePlan(planId) : undefined}
      onReject={onRejectPlan ? (reason, mode) => onRejectPlan(planId, reason, mode) : undefined}
      foldable
      fallback={
        <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[12.5px] text-tertiary">
          <LoadingText className="min-w-0 truncate text-left">{label}</LoadingText>
          <ToolElapsedBadge part={part} now={now} />
        </div>
      }
    />
  )
}

export type ActivePlanCanAct = {
  toolCallId: string
  canApprove: boolean
  canChat: boolean
  keepPolling: boolean
}

export function AssistantPlanPart({
  part,
  now,
  teamId,
  streaming,
  canActOnPlans,
  activePlanCanAct,
  onStop,
  onApprovePlan,
  onRejectPlan,
}: {
  part: ToolPart
  now: number
  teamId?: string
  streaming: boolean
  canActOnPlans: boolean
  activePlanCanAct?: ActivePlanCanAct | null
  onStop?: () => void
  onApprovePlan?: (planId: string) => void
  onRejectPlan?: (planId: string, reason: string, mode: 'revise' | 'delete') => void
}) {
  const active = activePlanCanAct?.toolCallId === part.toolCallId ? activePlanCanAct : null

  // The latest plan uses the live active-plan gate; any other plan in the
  // transcript stays approvable purely on its own status (PlanCard only shows
  // Approve while `proposed`) when the tab is idle — so continuing an OLDER
  // plan surfaces that plan's button, not the last one's.
  return (
    <PlanToolPart
      part={part}
      now={now}
      teamId={teamId}
      canApprove={active ? active.canApprove : canActOnPlans}
      canChat={active ? active.canChat : false}
      keepPolling={active ? active.keepPolling : streaming}
      onChat={onStop}
      onApprovePlan={onApprovePlan}
      onRejectPlan={onRejectPlan}
    />
  )
}

export function ChartToolPart({ part, now }: { part: ToolPart; now: number }) {
  // The tool's execute() echoes the validated input, so either side carries the
  // payload. Prefer output (post-validation) but fall back to input so a chart
  // can render mid-stream before the tool result lands.
  const payload = tryParseChartPayload(part.output) ?? tryParseChartPayload(part.input)
  const label = getToolLabel(part)
  const errored = part.state === 'output-error'
  const done = part.state === 'output-available' || part.state === 'output-error'

  if (errored) {
    return <ToolPartView part={part} now={now} />
  }

  if (!payload) {
    // Payload unparseable after completion: fall back to the standard tool
    // view so the raw input/output is inspectable for debugging.
    if (done) return <ToolPartView part={part} now={now} />

    return (
      <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[12.5px] text-tertiary">
        <LoadingText className="min-w-0 truncate text-left">{label}</LoadingText>
        <ToolElapsedBadge part={part} now={now} />
      </div>
    )
  }

  return <Chart payload={payload} />
}

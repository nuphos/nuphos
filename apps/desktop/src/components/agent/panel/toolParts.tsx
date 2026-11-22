import { artifactPagePath } from '../../../lib/sessionArtifacts'
import { useArtifactCall } from '../artifacts/useSessionArtifacts'
import { Chart } from '../Chart'
import { tryParseChartPayload } from '../chartPayload'
import { tryParsePlanPayload } from '../planPayload'
import { extractPersistedPlanId } from '../planReference'
import { PlanCard, PlanTool } from '../PlanTool'

import { LoadingText, ToolElapsedBadge } from './partChrome'
import { getToolLabel } from './toolPartUtils'
import { ToolPartView } from './ToolPartView'

import type { OpenLink } from './LocalUrlChip'
import type { ToolPart } from './parts'

export function PlanToolPart({
  part,
  now,
  teamId,
  keepPolling,
}: {
  part: ToolPart
  now: number
  teamId?: string
  keepPolling?: boolean
}) {
  const label = getToolLabel(part)
  const errored = part.state === 'output-error'
  const done = part.state === 'output-available' || part.state === 'output-error'

  if (errored) {
    return <ToolPartView part={part} now={now} />
  }

  // Legacy `plan` tool calls (pre-migration conversations) embedded the full
  // payload in input/output and have no DB row. Render them statically — no
  // live status.
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

    return <PlanTool payload={payload} foldable />
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
      keepPolling={keepPolling}
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
  keepPolling: boolean
}

export function AssistantPlanPart({
  part,
  now,
  teamId,
  streaming,
  activePlanCanAct,
}: {
  part: ToolPart
  now: number
  teamId?: string
  streaming: boolean
  activePlanCanAct?: ActivePlanCanAct | null
}) {
  const active = activePlanCanAct?.toolCallId === part.toolCallId ? activePlanCanAct : null

  // The latest plan polls while its tab streams; any other plan polls while
  // this message streams.
  return (
    <PlanToolPart
      part={part}
      now={now}
      teamId={teamId}
      keepPolling={active ? active.keepPolling : streaming}
    />
  )
}

export function ChartToolPart({
  part,
  now,
  teamId,
  onOpen,
}: {
  part: ToolPart
  now: number
  teamId: string | undefined
  onOpen: OpenLink | undefined
}) {
  // The chat collects each chart as an artifact, so it opens in the artifact's dock tab.
  const call = useArtifactCall(part.toolCallId)
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

  return (
    <Chart
      payload={payload}
      onOpen={
        teamId && onOpen && call
          ? () => onOpen(artifactPagePath(teamId, call.artifactId), false)
          : undefined
      }
    />
  )
}

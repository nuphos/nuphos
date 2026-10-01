import { AlertTriangle, Loader2 } from 'lucide-react'

import { useReportVisibleError } from '../../VisibleErrorReporter'

import { PlanRevealSection } from './reveal'

import type { PlanPayload } from '../planPayload'

export function PlanBuildingView({ payload }: { payload: PlanPayload }) {
  const nextSection = !payload.decisions
    ? 'decisions'
    : payload.steps.length === 0
      ? 'steps'
      : !payload.cost
        ? 'cost'
        : 'risk'

  return (
    <PlanRevealSection
      revealKey={`building-${nextSection}`}
      className="border-b border-zGray-800/70 bg-zGray-900/20 px-3.5 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <Loader2
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-zViolet-accent"
          strokeWidth={2.4}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium leading-relaxed text-main">Building plan</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-tertiary">
            Waiting for {nextSection}.
          </div>
        </div>
      </div>
    </PlanRevealSection>
  )
}

export function PlanExecutionPreparingView() {
  return (
    <PlanRevealSection
      revealKey="execution-preparing"
      className="border-b border-zGray-800/70 bg-zViolet-500/10 px-3.5 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <Loader2
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-zViolet-accent"
          strokeWidth={2.4}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium leading-relaxed text-main">
            Preparing plan execution
          </div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-secondary">
            The agent is starting the first command.
          </div>
        </div>
      </div>
    </PlanRevealSection>
  )
}

export function PlanExecutionErrorView({ message }: { message: string }) {
  useReportVisibleError(message, 'agent_plan_execution_error')

  return (
    <PlanRevealSection
      revealKey={`execution-error-${message}`}
      className="border-b border-error/25 bg-error/5 px-3.5 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-error" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium leading-relaxed text-main">
            Execution failed
          </div>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-secondary scrollbar-thin">
            {message}
          </pre>
        </div>
      </div>
    </PlanRevealSection>
  )
}

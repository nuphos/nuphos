import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2, Terminal, X } from 'lucide-react'
import { useState } from 'react'

import { resolveStepStatuses, rollupPlanStatus } from '../../../lib/planStepStatus'

import { PlanCommandView, StatusIcon } from './PlanCommandView'
import { PlanRevealItem } from './reveal'

import type { CommandStatus } from './planData'
import type { PlanStepStatus } from '../../../lib/planStepStatus'
import type { PlanJob, PlanStep } from '../planPayload'

export function PlanStepsList({
  steps,
  progress,
  floating,
}: {
  steps: PlanStep[]
  progress?: CommandStatus[]
  floating?: boolean
}) {
  return (
    <ol className="divide-y divide-zGray-800/60">
      {(() => {
        // Walk the steps and pass each its slice of `progress` so the
        // command-level icons land on the right rows. Statuses are resolved
        // across the whole plan, not per step, so at most one can be active.
        const slices: (CommandStatus[] | undefined)[] = []
        let cursor = 0

        for (const step of steps) {
          const count = step.jobs.reduce((sum, job) => sum + (job.commands?.length ?? 0), 0)

          slices.push(progress ? progress.slice(cursor, cursor + count) : undefined)
          cursor += count
        }
        const statuses = resolveStepStatuses(slices)

        return steps.map((step, i) => (
          <PlanStepView
            key={i}
            index={i + 1}
            step={step}
            progress={slices[i]}
            status={statuses[i]}
            floating={floating}
          />
        ))
      })()}
    </ol>
  )
}

function PlanStepView({
  index,
  step,
  progress,
  status,
  floating,
}: {
  index: number
  step: PlanStep
  progress?: CommandStatus[]
  status: PlanStepStatus | null
  floating?: boolean
}) {
  const hasJobs = step.jobs.length > 0
  // Auto-expand while the step is running (or failed, so the error stays
  // visible) and auto-collapse otherwise, letting the user follow the current
  // step without manual toggling. `partial` deliberately stays collapsed —
  // expanding every half-finished step is what made the plan look like it was
  // running everywhere at once. A manual click takes over via `override`.
  // Steps without jobs stay open so their description shows.
  const [override, setOverride] = useState<boolean | null>(null)
  const open = hasJobs ? (override ?? (status === 'running' || status === 'failed')) : true

  return (
    <PlanRevealItem
      revealKey={`step-${String(index)}-${step.title}`}
      className={floating ? 'px-4 py-3' : 'px-3.5 py-2.5'}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={clsx(
            'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-medium',
            status === 'done' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
            status === 'failed' && 'border-error/40 bg-error/10 text-error',
            status === 'running' && 'border-zViolet-500/50 bg-zViolet-500/15 text-zViolet-accent',
            // Started but idle: tinted like the running state so the step still
            // reads as underway, without the spinner that claims it is active.
            status === 'partial' &&
              'border-zViolet-500/30 bg-zViolet-500/10 text-zViolet-accent/80',
            (status === 'pending' || status === null) &&
              'border-zGray-700 bg-zGray-900 text-secondary',
          )}
        >
          {status === 'done' ? (
            <Check className="h-3 w-3" strokeWidth={3} />
          ) : status === 'failed' ? (
            <X className="h-3 w-3" strokeWidth={3} />
          ) : status === 'running' ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
          ) : (
            index
          )}
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => hasJobs && setOverride((v) => (v === null ? !open : !v))}
            disabled={!hasJobs}
            aria-expanded={hasJobs ? open : undefined}
            className={clsx(
              'flex w-full items-start gap-2 text-left',
              hasJobs ? '' : 'cursor-default',
            )}
          >
            <div className="min-w-0 flex-1 text-[13.5px] font-medium leading-relaxed text-main">
              {step.title}
            </div>
            {hasJobs && (
              <span
                className="t-icon-swap mt-0.5 flex-shrink-0 text-tertiary"
                data-state={open ? 'a' : 'b'}
              >
                <span className="t-icon" data-icon="a">
                  <ChevronDown className="h-3 w-3" strokeWidth={2} />
                </span>
                <span className="t-icon" data-icon="b">
                  <ChevronRight className="h-3 w-3" strokeWidth={2} />
                </span>
              </span>
            )}
          </button>
          <div className="t-collapse" data-open={open}>
            <div className="t-collapse-inner">
              {step.description && (
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-tertiary">
                  {step.description}
                </div>
              )}
              <ul className="mt-2 space-y-1.5">
                {(() => {
                  const jobProgress: (CommandStatus[] | undefined)[] = []
                  let cursor = 0

                  for (const job of step.jobs) {
                    const jobCommandCount = job.commands?.length ?? 0

                    jobProgress.push(
                      progress ? progress.slice(cursor, cursor + jobCommandCount) : undefined,
                    )
                    cursor += jobCommandCount
                  }

                  return step.jobs.map((job, j) => (
                    <PlanJobView key={j} job={job} progress={jobProgress[j]} />
                  ))
                })()}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </PlanRevealItem>
  )
}

function PlanJobView({ job, progress }: { job: PlanJob; progress?: CommandStatus[] }) {
  const hasCommands = (job.commands?.length ?? 0) > 0
  const status = rollupPlanStatus(progress)
  const hasOutput = Boolean(
    job.commands?.some(
      (command) =>
        command.stdout ||
        command.stderr ||
        typeof command.exitCode === 'number' ||
        command.executedBy,
    ),
  )
  // Auto-expand running jobs and jobs with output so execution progress stays visible.
  // The user can still collapse manually.
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? (status === 'running' || hasOutput)
  const doneCount = progress ? progress.filter((s) => s === 'done' || s === 'failed').length : 0
  const totalCommands = job.commands?.length ?? 0

  return (
    <li className="rounded-md border border-zGray-800/70 bg-zGray-950/40">
      <button
        type="button"
        onClick={() => hasCommands && setOverride((v) => (v === null ? !open : !v))}
        disabled={!hasCommands}
        className={clsx(
          'flex w-full items-start gap-2 px-2.5 py-1.5 text-left',
          hasCommands && 'hover:bg-zGray-800/40',
          !hasCommands && 'cursor-default',
        )}
      >
        {hasCommands ? (
          <span
            className="t-icon-swap mt-1 flex-shrink-0 text-tertiary"
            data-state={open ? 'a' : 'b'}
          >
            <span className="t-icon" data-icon="a">
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </span>
            <span className="t-icon" data-icon="b">
              <ChevronRight className="h-3 w-3" strokeWidth={2} />
            </span>
          </span>
        ) : (
          <span className="mt-1 inline-block h-3 w-3 flex-shrink-0" />
        )}
        <span className="mt-0.5 flex-shrink-0">
          <StatusIcon status={status} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={clsx(
              'text-[13px] leading-relaxed',
              status === 'done' ? 'text-secondary line-through decoration-zGray-600' : 'text-main',
              status === 'failed' && 'text-main',
            )}
          >
            {job.title}
          </div>
          {job.description && (
            <div className="mt-0.5 text-[12px] leading-relaxed text-tertiary">
              {job.description}
            </div>
          )}
        </div>
        {hasCommands && (
          <span className="ml-2 mt-0.5 inline-flex items-center gap-1 rounded-md bg-zGray-800/60 px-1.5 py-0.5 text-[11px] text-tertiary">
            <Terminal className="h-2.5 w-2.5" strokeWidth={2} />
            {progress ? `${String(doneCount)}/${String(totalCommands)}` : totalCommands}
          </span>
        )}
      </button>
      {hasCommands && (
        <div className="t-collapse" data-open={open}>
          <div className="t-collapse-inner">
            <div className="border-t border-zGray-800/60 px-2.5 py-2 space-y-1.5">
              {job.commands!.map((cmd, i) => (
                <PlanCommandView key={i} command={cmd} status={progress?.[i]} />
              ))}
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

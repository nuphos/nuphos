import clsx from 'clsx'
import { Check, Circle, CircleDashed, CircleDot, Loader2, X } from 'lucide-react'

import { t } from '../../../i18n'
import { useReportVisibleError } from '../../VisibleErrorReporter'

import type { CommandStatus } from './planData'
import type { PlanStepStatus } from '../../../lib/planStepStatus'
import type { PlanCommand } from '../planPayload'

export function StatusIcon({ status }: { status: PlanStepStatus | null }) {
  if (status === 'done') {
    return (
      <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-status-success/15 text-status-success">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'running') {
    return (
      <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" strokeWidth={2.4} />
    )
  }
  if (status === 'partial') {
    return <CircleDot className="h-3.5 w-3.5 flex-shrink-0 text-primary" strokeWidth={1.8} />
  }
  if (status === 'pending') {
    return <CircleDashed className="h-3.5 w-3.5 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
  }

  return <Circle className="h-3.5 w-3.5 flex-shrink-0 text-tertiary/40" strokeWidth={1.8} />
}

export function PlanCommandView({
  command,
  status,
}: {
  command: PlanCommand
  status?: CommandStatus
}) {
  const hasOutput =
    command.stdout || command.stderr || typeof command.exitCode === 'number' || command.executedBy

  useReportVisibleError(
    status === 'failed'
      ? command.stderr ||
          `Plan command failed with exit code ${String(command.exitCode ?? 'unknown')}`
      : null,
    'agent_plan_command_failed',
  )

  return (
    <div
      className={clsx(
        'rounded ring-1 px-2 py-1.5 font-mono text-[12.5px] leading-relaxed transition-colors',
        status === 'done'
          ? 'bg-status-success/[0.04] ring-status-success/20'
          : status === 'failed'
            ? 'bg-error/[0.05] ring-error/30'
            : status === 'running'
              ? 'bg-action-primary/[0.05] ring-line-focus'
              : 'bg-state-selected ring-line-control/60',
      )}
    >
      <div className="flex items-start gap-1.5">
        {status ? (
          <span className="mt-0.5">
            <StatusIcon status={status} />
          </span>
        ) : (
          <span className="select-none text-status-success">$</span>
        )}
        <span
          className={clsx(
            'min-w-0 flex-1 whitespace-pre-wrap break-all',
            status === 'done' ? 'text-secondary' : 'text-main',
          )}
        >
          {command.command}
        </span>
      </div>
      {command.description && (
        <div className="mt-1 pl-3 font-sans text-[11.5px] leading-relaxed text-tertiary">
          {command.description}
        </div>
      )}
      {hasOutput && (
        <div className="mt-2 space-y-1 border-t border-line-control/70 pt-2">
          <div className="flex items-center gap-2 pl-3 font-sans text-[11px] leading-relaxed text-tertiary">
            {command.executedBy && (
              <span>{t('Executed by {name}', { name: command.executedBy })}</span>
            )}
            {typeof command.exitCode === 'number' && (
              <span>{t('Exit {code}', { code: command.exitCode })}</span>
            )}
          </div>
          {command.stdout && (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-canvas px-2 py-1.5 text-[11.5px] leading-relaxed text-secondary scrollbar-thin">
              {command.stdout}
            </pre>
          )}
          {command.stderr && (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-error/10 px-2 py-1.5 text-[11.5px] leading-relaxed text-error scrollbar-thin">
              {command.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

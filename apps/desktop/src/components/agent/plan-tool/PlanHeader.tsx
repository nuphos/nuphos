import clsx from 'clsx'
import { ChevronDown, ChevronRight, ClipboardList } from 'lucide-react'

import { t } from '../../../i18n'

import { PlanStatusBadge } from './PlanStatusBadge'

import type { PlanLifecycleStatus } from '../../../api'
import type { PlanPayload } from '../planPayload'

type PlanHeaderProps = {
  payload: PlanPayload
  status?: PlanLifecycleStatus
  totalJobs: number
  totalCommands: number
  floating: boolean
  foldable: boolean
  folded: boolean
  onToggleFold: () => void
  headerAction?: React.ReactNode
}

// Shared header content. In floating mode the plan icon rides inline at the
// left of the title (matching Decisions / Cost / Risk), with the #/status/
// counts as a small eyebrow above and the overview below. The header action
// and fold toggle sit at the end of the eyebrow row, so the title and
// overview keep the full width.
export function PlanHeader({
  payload,
  status,
  totalJobs,
  totalCommands,
  floating,
  foldable,
  folded,
  onToggleFold,
  headerAction,
}: PlanHeaderProps) {
  const foldButton =
    !floating && foldable ? (
      <button
        type="button"
        onClick={onToggleFold}
        className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
        title={folded ? t('Expand plan') : t('Collapse plan')}
        aria-label={folded ? t('Expand plan') : t('Collapse plan')}
        aria-expanded={!folded}
      >
        {/* icon-swap: cross-fade the expand/collapse chevrons */}
        <span className="t-icon-swap" data-state={folded ? 'b' : 'a'}>
          <span className="t-icon" data-icon="a">
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="t-icon" data-icon="b">
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        </span>
      </button>
    ) : null

  const headerInner = (
    <>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-[12px] font-medium leading-relaxed text-zViolet-accent">
          <span className="whitespace-nowrap">
            {typeof payload.number === 'number'
              ? t('Plan #{number}', { number: String(payload.number) })
              : t('Plan')}
          </span>
          {status && <PlanStatusBadge status={status} />}
          <span className="whitespace-nowrap text-tertiary">
            {payload.steps.length === 1
              ? t('1 step')
              : t('{n} steps', { n: String(payload.steps.length) })}{' '}
            · {totalJobs === 1 ? t('1 job') : t('{n} jobs', { n: String(totalJobs) })}
            {totalCommands > 0 && (
              <>
                {' '}
                ·{' '}
                {totalCommands === 1
                  ? t('1 command')
                  : t('{n} commands', { n: String(totalCommands) })}
              </>
            )}
          </span>
        </div>
        {(headerAction ?? foldButton) && (
          <div className="flex h-[22px] flex-shrink-0 items-center gap-0.5">
            {headerAction}
            {foldButton}
          </div>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        {floating && (
          <ClipboardList className="h-3.5 w-3.5 flex-shrink-0 text-secondary" strokeWidth={2} />
        )}
        <span className="text-[14px] font-semibold leading-relaxed text-main">{payload.title}</span>
      </div>
      {payload.overview && (
        <div className="mt-1 text-[13px] leading-relaxed text-secondary">{payload.overview}</div>
      )}
    </>
  )

  if (floating) {
    return <div className="px-4 py-3.5">{headerInner}</div>
  }

  return (
    <div
      className={clsx(
        'flex items-start gap-2.5 px-3.5 py-2.5',
        !folded && 'border-b border-zGray-800/70',
      )}
    >
      <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-zViolet-500/15 text-zViolet-accent">
        <ClipboardList className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">{headerInner}</div>
    </div>
  )
}

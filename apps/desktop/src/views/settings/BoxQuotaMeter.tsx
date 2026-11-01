import clsx from 'clsx'

import { t } from '../../i18n'

import { boxQuota, quotaCells } from './boxCreatePresentation'

import type { QuotaCell } from './boxCreatePresentation'
import type { BoxUsage } from '../../api/device-types'

/** Past this many vCPU the cells would be slivers, so the meter is drawn at this scale instead. */
const MAX_CELLS = 32

const CELL_CLASS: Record<QuotaCell, string> = {
  used: 'bg-zViolet-500',
  adding: 'bg-zViolet-500/35 ring-1 ring-inset ring-zViolet-500/60',
  over: 'bg-amber-500',
  free: 'bg-zGray-800',
}

function Legend({ cell, label }: { cell: QuotaCell; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={clsx('h-2 w-2 rounded-[2px]', CELL_CLASS[cell])} />
      {label}
    </span>
  )
}

/** The plan's vCPU at a glance: what is left, and where the Box being made would land. */
export function BoxQuotaMeter({
  usage,
  adding,
}: {
  usage: BoxUsage | null
  /** The vCPU of the size picked; undefined while sizes are unknown. */
  adding: number | undefined
}) {
  if (!usage) return <p className="text-[12.5px] text-tertiary">{t('Loading your plan…')}</p>
  const quota = boxQuota(usage)

  if (!quota)
    return (
      <p className="text-[12.5px] text-tertiary">
        {t('Your team has no vCPU limit for computers.')}
      </p>
    )
  if (quota.used === null || quota.left === null)
    return (
      <p className="text-[12.5px] text-tertiary">
        {t('Your plan runs up to {limit} vCPU of computers. Their current use could not be read.', {
          limit: quota.limit,
        })}
      </p>
    )
  const scale = quota.limit > MAX_CELLS ? MAX_CELLS / quota.limit : 1
  const cells = quotaCells(
    Math.round(quota.limit * scale),
    Math.round(quota.used * scale),
    adding === undefined ? 0 : Math.max(1, Math.round(adding * scale)),
  )
  const fits = adding === undefined || adding <= quota.left

  return (
    <div className="rounded-xl border border-zGray-800 bg-gradient-to-br from-zViolet-500/10 via-transparent to-transparent px-4 py-3.5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-tertiary">
            {t('Plan capacity')}
          </span>
          <span className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[26px] font-semibold leading-none tabular-nums text-main">
              {quota.left}
            </span>
            <span className="text-[13px] text-secondary">{t('vCPU left')}</span>
          </span>
        </div>
        <div className="text-right text-[12px] leading-5 tabular-nums text-tertiary">
          <span className="block">
            {t('{used} of {limit} vCPU in use', { used: quota.used, limit: quota.limit })}
          </span>
          {adding !== undefined &&
            (fits ? (
              <span className="block">
                {t('{n} left after the new computer', { n: quota.left - adding })}
              </span>
            ) : (
              <span className="block font-medium text-amber-500">
                {t('{n} vCPU over your plan', { n: adding - quota.left })}
              </span>
            ))}
        </div>
      </div>
      <div
        className="mt-3 flex gap-[3px]"
        role="meter"
        aria-label={t('vCPU in use')}
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={Math.min(quota.used, quota.limit)}
      >
        {cells.map((cell, index) => (
          <span
            // Cells are positional: the index is their identity.
            key={index}
            className={clsx('h-2 flex-1 rounded-[2px] transition-colors', CELL_CLASS[cell])}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-tertiary">
        <Legend cell="used" label={t('Running computers')} />
        {adding !== undefined && (
          <Legend cell={fits ? 'adding' : 'over'} label={t('New computer')} />
        )}
        <Legend cell="free" label={t('Free')} />
      </div>
    </div>
  )
}

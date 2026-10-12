import { quotaLeftPercent, quotaWindowTone } from '../../lib/runtimeQuota'

import { QUOTA_FILL_CLASS, QUOTA_LABEL_CLASS } from './runtimePresentation'

import type { RuntimeQuotaWindow } from '../../types/runtime'

/** Drains like a battery: full when nothing is spent, empty when the window is used up. */
export function RuntimeUsageBar({ window }: { window: RuntimeQuotaWindow }) {
  const left = quotaLeftPercent(window)
  const tone = quotaWindowTone(window)

  return (
    <span
      className="inline-flex min-w-24 items-center gap-2"
      title={`${window.label}: ${String(left)}% left`}
    >
      <span
        role="progressbar"
        aria-label={`${window.label} remaining`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={left}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-zGray-800"
      >
        <span
          className={`block h-full rounded-full ${QUOTA_FILL_CLASS[tone]}`}
          style={{ width: `${String(left)}%` }}
        />
      </span>
      <span className={`text-[11px] ${QUOTA_LABEL_CLASS[tone] || 'text-tertiary'}`}>
        {left}% left
      </span>
    </span>
  )
}

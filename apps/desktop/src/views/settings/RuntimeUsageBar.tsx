import { quotaLeftPercent } from '../../lib/runtimeQuota'

import type { RuntimeQuotaWindow } from '../../types/runtime'

/** Drains like a battery: full when nothing is spent, empty when the window is used up. */
export function RuntimeUsageBar({ window }: { window: RuntimeQuotaWindow }) {
  const left = quotaLeftPercent(window)

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
          className="block h-full rounded-full bg-zViolet-500"
          style={{ width: `${String(left)}%` }}
        />
      </span>
      <span className="text-[11px] text-tertiary">{left}% left</span>
    </span>
  )
}

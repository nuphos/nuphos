import type { RuntimeQuotaWindow } from '../../types/runtime'

export function RuntimeUsageBar({ window }: { window: RuntimeQuotaWindow }) {
  const used = Math.max(0, Math.min(100, window.usedPercent))

  return (
    <span
      className="inline-flex min-w-24 items-center gap-2"
      title={`${window.label}: ${String(Math.round(used))}% used`}
    >
      <span
        role="progressbar"
        aria-label={`${window.label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-zGray-800"
      >
        <span className="block h-full rounded-full bg-zViolet-500" style={{ width: `${used}%` }} />
      </span>
      <span className="text-[11px] text-tertiary">{Math.round(used)}%</span>
    </span>
  )
}

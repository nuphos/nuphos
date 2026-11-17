import clsx from 'clsx'
import {
  CircleCheck as CircleCheckIcon,
  CircleAlert as CircleAlertIcon,
  CirclePause as CirclePauseIcon,
  CircleHelp as CircleHelpIcon,
  Clock as ClockIcon,
} from 'lucide-react'

import { AppSelect } from '../../components/ui/select'
import { UiIcon } from '../../components/ui/ui-icon'

import type { MonitoringOverviewRow } from '../../types'

// Icon + color come from the normalized status; the word is the provider's
// own vocabulary (Better Stack says "up"/"down", Grafana alert rules say
// "normal"/"firing" — an alert rule firing is a condition, not an outage,
// so forcing "down" onto it would misread the row).
export function StatusBadge({
  status,
  label,
}: {
  status: MonitoringOverviewRow['status']
  label: string
}) {
  const map: Record<
    MonitoringOverviewRow['status'],
    { color: string; icon: typeof CircleCheckIcon }
  > = {
    up: { color: 'text-success', icon: CircleCheckIcon },
    down: { color: 'text-error', icon: CircleAlertIcon },
    paused: { color: 'text-tertiary', icon: CirclePauseIcon },
    pending: { color: 'text-warning', icon: ClockIcon },
    unknown: { color: 'text-tertiary', icon: CircleHelpIcon },
  }
  const m = map[status]

  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[11.5px]', m.color)}>
      <UiIcon size={14} icon={m.icon} className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}

export function FilterSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <AppSelect
      value={value}
      onValueChange={(next) => onChange(next as T)}
      options={options}
      className="w-40"
      // Sit in the toolbar's controls row, so match its ghost h-7 controls (the
      // search box, namespace picker) rather than the default bordered field —
      // `!` because the base trigger's h-9/border/bg are later utilities that
      // would otherwise win.
      triggerClassName="!h-7 !border-transparent !bg-transparent text-[12.5px] text-secondary hover:!bg-state-hover"
    />
  )
}

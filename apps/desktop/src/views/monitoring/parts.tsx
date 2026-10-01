import {
  faCircleCheck,
  faCircleExclamation,
  faCirclePause,
  faCircleQuestion,
  faClock,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

import { AppSelect } from '../../components/ui/select'

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
    { color: string; icon: typeof faCircleCheck }
  > = {
    up: { color: 'text-success', icon: faCircleCheck },
    down: { color: 'text-error', icon: faCircleExclamation },
    paused: { color: 'text-tertiary', icon: faCirclePause },
    pending: { color: 'text-warning', icon: faClock },
    unknown: { color: 'text-tertiary', icon: faCircleQuestion },
  }
  const m = map[status]

  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[11.5px]', m.color)}>
      <FontAwesomeIcon icon={m.icon} className="h-3 w-3" />
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
      triggerClassName="!h-7 !border-transparent !bg-transparent text-[12.5px] text-secondary hover:!bg-zGray-800/60"
    />
  )
}

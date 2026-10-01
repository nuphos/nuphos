import clsx from 'clsx'

import { healthClass } from '../lib/k8sHealth'
import { statusColor } from '../utils'

import type { HealthTone } from '../lib/k8sHealth'

export function StatusBadge({ status, tone }: { status: string; tone?: HealthTone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5',
        tone ? healthClass[tone] : statusColor(status),
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

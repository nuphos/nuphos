import clsx from 'clsx'

import { t } from '../../../i18n'

import type { SelectorMetrics } from './selectorBoxes'

/** Data fill, as the agents' usage meters, turning warning from 80% and error from 95%. */
function meterTone(value: number) {
  if (value >= 95) return { bar: 'bg-error', text: 'text-error' }
  if (value >= 80) return { bar: 'bg-warning', text: 'text-warning' }

  return { bar: 'bg-data-1', text: 'text-secondary' }
}

function percent(value: number) {
  return `${String(Math.round(value))}%`
}

/** CPU, memory and disk as three labelled bars. */
export function SelectorBoxMeters({
  metrics,
  diskHint,
}: {
  metrics: SelectorMetrics
  /** Said on the disk meter once the disk is almost full (see `diskMeterHint`). */
  diskHint?: string | null
}) {
  const meters = [
    ['CPU', metrics.cpu],
    ['MEM', metrics.memory],
    ['DISK', metrics.disk],
  ] as const

  return (
    <span className="mt-2 grid grid-cols-3 gap-3">
      {meters.map(([label, value]) => (
        <span
          key={label}
          title={label === 'DISK' ? (diskHint ?? undefined) : undefined}
          role="meter"
          aria-label={t('{label} usage', { label })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={t('{percent} used', { percent: percent(value) })}
        >
          <span className="flex justify-between gap-1 text-[10px] text-tertiary">
            <span>{label}</span>
            <span className={clsx('text-[11px] tabular-nums', meterTone(value).text)}>
              {percent(value)}
            </span>
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-surface-sunken">
            <span
              className={clsx('block h-full rounded-full', meterTone(value).bar)}
              style={{ width: percent(value) }}
            />
          </span>
        </span>
      ))}
    </span>
  )
}

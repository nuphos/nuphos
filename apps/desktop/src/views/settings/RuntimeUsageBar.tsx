import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import {
  mostConstrainedWindow,
  quotaDetailLines,
  quotaLeftPercent,
  quotaSummary,
  quotaWindowTone,
} from '../../lib/runtimeQuota'

import { QUOTA_FILL_CLASS } from './runtimePresentation'

import type { RuntimeQuota } from '../../types/runtime'

/** Drains like a battery: full when nothing is spent, empty when the tightest
 *  window is used up. The exact figures and reset times sit in the tooltip. */
export function RuntimeUsageBar({ quota }: { quota?: RuntimeQuota }) {
  const window = mostConstrainedWindow(quota)

  if (!window) return null
  const left = quotaLeftPercent(window)
  const tone = quotaWindowTone(window)

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          {quotaDetailLines(quota).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <span
        role="progressbar"
        aria-label={t('Usage remaining')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={left}
        aria-valuetext={quotaSummary(quota) ?? undefined}
        // A spent window has no fill left to colour, so its track carries the red.
        className={`h-1.5 w-10 shrink-0 overflow-hidden rounded-full ${tone === 'exhausted' ? 'bg-status-danger/30' : 'bg-surface-sunken'}`}
      >
        <span
          className={`block h-full rounded-full ${QUOTA_FILL_CLASS[tone]}`}
          style={{ width: `${String(left)}%` }}
        />
      </span>
    </Tooltip>
  )
}

/** The composer's runtime line: silent while there is room, words once a window runs low. */
export function RuntimeUsageNote({ quota }: { quota?: RuntimeQuota }) {
  const window = mostConstrainedWindow(quota)

  if (!window) return null
  const tone = quotaWindowTone(window)

  if (tone === 'ok') return null

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          {quotaDetailLines(quota).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <span
        className={`shrink-0 ${tone === 'exhausted' ? 'text-status-danger' : 'text-status-warning'}`}
      >
        ·{' '}
        {tone === 'exhausted'
          ? t('At limit')
          : t('{percent}% left', { percent: quotaLeftPercent(window) })}
      </span>
    </Tooltip>
  )
}

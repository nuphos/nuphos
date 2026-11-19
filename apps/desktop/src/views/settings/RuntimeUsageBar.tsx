import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import {
  formatResetsIn,
  mostConstrainedWindow,
  quotaDetailLines,
  quotaLeftPercent,
  quotaSummary,
  quotaWindowTone,
} from '../../lib/runtimeQuota'

import { QUOTA_FILL_CLASS } from './runtimePresentation'

import type { RuntimeQuota } from '../../types/runtime'

/** Drains like a battery: full when nothing is spent, empty when the tightest
 *  window is used up. When that window resets sits on its right; every
 *  window's figures sit in the tooltip. */
export function RuntimeUsageBar({ quota }: { quota?: RuntimeQuota }) {
  const window = mostConstrainedWindow(quota)

  if (!window) return null
  const left = quotaLeftPercent(window)
  const tone = quotaWindowTone(window)
  const reset = formatResetsIn(window.resetsAt)

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
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          role="progressbar"
          aria-label={t('Usage remaining')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={left}
          aria-valuetext={quotaSummary(quota) ?? undefined}
          // A spent window has no fill left to colour, so its track carries the red.
          className={`h-1.5 w-10 shrink-0 overflow-hidden rounded-full ${tone === 'exhausted' ? 'bg-error/30' : 'bg-surface-sunken'}`}
        >
          <span
            className={`block h-full rounded-full ${QUOTA_FILL_CLASS[tone]}`}
            style={{ width: `${String(left)}%` }}
          />
        </span>
        {reset && (
          <span className="whitespace-nowrap text-[11px] tabular-nums text-tertiary">{reset}</span>
        )}
      </span>
    </Tooltip>
  )
}

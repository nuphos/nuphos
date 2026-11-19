import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import {
  formatResetsDuration,
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
 *  window's figures sit in the tooltip. In the composer chip (`chip`) the
 *  reset is the bare duration, and it is the first thing to go when the
 *  composer narrows, before the model chip drops its effort. Outside a
 *  container, as in the fallback pickers, it always shows. */
export function RuntimeUsageBar({ quota, chip = false }: { quota?: RuntimeQuota; chip?: boolean }) {
  const window = mostConstrainedWindow(quota)

  if (!window) return null
  const left = quotaLeftPercent(window)
  const tone = quotaWindowTone(window)
  const reset = formatResetsIn(window.resetsAt)
  const duration = formatResetsDuration(window.resetsAt)

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
          aria-valuetext={[quotaSummary(quota), reset].filter(Boolean).join(' · ') || undefined}
          // A spent window has no fill left to colour, so its track carries the red.
          className={`h-1.5 w-10 shrink-0 overflow-hidden rounded-full ${tone === 'exhausted' ? 'bg-error/30' : 'bg-surface-sunken'}`}
        >
          <span
            className={`block h-full rounded-full ${QUOTA_FILL_CLASS[tone]}`}
            style={{ width: `${String(left)}%` }}
          />
        </span>
        {chip ? (
          duration && (
            <span
              aria-hidden
              className="whitespace-nowrap text-xs tabular-nums text-tertiary @[0px]:hidden @[520px]:inline"
            >
              {duration}
            </span>
          )
        ) : (
          <ResetsIn resetsAt={window.resetsAt} />
        )}
      </span>
    </Tooltip>
  )
}

/** The widest a reset reads, under a day and past one. */
const WIDEST_MINUTES = [23 * 60 + 59, 29 * 1440 + 23 * 60]

/** When a usage window resets, as it sits on the right of every usage bar. */
export function ResetsIn({ resetsAt }: { resetsAt: string | null | undefined }) {
  const reset = formatResetsIn(resetsAt)
  // Every reset takes the room of the widest, so bars stacked above one another
  // end at the same x and the text never moves a bar as it ticks.
  const widest = WIDEST_MINUTES.map((minutes) =>
    formatResetsIn(new Date(minutes * 60_000).toISOString(), new Date(0)),
  )

  return reset ? (
    <span className="grid shrink-0 justify-items-end whitespace-nowrap text-xs tabular-nums text-tertiary">
      {widest.map((text) => (
        <span key={text} aria-hidden className="invisible [grid-area:1/1]">
          {text}
        </span>
      ))}
      <span className="[grid-area:1/1]">{reset}</span>
    </span>
  ) : null
}

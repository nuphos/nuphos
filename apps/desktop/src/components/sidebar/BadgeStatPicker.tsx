import clsx from 'clsx'

import { BADGE_STAT_INFO, BADGE_STATS } from '../../lib/badgeStat'

import type { BadgeStat } from '../../types'

/** "Show" row: which one stat the badge and ring carry. */
export function BadgeStatPicker({
  value,
  failed,
  onPick,
}: {
  value: BadgeStat
  failed: boolean
  onPick: (stat: BadgeStat) => void
}) {
  return (
    <div className="mb-3.5 grid grid-cols-[52px_1fr] items-start gap-2">
      <span className="pt-1 text-[12px] text-tertiary">Show</span>
      <div>
        <div role="radiogroup" aria-label="Badge shows" className="flex flex-wrap gap-1">
          {BADGE_STATS.map((stat) => (
            <button
              key={stat}
              type="button"
              role="radio"
              aria-checked={stat === value}
              onClick={() => onPick(stat)}
              className={clsx(
                'rounded-md border px-2 py-0.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zViolet-accent/60',
                stat === value
                  ? 'border-zViolet-500/60 bg-zViolet-500/10 font-medium text-zViolet-accent'
                  : 'border-zGray-800 text-secondary hover:bg-zGray-800/50',
              )}
            >
              {BADGE_STAT_INFO[stat].label}
            </button>
          ))}
        </div>
        <div className="mt-1 text-[11.5px] text-tertiary">
          {failed ? (
            <span role="alert" className="text-red-400">
              Couldn't save this choice; it stays on this computer.
            </span>
          ) : (
            BADGE_STAT_INFO[value].hint
          )}
        </div>
      </div>
    </div>
  )
}

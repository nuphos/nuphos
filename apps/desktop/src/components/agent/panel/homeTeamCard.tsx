import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'

import { heatmapRows } from './teamActivity'

import type { TeamActivity, TeamActivityRange } from '../../../types/team.ts'

const REFRESH_MS = 60_000
const RANGES: { value: TeamActivityRange; label: string }[] = [
  { value: '1d', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]
// Empty, then four steps of the busiest slot, GitHub-style.
const LEVELS = [
  'bg-zGray-800/50',
  'bg-zViolet-500/25',
  'bg-zViolet-500/45',
  'bg-zViolet-500/70',
  'bg-zViolet-500',
]
const CELL_HEIGHT: Record<TeamActivityRange, string> = { '1d': 'h-4', '7d': 'h-3', '30d': 'h-2' }
const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (d: Date) =>
  d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })

/**
 * How busy the team's agents have been: a GitHub-style heatmap where each cell
 * is a slot of time, darker the more sessions ran in it. A longer range uses
 * longer slots so the grid stays a readable size.
 */
export function TeamActivityCard({ teamId }: { teamId: string }) {
  const [range, setRange] = useState<TeamActivityRange>('7d')
  // Kept with the range it answers, so switching range shows the skeleton
  // until the new range arrives instead of the old grid.
  const [loaded, setLoaded] = useState<TeamActivity | null>(null)
  const activity = loaded?.range === range ? loaded : null

  useEffect(() => {
    let alive = true
    const refresh = () =>
      void api.atlasGetTeamActivity(teamId, range).then(
        (next) => alive && setLoaded(next),
        () => {},
      )

    refresh()
    const timer = setInterval(refresh, REFRESH_MS)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [teamId, range])

  const rows = activity ? heatmapRows(activity) : null
  const columns = activity ? (24 * 60) / activity.slotMinutes : 0
  const peak = activity ? Math.max(0, ...activity.slots) : 0

  return (
    <section className="min-w-0 rounded-lg border border-zGray-800/60 p-3 home-card-wide">
      <div className="mb-3 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>Team activity</span>
        {activity && (
          <span className="text-tertiary">
            · {activity.slotMinutes < 60 ? `${String(activity.slotMinutes)} min` : '1 hour'} per
            cell
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5 rounded-md bg-zGray-800/40 p-0.5">
          {RANGES.map((r) => (
            <BaseButton
              key={r.value}
              onClick={() => setRange(r.value)}
              className={clsx(
                'rounded px-2 py-0.5 text-[11px] outline-none transition-colors',
                r.value === range ? 'bg-zGray-700 text-main' : 'text-tertiary hover:text-main',
              )}
            >
              {r.label}
            </BaseButton>
          ))}
        </div>
      </div>
      {rows ? (
        <div className="space-y-[3px]">
          {rows.map((row) => (
            <div key={row.day.toDateString()} className="flex items-center gap-2">
              <span className="w-20 flex-shrink-0 text-right text-[10.5px] text-tertiary">
                {day(row.day)}
              </span>
              <div
                className="grid flex-1 gap-[2px]"
                style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
              >
                {row.cells.map((cell, i) => (
                  <div
                    key={i}
                    title={
                      cell
                        ? `${day(cell.start)} ${time(cell.start)} · ${String(cell.count)} running`
                        : undefined
                    }
                    className={clsx(
                      'rounded-[2px]',
                      CELL_HEIGHT[range],
                      cell ? LEVELS[cell.level] : 'bg-transparent',
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1.5">
            <span className="w-20 flex-shrink-0" />
            <div className="flex flex-1 justify-between text-[10.5px] text-tertiary">
              {['00:00', '06:00', '12:00', '18:00', '24:00'].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 pt-1 text-[10.5px] text-tertiary">
            <span className="mr-auto pl-[88px]">Busiest cell: {peak} sessions</span>
            <span>Less</span>
            {LEVELS.map((cls) => (
              <span key={cls} className={clsx('h-2.5 w-2.5 rounded-[2px]', cls)} />
            ))}
            <span>More</span>
          </div>
        </div>
      ) : (
        <div className="h-32 rounded-md bg-zGray-800/40 animate-pulse" />
      )}
    </section>
  )
}

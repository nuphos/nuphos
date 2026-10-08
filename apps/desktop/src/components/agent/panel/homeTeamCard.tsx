import { Button as BaseButton } from '@base-ui/react/button'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import clsx from 'clsx'
import { Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { Avatar } from '../../Avatar'

import { AgentProviderIcon } from './icons'
import { heatmapRows } from './teamActivity'

import type { HeatCell } from './teamActivity'
import type { TeamActivity, TeamActivityRange } from '../../../types/team.ts'

const RANGES: { value: TeamActivityRange; label: string; slotMinutes: number }[] = [
  { value: '1d', label: '24h', slotMinutes: 30 },
  { value: '7d', label: '7d', slotMinutes: 120 },
  { value: '30d', label: '30d', slotMinutes: 720 },
]
// Empty, then four steps of the busiest cell, GitHub-style.
const LEVELS = [
  'bg-zGray-800/50',
  'bg-zViolet-500/25',
  'bg-zViolet-500/45',
  'bg-zViolet-500/70',
  'bg-zViolet-500',
]
const MAX_TITLES = 6
const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (d: Date) =>
  d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })
const span = (c: HeatCell) => `${day(c.start)} ${time(c.start)}–${time(c.end)}`
const slotLabel = (minutes: number) =>
  minutes < 60 ? `${String(minutes)} min` : `${String(minutes / 60)} h`

type Hover = { el: Element; name: string; cell: HeatCell }

// Long enough to move the pointer from a cell onto the tooltip to click it.
const CLOSE_DELAY_MS = 150

function CellTooltip({
  hover,
  onKeep,
  onLeave,
  onOpenSession,
}: {
  hover: Hover | null
  onKeep: () => void
  onLeave: () => void
  onOpenSession?: (sessionId: string, title: string) => void
}) {
  return (
    <TooltipPrimitive.Root open={hover !== null}>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          anchor={hover?.el}
          side="top"
          sideOffset={6}
          className="z-[1000]"
        >
          <TooltipPrimitive.Popup
            onMouseEnter={onKeep}
            onMouseLeave={onLeave}
            className="max-w-[300px] rounded-lg border border-zGray-800/60 bg-main px-1.5 py-1.5 text-[11.5px] leading-snug text-secondary shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none"
          >
            {hover && (
              <>
                <div className="px-1 text-main">{hover.name}</div>
                <div className="mb-1 px-1 text-tertiary">{span(hover.cell)}</div>
                {hover.cell.sessions.length === 0 ? (
                  <div className="px-1 text-tertiary">No sessions running</div>
                ) : (
                  <div className="space-y-px">
                    {hover.cell.sessions.slice(0, MAX_TITLES).map((s) => (
                      <BaseButton
                        key={s.id}
                        onClick={() => onOpenSession?.(s.id, s.title)}
                        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-zGray-800/60 hover:text-main focus-visible:bg-zGray-800/60"
                      >
                        <AgentProviderIcon provider={s.runtime} className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{s.title || 'Untitled session'}</span>
                      </BaseButton>
                    ))}
                    {hover.cell.sessions.length > MAX_TITLES && (
                      <div className="px-1 text-tertiary">
                        and {hover.cell.sessions.length - MAX_TITLES} more
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/**
 * Who on the team has been running agents, and when: a row per member across
 * the whole range, each cell one slot, darker the more of their sessions ran
 * in it. Hovering a cell names the sessions. A longer range uses longer slots
 * so a row stays readable.
 */
export function TeamActivityCard({
  teamId,
  onOpenConversation,
}: {
  teamId: string
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const [range, setRange] = useState<TeamActivityRange>('7d')
  // Kept with the range it answers, so switching range shows the skeleton
  // until the new range arrives instead of the old grid.
  const [loaded, setLoaded] = useState<TeamActivity | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const closeTimer = useRef<number | null>(null)
  const keep = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const leave = () => {
    keep()
    closeTimer.current = window.setTimeout(() => setHover(null), CLOSE_DELAY_MS)
  }
  const activity = loaded?.range === range ? loaded : null
  const slotMinutes = RANGES.find((r) => r.value === range)?.slotMinutes ?? 60

  useEffect(() => {
    let alive = true
    const refresh = () =>
      void api.atlasGetTeamActivity(teamId, range).then(
        (next) => alive && setLoaded(next),
        () => {},
      )

    refresh()
    // The server's answer only moves a slot at a time; asking sooner gains nothing.
    const timer = setInterval(refresh, slotMinutes * 60_000)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [teamId, range, slotMinutes])

  const rows = activity ? heatmapRows(activity) : null
  const first = rows?.[0]?.cells
  const ticks = first
    ? [0, 0.25, 0.5, 0.75, 1].map(
        (f) => first[Math.min(first.length - 1, Math.round(f * (first.length - 1)))],
      )
    : []

  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-zGray-800/60 p-3">
      <div className="home-card-drag cursor-grab active:cursor-grabbing mb-3 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>Team activity</span>
        <span className="text-tertiary">· {slotLabel(slotMinutes)} per cell</span>
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
        <div
          // Rows share the card's height, so cells grow and shrink with it.
          className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto scrollbar-thin"
          onMouseLeave={leave}
        >
          {rows.map((row) => (
            <div key={row.id} className="flex min-h-[10px] flex-1 gap-2">
              <span className="flex w-28 flex-shrink-0 items-center gap-1.5 self-center truncate text-[11.5px] text-secondary">
                <Avatar src={row.avatarURL} name={row.name} size={16} className="rounded-full" />
                <span className="truncate">{row.name}</span>
              </span>
              <div
                className="grid flex-1 gap-[2px]"
                style={{
                  gridTemplateColumns: `repeat(${String(row.cells.length)}, minmax(0, 1fr))`,
                }}
              >
                {row.cells.map((cell, i) => (
                  <div
                    key={i}
                    onMouseEnter={(e) => {
                      keep()
                      setHover({ el: e.currentTarget, name: row.name, cell })
                    }}
                    className={clsx('rounded-[2px]', LEVELS[cell.level])}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-none items-center gap-2 pt-1.5">
            <span className="w-28 flex-shrink-0" />
            <div className="flex flex-1 justify-between text-[10.5px] text-tertiary">
              {ticks.map((c, i) =>
                c ? <span key={i}>{range === '1d' ? time(c.start) : day(c.start)}</span> : null,
              )}
            </div>
          </div>
          <div className="flex flex-none items-center justify-end gap-1 pt-1 text-[10.5px] text-tertiary">
            <span>Less</span>
            {LEVELS.map((cls) => (
              <span key={cls} className={clsx('h-2.5 w-2.5 rounded-[2px]', cls)} />
            ))}
            <span>More</span>
          </div>
          <CellTooltip
            hover={hover}
            onKeep={keep}
            onLeave={leave}
            onOpenSession={(id, title) => {
              setHover(null)
              onOpenConversation?.(id, title)
            }}
          />
        </div>
      ) : (
        <div className="h-32 rounded-md bg-zGray-800/40 animate-pulse" />
      )}
    </section>
  )
}

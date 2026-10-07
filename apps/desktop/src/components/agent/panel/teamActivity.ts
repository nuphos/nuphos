import type { TeamActivity } from '../../../types/team.ts'

export type HeatCell = { start: Date; count: number; level: number } | null

/** One row per local calendar day, one column per slot of that day. */
export type HeatRow = { day: Date; cells: HeatCell[] }

/**
 * Lays the activity slots out like GitHub's contribution graph: a row per
 * local day, oldest first, with each slot in its time-of-day column. Slots
 * outside the range stay empty. `level` is 0 for no sessions, then 1–4 by
 * share of the busiest slot.
 */
export function heatmapRows(activity: TeamActivity): HeatRow[] {
  const slotMs = activity.slotMinutes * 60_000
  const perDay = (24 * 60) / activity.slotMinutes
  const start = new Date(activity.start).getTime()
  const peak = Math.max(1, ...activity.slots)
  const rows = new Map<string, HeatRow>()

  activity.slots.forEach((count, i) => {
    const at = new Date(start + i * slotMs)
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate())
    const key = day.toDateString()
    const row = rows.get(key) ?? { day, cells: new Array<HeatCell>(perDay).fill(null) }
    const column = Math.floor((at.getHours() * 60 + at.getMinutes()) / activity.slotMinutes)

    row.cells[column] = { start: at, count, level: count === 0 ? 0 : Math.ceil((count / peak) * 4) }
    rows.set(key, row)
  })

  return [...rows.values()]
}

import type { TeamActivity } from '../../../types/team.ts'

export type HeatCell = {
  start: Date
  end: Date
  sessions: { id: string; title: string }[]
  /** 0 for no sessions, then 1–4 by share of the busiest cell on the card. */
  level: number
}

export type HeatRow = { id: string; name: string; avatarURL: string; cells: HeatCell[] }

/**
 * A row per member across the whole range, GitHub-style: each cell is one
 * slot, shaded by how many of that member's sessions ran in it.
 */
export function heatmapRows(activity: TeamActivity): HeatRow[] {
  const slotMs = activity.slotMinutes * 60_000
  const start = new Date(activity.start).getTime()
  const peak = Math.max(1, ...activity.members.flatMap((m) => m.slots.map((s) => s.length)))

  return activity.members.map((m) => ({
    id: m.id,
    name: m.name,
    avatarURL: m.avatarURL,
    cells: m.slots.map((indexes, i) => ({
      start: new Date(start + i * slotMs),
      end: new Date(start + (i + 1) * slotMs),
      sessions: indexes.flatMap((x) => activity.sessions[x] ?? []),
      level: indexes.length === 0 ? 0 : Math.ceil((indexes.length / peak) * 4),
    })),
  }))
}

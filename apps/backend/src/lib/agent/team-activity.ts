import { agentConversations, agentMessages } from '@/lib/agent/db'

/** Ranges the home heatmap offers; a longer range gets coarser slots. */
export const ACTIVITY_RANGES = {
  '1d': { days: 1, slotMinutes: 15 },
  '7d': { days: 7, slotMinutes: 30 },
  '30d': { days: 30, slotMinutes: 60 },
} as const

export type ActivityRange = keyof typeof ACTIVITY_RANGES

export type TeamActivity = {
  range: ActivityRange
  slotMinutes: number
  /** ISO start of the first slot; slots follow back to back. */
  start: string
  /** Sessions running at some point within each slot. */
  slots: number[]
}

type TurnMessage = { sessionId: string; role: string; createdAt: Date }

// A turn with no reply yet is still running, unless it is so old that its
// reply was lost; then it is not counted at all.
const OPEN_TURN_LIMIT_MS = 2 * 60 * 60_000

/**
 * Turns, as [start, end] times, from a session's messages in transcript order.
 * No collection records a turn's start and end, so a turn runs from when the
 * user message was saved until the last assistant message that answers it.
 */
export function turnIntervals(messages: TurnMessage[], now: Date): [number, number][] {
  const turns: [number, number][] = []
  let openedAt: number | null = null

  for (const m of messages) {
    const at = m.createdAt.getTime()

    if (m.role === 'user') {
      openedAt ??= at
    } else if (openedAt !== null) {
      turns.push([openedAt, at])
      openedAt = null
    } else {
      // A reply split across messages (a hand-off) extends the same turn.
      const last = turns.at(-1)

      if (last) last[1] = Math.max(last[1], at)
    }
  }
  if (openedAt !== null && now.getTime() - openedAt < OPEN_TURN_LIMIT_MS) {
    turns.push([openedAt, now.getTime()])
  }

  return turns
}

/** Counts, per slot, the sessions with a turn overlapping it. */
export function countSlots(
  sessions: [number, number][][],
  start: number,
  slotMs: number,
  slotCount: number,
): number[] {
  const slots = new Array<number>(slotCount).fill(0)

  for (const turns of sessions) {
    const hit = new Set<number>()

    for (const [from, to] of turns) {
      const first = Math.max(0, Math.floor((from - start) / slotMs))
      const last = Math.min(slotCount - 1, Math.floor((to - start) / slotMs))

      for (let i = first; i <= last; i++) hit.add(i)
    }
    for (const i of hit) slots[i] = (slots[i] ?? 0) + 1
  }

  return slots
}

// The answer only moves a slot at a time, so one scan per team, range and
// slot serves every viewer until the next slot starts.
const cache = new Map<string, { end: number; result: Promise<TeamActivity> }>()

// Bounds a single scan for a very busy team: the most recently active sessions.
const MAX_SESSIONS = 2000

export function getTeamActivity(
  teamId: string,
  range: ActivityRange,
  now = new Date(),
): Promise<TeamActivity> {
  const slotMs = ACTIVITY_RANGES[range].slotMinutes * 60_000
  // Slots line up on whole slot boundaries, ending with the one in progress.
  const end = Math.ceil(now.getTime() / slotMs) * slotMs
  const key = `${teamId}|${range}`
  const hit = cache.get(key)

  if (hit?.end === end) return hit.result
  const result = scanTeamActivity(teamId, range, end, now)

  cache.set(key, { end, result })
  // A failed scan is not kept; the next request tries again.
  result.catch(() => {
    if (cache.get(key)?.result === result) cache.delete(key)
  })

  return result
}

async function scanTeamActivity(
  teamId: string,
  range: ActivityRange,
  end: number,
  now: Date,
): Promise<TeamActivity> {
  const { days, slotMinutes } = ACTIVITY_RANGES[range]
  const slotMs = slotMinutes * 60_000
  const slotCount = (days * 24 * 60) / slotMinutes
  const start = end - slotCount * slotMs

  const sessionIds = await agentConversations()
    .find(
      { teamId, lastActiveAt: { $gte: new Date(start) } },
      { projection: { sessionId: 1 }, sort: { lastActiveAt: -1 }, limit: MAX_SESSIONS },
    )
    .map((c) => c.sessionId)
    .toArray()
  const messages = await agentMessages()
    .find(
      // A turn that ends in range may have started a little before it.
      { sessionId: { $in: sessionIds }, createdAt: { $gte: new Date(start - OPEN_TURN_LIMIT_MS) } },
      { projection: { sessionId: 1, role: 1, createdAt: 1 }, sort: { sessionId: 1, index: 1 } },
    )
    .toArray()

  const bySession = new Map<string, TurnMessage[]>()

  for (const m of messages) {
    const list = bySession.get(m.sessionId) ?? []

    list.push(m)
    bySession.set(m.sessionId, list)
  }

  return {
    range,
    slotMinutes,
    start: new Date(start).toISOString(),
    slots: countSlots(
      [...bySession.values()].map((list) => turnIntervals(list, now)),
      start,
      slotMs,
      slotCount,
    ),
  }
}

import { agentConversations, agentMessages } from '@/lib/agent/db'
import { getTeamMembers } from '@/lib/identity'

/**
 * Ranges the home heatmap offers. Each member's row spans the whole range, so
 * a longer range gets longer slots to keep the row a readable width.
 */
export const ACTIVITY_RANGES = {
  '1d': { days: 1, slotMinutes: 30 },
  '7d': { days: 7, slotMinutes: 120 },
  '30d': { days: 30, slotMinutes: 720 },
} as const

export type ActivityRange = keyof typeof ACTIVITY_RANGES

export type TeamActivity = {
  range: ActivityRange
  slotMinutes: number
  /** ISO start of the first slot; slots follow back to back. */
  start: string
  /** The sessions the slots refer to, with the agent each ran on. */
  sessions: { id: string; title: string; runtime: string | null }[]
  /** Every current member, busiest first. */
  members: MemberActivity[]
}

/** `slots[i]` lists, as indexes into `sessions`, the member's sessions running in slot i. */
export type MemberActivity = { id: string; name: string; avatarURL: string; slots: number[][] }

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

/** The slots, in order, that a session's turns overlap. */
export function sessionSlots(
  turns: [number, number][],
  start: number,
  slotMs: number,
  slotCount: number,
): number[] {
  const hit = new Set<number>()

  for (const [from, to] of turns) {
    const first = Math.max(0, Math.floor((from - start) / slotMs))
    const last = Math.min(slotCount - 1, Math.floor((to - start) / slotMs))

    for (let i = first; i <= last; i++) hit.add(i)
  }

  return [...hit].sort((a, b) => a - b)
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

  const sessions = await agentConversations()
    .find(
      { teamId, lastActiveAt: { $gte: new Date(start) } },
      {
        projection: { sessionId: 1, userId: 1, title: 1, agentRuntime: 1, generalAccess: 1 },
        sort: { lastActiveAt: -1 },
        limit: MAX_SESSIONS,
      },
    )
    .map((c) => ({
      sessionId: c.sessionId,
      userId: c.userId,
      // The activity is team-wide and cached per team, so a private session
      // shows that someone worked, never what on.
      title: c.generalAccess === 'none' ? 'Private session' : c.title,
      runtime: c.agentRuntime ?? null,
    }))
    .toArray()
  const sessionIds = sessions.map((c) => c.sessionId)
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

  // Only sessions that ran in range are listed; slots refer to them by index.
  const listed: TeamActivity['sessions'] = []
  const slotsByMember = new Map<string, number[][]>()

  for (const c of sessions) {
    const list = bySession.get(c.sessionId)
    const hit = list ? sessionSlots(turnIntervals(list, now), start, slotMs, slotCount) : []

    if (hit.length === 0) continue
    const index = listed.push({ id: c.sessionId, title: c.title, runtime: c.runtime }) - 1
    const slots =
      slotsByMember.get(c.userId) ?? Array.from({ length: slotCount }, (): number[] => [])

    for (const i of hit) slots[i]?.push(index)
    slotsByMember.set(c.userId, slots)
  }

  const total = (slots: number[][]) => slots.reduce((sum, s) => sum + s.length, 0)
  const members = (await getTeamMembers(teamId))
    .map((m) => ({
      id: m.id,
      name: m.name,
      avatarURL: m.avatarURL,
      slots: slotsByMember.get(m.id) ?? Array.from({ length: slotCount }, (): number[] => []),
    }))
    .sort((a, b) => total(b.slots) - total(a.slots) || a.name.localeCompare(b.name))

  return {
    range,
    slotMinutes,
    start: new Date(start).toISOString(),
    sessions: listed,
    members,
  }
}

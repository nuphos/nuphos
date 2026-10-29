import { agentConversations, agentMessages } from '@/lib/agent/db'

import type { AgentConversation } from '@/lib/agent/db'

type TurnMessage = { sessionId: string; role: string; createdAt: Date }

// A turn with no reply yet is still running, unless it is so old that its
// reply was lost; then it is not counted at all.
export const OPEN_TURN_LIMIT_MS = 2 * 60 * 60_000

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

/** What a read keeps of a session: enough to count it, name it and check who may open it. */
export type TurnSession = Pick<
  AgentConversation,
  | 'sessionId'
  | 'userId'
  | 'teamId'
  | 'title'
  | 'agentRuntime'
  | 'parentSessionId'
  | 'createdAt'
  | 'generalAccess'
  | 'participantIds'
  | 'viewOnlyIds'
  | 'linkedResources'
>

export type SessionTurns = { session: TurnSession; turns: [number, number][] }

// Bounds a single read for a very busy team: the most recently active sessions.
export const MAX_SESSIONS = 2000

/**
 * The team's sessions active since `since`, most recently active first, each
 * with its turns; only `userId`'s own when given. A turn that ends after
 * `since` may have started a little before it, so its messages are read from
 * a little earlier. At most MAX_SESSIONS sessions are read.
 */
export async function readTeamTurns(
  teamId: string,
  since: number,
  now: Date,
  userId?: string,
): Promise<SessionTurns[]> {
  const sessions = await agentConversations()
    .find(
      { teamId, ...(userId ? { userId } : {}), lastActiveAt: { $gte: new Date(since) } },
      {
        projection: {
          sessionId: 1,
          userId: 1,
          teamId: 1,
          title: 1,
          agentRuntime: 1,
          parentSessionId: 1,
          createdAt: 1,
          generalAccess: 1,
          participantIds: 1,
          viewOnlyIds: 1,
          'linkedResources.key': 1,
          'linkedResources.provider': 1,
          'linkedResources.linkedAt': 1,
          'linkedResources.mergedAt': 1,
        },
        sort: { lastActiveAt: -1 },
        limit: MAX_SESSIONS,
      },
    )
    .map((c): TurnSession => c)
    .toArray()
  const messages = await agentMessages()
    .find(
      {
        sessionId: { $in: sessions.map((c) => c.sessionId) },
        createdAt: { $gte: new Date(since - OPEN_TURN_LIMIT_MS) },
      },
      { projection: { sessionId: 1, role: 1, createdAt: 1 }, sort: { sessionId: 1, index: 1 } },
    )
    .toArray()
  const bySession = new Map<string, TurnMessage[]>()

  for (const m of messages) {
    const list = bySession.get(m.sessionId) ?? []

    list.push(m)
    bySession.set(m.sessionId, list)
  }

  return sessions.map((session) => ({
    session,
    turns: turnIntervals(bySession.get(session.sessionId) ?? [], now),
  }))
}

// Readers that only need the last few days to within minutes share one read.
const REUSE_MS = 5 * 60_000

export type RecentTurns = {
  /** When the read was made. */
  now: number
  sessions: SessionTurns[]
  /** The read stopped at MAX_SESSIONS, so older sessions are missing from it. */
  capped: boolean
}

const cache = new Map<string, { bucket: number; read: Promise<RecentTurns> }>()

/**
 * readTeamTurns over the last `days`, only `userId`'s sessions when given,
 * shared by every caller asking for the same for five minutes. Reads from an
 * earlier five minutes are dropped on the way.
 */
export function recentTeamTurns(
  teamId: string,
  days: number,
  now = Date.now(),
  userId?: string,
): Promise<RecentTurns> {
  const key = `${teamId}|${userId ?? '*'}|${String(days)}`
  const bucket = Math.floor(now / REUSE_MS)

  for (const [k, entry] of cache) if (entry.bucket !== bucket) cache.delete(k)
  const hit = cache.get(key)

  if (hit) return hit.read
  const read = readTeamTurns(teamId, now - days * 24 * 60 * 60_000, new Date(now), userId).then(
    (sessions) => ({ now, sessions, capped: sessions.length >= MAX_SESSIONS }),
  )

  cache.set(key, { bucket, read })
  // A failed read is not kept; the next request tries again.
  read.catch(() => {
    if (cache.get(key)?.read === read) cache.delete(key)
  })

  return read
}

/** How many reads are kept, for tests. */
export const recentTeamTurnsKept = () => cache.size

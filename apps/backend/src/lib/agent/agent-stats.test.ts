import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { peakOverlap, streaks, zoneClock } from './agent-stats-time'

import type { SessionTurns, TurnSession } from './team-turns'

let reads = 0
let filters: unknown[] = []
let conversations: Record<string, unknown>[] = []
let messages: { sessionId: string; role: string; createdAt: Date }[] = []

useAgentDb({
  agentConversations: () => ({
    find: (filter: unknown) => {
      reads++
      filters.push(filter)

      return {
        map: (fn: (c: Record<string, unknown>) => unknown) => ({
          toArray: () => Promise.resolve(conversations.map(fn)),
        }),
      }
    },
  }),
  agentMessages: () => ({ find: () => ({ toArray: () => Promise.resolve(messages) }) }),
})

const { getAgentStats, isTimeZone, summarizeStats } = await import('@/lib/agent/agent-stats')

const HOUR = 60 * 60_000
// Thursday 29 October 2026, noon UTC.
const now = Date.UTC(2026, 9, 29, 12)
const utc = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour, minute)

const session = (
  over: Partial<TurnSession> & { sessionId: string },
  turns: [number, number][] = [],
): SessionTurns => ({
  session: {
    userId: 'me',
    teamId: 'team',
    title: over.sessionId,
    agentRuntime: 'claude-code',
    createdAt: new Date(utc(29, 1)),
    ...over,
  },
  turns,
})
const readOf = (...sessions: SessionTurns[]) => ({ now, sessions })
const mine = { viewerId: 'me', scope: 'me', range: '7d', timeZone: 'UTC' } as const
const team = { ...mine, scope: 'team' } as const
const pull = (key: string, linkedAt: number, mergedAt: number | null) => ({
  id: key,
  key,
  provider: 'github' as const,
  integrationId: '1',
  resourceId: key,
  title: key,
  url: '',
  state: mergedAt ? 'merged' : 'open',
  linkedAt: new Date(linkedAt).toISOString(),
  ...(mergedAt ? { mergedAt: new Date(mergedAt).toISOString() } : {}),
})

beforeEach(() => {
  reads = 0
  filters = []
  conversations = []
  messages = []
})

test('zoneClock reads local time, half-hour zones included', () => {
  expect(zoneClock('Asia/Kolkata')(utc(29, 18, 45))).toBe(utc(30, 0, 15))
  expect(zoneClock('America/New_York')(utc(29, 12))).toBe(utc(29, 8))
  expect(isTimeZone('Asia/Kolkata')).toBe(true)
  expect(isTimeZone('Mars/Olympus')).toBe(false)
})

test('ranges roll back from now, like the heatmap, against the period before', () => {
  const read = readOf(
    // Two hours, half of them in the last 24 hours.
    session({ sessionId: 'now' }, [[utc(28, 11), utc(28, 13)]]),
    session({ sessionId: 'earlier', createdAt: new Date(utc(27, 9)) }, [[utc(27, 9), utc(27, 10)]]),
    session({ sessionId: 'before', createdAt: new Date(utc(20, 9)) }, [[utc(20, 9), utc(20, 10)]]),
    session({ sessionId: 'long ago', createdAt: new Date(utc(1, 9)) }, [[utc(1, 9), utc(1, 10)]]),
  )
  const day = summarizeStats(read, { ...mine, range: '1d' })

  expect(day.current).toMatchObject({ agentMs: HOUR, turns: 0, sessions: 1 })
  // The turn that started yesterday counts there; the day before is out of both.
  expect(day.previous).toMatchObject({ agentMs: HOUR, turns: 1, sessions: 0 })

  const week = summarizeStats(read, mine)

  expect(week.current).toMatchObject({ agentMs: 3 * HOUR, turns: 2, sessions: 2 })
  expect(week.previous).toMatchObject({ agentMs: HOUR, turns: 1, sessions: 1 })
})

test('me counts the viewer’s sessions, team everyone’s', () => {
  const read = readOf(
    session({ sessionId: 'a' }, [[utc(29, 9), utc(29, 10)]]),
    session({ sessionId: 'b', userId: 'carol', agentRuntime: 'codex' }, [
      [utc(29, 9), utc(29, 11)],
    ]),
  )

  expect(summarizeStats(read, mine).current.agentMs).toBe(HOUR)
  expect(summarizeStats(read, team).current.agentMs).toBe(3 * HOUR)
  expect(summarizeStats(read, team).runtimes).toEqual([
    { runtime: 'codex', agentMs: 2 * HOUR },
    { runtime: 'claude-code', agentMs: HOUR },
  ])
  expect(summarizeStats(read, team).peak).toEqual({
    count: 2,
    at: new Date(utc(29, 9)).toISOString(),
  })
})

test('sub-agents are counted apart from sessions, with the busiest parent', () => {
  const stats = summarizeStats(
    readOf(
      session({ sessionId: 'lead' }),
      session({ sessionId: 'w1', parentSessionId: 'lead' }),
      session({ sessionId: 'w2', parentSessionId: 'lead' }),
      session({ sessionId: 'w3', parentSessionId: 'other' }),
    ),
    mine,
  )

  expect(stats.current).toMatchObject({ sessions: 1, subAgents: 3 })
  expect(stats.fanOut).toEqual({ count: 2, session: { id: 'lead', title: 'lead' } })
})

test('a team card only names sessions the viewer may open', () => {
  const long: [number, number][] = [[utc(29, 1), utc(29, 6)]]
  const named = (over: Partial<TurnSession> & { sessionId: string }) =>
    summarizeStats(readOf(session(over, long)), team).longest

  // A teammate's private session counts, unnamed and unlinked.
  expect(named({ sessionId: 'p', userId: 'carol', generalAccess: 'none' })).toEqual({
    ms: 5 * HOUR,
    startedAt: new Date(utc(29, 1)).toISOString(),
    session: null,
  })
  // The viewer's own private session, one shared with the team, one they joined.
  expect(named({ sessionId: 'own', generalAccess: 'none' })?.session).toEqual({
    id: 'own',
    title: 'own',
  })
  expect(named({ sessionId: 'shared', userId: 'carol', generalAccess: 'view' })?.session).toEqual({
    id: 'shared',
    title: 'shared',
  })
  expect(
    named({ sessionId: 'joined', userId: 'carol', generalAccess: 'none', participantIds: ['me'] })
      ?.session,
  ).toEqual({ id: 'joined', title: 'joined' })

  const fanOut = summarizeStats(
    readOf(
      session({ sessionId: 'lead', userId: 'carol', generalAccess: 'none' }),
      session({ sessionId: 'w1', userId: 'carol', parentSessionId: 'lead' }),
    ),
    team,
  ).fanOut

  expect(fanOut).toEqual({ count: 1, session: null })
})

test('pull requests count once, merged ones by their local merge time', () => {
  const read = readOf(
    session({
      sessionId: 'a',
      // Merged at 02:00 in New York: overnight there.
      linkedResources: [
        pull('github/1/2/3', utc(27, 9), utc(28, 6)),
        pull('github/1/2/4', utc(27, 9), null),
      ],
    }),
    // The same pull request linked from another session.
    session({ sessionId: 'b', linkedResources: [pull('github/1/2/3', utc(27, 9), utc(28, 6))] }),
    // Linked before the range, merged in it at 10:00 New York.
    session({ sessionId: 'c', linkedResources: [pull('github/1/2/5', utc(15, 9), utc(28, 14))] }),
    // Linked again in the range from another session: it still counts as linked before it.
    session({ sessionId: 'd', linkedResources: [pull('github/1/2/5', utc(28, 9), utc(28, 14))] }),
  )

  expect(summarizeStats(read, { ...mine, timeZone: 'America/New_York' }).current).toMatchObject({
    prsOpened: 2,
    prsMerged: 2,
    prsMergedOvernight: 1,
  })
  // 06:00 UTC is 11:30 in Kolkata: not overnight there.
  expect(
    summarizeStats(read, { ...mine, timeZone: 'Asia/Kolkata' }).current.prsMergedOvernight,
  ).toBe(0)
})

test('streaks count local days, ending today or yesterday', () => {
  expect(streaks(new Set([97, 98, 99, 100]), 100, 60)).toEqual({
    current: 4,
    best: 4,
    lookbackDays: 60,
  })
  expect(streaks(new Set([90, 91, 92, 93, 98, 99]), 100, 60)).toMatchObject({ current: 2, best: 4 })
  expect(streaks(new Set([97]), 100, 60).current).toBe(0)
  // A run longer than the lookback stops at it, level with the best run.
  expect(streaks(new Set(Array.from({ length: 101 }, (_, d) => d)), 100, 60)).toEqual({
    current: 60,
    best: 60,
    lookbackDays: 60,
  })

  const read = readOf(
    session({ sessionId: 's' }, [
      [utc(27, 9), utc(27, 10)],
      [utc(28, 9), utc(28, 10)],
    ]),
  )

  expect(summarizeStats(read, mine).streak.current).toBe(2)
  // In Tokyo it is already the 29th's evening, and the 28th's turn fell on the 28th.
  expect(summarizeStats(read, { ...mine, timeZone: 'Asia/Tokyo' }).streak.current).toBe(2)
})

test('a link or merge time that does not parse is not counted', () => {
  const broken = { ...pull('github/1/2/9', utc(27, 9), null), mergedAt: 'soon' }
  const stats = summarizeStats(readOf(session({ sessionId: 'x', linkedResources: [broken] })), mine)

  expect(stats.current).toMatchObject({ prsOpened: 1, prsMerged: 0 })
  expect(stats.previous).toMatchObject({ prsOpened: 0, prsMerged: 0 })

  const unlinked = { ...pull('github/1/2/8', utc(27, 9), utc(28, 9)), linkedAt: 'never' }
  const none = summarizeStats(
    readOf(session({ sessionId: 'y', linkedResources: [unlinked] })),
    mine,
  )

  expect(none.current).toMatchObject({ prsOpened: 0, prsMerged: 0 })
  expect(none.previous).toMatchObject({ prsOpened: 0, prsMerged: 0 })
})

test('peak overlap counts turns running at the same moment', () => {
  expect(
    peakOverlap([
      [0, 10],
      [5, 20],
      [6, 8],
      // Starts as the first ends: back to back, not at once.
      [10, 12],
    ]),
  ).toEqual({ count: 3, at: 6 })
  expect(peakOverlap([])).toBeNull()
})

test('me reads only the viewer’s sessions; team viewers share one read', async () => {
  conversations = []
  await getAgentStats('team-scope', { ...mine, viewerId: 'carol' }, now)
  await getAgentStats('team-scope', team, now)
  await getAgentStats('team-scope', { ...team, viewerId: 'carol', range: '30d' }, now)

  expect(reads).toBe(2)
  expect(filters[0]).toMatchObject({ teamId: 'team-scope', userId: 'carol' })
  expect(filters[1]).not.toHaveProperty('userId')
})

test('a read cut at the session limit is reported as capped', () => {
  expect(summarizeStats({ ...readOf(), capped: true }, mine).capped).toBe(true)
  expect(summarizeStats(readOf(), mine).capped).toBe(false)
})

test('one read serves every team viewer, range and time zone for a few minutes', async () => {
  conversations = [
    {
      sessionId: 's',
      userId: 'me',
      teamId: 'team-cache',
      title: 'Deploy',
      createdAt: new Date(utc(29, 9)),
    },
  ]
  messages = [
    { sessionId: 's', role: 'user', createdAt: new Date(utc(29, 9)) },
    { sessionId: 's', role: 'assistant', createdAt: new Date(utc(29, 10)) },
  ]

  const first = await getAgentStats('team-cache', team, now)
  const second = await getAgentStats(
    'team-cache',
    { viewerId: 'carol', scope: 'team', range: '30d', timeZone: 'Asia/Kolkata' },
    now + 60_000,
  )

  expect(reads).toBe(1)
  expect(first.current).toMatchObject({ agentMs: HOUR, sessions: 1 })
  expect(second.current.agentMs).toBe(HOUR)
})

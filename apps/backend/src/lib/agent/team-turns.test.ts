import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

const at = (min: number) => new Date(Date.UTC(2026, 9, 7, 0, min))

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

const { MAX_SESSIONS, readTeamTurns, recentTeamTurns, recentTeamTurnsKept } =
  await import('@/lib/agent/team-turns')

const msg = (sessionId: string, role: string, min: number) => ({
  sessionId,
  role,
  createdAt: at(min),
})

beforeEach(() => {
  reads = 0
  filters = []
  conversations = []
  messages = []
})

test('each session comes with its own turns, in the order sessions were read', async () => {
  conversations = [
    { sessionId: 's2', userId: 'u1', title: 'Deploy' },
    { sessionId: 's1', userId: 'u2', title: 'Fix CI' },
  ]
  messages = [
    msg('s1', 'user', 10),
    msg('s1', 'assistant', 20),
    msg('s2', 'user', 30),
    msg('s2', 'assistant', 45),
  ]
  const read = await readTeamTurns('team', at(0).getTime(), at(60))

  expect(read.map((r) => [r.session.sessionId, r.turns])).toEqual([
    ['s2', [[at(30).getTime(), at(45).getTime()]]],
    ['s1', [[at(10).getTime(), at(20).getTime()]]],
  ])
  expect(filters[0]).toEqual({ teamId: 'team', lastActiveAt: { $gte: at(0) } })
})

test('a session without messages in the read has no turns', async () => {
  conversations = [{ sessionId: 's1', userId: 'u1', title: 'Idle' }]
  const read = await readTeamTurns('team', at(0).getTime(), at(60))

  expect(read).toEqual([{ session: conversations[0] as never, turns: [] }])
})

test('one member’s sessions are filtered in the read, not after it', async () => {
  await readTeamTurns('team', at(0).getTime(), at(60), 'u1')

  expect(filters[0]).toEqual({ teamId: 'team', userId: 'u1', lastActiveAt: { $gte: at(0) } })
})

test('a read that reached the session limit says so', async () => {
  conversations = Array.from({ length: MAX_SESSIONS }, (_, i) => ({ sessionId: `s${String(i)}` }))
  const full = await recentTeamTurns('team-full', 60, at(600).getTime())

  conversations = [{ sessionId: 's1' }]
  const some = await recentTeamTurns('team-some', 60, at(600).getTime())

  expect(full.capped).toBe(true)
  expect(some.capped).toBe(false)
})

test('reads from an earlier five minutes are dropped', async () => {
  await recentTeamTurns('team-a', 60, at(600).getTime())
  await recentTeamTurns('team-b', 60, at(600).getTime())
  await recentTeamTurns('team-c', 60, at(610).getTime())

  expect(recentTeamTurnsKept()).toBe(1)
})

test('recent turns are read once per team and days for five minutes', async () => {
  const now = at(600).getTime()

  await recentTeamTurns('team-cache', 60, now)
  const again = await recentTeamTurns('team-cache', 60, now + 60_000)

  expect(reads).toBe(1)
  expect(again.now).toBe(now)
  await recentTeamTurns('team-cache', 30, now)
  await recentTeamTurns('team-other', 60, now)
  await recentTeamTurns('team-cache', 60, now, 'u1')
  await recentTeamTurns('team-cache', 60, now + 5 * 60_000)
  expect(reads).toBe(5)
})

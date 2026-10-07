import { expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

let scans = 0

useAgentDb({
  agentConversations: () => ({
    find: () => {
      scans++

      return { map: () => ({ toArray: async () => ['s1'] }) }
    },
  }),
  agentMessages: () => ({ find: () => ({ toArray: async () => [] }) }),
})

const { countSlots, getTeamActivity, turnIntervals } = await import('@/lib/agent/team-activity')

const at = (min: number) => new Date(Date.UTC(2026, 9, 7, 0, min))
const msg = (role: string, min: number) => ({ sessionId: 's', role, createdAt: at(min) })
const now = at(600)

test('a turn runs from the user message to the last reply that answers it', () => {
  const turns = turnIntervals(
    [
      msg('user', 10),
      msg('assistant', 25),
      msg('assistant', 30),
      msg('user', 100),
      msg('assistant', 110),
    ],
    now,
  )

  expect(turns).toEqual([
    [at(10).getTime(), at(30).getTime()],
    [at(100).getTime(), at(110).getTime()],
  ])
})

test('an unanswered turn runs until now, unless it is too old to still be running', () => {
  expect(turnIntervals([msg('user', 590)], now)).toEqual([[at(590).getTime(), now.getTime()]])
  expect(turnIntervals([msg('user', 10)], now)).toEqual([])
})

test('a session counts once per slot however many turns it has there', () => {
  const slotMs = 30 * 60_000
  const start = at(0).getTime()
  const a: [number, number][] = [
    [at(5).getTime(), at(10).getTime()],
    [at(15).getTime(), at(40).getTime()],
  ]
  const b: [number, number][] = [[at(20).getTime(), at(25).getTime()]]

  expect(countSlots([a, b], start, slotMs, 3)).toEqual([2, 1, 0])
})

test('one scan serves a team and range until the next slot starts', async () => {
  scans = 0
  const t = (min: number) => new Date(Date.UTC(2026, 9, 7, 10, min))

  await getTeamActivity('team-a', '7d', t(1))
  await getTeamActivity('team-a', '7d', t(20))
  expect(scans).toBe(1)

  // A new 30-minute slot, another range, or another team each scan afresh.
  await getTeamActivity('team-a', '7d', t(31))
  await getTeamActivity('team-a', '1d', t(31))
  await getTeamActivity('team-b', '7d', t(31))
  expect(scans).toBe(4)
})

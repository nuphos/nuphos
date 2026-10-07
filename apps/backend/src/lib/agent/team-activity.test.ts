import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

const at = (min: number) => new Date(Date.UTC(2026, 9, 7, 0, min))

let scans = 0
let conversations: { sessionId: string; userId: string; title: string }[] = []
let messages: { sessionId: string; role: string; createdAt: Date }[] = []

useAgentDb({
  agentConversations: () =>
    ({
      find: () => {
        scans++

        return { map: () => ({ toArray: async () => conversations }) }
      },
    }) as never,
  agentMessages: () => ({ find: () => ({ toArray: async () => messages }) }) as never,
})
useIdentity({
  getTeamMembers: async () =>
    [
      { id: 'u-carol', name: 'Carol', avatarURL: '' },
      { id: 'u-alice', name: 'Alice', avatarURL: '' },
      { id: 'u-bob', name: 'Bob', avatarURL: '' },
    ] as never,
})

const { getTeamActivity, sessionSlots, turnIntervals } = await import('@/lib/agent/team-activity')

const msg = (sessionId: string, role: string, min: number) => ({
  sessionId,
  role,
  createdAt: at(min),
})
const now = at(600)

beforeEach(() => {
  scans = 0
  conversations = []
  messages = []
})

test('a turn runs from the user message to the last reply that answers it', () => {
  const turns = turnIntervals(
    [
      msg('s', 'user', 10),
      msg('s', 'assistant', 25),
      msg('s', 'assistant', 30),
      msg('s', 'user', 100),
      msg('s', 'assistant', 110),
    ],
    now,
  )

  expect(turns).toEqual([
    [at(10).getTime(), at(30).getTime()],
    [at(100).getTime(), at(110).getTime()],
  ])
})

test('an unanswered turn runs until now, unless it is too old to still be running', () => {
  expect(turnIntervals([msg('s', 'user', 590)], now)).toEqual([[at(590).getTime(), now.getTime()]])
  expect(turnIntervals([msg('s', 'user', 10)], now)).toEqual([])
})

test('sessionSlots lists each slot a session ran in once, in order', () => {
  const turns: [number, number][] = [
    [at(40).getTime(), at(70).getTime()],
    [at(5).getTime(), at(10).getTime()],
  ]

  expect(sessionSlots(turns, at(0).getTime(), 30 * 60_000, 4)).toEqual([0, 1, 2])
})

test('every member gets a row, busiest first, with the sessions they ran in each slot', async () => {
  conversations = [
    { sessionId: 's1', userId: 'u-alice', title: 'Fix CI' },
    { sessionId: 's2', userId: 'u-alice', title: 'Deploy' },
    { sessionId: 's3', userId: 'u-bob', title: 'Old chat' },
  ]
  // Alice runs two sessions in the same slot; Bob's session has no turn in range.
  messages = [
    msg('s1', 'user', 560),
    msg('s1', 'assistant', 570),
    msg('s2', 'user', 565),
    msg('s2', 'assistant', 575),
  ]
  const activity = await getTeamActivity('team-members', '1d', now)
  const slot = Math.floor((at(560).getTime() - new Date(activity.start).getTime()) / (30 * 60_000))

  expect(activity.sessions).toEqual([
    { id: 's1', title: 'Fix CI' },
    { id: 's2', title: 'Deploy' },
  ])
  expect(activity.members.map((m) => m.name)).toEqual(['Alice', 'Bob', 'Carol'])
  expect(activity.members[0]?.slots[slot]).toEqual([0, 1])
  expect(activity.members[1]?.slots.flat()).toEqual([])
})

test('one scan serves a team and range until the next slot starts', async () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 7, 10, min))

  await getTeamActivity('team-cache', '1d', t(1))
  await getTeamActivity('team-cache', '1d', t(20))
  expect(scans).toBe(1)

  // A new 30-minute slot, another range, or another team each scan afresh.
  await getTeamActivity('team-cache', '1d', t(31))
  await getTeamActivity('team-cache', '7d', t(31))
  await getTeamActivity('team-other', '1d', t(31))
  expect(scans).toBe(4)
})

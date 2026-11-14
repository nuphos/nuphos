import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

let used = 0
let filter: Record<string, unknown> | undefined

useAgentDb({
  agentConversations: () => ({
    countDocuments: (query: Record<string, unknown>) => {
      filter = query

      return Promise.resolve(used)
    },
  }),
})

const { assertMeetingBudget } = await import('./meetings')

const now = Date.parse('2026-11-14T00:00:00Z')

beforeEach(() => {
  used = 0
  filter = undefined
})

describe('assertMeetingBudget', () => {
  test('counts the team’s meeting channels from the last 24 hours', async () => {
    await assertMeetingBudget('team-1', 20, now)

    const since = new Date(now - 24 * 60 * 60 * 1000)

    expect(filter).toEqual({
      teamId: 'team-1',
      lastActiveAt: { $gte: since },
      createdAt: { $gte: since },
      'meeting.botId': { $exists: true },
    })
  })

  test('lets a team under its limit join', async () => {
    used = 19

    await expect(assertMeetingBudget('team-1', 20, now)).resolves.toBeUndefined()
  })

  test('refuses a team at its limit', async () => {
    used = 20

    await expect(assertMeetingBudget('team-1', 20, now)).rejects.toThrow('20 bots')
  })
})

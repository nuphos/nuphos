// /usage/query through the real app, /teams router and its auth middleware: every member gets
// the team's numbers, and only an administrator gets another member's conversation name. The
// database answers with one group in an administrator's conversation.
import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { NuphosTeamRole } from '@/lib/identity/types'

const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const ADMIN = '62e6289482f5f9d9408f1a79'
const MEMBER = '62e6289482f5f9d9408f1a7a'
const CHAT = 'admin-chat'

let role: NuphosTeamRole = 'VIEWER'
let caller = MEMBER

// What each collection answers: a single usage group, and the conversation it belongs to.
const answers: Record<string, unknown[]> = {
  agent_token_usage: [
    {
      _id: { conversation: CHAT, provider: 'claude-code', modelId: 'claude-opus-5-5' },
      inputTokens: 900,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
      totalTokens: 1000,
    },
  ],
  agent_conversations: [{ sessionId: CHAT, title: 'Pricing plan', userId: ADMIN }],
}
const answering = (collection: string) => {
  const cursor = {
    project: () => cursor,
    map: () => cursor,
    toArray: () => Promise.resolve(answers[collection] ?? []),
  }

  return { find: () => cursor, aggregate: () => cursor }
}

useDb({ db: () => ({ collection: answering }) })
useIdentity({
  authenticateToken: () =>
    Promise.resolve({ user: { id: caller, email: 'm@example.com', name: 'Member' } } as never),
  getTeamMembership: () => Promise.resolve({ role, team: { id: TEAM } } as never),
  getTeamMembers: () => Promise.resolve([] as never),
})

const { app } = await import('@/index-app')

const read = async (who: string, teamRole: NuphosTeamRole) => {
  caller = who
  role = teamRole
  const query = new URLSearchParams({
    from: '2026-11-11T00:00:00.000Z',
    to: '2026-11-18T00:00:00.000Z',
    groupBy: 'conversation',
  })
  const response = await app.request(`/teams/${TEAM}/usage/query?${query.toString()}`, {
    headers: { Authorization: 'Bearer session' },
  })

  expect(response.status).toBe(200)

  return (await response.json()) as {
    rows: { keys: { conversation: string }; totalTokens: number }[]
    names: { conversation: Record<string, string | null> }
  }
}

describe('/usage/query', () => {
  test.each(['EDITOR', 'VIEWER'] as const)(
    'a member with %s gets the team’s numbers but not an administrator’s conversation name',
    async (teamRole) => {
      const answer = await read(MEMBER, teamRole)

      expect(answer.rows).toEqual([
        expect.objectContaining({ keys: { conversation: CHAT }, totalTokens: 1000 }),
      ])
      expect(answer.names.conversation).toEqual({ [CHAT]: null })
    },
  )

  test('an administrator gets the name', async () => {
    expect((await read(ADMIN, 'ADMINISTRATOR')).names.conversation).toEqual({
      [CHAT]: 'Pricing plan',
    })
  })

  test('the owner gets their own name, whatever their role', async () => {
    answers.agent_conversations = [{ sessionId: CHAT, title: 'Pricing plan', userId: MEMBER }]
    expect((await read(MEMBER, 'VIEWER')).names.conversation).toEqual({ [CHAT]: 'Pricing plan' })
  })
})

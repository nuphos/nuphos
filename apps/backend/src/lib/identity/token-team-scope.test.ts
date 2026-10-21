import { describe, expect, test } from 'bun:test'

import { useIdentity } from '@/lib/test/doubles/identity'

// Run with: cd apps/backend && bun test src/lib/identity/token-team-scope.test.ts

const TEAM_A = '507f1f77bcf86cd799439011'
const TEAM_B = '507f1f77bcf86cd799439022'

// The user is a member of both teams; only the agent token limits them to A.
useIdentity({
  getTeamMembership: async (_userId: string, teamId: string) =>
    [TEAM_A, TEAM_B].includes(teamId) ? { role: 'MEMBER' } : null,
})

const { runInTokenTeamScope } = await import('@/lib/identity/token-team-scope')
const { withTeamScope } = await import('@/lib/agent/db/shared')
const plans = await import('@/lib/agent/plans/scope')
const { resolveVerifiedTeamId } = await import('@/routes/agent/team-scope')

const ctx = { get: () => 'user-1' } as never
const owner = { sessionId: 's1', userId: 'user-1' }
const matchesNothing = { $in: [] }

describe('conversation filters under an agent token', () => {
  test('without a token: team plus legacy team-less rows, or owner only', () => {
    expect(withTeamScope(owner, TEAM_A)).toEqual({
      ...owner,
      $or: [{ teamId: TEAM_A }, { teamId: { $exists: false } }],
    })
    expect(withTeamScope(owner, undefined)).toEqual(owner)
  })

  test('its own team only, never team-less rows', () => {
    runInTokenTeamScope(TEAM_A, () => {
      expect(withTeamScope(owner, TEAM_A)).toEqual({ ...owner, teamId: TEAM_A })
      expect(withTeamScope(owner, undefined)).toEqual({ ...owner, teamId: TEAM_A })
    })
  })

  test('another team matches nothing', () => {
    runInTokenTeamScope(TEAM_A, () => {
      expect(withTeamScope(owner, TEAM_B)).toEqual({ ...owner, teamId: matchesNothing })
      expect(plans.withTeamScope({}, TEAM_B)).toEqual({ teamId: matchesNothing })
      expect(plans.scopedNumberFilter(2, { userId: 'user-1' })).toEqual({
        number: 2,
        teamId: TEAM_A,
      })
    })
  })
})

describe('resolveVerifiedTeamId under an agent token', () => {
  test('an omitted team resolves to the token team', async () => {
    await runInTokenTeamScope(TEAM_A, async () => {
      expect(await resolveVerifiedTeamId(ctx, undefined)).toBe(TEAM_A)
      expect(await resolveVerifiedTeamId(ctx, TEAM_A)).toBe(TEAM_A)
    })
  })

  test('a foreign or malformed team is refused, not read as personal', async () => {
    await runInTokenTeamScope(TEAM_A, async () => {
      for (const candidate of [TEAM_B, 'not-a-team']) {
        await expect(resolveVerifiedTeamId(ctx, candidate)).rejects.toMatchObject({ status: 403 })
      }
    })
  })

  test('without a token a member team still resolves', async () => {
    expect(await resolveVerifiedTeamId(ctx, TEAM_B)).toBe(TEAM_B)
    expect(await resolveVerifiedTeamId(ctx, 'not-a-team')).toBeUndefined()
  })
})

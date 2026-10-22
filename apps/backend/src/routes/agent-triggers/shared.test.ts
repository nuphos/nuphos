import { describe, expect, test } from 'bun:test'

import { useIdentity } from '@/lib/test/doubles/identity'

const PATH_TEAM = '64b5f1c2e4b0a1d2c3e4f5a1'
const OTHER_TEAM = '64b5f1c2e4b0a1d2c3e4f5a2'

useIdentity({
  getTeamMembership: () => Promise.resolve({ role: 'EDITOR' }) as never,
})

const { triggerActor } = await import('./shared')

function context(pathTeamId?: string) {
  const vars: Record<string, string | undefined> = { userId: 'user-1', teamId: pathTeamId }

  return { get: (key: string) => vars[key] } as unknown as Parameters<typeof triggerActor>[0]
}

describe('triggerActor', () => {
  test('a team route acts on the path team', async () => {
    expect(await triggerActor(context(PATH_TEAM), undefined)).toEqual({
      userId: 'user-1',
      teamId: PATH_TEAM,
    })
    expect(await triggerActor(context(PATH_TEAM), PATH_TEAM)).toEqual({
      userId: 'user-1',
      teamId: PATH_TEAM,
    })
  })

  test('a team route refuses a body or query team that differs from the path', async () => {
    await expect(triggerActor(context(PATH_TEAM), OTHER_TEAM)).rejects.toMatchObject({
      status: 403,
    })
  })

  test('the personal route still takes the requested team', async () => {
    expect(await triggerActor(context(), OTHER_TEAM)).toEqual({
      userId: 'user-1',
      teamId: OTHER_TEAM,
    })
  })
})

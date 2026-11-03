import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type * as dbActual from '@/lib/db'

type Call = { op: string; filter: unknown; update?: unknown; options?: unknown }

const calls: Call[] = []
const collection = {
  updateOne: (filter: unknown, update: unknown) => {
    calls.push({ op: 'updateOne', filter, update })

    return Promise.resolve({ matchedCount: 1 })
  },
  updateMany: (filter: unknown, update: unknown, options?: unknown) => {
    calls.push({ op: 'updateMany', filter, update, ...(options ? { options } : {}) })

    return Promise.resolve({ matchedCount: 1 })
  },
}

useDb({ db: () => ({ collection: () => collection }) })

const { dropFromTeamGrants, dropOwnerTeamGrants, setTeamUse, teamGrant, transferTeamComputers } =
  await import('./device-grants')

test('replacing a team’s use list is one update that keeps its managers', async () => {
  calls.length = 0

  expect(await setTeamUse('owner', 'mac', 'team', { everyone: false, userIds: ['mate'] })).toBe(
    true,
  )
  expect(calls).toHaveLength(1)
  const update = calls[0]?.update as { $set: { access: { $concatArrays: unknown[] } } }[]

  // A pipeline update: the other teams' grants, then this one, in a single write.
  expect(Array.isArray(update)).toBe(true)
  const [others, mine] = update[0]?.$set.access.$concatArrays ?? []

  expect(others).toEqual({
    $filter: { input: { $ifNull: ['$access', []] }, cond: { $ne: ['$$this.teamId', 'team'] } },
  })
  expect(JSON.stringify(mine)).toContain('"$$current.managerIds"')
  expect((mine as Record<string, unknown>[])[0]?.userIds).toEqual({ $literal: ['mate'] })
})

test('teamGrant reads only the asked team', () => {
  const grant = { teamId: 'a', everyone: true, userIds: [], managerIds: [] }
  const device = { access: [grant] } as unknown as Parameters<typeof teamGrant>[0]

  expect(teamGrant(device, 'a')).toBe(grant)
  expect(teamGrant(device, 'b')).toBeUndefined()
})

test('leaving a team drops the person from its grants, their own grants there, and hands over its computers', async () => {
  calls.length = 0
  await dropFromTeamGrants('team', 'mate')
  await dropOwnerTeamGrants('team', 'owner')
  await transferTeamComputers('team', 'owner', 'boss')

  expect(calls[0]).toEqual({
    op: 'updateMany',
    filter: {
      access: {
        $elemMatch: { teamId: 'team', $or: [{ userIds: 'mate' }, { managerIds: 'mate' }] },
      },
    },
    update: { $pull: { 'access.$[grant].userIds': 'mate', 'access.$[grant].managerIds': 'mate' } },
    options: { arrayFilters: [{ 'grant.teamId': 'team' }] },
  })
  expect(calls[1]).toEqual({
    op: 'updateMany',
    filter: { userId: 'owner', box: { $exists: false }, 'access.teamId': 'team' },
    update: { $pull: { access: { teamId: 'team' } } },
  })
  expect(calls[2]?.filter).toEqual({
    'box.teamId': 'team',
    'box.createdBy': 'owner',
    'box.provider': { $ne: 'k8s' },
  })
})

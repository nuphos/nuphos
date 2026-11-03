import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

type Call = { op: string; filter: unknown; update?: unknown; options?: unknown }

const calls: Call[] = []
// What the next update matches, and whether the computer is still there.
const db = { matched: 1, exists: true }
const collection = {
  updateOne: (filter: unknown, update: unknown) => {
    calls.push({ op: 'updateOne', filter, update })

    return Promise.resolve({ matchedCount: db.matched })
  },
  findOne: () => Promise.resolve(db.exists ? { deviceId: 'mac' } : null),
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
  // The fields an older release reads get the same list, so a rollback still sees it.
  expect(Object.keys(update[0]?.$set ?? {})).toEqual(['access', 'box', 'shares', 'updatedAt'])
  expect(JSON.stringify(update[0]?.$set)).toContain(
    '{"teamId":"team","level":"full","everyone":false,"userIds":["mate"]}',
  )
})

test('managers that followed from a read are written only while they still hold', async () => {
  calls.length = 0
  const use = { everyone: false, userIds: ['mate'] }

  expect(
    await setTeamUse('owner', 'mac', 'team', use, { ids: ['mate'], read: ['mate', 'lead'] }),
  ).toBe(true)
  expect(calls[0]?.filter).toEqual({
    userId: 'owner',
    deviceId: 'mac',
    access: { $elemMatch: { teamId: 'team', managerIds: ['mate', 'lead'] } },
  })
  // None read also matches a team with no grant yet.
  await setTeamUse('owner', 'mac', 'team', use, { ids: [], read: [] })
  expect(calls[1]?.filter).toEqual({
    userId: 'owner',
    deviceId: 'mac',
    $or: [
      { access: { $elemMatch: { teamId: 'team', managerIds: [] } } },
      { access: { $not: { $elemMatch: { teamId: 'team' } } } },
    ],
  })
  db.matched = 0
  const error = await setTeamUse('owner', 'mac', 'team', use, { ids: [], read: ['lead'] }).catch(
    (e: unknown) => e,
  )

  expect(error).toMatchObject({ status: 409, code: 'access_changed' })
  // A computer that is gone is still just not found.
  db.exists = false
  expect(await setTeamUse('owner', 'mac', 'team', use, { ids: [], read: ['lead'] })).toBe(false)
  db.matched = 1
  db.exists = true
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

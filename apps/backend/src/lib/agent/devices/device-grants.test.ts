import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

type Call = { op: string; filter: unknown; update?: unknown; options?: unknown }

const calls: Call[] = []
const audits: Record<string, unknown>[] = []
// What the next update matches, and whether the computer is still there.
const db = { matched: 1, exists: true }
// When set, what each guarded update finds in turn, as the leave flow's loop sees it.
let queue: Record<string, unknown>[] | null = null
const stored = {
  _id: 'device-1',
  userId: 'owner',
  deviceId: 'mac',
  access: [{ teamId: 'team', everyone: false, userIds: ['old'], managerIds: ['lead'] }],
}
const collection = {
  findOneAndUpdate: (filter: unknown, update: unknown, options: unknown) => {
    calls.push({ op: 'findOneAndUpdate', filter, update, options })
    if (queue) return Promise.resolve(queue.shift() ?? null)

    return Promise.resolve(db.matched ? stored : null)
  },
  insertOne: (doc: Record<string, unknown>) => {
    audits.push(doc)

    return Promise.resolve({ acknowledged: true })
  },
  findOne: () => Promise.resolve(db.exists ? { deviceId: 'mac' } : null),
  updateMany: (filter: unknown, update: unknown, options?: unknown) => {
    calls.push({ op: 'updateMany', filter, update, ...(options ? { options } : {}) })

    return Promise.resolve({ matchedCount: 1 })
  },
}

useDb({ db: () => ({ collection: () => collection }) })

const {
  addTeamUse,
  dropFromTeamGrants,
  dropOwnerTeamGrants,
  setTeamUse,
  teamGrant,
  transferTeamComputers,
} = await import('./device-grants')

const by = { actorUserId: 'lead', via: 'share' as const }

test('replacing a team’s use list is one update that keeps its managers', async () => {
  calls.length = 0

  expect(await setTeamUse('owner', 'mac', 'team', { everyone: false, userIds: ['mate'] }, by)).toBe(
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

test('adding use keeps who already uses it and leaves an everyone grant alone', async () => {
  calls.length = 0
  const device = {
    userId: 'owner',
    deviceId: 'mac',
    access: [{ teamId: 'team', everyone: false, userIds: ['mate'], managerIds: ['lead'] }],
  } as never

  expect(await addTeamUse(device, 'team', ['mate', 'new'], by)).toBe(true)
  const update = calls[0]?.update as { $set: { access: { $concatArrays: unknown[] } } }[]
  const [, mine] = update[0]?.$set.access.$concatArrays ?? []

  expect((mine as Record<string, unknown>[])[0]?.userIds).toEqual({ $literal: ['mate', 'new'] })
  // Managers are not named, so the write keeps the stored ones.
  expect(JSON.stringify(mine)).toContain('"$$current.managerIds"')
  calls.length = 0
  const everyone = {
    userId: 'owner',
    deviceId: 'mac',
    access: [{ teamId: 'team', everyone: true, userIds: [], managerIds: [] }],
  } as never

  expect(await addTeamUse(everyone, 'team', ['new'], by)).toBe(true)
  expect(calls).toHaveLength(0)
})

test('managers that followed from a read are written only while they still hold', async () => {
  calls.length = 0
  const use = { everyone: false, userIds: ['mate'] }

  expect(
    await setTeamUse('owner', 'mac', 'team', use, by, { ids: ['mate'], read: ['mate', 'lead'] }),
  ).toBe(true)
  expect(calls[0]?.filter).toEqual({
    userId: 'owner',
    deviceId: 'mac',
    access: { $elemMatch: { teamId: 'team', managerIds: ['mate', 'lead'] } },
  })
  // None read also matches a team with no grant yet.
  await setTeamUse('owner', 'mac', 'team', use, by, { ids: [], read: [] })
  expect(calls[1]?.filter).toEqual({
    userId: 'owner',
    deviceId: 'mac',
    $or: [
      { access: { $elemMatch: { teamId: 'team', managerIds: [] } } },
      { access: { $not: { $elemMatch: { teamId: 'team' } } } },
    ],
  })
  db.matched = 0
  const error = await setTeamUse('owner', 'mac', 'team', use, by, {
    ids: [],
    read: ['lead'],
  }).catch((e: unknown) => e)

  expect(error).toMatchObject({ status: 409, code: 'access_changed' })
  // A computer that is gone is still just not found.
  db.exists = false
  expect(await setTeamUse('owner', 'mac', 'team', use, by, { ids: [], read: ['lead'] })).toBe(false)
  db.matched = 1
  db.exists = true
})

test('every change is audited with who made it, their authority and the grant it replaced', async () => {
  audits.length = 0
  await setTeamUse('owner', 'mac', 'team', { everyone: false, userIds: ['mate'] }, by)

  expect(calls.at(-1)?.options).toEqual({ returnDocument: 'before' })
  expect(audits).toEqual([
    {
      ownerUserId: 'owner',
      deviceId: 'mac',
      teamId: 'team',
      actorUserId: 'lead',
      actorAuthority: 'manage',
      via: 'share',
      previous: { everyone: false, userIds: ['old'], managerIds: ['lead'] },
      // Managers not named are kept, and the record says so.
      next: { everyone: false, userIds: ['mate'], managerIds: ['lead'] },
      changedAt: expect.any(Date),
    },
  ])
  // Nothing written, nothing audited.
  db.matched = 0
  db.exists = false
  expect(await setTeamUse('owner', 'mac', 'team', { everyone: true, userIds: [] }, by)).toBe(false)
  expect(audits).toHaveLength(1)
  db.matched = 1
  db.exists = true
})

test('teamGrant reads only the asked team', () => {
  const grant = { teamId: 'a', everyone: true, userIds: [], managerIds: [] }
  const device = { access: [grant] } as unknown as Parameters<typeof teamGrant>[0]

  expect(teamGrant(device, 'a')).toBe(grant)
  expect(teamGrant(device, 'b')).toBeUndefined()
})

test('leaving a team drops the person from its grants and their own grants, one audited computer at a time', async () => {
  calls.length = 0
  audits.length = 0
  const leave = { actorUserId: 'admin', via: 'team_removal' as const }
  const theirs = {
    _id: 'device-3',
    userId: 'mate',
    deviceId: 'pc',
    access: [{ teamId: 'team', everyone: true, userIds: [], managerIds: [] }],
  }

  queue = [stored, { ...stored, _id: 'device-2', deviceId: 'mini' }]
  await dropFromTeamGrants('team', 'lead', leave)
  queue = [theirs]
  await dropOwnerTeamGrants('team', 'mate', leave)
  queue = null

  // Each loop runs until nothing matches: two computers, then the miss that ends it.
  expect(calls.map((call) => call.op)).toEqual(Array(5).fill('findOneAndUpdate'))
  expect(calls[0]).toEqual({
    op: 'findOneAndUpdate',
    filter: {
      access: {
        $elemMatch: { teamId: 'team', $or: [{ userIds: 'lead' }, { managerIds: 'lead' }] },
      },
    },
    update: { $pull: { 'access.$[grant].userIds': 'lead', 'access.$[grant].managerIds': 'lead' } },
    options: { returnDocument: 'before', arrayFilters: [{ 'grant.teamId': 'team' }] },
  })
  expect(calls[3]).toEqual({
    op: 'findOneAndUpdate',
    filter: { userId: 'mate', box: { $exists: false }, 'access.teamId': 'team' },
    update: { $pull: { access: { teamId: 'team' } } },
    options: { returnDocument: 'before' },
  })
  expect(audits.map((audit) => audit.deviceId)).toEqual(['mac', 'mini', 'pc'])
  expect(audits[0]).toMatchObject({
    actorUserId: 'admin',
    actorAuthority: 'team_membership',
    via: 'team_removal',
    previous: { everyone: false, userIds: ['old'], managerIds: ['lead'] },
    next: { everyone: false, userIds: ['old'], managerIds: [] },
  })
  // Their own computer stops being granted in the team at all.
  expect(audits[2]).toMatchObject({
    previous: { everyone: true, userIds: [], managerIds: [] },
    next: null,
  })
})

test('a computer the update leaves matching ends the loop instead of spinning', async () => {
  calls.length = 0
  audits.length = 0
  // As if a later change broke the update: it finds the same computer again and again.
  queue = [stored, stored, stored]
  await dropFromTeamGrants('team', 'lead', { actorUserId: 'lead', via: 'team_leave' })
  queue = null

  expect(calls).toHaveLength(2)
  expect(audits).toHaveLength(1)
})

test('a person leaving hands the team’s cloud computers they own to its owner, audited', async () => {
  calls.length = 0
  audits.length = 0
  queue = [{ ...stored, box: { teamId: 'team', createdBy: 'owner' } }]
  await transferTeamComputers('team', 'owner', 'boss', { actorUserId: 'owner', via: 'team_leave' })
  queue = null

  expect(calls[0]?.filter).toEqual({
    'box.teamId': 'team',
    'box.createdBy': 'owner',
    'box.provider': { $ne: 'k8s' },
  })
  expect(calls[0]?.update).toMatchObject({ $set: { 'box.createdBy': 'boss' } })
  const grant = { everyone: false, userIds: ['old'], managerIds: ['lead'] }

  expect(audits).toEqual([
    expect.objectContaining({
      deviceId: 'mac',
      teamId: 'team',
      via: 'team_leave',
      actorAuthority: 'team_membership',
      previous: grant,
      next: grant,
      owner: { from: 'owner', to: 'boss' },
    }),
  ])
})

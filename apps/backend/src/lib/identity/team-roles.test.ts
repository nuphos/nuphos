import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { NuphosTeamDoc } from './shared'
import type { Filter, UpdateFilter } from 'mongodb'

const TEAM_ID = new ObjectId()
const OWNER_ID = new ObjectId()
const MEMBER_ID = new ObjectId()
let writes: { filter: Filter<NuphosTeamDoc>; update: UpdateFilter<NuphosTeamDoc> }[] = []
let modifiedCount = 1
let storedOwner: ObjectId | null = OWNER_ID

useDb({
  db: () => ({
    collection: () => ({
      updateOne: (filter: Filter<NuphosTeamDoc>, update: UpdateFilter<NuphosTeamDoc>) => {
        writes.push({ filter, update })

        return Promise.resolve({ modifiedCount })
      },
      findOne: () => Promise.resolve(storedOwner && { _id: TEAM_ID, ownerID: storedOwner }),
    }),
  }),
})

const { transferTeamOwnership } = await import('./team-roles')

function transfer(newOwner = MEMBER_ID, actor = OWNER_ID) {
  return transferTeamOwnership(TEAM_ID.toHexString(), newOwner.toHexString(), actor.toHexString())
}

describe('transferTeamOwnership', () => {
  beforeEach(() => {
    writes = []
    modifiedCount = 1
    storedOwner = OWNER_ID
  })

  test('guards the write on the current owner and an active target membership', async () => {
    expect(await transfer()).toBe('transferred')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.filter).toMatchObject({
      _id: TEAM_ID,
      ownerID: OWNER_ID,
      members: { $elemMatch: { userId: MEMBER_ID, deletedAt: { $exists: false } } },
    })
    expect(writes[0]?.update.$set).toMatchObject({
      ownerID: MEMBER_ID,
      'members.$.role': 'ADMINISTRATOR',
    })
  })

  test('refuses a transfer to yourself without writing', async () => {
    expect(await transfer(OWNER_ID)).toBe('self')
    expect(writes).toHaveLength(0)
  })

  test('explains a write that matched nothing', async () => {
    modifiedCount = 0
    expect(await transfer()).toBe('member_not_found')
    expect(await transfer(MEMBER_ID, new ObjectId())).toBe('forbidden')
    storedOwner = null
    expect(await transfer()).toBe('team_not_found')
  })
})

import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { NuphosTeamDoc } from './shared'
import type { Filter } from 'mongodb'

const TEAM_ID = new ObjectId()
const OWNER_ID = new ObjectId()
const ADMIN_ID = new ObjectId()
const MEMBER_ID = new ObjectId()
let filters: Filter<NuphosTeamDoc>[] = []

// The read sees OWNER_ID as owner; every write then misses, as if a transfer
// to the target committed in between.
useDb({
  db: () => ({
    collection: () => ({
      findOne: () =>
        Promise.resolve({
          _id: TEAM_ID,
          ownerID: OWNER_ID,
          members: [
            { userId: OWNER_ID, role: 'ADMINISTRATOR' },
            { userId: ADMIN_ID, role: 'ADMINISTRATOR' },
            { userId: MEMBER_ID, role: 'ADMINISTRATOR' },
          ],
        }),
      updateOne: (filter: Filter<NuphosTeamDoc>) => {
        filters.push(filter)

        return Promise.resolve({ modifiedCount: 0 })
      },
    }),
  }),
})

const { deleteTeam, leaveTeam, removeUserFromTeam } = await import('./team-removal')
const { updateTeamMemberRole } = await import('./team-roles')

const team = TEAM_ID.toHexString()

describe('owner fences against a concurrent transfer', () => {
  beforeEach(() => {
    filters = []
  })

  test('removal cannot tombstone a member who just became owner', async () => {
    expect(await removeUserFromTeam(team, MEMBER_ID.toHexString(), ADMIN_ID.toHexString())).toBe(
      'member_not_found',
    )
    expect(filters[0]?.ownerID).toEqual({ $ne: MEMBER_ID })
  })

  test('demotion cannot demote a member who just became owner', async () => {
    const result = await updateTeamMemberRole(
      team,
      MEMBER_ID.toHexString(),
      'EDITOR',
      ADMIN_ID.toHexString(),
    )

    expect(result).toEqual({ kind: 'member_not_found' })
    expect(filters[0]?.ownerID).toEqual({ $ne: MEMBER_ID })
  })

  test('leaving cannot strand a team whose ownership just arrived', async () => {
    await leaveTeam(team, MEMBER_ID.toHexString())
    expect(filters[0]?.ownerID).toEqual({ $ne: MEMBER_ID })
  })

  test('a former owner cannot finish a pending deletion', async () => {
    expect(await deleteTeam(team, OWNER_ID.toHexString())).toBe('team_not_found')
    expect(filters[0]?.ownerID).toEqual(OWNER_ID)
  })
})

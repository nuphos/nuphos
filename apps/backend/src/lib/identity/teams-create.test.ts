// The create response's `role`, isolated from Mongo. The value must be the
// seeded membership's role — one value flowing to both the insert and the
// response — so a future change to the seeding rule cannot make the response
// disagree with what was persisted.
import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { NuphosTeamDoc, NuphosUserDoc } from '@/lib/identity/shared'

const CREATOR: NuphosUserDoc = {
  _id: new ObjectId(),
  email: 'ian@zeabur.com',
  name: 'Ian',
  username: 'ca110us',
  avatarURL: '',
  language: 'en',
  createdAt: new Date('2026-08-03T00:00:00.000Z'),
  updatedAt: new Date('2026-08-03T00:00:00.000Z'),
}

let insertedTeam: NuphosTeamDoc | null = null

const collections: Record<string, unknown> = {
  users: { findOne: () => Promise.resolve(CREATOR) },
  teams: {
    insertOne: (doc: NuphosTeamDoc) => {
      insertedTeam = doc

      return Promise.resolve({ insertedId: doc._id })
    },
  },
}

useDb({
  db: () => ({
    // The team-directory cache and anything else that tags along get an inert
    // collection; only users/teams answer with real fixtures.
    collection: (name: string) =>
      collections[name] ?? { updateOne: () => Promise.resolve({ acknowledged: true }) },
  }),
})

const { createTeamForUser } = await import('@/lib/identity/teams')

describe('createTeamForUser', () => {
  test("reports the seeded membership's role — today, the creator administers", async () => {
    const team = await createTeamForUser(CREATOR._id.toHexString(), 'Acme')

    expect(insertedTeam?.members).toHaveLength(1)
    // The invariant: whatever role the seeding rule assigns is the role the
    // caller is told. If the rule changes, both move together or this fails.
    expect(team.role).toBe(insertedTeam!.members[0]!.role)
    expect(team.role).toBe('ADMINISTRATOR')
  })
})

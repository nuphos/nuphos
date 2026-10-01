import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { NuphosTeamDoc } from './shared'
import type { Filter } from 'mongodb'

const USER_ID = new ObjectId()
const TEAM_ID = new ObjectId()
let updateFilters: Filter<NuphosTeamDoc>[] = []

useDb({
  db: () => ({
    collection: (name: string) => {
      if (name === 'users') {
        return { findOne: () => Promise.resolve({ _id: USER_ID }) }
      }
      if (name === 'teams') {
        return {
          updateOne: (filter: Filter<NuphosTeamDoc>) => {
            updateFilters.push(filter)

            return Promise.resolve({ modifiedCount: 1 })
          },
        }
      }

      return {}
    },
  }),
})

const { addUserToTeam } = await import('./teams')

describe('addUserToTeam', () => {
  beforeEach(() => {
    updateFilters = []
  })

  test('keeps unlimited joins free of a capacity predicate', async () => {
    await addUserToTeam(TEAM_ID.toHexString(), USER_ID.toHexString())

    expect(updateFilters).toHaveLength(1)
    expect(updateFilters[0]?.$expr).toBeUndefined()
    expect(updateFilters[0]?.members).toEqual({
      $not: { $elemMatch: { userId: USER_ID, deletedAt: { $exists: false } } },
    })
  })
})

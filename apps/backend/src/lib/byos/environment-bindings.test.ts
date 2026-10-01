import { beforeEach, expect, test } from 'bun:test'
import { MongoServerError, ObjectId } from 'mongodb'

import { useModels } from '@/lib/test/doubles/models'

import { appendEnvironmentBinding } from './environment-bindings'

import type { Document } from 'mongodb'

const teamId = new ObjectId()
let filters: Document[] = []
let inserted = 1
let creationError: Error | null = null

useModels({
  teamByosBindings: () => ({
    updateOne: async (filter: Document, _update: Document, options?: { upsert?: boolean }) => {
      filters.push(filter)
      if (options?.upsert && creationError) throw creationError

      return { modifiedCount: options?.upsert ? 0 : inserted }
    },
  }),
})
beforeEach(() => {
  filters = []
  inserted = 1
  creationError = null
})
const duplicateFilter = { 'awsRoles.accountId': { $ne: '123456789012' } }
const update = { $set: { updatedAt: new Date() } }

test('connector writes have no capacity predicate and retain duplicate protection', async () => {
  expect(await appendEnvironmentBinding(teamId, duplicateFilter, update)).toBe(true)
  expect(filters[1]).toEqual({ _id: teamId, ...duplicateFilter })
  inserted = 0
  expect(await appendEnvironmentBinding(teamId, duplicateFilter, update)).toBe(false)
})
test('a concurrent first binding may win document creation without blocking this append', async () => {
  creationError = new MongoServerError({ code: 11000, message: 'duplicate key' })
  expect(await appendEnvironmentBinding(teamId, duplicateFilter, update)).toBe(true)
})
test('real storage failures are still surfaced', async () => {
  creationError = new Error('database unavailable')
  await expect(appendEnvironmentBinding(teamId, duplicateFilter, update)).rejects.toThrow(
    'database unavailable',
  )
})

import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { NuphosTeamDoc } from './shared'

// Run with: cd apps/backend && bun test src/lib/identity/box-auto-update.test.ts

const teamId = new ObjectId()
const team: NuphosTeamDoc = {
  _id: teamId,
  name: 'Box team',
  avatarUrl: '',
  ownerID: new ObjectId(),
  contactEmails: [],
  members: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

useDb({ db: () => ({ collection: () => ({ findOne: () => Promise.resolve(team) }) }) })
const { getTeamBoxAutoUpdate } = await import('./box-auto-update')
const { mapTeam } = await import('./shared')

test('Boxes update on their own unless the team turned it off', async () => {
  expect(await getTeamBoxAutoUpdate(teamId.toHexString())).toBe(true)
  expect(mapTeam(team).boxAutoUpdate).toBe(true)
  team.boxAutoUpdate = false
  expect(await getTeamBoxAutoUpdate(teamId.toHexString())).toBe(false)
  expect(mapTeam(team).boxAutoUpdate).toBe(false)
})

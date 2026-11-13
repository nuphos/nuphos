import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'

import { finishConnectorOAuth } from './connector-oauth'

import type { BindingAccess } from '@/models'

let teamDefault: 'private' | 'team' = 'private'
let staged: Record<string, unknown>[] = []

useIdentity({
  getTeamMembership: async () => ({
    role: 'ADMINISTRATOR',
    team: { bindingShareDefault: teamDefault },
  }),
})
useModels({
  connectorOAuthReady: () => ({
    insertOne: async (doc: Record<string, unknown>) => {
      staged.push(doc)
    },
  }),
})
beforeEach(() => {
  teamDefault = 'private'
  staged = []
})

async function accessFor(input: {
  share?: { mode: 'team'; memberIds: [] }
  highPrivilege?: boolean
}) {
  let access: BindingAccess | undefined

  await finishConnectorOAuth({
    provider: 'linear',
    defer: false,
    state: 's',
    teamId: new ObjectId(),
    requesterUserId: 'u1',
    draft: {},
    persist: async (_team, _draft, given) => {
      access = given
      return {}
    },
    ...input,
  })

  return access
}

test('an OAuth-connected binding starts private to the member who connected it', async () => {
  expect(await accessFor({})).toMatchObject({ memberAllowList: ['u1'], ownerUserId: 'u1' })
})

test('it follows the team default and the choice made when starting the flow', async () => {
  teamDefault = 'team'
  expect((await accessFor({}))?.memberAllowList).toEqual(['*'])
  expect((await accessFor({ highPrivilege: true }))?.memberAllowList).toEqual(['u1'])
  teamDefault = 'private'
  expect((await accessFor({ share: { mode: 'team', memberIds: [] } }))?.memberAllowList).toEqual([
    '*',
  ])
})

test('a deferred grant keeps the decided access for the requester to complete', async () => {
  await finishConnectorOAuth({
    provider: 'linear',
    defer: true,
    state: 's',
    teamId: new ObjectId(),
    requesterUserId: 'u1',
    draft: {},
    persist: async () => ({}),
  })
  expect(staged[0]).toMatchObject({ access: { memberAllowList: ['u1'], ownerUserId: 'u1' } })
})

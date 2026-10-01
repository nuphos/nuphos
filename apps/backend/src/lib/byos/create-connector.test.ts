import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosGcp } from '@/lib/test/doubles/byos-gcp'
import { useByosGcpWif } from '@/lib/test/doubles/byos-gcp-wif'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useModels } from '@/lib/test/doubles/models'

const teamId = new ObjectId().toHexString()
let role: string | null = 'ADMINISTRATOR'
let cloudCalls = 0
const writes: Record<string, unknown>[] = []
let duplicate = false
let federationAvailable = true
let hasExistingConnection = false

useIdentity({
  getTeamMembership: async () => (role ? { role, team: { id: teamId } } : null),
})
useModels({
  teamByosBindings: () => ({
    findOne: async () => ({
      awsRoles: hasExistingConnection ? [{ id: new ObjectId() }] : [],
      gcpServiceAccounts: duplicate ? [{ serviceAccountEmail: email, projectId: 'project' }] : [],
    }),
    updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
      writes.push(update)

      return { matchedCount: 1, modifiedCount: 1 }
    },
  }),
})
useByosGcp({
  impersonateSa: async () => {
    cloudCalls++

    return { getAccessToken: async () => ({ token: 'test-token' }) }
  },
})
useByosGcpWif({ gcpWifConfigured: () => federationAvailable })
const { createCloudConnector } = await import('./create-connector')
const email = 'connector@project.iam.gserviceaccount.com'
const input = { serviceAccountEmail: email, projectId: 'project' }
const actor = { userId: new ObjectId().toHexString(), teamId }

beforeEach(() => {
  role = 'ADMINISTRATOR'
  cloudCalls = 0
  writes.length = 0
  duplicate = false
  federationAvailable = true
  hasExistingConnection = false
})

test('uses the real binding route to verify and save the connector', async () => {
  const result = await createCloudConnector(actor, 'gcp', input)

  expect(result.serviceAccountEmail).toBe(email)
  expect(result.serviceAccountId).toBeString()
  expect(cloudCalls).toBe(1)
  expect(writes.some((write) => '$push' in write)).toBe(true)
})

test('checks live team membership and administrator role before cloud access', async () => {
  for (const denied of [null, 'EDITOR', 'VIEWER']) {
    role = denied
    await expect(createCloudConnector(actor, 'gcp', input)).rejects.toMatchObject({ status: 403 })
  }
  expect(cloudCalls).toBe(0)
  expect(writes).toEqual([])
})

test('preserves duplicate and federation errors without creating a binding', async () => {
  duplicate = true
  await expect(createCloudConnector(actor, 'gcp', input)).rejects.toMatchObject({ status: 409 })
  duplicate = false
  federationAvailable = false
  await expect(createCloudConnector(actor, 'gcp', input)).rejects.toMatchObject({
    code: 'gcp_federation_unavailable',
  })
  expect(writes).toEqual([])
})

test('rejects the retired credential kind even from an old client', async () => {
  await expect(
    createCloudConnector(actor, 'gcp', { ...input, purpose: 'permission-admin' }),
  ).rejects.toMatchObject({ status: 400 })
  expect(cloudCalls).toBe(0)
  expect(writes).toEqual([])
})

test('allows another connector when the team already has a connection', async () => {
  hasExistingConnection = true
  const result = await createCloudConnector(actor, 'gcp', input)

  expect(result.serviceAccountEmail).toBe(email)
  expect(cloudCalls).toBe(1)
  expect(writes.some((write) => '$push' in write)).toBe(true)
})

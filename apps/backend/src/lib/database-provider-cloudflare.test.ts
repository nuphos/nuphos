import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useCloudflareAccountHandle } from '@/lib/test/doubles/cloudflare-account-handle'
import { useCloudflareD1 } from '@/lib/test/doubles/cloudflare-d1'
import { useModels } from '@/lib/test/doubles/models'

import type { CloudflareAccountBinding, DatabaseConnection } from '@/models'

const stored: DatabaseConnection[] = []
let activeBinding: CloudflareAccountBinding | null = null

function providerMatch(connection: DatabaseConnection, filter: Record<string, unknown>): boolean {
  return (
    connection.teamId.equals(filter.teamId as ObjectId) &&
    connection.providerOrigin?.provider === filter['providerOrigin.provider'] &&
    connection.providerOrigin?.product === filter['providerOrigin.product'] &&
    connection.providerOrigin?.externalResourceId === filter['providerOrigin.externalResourceId']
  )
}

useModels({
  databaseConnections: () => ({
    findOne: async (filter: Record<string, unknown>) =>
      stored.find((connection) => providerMatch(connection, filter)) ?? null,
    insertOne: async (connection: DatabaseConnection) => {
      if (
        stored.some(
          (item) => item.teamId.equals(connection.teamId) && item.name === connection.name,
        )
      ) {
        throw new Error('E11000 duplicate key')
      }
      stored.push(connection)

      return { insertedId: connection._id }
    },
    updateOne: async (filter: { _id: ObjectId }, update: { $set: Partial<DatabaseConnection> }) => {
      const index = stored.findIndex((connection) => connection._id.equals(filter._id))

      if (index >= 0) stored[index] = { ...stored[index]!, ...update.$set }

      return { matchedCount: index >= 0 ? 1 : 0 }
    },
  }),
})

useByosAccount({
  findCloudflareAccount: async () => activeBinding,
  findTailscaleClient: async () => null,
})

useCloudflareAccountHandle({
  cloudflareAccountHandle: async (_teamId: ObjectId, binding: CloudflareAccountBinding) => ({
    accountId: binding.accountId,
    apiKey: 'request-local-token',
  }),
})

useCloudflareD1({
  getD1Database: async (_handle: unknown, databaseId: string) => ({
    uuid: databaseId,
    name: 'orders',
    version: 'production',
    numTables: 3,
    fileSize: 4096,
    createdAt: null,
    runningInRegion: 'WNAM',
  }),
})

const { materializeCloudflareD1Connection, probeCloudflareD1Connection } =
  await import('@/lib/database-provider-cloudflare')

const teamId = new ObjectId()
const database = {
  uuid: '1938d174-65f4-4d06-934b-6f7820e10164',
  name: 'orders',
  version: 'production',
  numTables: 3,
  fileSize: 4096,
  createdAt: null,
  runningInRegion: 'WNAM',
}

function binding(id = new ObjectId()): CloudflareAccountBinding {
  return {
    id,
    accountId: '0123456789abcdef0123456789abcdef',
    accountName: 'Acme Cloudflare',
    encryptedApiKey: {
      v: 1,
      alg: 'A256GCM',
      keyId: 'test',
      iv: 'secret-iv',
      authTag: 'secret-tag',
      ciphertext: 'secret-ciphertext',
    },
    createdAt: new Date(),
  }
}

beforeEach(() => {
  stored.splice(0)
  activeBinding = binding()
})

describe('Cloudflare D1 database resources', () => {
  test('materializes idempotently without copying connector credentials', async () => {
    const first = await materializeCloudflareD1Connection({
      teamId,
      binding: activeBinding!,
      database,
      userId: new ObjectId().toHexString(),
      latencyMs: 12,
    })
    const second = await materializeCloudflareD1Connection({
      teamId,
      binding: activeBinding!,
      database: { ...database, name: 'orders-renamed' },
      userId: new ObjectId().toHexString(),
      latencyMs: 9,
    })

    expect(stored).toHaveLength(1)
    expect(second._id.equals(first._id)).toBe(true)
    expect(first.engine).toBe('cloudflare-d1')
    expect(first.encryptedCredential).toBeUndefined()
    expect(first.providerOrigin).toMatchObject({
      provider: 'cloudflare',
      product: 'd1',
      externalResourceId: database.uuid,
      capabilities: { catalog: true, query: false },
    })
    expect(JSON.stringify(first)).not.toContain('secret-ciphertext')
    expect(JSON.stringify(first)).not.toContain('request-local-token')
  })

  test('fails closed after the referenced connector binding is removed', async () => {
    const connection = await materializeCloudflareD1Connection({
      teamId,
      binding: activeBinding!,
      database,
      userId: new ObjectId().toHexString(),
      latencyMs: 12,
    })

    activeBinding = null
    await expect(probeCloudflareD1Connection(connection)).rejects.toMatchObject({
      code: 'database_provider_binding_revoked',
      status: 403,
    })
  })
})

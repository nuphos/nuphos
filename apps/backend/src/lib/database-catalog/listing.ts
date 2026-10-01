import { fitMetadataItems } from '@/lib/database-catalog/metadata'
import { databaseMongoClient } from '@/lib/database-mongo-client'

import type { MongoCollectionSummary, MongoDatabaseSummary } from '@/lib/database-catalog/types'
import type { MongoNetworkOptions } from '@/lib/database-mongo-client'
import type { Document, MongoClient } from 'mongodb'

const CONNECT_TIMEOUT_MS = 5_000
const COLLECTION_STATS_BUDGET_MS = 12_000
const MAX_DATABASES = 100
const MAX_COLLECTIONS = 500
const MAX_DATABASE_CATALOG_BYTES = 256 * 1024
const MAX_COLLECTION_CATALOG_BYTES = 512 * 1024

export const OPERATION_TIMEOUT_MS = 8_000
export const COLLECTION_STATS_TIMEOUT_MS = 2_500

function clientFor(uri: string, network: MongoNetworkOptions): MongoClient {
  return databaseMongoClient(
    uri,
    {
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
      connectTimeoutMS: CONNECT_TIMEOUT_MS,
      socketTimeoutMS: OPERATION_TIMEOUT_MS,
      maxPoolSize: 4,
      minPoolSize: 0,
    },
    network,
  )
}

export async function withMongo<T>(
  uri: string,
  network: MongoNetworkOptions,
  operation: (client: MongoClient) => Promise<T>,
): Promise<T> {
  const client = clientFor(uri, network)

  try {
    await client.connect()

    return await operation(client)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function listMongoDatabases(
  uri: string,
  network: MongoNetworkOptions = {},
): Promise<{
  databases: MongoDatabaseSummary[]
  truncated: boolean
  fetchedAt: Date
}> {
  return withMongo(uri, network, async (client) => {
    const result = await client.db('admin').admin().listDatabases({
      authorizedDatabases: true,
      nameOnly: false,
      maxTimeMS: OPERATION_TIMEOUT_MS,
    })
    const databases = result.databases
      .map((database) => ({
        name: database.name,
        sizeOnDisk: typeof database.sizeOnDisk === 'number' ? database.sizeOnDisk : null,
        empty: database.empty === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const selected = databases.slice(0, MAX_DATABASES)
    const fitted = fitMetadataItems(selected, MAX_DATABASE_CATALOG_BYTES, (items) => ({
      databases: items,
      truncated: true,
      fetchedAt: new Date(0),
    }))

    return {
      databases: fitted.items,
      truncated: databases.length > MAX_DATABASES || fitted.truncated,
      fetchedAt: new Date(),
    }
  })
}

export function collectionType(info: {
  type?: string
  options?: Document
}): MongoCollectionSummary['type'] {
  if (info.type === 'view') return 'view'
  if (info.options?.timeseries) return 'timeseries'

  return 'collection'
}

export async function collectionStats(
  database: ReturnType<MongoClient['db']>,
  name: string,
): Promise<Omit<MongoCollectionSummary, 'name' | 'type'>> {
  try {
    const stats = await database.command({
      collStats: name,
      maxTimeMS: COLLECTION_STATS_TIMEOUT_MS,
    })

    return {
      documentCount: typeof stats.count === 'number' ? stats.count : null,
      avgDocumentSize: typeof stats.avgObjSize === 'number' ? stats.avgObjSize : null,
      storageSize: typeof stats.storageSize === 'number' ? stats.storageSize : null,
      totalIndexSize: typeof stats.totalIndexSize === 'number' ? stats.totalIndexSize : null,
      indexCount: typeof stats.nindexes === 'number' ? stats.nindexes : null,
    }
  } catch {
    return {
      documentCount: null,
      avgDocumentSize: null,
      storageSize: null,
      totalIndexSize: null,
      indexCount: null,
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor

        cursor += 1
        results[index] = await fn(items[index]!)
      }
    }),
  )

  return results
}

export async function listMongoCollections(
  uri: string,
  databaseName: string,
  network: MongoNetworkOptions = {},
): Promise<{
  database: string
  collections: MongoCollectionSummary[]
  truncated: boolean
  fetchedAt: Date
}> {
  return withMongo(uri, network, async (client) => {
    const database = client.db(databaseName)
    const all = await database
      .listCollections(
        {},
        {
          nameOnly: false,
          maxTimeMS: OPERATION_TIMEOUT_MS,
        },
      )
      .toArray()
    const selected = all.slice(0, MAX_COLLECTIONS)
    const statsDeadline = Date.now() + COLLECTION_STATS_BUDGET_MS
    const collections = await mapWithConcurrency(selected, 6, async (info) => {
      const stats =
        Date.now() < statsDeadline
          ? await collectionStats(database, info.name)
          : {
              documentCount: null,
              avgDocumentSize: null,
              storageSize: null,
              totalIndexSize: null,
              indexCount: null,
            }

      return { name: info.name, type: collectionType(info), ...stats }
    })

    collections.sort((a, b) => a.name.localeCompare(b.name))
    const fitted = fitMetadataItems(collections, MAX_COLLECTION_CATALOG_BYTES, (items) => ({
      database: databaseName,
      collections: items,
      truncated: true,
      fetchedAt: new Date(0),
    }))

    return {
      database: databaseName,
      collections: fitted.items,
      truncated: all.length > MAX_COLLECTIONS || fitted.truncated,
      fetchedAt: new Date(),
    }
  })
}

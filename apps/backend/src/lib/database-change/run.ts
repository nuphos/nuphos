import { BSON } from 'mongodb'

import {
  DATABASE_CHANGE_MAX_AFFECTED_DOCUMENTS,
  DATABASE_CHANGE_TIMEOUT_MS,
  assertMongoChangeStatement,
} from '@/lib/database-change/statement'
import { databaseMongoClient } from '@/lib/database-mongo-client'

import type { MongoDatabaseChangeStatement } from '@/lib/database-change/statement'
import type { MongoNetworkOptions } from '@/lib/database-mongo-client'
import type { MongoDatabaseChangeOperation } from '@/models'
import type { Document, IndexSpecification, MongoClient } from 'mongodb'

const CONNECT_TIMEOUT_MS = 5_000

export type MongoDatabaseChangeResult = {
  operation: MongoDatabaseChangeOperation
  matchedCount: number | null
  modifiedCount: number | null
  insertedCount: number | null
  deletedCount: number | null
  indexName: string | null
  collectionChanged: boolean
  durationMs: number
  executedAt: Date
}

function clientFor(uri: string, network: MongoNetworkOptions): MongoClient {
  return databaseMongoClient(
    uri,
    {
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
      connectTimeoutMS: CONNECT_TIMEOUT_MS,
      socketTimeoutMS: DATABASE_CHANGE_TIMEOUT_MS,
      maxPoolSize: 2,
      minPoolSize: 0,
    },
    network,
  )
}

function document(value: Record<string, unknown> | undefined): Document {
  return value ? (BSON.EJSON.deserialize(value) as Document) : {}
}

async function boundedImpactCount(
  collection: ReturnType<ReturnType<MongoClient['db']>['collection']>,
  filter: Record<string, unknown> | undefined,
): Promise<number> {
  const count = await collection.countDocuments(document(filter), {
    limit: DATABASE_CHANGE_MAX_AFFECTED_DOCUMENTS + 1,
    maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
  })

  if (count > DATABASE_CHANGE_MAX_AFFECTED_DOCUMENTS) {
    throw new Error(
      `The change matches more than ${String(DATABASE_CHANGE_MAX_AFFECTED_DOCUMENTS)} documents and exceeds the gateway impact limit.`,
    )
  }

  return count
}

export async function runMongoDatabaseChange(
  uri: string,
  statement: MongoDatabaseChangeStatement,
  network: MongoNetworkOptions = {},
): Promise<MongoDatabaseChangeResult> {
  assertMongoChangeStatement(statement)
  const startedAt = Date.now()
  const client = clientFor(uri, network)
  let matchedCount: number | null = null
  let modifiedCount: number | null = null
  let insertedCount: number | null = null
  let deletedCount: number | null = null
  let indexName: string | null = null
  let collectionChanged = false

  try {
    await client.connect()
    const db = client.db(statement.database)
    const collection = db.collection(statement.collection)

    switch (statement.operation) {
      case 'insertOne': {
        const result = await collection.insertOne(document(statement.document), {
          maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
        })

        insertedCount = result.acknowledged ? 1 : 0
        break
      }
      case 'insertMany': {
        const docs = (statement.documents ?? []).map((value) => document(value))
        const result = await collection.insertMany(docs, {
          ordered: true,
          maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
        })

        insertedCount = result.insertedCount
        break
      }
      case 'updateOne': {
        await boundedImpactCount(collection, statement.filter)
        const result = await collection.updateOne(
          document(statement.filter),
          document(statement.update),
          {
            upsert: false,
            maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
          },
        )

        matchedCount = result.matchedCount
        modifiedCount = result.modifiedCount
        break
      }
      case 'updateMany': {
        await boundedImpactCount(collection, statement.filter)
        const result = await collection.updateMany(
          document(statement.filter),
          document(statement.update),
          {
            upsert: false,
            maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
          },
        )

        matchedCount = result.matchedCount
        modifiedCount = result.modifiedCount
        break
      }
      case 'deleteOne': {
        matchedCount = await boundedImpactCount(collection, statement.filter)
        const result = await collection.deleteOne(document(statement.filter), {
          maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
        })

        deletedCount = result.deletedCount
        break
      }
      case 'deleteMany': {
        matchedCount = await boundedImpactCount(collection, statement.filter)
        const result = await collection.deleteMany(document(statement.filter), {
          maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
        })

        deletedCount = result.deletedCount
        break
      }
      case 'createCollection':
        await db.createCollection(statement.collection, { maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS })
        collectionChanged = true
        break
      case 'dropCollection':
        collectionChanged = await db.dropCollection(statement.collection, {
          maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
        })
        break
      case 'createIndex':
        indexName = await collection.createIndex(
          document(statement.indexKeys) as IndexSpecification,
          {
            ...(statement.indexName ? { name: statement.indexName } : {}),
            unique: statement.unique ?? false,
            sparse: statement.sparse ?? false,
            maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS,
          },
        )
        break
      case 'dropIndex':
        await collection.dropIndex(statement.indexName!, { maxTimeMS: DATABASE_CHANGE_TIMEOUT_MS })
        indexName = statement.indexName!
        break
    }

    return {
      operation: statement.operation,
      matchedCount,
      modifiedCount,
      insertedCount,
      deletedCount,
      indexName,
      collectionChanged,
      durationMs: Date.now() - startedAt,
      executedAt: new Date(),
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}

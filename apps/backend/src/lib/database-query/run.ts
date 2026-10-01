import { BSON } from 'mongodb'

import { databaseMongoClient } from '@/lib/database-mongo-client'
import { assertMongoReadQuery } from '@/lib/database-query/guard'
import { boundQueryRows, columnsFor, sanitizeMongoRows } from '@/lib/database-query/sanitize'
import {
  DATABASE_QUERY_DEFAULT_LIMIT,
  DATABASE_QUERY_MAX_LIMIT,
  DATABASE_QUERY_TIMEOUT_MS,
} from '@/lib/database-query/types'

import type { MongoNetworkOptions } from '@/lib/database-mongo-client'
import type { DatabaseQueryResult, MongoReadQuery } from '@/lib/database-query/types'
import type { Document } from 'mongodb'

const CONNECT_TIMEOUT_MS = 5_000

function clientFor(uri: string, network: MongoNetworkOptions) {
  return databaseMongoClient(
    uri,
    {
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
      connectTimeoutMS: CONNECT_TIMEOUT_MS,
      socketTimeoutMS: DATABASE_QUERY_TIMEOUT_MS,
      maxPoolSize: 4,
      minPoolSize: 0,
    },
    network,
  )
}

function deserializeDocument(value: Record<string, unknown> | undefined): Document {
  return value ? (BSON.EJSON.deserialize(value) as Document) : {}
}

export async function runMongoReadQuery(
  uri: string,
  query: MongoReadQuery,
  network: MongoNetworkOptions = {},
): Promise<DatabaseQueryResult> {
  assertMongoReadQuery(query)
  const startedAt = Date.now()
  const limit = Math.min(query.limit ?? DATABASE_QUERY_DEFAULT_LIMIT, DATABASE_QUERY_MAX_LIMIT)
  const skip = query.skip ?? 0
  const client = clientFor(uri, network)

  try {
    await client.connect()
    const collection = client.db(query.database).collection(query.collection)
    let rawRows: unknown[]
    let hasMore = false

    if (query.operation === 'find') {
      rawRows = await collection
        .find(deserializeDocument(query.filter), {
          projection: deserializeDocument(query.projection),
          sort: query.sort,
          skip,
          limit: limit + 1,
          maxTimeMS: DATABASE_QUERY_TIMEOUT_MS,
        })
        .toArray()
      hasMore = rawRows.length > limit
      rawRows = rawRows.slice(0, limit)
    } else if (query.operation === 'aggregate') {
      const pipeline = (query.pipeline ?? []).map(
        (stage) => BSON.EJSON.deserialize(stage) as Document,
      )

      rawRows = await collection
        .aggregate([...pipeline, { $skip: skip }, { $limit: limit + 1 }], {
          maxTimeMS: DATABASE_QUERY_TIMEOUT_MS,
          allowDiskUse: false,
        })
        .toArray()
      hasMore = rawRows.length > limit
      rawRows = rawRows.slice(0, limit)
    } else if (query.operation === 'count') {
      const count = await collection.countDocuments(deserializeDocument(query.filter), {
        maxTimeMS: DATABASE_QUERY_TIMEOUT_MS,
        limit: DATABASE_QUERY_MAX_LIMIT + 1,
      })

      rawRows = [
        {
          count: Math.min(count, DATABASE_QUERY_MAX_LIMIT),
          exact: count <= DATABASE_QUERY_MAX_LIMIT,
        },
      ]
      hasMore = count > DATABASE_QUERY_MAX_LIMIT
    } else {
      const plan = await collection
        .find(deserializeDocument(query.filter), {
          projection: deserializeDocument(query.projection),
          sort: query.sort,
          skip,
          limit,
          maxTimeMS: DATABASE_QUERY_TIMEOUT_MS,
        })
        .explain('executionStats')

      rawRows = [plan]
    }

    const sanitized = sanitizeMongoRows(rawRows)
    const bounded = boundQueryRows(sanitized.rows)
    const sizeTruncated = bounded.truncated
    const truncated = hasMore || sizeTruncated

    return {
      operation: query.operation,
      columns: columnsFor(bounded.rows),
      rows: bounded.rows,
      rowCount: bounded.rows.length,
      durationMs: Date.now() - startedAt,
      truncated,
      truncationReason: sizeTruncated ? 'response-size' : hasMore ? 'row-limit' : null,
      nextSkip:
        hasMore && !sizeTruncated && (query.operation === 'find' || query.operation === 'aggregate')
          ? skip + bounded.rows.length
          : null,
      redactedFields: sanitized.redactedFields,
      executedAt: new Date(),
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}

export function mongoQueryShape(query: MongoReadQuery): string[] {
  if (query.operation === 'aggregate')
    return (query.pipeline ?? []).flatMap((stage) => Object.keys(stage)).slice(0, 50)

  return Object.keys(query.filter ?? {}).slice(0, 50)
}

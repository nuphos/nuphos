import {
  COLLECTION_STATS_TIMEOUT_MS,
  OPERATION_TIMEOUT_MS,
  collectionStats,
  collectionType,
  withMongo,
} from '@/lib/database-catalog/listing'
import {
  boundedMetadataRecord,
  jsonRecord,
  metadataByteSize,
  sanitizeMongoViewPipeline,
} from '@/lib/database-catalog/metadata'
import { SCHEMA_SAMPLE_SIZE, inferMongoSchema } from '@/lib/database-catalog/schema'

import type { MongoCollectionDetail } from '@/lib/database-catalog/types'
import type { MongoNetworkOptions } from '@/lib/database-mongo-client'
import type { Document, MongoClient } from 'mongodb'

const MAX_INDEXES = 200
const MAX_COLLECTION_DETAIL_BYTES = 768 * 1024
const MAX_OPTIONS_BYTES = 64 * 1024
const MAX_VALIDATOR_BYTES = 128 * 1024

const SAFE_COLLECTION_OPTION_KEYS = new Set([
  'capped',
  'size',
  'max',
  'timeseries',
  'clusteredIndex',
  'changeStreamPreAndPostImages',
  'expireAfterSeconds',
  'storageEngine',
  'collation',
  'viewOn',
])

function safeCollectionOptions(options: Document | undefined): {
  value: Record<string, unknown>
  truncated: boolean
} {
  const selected: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(options ?? {})) {
    if (SAFE_COLLECTION_OPTION_KEYS.has(key)) selected[key] = value
  }

  return boundedMetadataRecord(selected, MAX_OPTIONS_BYTES)
}

async function collectionSharding(
  client: MongoClient,
  databaseName: string,
  collectionName: string,
): Promise<MongoCollectionDetail['sharding']> {
  try {
    const namespace = `${databaseName}.${collectionName}`
    const metadata = await client
      .db('config')
      .collection('collections')
      .findOne({ _id: namespace, dropped: { $ne: true } } as Document, {
        projection: { key: 1, unique: 1, noBalance: 1, unsplittable: 1 },
        maxTimeMS: COLLECTION_STATS_TIMEOUT_MS,
      })

    if (!metadata || metadata.unsplittable === true) {
      return { available: true, sharded: false, shardKey: null, unique: null, balancing: null }
    }

    return {
      available: true,
      sharded: true,
      shardKey: metadata.key && typeof metadata.key === 'object' ? jsonRecord(metadata.key) : null,
      unique: metadata.unique === true,
      balancing: metadata.noBalance === true ? 'disabled' : 'enabled',
    }
  } catch {
    // config.collections is intentionally best-effort: many application roles
    // can read their database but cannot inspect cluster configuration.
    return { available: false, sharded: null, shardKey: null, unique: null, balancing: null }
  }
}

function fitCollectionDetail(detail: MongoCollectionDetail): MongoCollectionDetail {
  if (metadataByteSize(detail) <= MAX_COLLECTION_DETAIL_BYTES) return detail
  const compact: MongoCollectionDetail = {
    ...detail,
    metadataTruncated: true,
    options: {},
    indexes: detail.indexes.slice(0, 50),
    indexesTruncated: true,
    validation: {
      ...detail.validation,
      validator: detail.validation.validator
        ? { $nuphosMetadata: 'Validator metadata exceeded the safe response limit.' }
        : null,
      truncated: detail.validation.validator !== null || detail.validation.truncated,
    },
    view: detail.view
      ? {
          ...detail.view,
          pipeline: detail.view.pipeline.slice(0, 10),
          pipelineTruncated: detail.view.pipeline.length > 10 || detail.view.pipelineTruncated,
        }
      : null,
    schema: {
      ...detail.schema,
      fields: detail.schema.fields.slice(0, 100),
      truncated: detail.schema.fields.length > 100 || detail.schema.truncated,
    },
  }

  if (metadataByteSize(compact) <= MAX_COLLECTION_DETAIL_BYTES) return compact

  return {
    ...compact,
    indexes: [],
    schema: { ...compact.schema, fields: [], truncated: true },
  }
}

export async function getMongoCollectionDetail(
  uri: string,
  databaseName: string,
  collectionName: string,
  network: MongoNetworkOptions = {},
): Promise<MongoCollectionDetail | null> {
  return withMongo(uri, network, async (client) => {
    const database = client.db(databaseName)
    const info = await database
      .listCollections(
        { name: collectionName },
        {
          nameOnly: false,
          maxTimeMS: OPERATION_TIMEOUT_MS,
        },
      )
      .next()

    if (!info) return null
    const collection = database.collection(collectionName)
    const [stats, indexes, documents, sharding] = await Promise.all([
      collectionStats(database, collectionName),
      collection.indexes({ maxTimeMS: OPERATION_TIMEOUT_MS }).catch(() => []),
      collection
        .aggregate([{ $sample: { size: SCHEMA_SAMPLE_SIZE } }], {
          maxTimeMS: OPERATION_TIMEOUT_MS,
          allowDiskUse: false,
        })
        .toArray()
        .catch(() => []),
      collectionSharding(client, databaseName, collectionName),
    ])
    const options = safeCollectionOptions(info.options)
    const validator = info.options?.validator
    const safeValidator =
      validator && typeof validator === 'object'
        ? boundedMetadataRecord(validator, MAX_VALIDATOR_BYTES)
        : { value: null, truncated: false }
    const viewPipeline = sanitizeMongoViewPipeline(info.options?.pipeline)
    const selectedIndexes = indexes.slice(0, MAX_INDEXES)
    const detail: MongoCollectionDetail = {
      database: databaseName,
      name: collectionName,
      type: collectionType(info),
      options: options.value,
      stats,
      indexes: selectedIndexes.map((index) => ({
        name: index.name ?? '(unnamed)',
        keys: jsonRecord(index.key ?? {}),
        unique: index.unique === true,
        sparse: index.sparse === true,
        hidden: index.hidden === true,
        expireAfterSeconds:
          typeof index.expireAfterSeconds === 'number' ? index.expireAfterSeconds : null,
        partial: index.partialFilterExpression !== undefined,
        collation: index.collation !== undefined,
      })),
      indexesTruncated: indexes.length > MAX_INDEXES,
      validation: {
        validator: safeValidator.value,
        level:
          typeof info.options?.validationLevel === 'string' ? info.options.validationLevel : null,
        action:
          typeof info.options?.validationAction === 'string' ? info.options.validationAction : null,
        truncated: safeValidator.truncated,
      },
      view:
        typeof info.options?.viewOn === 'string'
          ? {
              source: info.options.viewOn,
              pipeline: viewPipeline.pipeline,
              pipelineTruncated: viewPipeline.truncated,
            }
          : null,
      sharding,
      schema: inferMongoSchema(documents),
      metadataTruncated:
        options.truncated ||
        safeValidator.truncated ||
        viewPipeline.truncated ||
        indexes.length > MAX_INDEXES,
    }

    return fitCollectionDetail(detail)
  })
}

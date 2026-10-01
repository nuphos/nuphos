import { z } from 'zod'

import {
  databaseAgentPolicySchema,
  databaseNetworkModeSchema,
  databaseRelationSchema,
  databaseResourceEngineSchema,
} from './connection-schemas'
import { databaseMongoReadQuerySchema } from './request-schemas'
import { objectIdSchema } from './shared'

const healthSchema = z.object({
  status: z.enum(['healthy', 'unreachable', 'auth-failed', 'permission-denied', 'unknown']),
  errorCategory: z
    .enum([
      'dns',
      'route',
      'tls',
      'authentication',
      'authorization',
      'database-unavailable',
      'unknown',
    ])
    .nullable(),
  message: z.string().nullable(),
  checkedAt: z.string().datetime(),
  latencyMs: z.number().nonnegative(),
  databaseName: z.string().nullable(),
  serverVersion: z.string().nullable(),
  readOnly: z.enum(['verified', 'unverified', 'writable']),
})

export const databaseConnectionResponseSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  engine: databaseResourceEngineSchema,
  environment: z.string(),
  tags: z.array(z.string()),
  endpoint: z.string(),
  databaseName: z.string().nullable(),
  tls: z.object({ enabled: z.boolean(), mode: z.string() }),
  networkMode: databaseNetworkModeSchema,
  tailscale: z.object({ bindingId: objectIdSchema, tag: z.string() }).optional(),
  providerOrigin: z
    .object({
      provider: z.literal('cloudflare'),
      product: z.literal('d1'),
      integrationId: objectIdSchema,
      externalResourceId: z.string(),
      accountId: z.string(),
      accountName: z.string().nullable(),
      region: z.string().nullable(),
      capabilities: z.object({
        catalog: z.boolean(),
        query: z.boolean(),
        monitoring: z.boolean(),
        changes: z.boolean(),
        backupRestore: z.boolean(),
        parameters: z.boolean(),
      }),
    })
    .optional(),
  agentPolicy: databaseAgentPolicySchema,
  relations: z.array(databaseRelationSchema),
  health: healthSchema,
  canUse: z.boolean(),
  access: z
    .object({
      memberAllowList: z.array(z.string()),
      updatedAt: z.string().datetime().nullable(),
      updatedBy: z.string().nullable(),
      agentPolicy: databaseAgentPolicySchema,
    })
    .optional(),
  changeApprovalPolicy: z.object({
    minimumApprovals: z.number().int().min(1),
    version: z.number().int().min(1),
    updatedAt: z.string().datetime(),
    updatedBy: z.string(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const testResponseSchema = z.object({
  endpoint: z.string(),
  databaseName: z.string().nullable(),
  tls: z.object({ enabled: z.boolean(), mode: z.string() }),
  health: healthSchema,
})

const nullableMetricSchema = z.number().nonnegative().nullable()
const databaseSummarySchema = z.object({
  name: z.string(),
  sizeOnDisk: nullableMetricSchema,
  empty: z.boolean(),
})
const collectionStatsSchema = z.object({
  documentCount: nullableMetricSchema,
  avgDocumentSize: nullableMetricSchema,
  storageSize: nullableMetricSchema,
  totalIndexSize: nullableMetricSchema,
  indexCount: nullableMetricSchema,
})
const collectionSummarySchema = collectionStatsSchema.extend({
  name: z.string(),
  type: z.enum(['collection', 'view', 'timeseries']),
})
const fetchedAtSchema = z.string().datetime()

export const databaseCatalogResponseSchema = z.object({
  databases: z.array(databaseSummarySchema),
  truncated: z.boolean(),
  fetchedAt: fetchedAtSchema,
})
export const databaseCollectionsResponseSchema = z.object({
  database: z.string(),
  collections: z.array(collectionSummarySchema),
  truncated: z.boolean(),
  fetchedAt: fetchedAtSchema,
})
export const databaseCollectionDetailResponseSchema = z.object({
  database: z.string(),
  name: z.string(),
  type: z.enum(['collection', 'view', 'timeseries']),
  options: z.record(z.unknown()),
  stats: collectionStatsSchema,
  indexes: z.array(
    z.object({
      name: z.string(),
      keys: z.record(z.unknown()),
      unique: z.boolean(),
      sparse: z.boolean(),
      hidden: z.boolean(),
      expireAfterSeconds: z.number().nullable(),
      partial: z.boolean(),
      collation: z.boolean(),
    }),
  ),
  indexesTruncated: z.boolean(),
  validation: z.object({
    validator: z.record(z.unknown()).nullable(),
    level: z.string().nullable(),
    action: z.string().nullable(),
    truncated: z.boolean(),
  }),
  view: z
    .object({
      source: z.string(),
      pipeline: z.array(z.record(z.unknown())),
      pipelineTruncated: z.boolean(),
    })
    .nullable(),
  sharding: z.object({
    available: z.boolean(),
    sharded: z.boolean().nullable(),
    shardKey: z.record(z.unknown()).nullable(),
    unique: z.boolean().nullable(),
    balancing: z.enum(['enabled', 'disabled']).nullable(),
  }),
  schema: z.object({
    sampleSize: z.number().int().nonnegative(),
    fields: z.array(
      z.object({
        path: z.string(),
        presence: z.number().min(0).max(1),
        occurrences: z.number().int().nonnegative(),
        types: z.array(z.object({ type: z.string(), count: z.number().int().nonnegative() })),
      }),
    ),
    truncated: z.boolean(),
  }),
  metadataTruncated: z.boolean(),
})

export const databaseQueryResultSchema = z.object({
  operation: z.enum(['find', 'aggregate', 'count', 'explain']),
  columns: z.array(z.string()),
  rows: z.array(z.unknown()),
  rowCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  truncated: z.boolean(),
  truncationReason: z.enum(['row-limit', 'response-size']).nullable(),
  nextSkip: z.number().int().nonnegative().nullable(),
  redactedFields: z.array(z.string()),
  executedAt: z.string().datetime(),
})
export const databaseQueryAuditSchema = z.object({
  id: objectIdSchema,
  userId: z.string(),
  sessionId: z.string().nullable(),
  source: z.enum(['human', 'agent']),
  networkMode: databaseNetworkModeSchema,
  executionPlane: z.enum(['backend', 'tailscale-tsnet']),
  networkBindingId: objectIdSchema.nullable(),
  networkTag: z.string().nullable(),
  operation: z.enum(['find', 'aggregate', 'count', 'explain']),
  database: z.string(),
  collection: z.string(),
  queryShape: z.array(z.string()),
  queryStatement: z.string().nullable(),
  queryStatementTruncated: z.boolean(),
  queryRedactedFields: z.array(z.string()),
  queryInput: databaseMongoReadQuerySchema.nullable(),
  outcome: z.enum(['running', 'succeeded', 'rejected', 'failed']),
  durationMs: z.number().int().nonnegative().nullable(),
  rowCount: z.number().int().nonnegative().nullable(),
  truncated: z.boolean().nullable(),
  errorCategory: z
    .enum([
      'dns',
      'route',
      'tls',
      'authentication',
      'authorization',
      'database-unavailable',
      'unknown',
    ])
    .nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
})

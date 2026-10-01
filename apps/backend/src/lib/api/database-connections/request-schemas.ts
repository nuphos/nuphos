import { z } from 'zod'

import { objectIdSchema } from './shared'

const catalogRefreshSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true')

export const databaseCatalogQuerySchema = z
  .object({
    refresh: catalogRefreshSchema,
  })
  .strict()
export const databaseCatalogCollectionsQuerySchema = z
  .object({
    database: z.string().min(1).max(256),
    refresh: catalogRefreshSchema,
  })
  .strict()
export const databaseCatalogCollectionQuerySchema = databaseCatalogCollectionsQuerySchema
  .extend({
    collection: z.string().min(1).max(512),
  })
  .strict()

const jsonDocumentSchema = z.record(z.unknown())

export const databaseMongoReadQuerySchema = z
  .object({
    operation: z.enum(['find', 'aggregate', 'count', 'explain']).default('find'),
    database: z.string().min(1).max(256),
    collection: z.string().min(1).max(512),
    filter: jsonDocumentSchema.default({}),
    projection: jsonDocumentSchema.default({}),
    sort: z.record(z.union([z.literal(1), z.literal(-1)])).default({}),
    pipeline: z.array(jsonDocumentSchema).max(50).default([]),
    skip: z.number().int().min(0).max(10_000_000).default(0),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict()
export const databaseQueryAuditListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()
export const databaseMonitoringHistoryQuerySchema = z
  .object({
    rangeMinutes: z.coerce.number().int().min(15).max(10_080).default(60),
  })
  .strict()
const mongoChangeBaseSchema = z
  .object({
    database: z.string().trim().min(1).max(256),
    collection: z.string().trim().min(1).max(512),
  })
  .strict()
const mongoChangeDocumentSchema = z.record(z.unknown())

export const mongoChangeStatementSchema = z.discriminatedUnion('operation', [
  mongoChangeBaseSchema
    .extend({ operation: z.literal('insertOne'), document: mongoChangeDocumentSchema })
    .strict(),
  mongoChangeBaseSchema
    .extend({
      operation: z.literal('insertMany'),
      documents: z.array(mongoChangeDocumentSchema).min(1).max(1_000),
    })
    .strict(),
  mongoChangeBaseSchema
    .extend({
      operation: z.literal('updateOne'),
      filter: mongoChangeDocumentSchema,
      update: mongoChangeDocumentSchema,
    })
    .strict(),
  mongoChangeBaseSchema
    .extend({
      operation: z.literal('updateMany'),
      filter: mongoChangeDocumentSchema,
      update: mongoChangeDocumentSchema,
    })
    .strict(),
  mongoChangeBaseSchema
    .extend({ operation: z.literal('deleteOne'), filter: mongoChangeDocumentSchema })
    .strict(),
  mongoChangeBaseSchema
    .extend({ operation: z.literal('deleteMany'), filter: mongoChangeDocumentSchema })
    .strict(),
  mongoChangeBaseSchema.extend({ operation: z.literal('createCollection') }).strict(),
  mongoChangeBaseSchema.extend({ operation: z.literal('dropCollection') }).strict(),
  mongoChangeBaseSchema
    .extend({
      operation: z.literal('createIndex'),
      indexKeys: z.record(
        z.union([z.literal(1), z.literal(-1), z.literal('text'), z.literal('hashed')]),
      ),
      indexName: z.string().trim().min(1).max(128).optional(),
      unique: z.boolean().default(false),
      sparse: z.boolean().default(false),
    })
    .strict(),
  mongoChangeBaseSchema
    .extend({ operation: z.literal('dropIndex'), indexName: z.string().trim().min(1).max(128) })
    .strict(),
])

const changeRequestFields = {
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(20_000),
  risk: z.string().trim().min(1).max(20_000),
  rollbackPlan: z.string().trim().min(1).max(20_000),
  statement: mongoChangeStatementSchema,
  authorizedExecutorUserIds: z.array(objectIdSchema).max(100).default([]),
  expiresAt: z.string().datetime().nullable().default(null),
}

export const databaseChangeRequestCreateSchema = z.object(changeRequestFields).strict()
export const databaseChangeRequestUpdateSchema = z
  .object({
    title: changeRequestFields.title.optional(),
    description: changeRequestFields.description.optional(),
    risk: changeRequestFields.risk.optional(),
    rollbackPlan: changeRequestFields.rollbackPlan.optional(),
    statement: changeRequestFields.statement.optional(),
    authorizedExecutorUserIds: changeRequestFields.authorizedExecutorUserIds.optional(),
    expiresAt: changeRequestFields.expiresAt.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one change request field to update',
  )
export const databaseChangeRequestListSchema = z
  .object({
    status: z
      .enum([
        'draft',
        'pending_approval',
        'approved',
        'executing',
        'succeeded',
        'failed',
        'rejected',
        'canceled',
        'expired',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()
export const databaseChangeDecisionSchema = z
  .object({
    comment: z.string().trim().max(4_000).nullable().default(null),
  })
  .strict()
export const databaseChangeExecuteSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict()
export const databaseChangeApprovalPolicySchema = z
  .object({
    minimumApprovals: z.number().int().min(1).max(20),
  })
  .strict()

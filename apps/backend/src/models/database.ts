import { db } from '@/lib/db'

import type { MongoMonitoringSnapshot } from '@/lib/database-monitoring'
import type { BindingAccess, EncryptedEnvelope } from '@/models/common'
import type { Collection, ObjectId } from 'mongodb'

export type DatabaseEngine = 'mongodb' | 'postgresql' | 'mysql' | 'cloudflare-d1'
export type DatabaseNetworkMode = 'public' | 'tailscale' | 'cluster-relay'
export type DatabaseAgentPolicy = 'disabled' | 'metadata-only' | 'read-only'
export type DatabaseHealthStatus =
  'healthy' | 'unreachable' | 'auth-failed' | 'permission-denied' | 'unknown'
export type DatabaseErrorCategory =
  'dns' | 'route' | 'tls' | 'authentication' | 'authorization' | 'database-unavailable' | 'unknown'
export type DatabaseReadOnlyCapability = 'verified' | 'unverified' | 'writable'

export type DatabaseConnectionAccess = BindingAccess & {
  agentPolicy: DatabaseAgentPolicy
}

export type DatabaseTailscaleNetwork = {
  // References a team-scoped Tailscale OAuth client binding. The OAuth secret
  // remains in the BYOS envelope and is resolved only by the backend when it
  // asks the local tsnet dialer for an isolated data-plane identity.
  bindingId: ObjectId
  tag: string
}

export type DatabaseRelation = {
  kind: 'service' | 'deployment' | 'cluster' | 'repository'
  id: string
  label?: string
}

export type DatabaseConnectionHealth = {
  status: DatabaseHealthStatus
  errorCategory: DatabaseErrorCategory | null
  message: string | null
  checkedAt: Date
  latencyMs: number
  databaseName: string | null
  serverVersion: string | null
  readOnly: DatabaseReadOnlyCapability
}

export type DatabaseProviderCapabilities = {
  catalog: boolean
  query: boolean
  monitoring: boolean
  changes: boolean
  backupRestore: boolean
  parameters: boolean
}

export type DatabaseProviderOrigin = {
  provider: 'cloudflare'
  product: 'd1'
  integrationId: ObjectId
  externalResourceId: string
  accountId: string
  accountName: string | null
  region: string | null
  capabilities: DatabaseProviderCapabilities
}

export type DatabaseConnection = {
  _id: ObjectId
  teamId: ObjectId
  name: string
  engine: DatabaseEngine
  environment: string
  tags: string[]
  endpoint: string
  databaseName: string | null
  tls: {
    enabled: boolean
    mode: string
  }
  networkMode: DatabaseNetworkMode
  tailscale?: DatabaseTailscaleNetwork
  // Direct connections own an encrypted URI. Provider-managed resources keep
  // only providerOrigin and resolve the active connector binding at request
  // time, so provider credentials are never copied into this collection.
  encryptedCredential?: EncryptedEnvelope
  providerOrigin?: DatabaseProviderOrigin
  access: DatabaseConnectionAccess
  changeApprovalPolicy?: DatabaseChangeApprovalPolicy
  relations: DatabaseRelation[]
  health: DatabaseConnectionHealth
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
}

export type DatabaseChangeApprovalPolicy = {
  minimumApprovals: number
  version: number
  updatedAt: Date
  updatedBy: string
}

export type DatabaseChangeKind = 'dml' | 'ddl'
export type DatabaseChangeStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'canceled'
  | 'expired'

export type MongoDatabaseChangeOperation =
  | 'insertOne'
  | 'insertMany'
  | 'updateOne'
  | 'updateMany'
  | 'deleteOne'
  | 'deleteMany'
  | 'createCollection'
  | 'dropCollection'
  | 'createIndex'
  | 'dropIndex'

export type DatabaseChangeApproval = {
  userId: string
  digest: string
  policyVersion: number
  comment: string | null
  createdAt: Date
}

export type DatabaseChangeEventType =
  | 'created'
  | 'updated'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'canceled'
  | 'execution_started'
  | 'execution_succeeded'
  | 'execution_failed'
  | 'policy_invalidated'

export type DatabaseChangeEvent = {
  type: DatabaseChangeEventType
  actorUserId: string
  at: Date
  comment: string | null
}

/**
 * A team-scoped, approval-gated database mutation. The executable statement is
 * encrypted separately from the database credential; only a bounded redacted
 * rendering is returned to clients. Approval and execution authority are
 * deliberately independent: approvers never become executors implicitly.
 */
export type DatabaseChangeRequest = {
  _id: ObjectId
  teamId: ObjectId
  connectionId: ObjectId
  engine: 'mongodb'
  kind: DatabaseChangeKind
  operation: MongoDatabaseChangeOperation
  database: string
  collection: string
  title: string
  description: string
  risk: string
  rollbackPlan: string
  encryptedStatement: EncryptedEnvelope
  statementDigest: string
  statementPreview: string
  statementPreviewTruncated: boolean
  statementRedactedFields: string[]
  requesterUserId: string
  authorizedExecutorUserIds: string[]
  approvals: DatabaseChangeApproval[]
  policySnapshot: DatabaseChangeApprovalPolicy
  status: DatabaseChangeStatus
  expiresAt: Date | null
  executionId: string | null
  executionStartedAt: Date | null
  executionCompletedAt: Date | null
  executionResult: Record<string, unknown> | null
  executionErrorCategory: DatabaseErrorCategory | null
  executionErrorMessage: string | null
  events: DatabaseChangeEvent[]
  createdAt: Date
  updatedAt: Date
}

export type DatabaseQueryOperation = 'find' | 'aggregate' | 'count' | 'explain'
export type DatabaseQueryOutcome = 'running' | 'succeeded' | 'rejected' | 'failed'

/**
 * Audit metadata for every database gateway request. A sanitized, bounded
 * statement is retained for operator history; raw request bodies, result
 * documents, credentials, and sensitive query values are never persisted.
 * The row is inserted before database I/O so a query cannot execute when its
 * audit intent cannot be persisted.
 */
export type DatabaseQueryAudit = {
  _id: ObjectId
  teamId: ObjectId
  connectionId: ObjectId
  userId: string
  sessionId: string | null
  source: 'human' | 'agent'
  networkMode?: DatabaseNetworkMode
  executionPlane?: 'backend' | 'tailscale-tsnet'
  networkBindingId?: ObjectId | null
  networkTag?: string | null
  operation: DatabaseQueryOperation
  database: string
  collection: string
  queryShape: string[]
  queryStatement?: string
  queryStatementTruncated?: boolean
  queryRedactedFields?: string[]
  queryInput?: {
    operation: DatabaseQueryOperation
    database: string
    collection: string
    filter?: Record<string, unknown>
    projection?: Record<string, unknown>
    sort?: Record<string, 1 | -1>
    pipeline?: Record<string, unknown>[]
    skip?: number
    limit?: number
  }
  outcome: DatabaseQueryOutcome
  durationMs: number | null
  rowCount: number | null
  truncated: boolean | null
  errorCategory: DatabaseErrorCategory | null
  createdAt: Date
  completedAt: Date | null
}

/**
 * Value-only MongoDB process metrics. The source command response is never
 * persisted: this record contains only an allowlisted normalized snapshot,
 * bounded replica member metadata, and an expiry used by the TTL index.
 */
export type DatabaseMetricSample = MongoMonitoringSnapshot & {
  _id: ObjectId
  teamId: ObjectId
  connectionId: ObjectId
  expiresAt: Date
}

export const databaseConnections = (): Collection<DatabaseConnection> =>
  db().collection<DatabaseConnection>('database_connections')

export const databaseQueryAudits = (): Collection<DatabaseQueryAudit> =>
  db().collection<DatabaseQueryAudit>('database_query_audits')

export const databaseMetricSamples = (): Collection<DatabaseMetricSample> =>
  db().collection<DatabaseMetricSample>('database_metric_samples')

export const databaseChangeRequests = (): Collection<DatabaseChangeRequest> =>
  db().collection<DatabaseChangeRequest>('database_change_requests')

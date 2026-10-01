import type { MongoReadQueryInput } from './mongo-types'

export type DatabaseEngine = 'mongodb' | 'postgresql' | 'mysql' | 'cloudflare-d1'
export type DirectDatabaseEngine = Exclude<DatabaseEngine, 'cloudflare-d1'>
export type DatabaseNetworkMode = 'public' | 'tailscale' | 'cluster-relay'
export type DatabaseAgentPolicy = 'disabled' | 'metadata-only' | 'read-only'
export type DatabaseTailscaleNetwork = { bindingId: string; tag: string }
export type DatabaseConnectionInput = {
  name: string
  engine: DirectDatabaseEngine
  connectionUri: string
  environment: string
  tags: string[]
  networkMode: DatabaseNetworkMode
  tailscale?: DatabaseTailscaleNetwork
  access: { memberAllowList: string[]; agentPolicy: DatabaseAgentPolicy }
  changeApprovalPolicy?: { minimumApprovals: number }
  relations: {
    kind: 'service' | 'deployment' | 'cluster' | 'repository'
    id: string
    label?: string
  }[]
}

export type DatabaseConnection = Omit<
  DatabaseConnectionInput,
  'connectionUri' | 'access' | 'engine'
> & {
  id: string
  engine: DatabaseEngine
  endpoint: string
  databaseName: string | null
  providerOrigin?: {
    provider: 'cloudflare'
    product: 'd1'
    integrationId: string
    externalResourceId: string
    accountId: string
    accountName: string | null
    region: string | null
    capabilities: {
      catalog: boolean
      query: boolean
      monitoring: boolean
      changes: boolean
      backupRestore: boolean
      parameters: boolean
    }
  }
  tls: { enabled: boolean; mode: string }
  agentPolicy: DatabaseAgentPolicy
  health: {
    status: 'healthy' | 'unreachable' | 'auth-failed' | 'permission-denied' | 'unknown'
    errorCategory:
      | 'dns'
      | 'route'
      | 'tls'
      | 'authentication'
      | 'authorization'
      | 'database-unavailable'
      | 'unknown'
      | null
    message: string | null
    checkedAt: string
    latencyMs: number
    databaseName: string | null
    serverVersion: string | null
    readOnly: 'verified' | 'unverified' | 'writable'
  }
  canUse: boolean
  access?: {
    memberAllowList: string[]
    updatedAt: string | null
    updatedBy: string | null
    agentPolicy: DatabaseAgentPolicy
  }
  changeApprovalPolicy: {
    minimumApprovals: number
    version: number
    updatedAt: string
    updatedBy: string
  }
  createdAt: string
  updatedAt: string
}

export type DatabaseQueryResult = {
  operation: MongoReadQueryInput['operation']
  columns: string[]
  rows: unknown[]
  rowCount: number
  durationMs: number
  truncated: boolean
  truncationReason: 'row-limit' | 'response-size' | null
  nextSkip: number | null
  redactedFields: string[]
  executedAt: string
}

export type DatabaseQueryAudit = {
  id: string
  userId: string
  sessionId: string | null
  source: 'human' | 'agent'
  operation: MongoReadQueryInput['operation']
  database: string
  collection: string
  queryShape: string[]
  queryStatement: string | null
  queryStatementTruncated: boolean
  queryRedactedFields: string[]
  queryInput: MongoReadQueryInput | null
  outcome: 'running' | 'succeeded' | 'rejected' | 'failed'
  durationMs: number | null
  rowCount: number | null
  truncated: boolean | null
  errorCategory: string | null
  createdAt: string
  completedAt: string | null
}

export type MongoDatabaseChangeStatement = {
  operation:
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
  database: string
  collection: string
  document?: Record<string, unknown>
  documents?: Record<string, unknown>[]
  filter?: Record<string, unknown>
  update?: Record<string, unknown>
  indexKeys?: Record<string, 1 | -1 | 'text' | 'hashed'>
  indexName?: string
  unique?: boolean
  sparse?: boolean
}

export type DatabaseChangeRequestInput = {
  title: string
  description: string
  risk: string
  rollbackPlan: string
  statement: MongoDatabaseChangeStatement
  authorizedExecutorUserIds: string[]
  expiresAt: string | null
}

export type DatabaseChangeRequest = {
  id: string
  kind: 'dml' | 'ddl'
  operation: MongoDatabaseChangeStatement['operation']
  database: string
  collection: string
  title: string
  description: string
  risk: string
  rollbackPlan: string
  statementDigest: string
  statementPreview: string
  statementPreviewTruncated: boolean
  statementRedactedFields: string[]
  requesterUserId: string
  authorizedExecutorUserIds: string[]
  approvals: { userId: string; comment: string | null; createdAt: string }[]
  requiredApprovals: number
  currentApprovals: number
  policyVersion: number
  status:
    | 'draft'
    | 'pending_approval'
    | 'approved'
    | 'executing'
    | 'succeeded'
    | 'failed'
    | 'rejected'
    | 'canceled'
    | 'expired'
  canEdit: boolean
  canApprove: boolean
  canReject: boolean
  canCancel: boolean
  canExecute: boolean
  expiresAt: string | null
  executionId: string | null
  executionStartedAt: string | null
  executionCompletedAt: string | null
  executionResult: Record<string, unknown> | null
  executionErrorCategory: string | null
  executionErrorMessage: string | null
  events: { type: string; actorUserId: string; at: string; comment: string | null }[]
  createdAt: string
  updatedAt: string
}

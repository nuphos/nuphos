import type { BindingAccess } from './k8s-core.ts'

export type DatabaseEngine = 'mongodb' | 'postgresql' | 'mysql' | 'cloudflare-d1'
export type DirectDatabaseEngine = Exclude<DatabaseEngine, 'cloudflare-d1'>
export type DatabaseNetworkMode = 'public' | 'tailscale' | 'cluster-relay'
export type DatabaseTailscaleNetwork = { bindingId: string; tag: string }
export type DatabaseAgentPolicy = 'disabled' | 'metadata-only' | 'read-only'
export type DatabaseHealthStatus =
  'healthy' | 'unreachable' | 'auth-failed' | 'permission-denied' | 'unknown'
export type DatabaseErrorCategory =
  'dns' | 'route' | 'tls' | 'authentication' | 'authorization' | 'database-unavailable' | 'unknown'

export type DatabaseConnectionHealth = {
  status: DatabaseHealthStatus
  errorCategory: DatabaseErrorCategory | null
  message: string | null
  checkedAt: string
  latencyMs: number
  databaseName: string | null
  serverVersion: string | null
  readOnly: 'verified' | 'unverified' | 'writable'
}

export type DatabaseRelation = {
  kind: 'service' | 'deployment' | 'cluster' | 'repository'
  id: string
  label?: string
}

export type DatabaseProviderOrigin = {
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

export type DatabaseConnection = {
  id: string
  name: string
  engine: DatabaseEngine
  environment: string
  tags: string[]
  endpoint: string
  databaseName: string | null
  tls: { enabled: boolean; mode: string }
  networkMode: DatabaseNetworkMode
  tailscale?: DatabaseTailscaleNetwork
  providerOrigin?: DatabaseProviderOrigin
  agentPolicy: DatabaseAgentPolicy
  relations: DatabaseRelation[]
  health: DatabaseConnectionHealth
  canUse: boolean
  access?: BindingAccess & { agentPolicy: DatabaseAgentPolicy }
  changeApprovalPolicy: {
    minimumApprovals: number
    version: number
    updatedAt: string
    updatedBy: string
  }
  createdAt: string
  updatedAt: string
}

export type DatabaseConnectionInput = {
  name: string
  engine: DirectDatabaseEngine
  connectionUri: string
  environment: string
  tags: string[]
  networkMode: DatabaseNetworkMode
  tailscale?: DatabaseTailscaleNetwork
  access: {
    memberAllowList: string[]
    agentPolicy: DatabaseAgentPolicy
  }
  changeApprovalPolicy?: { minimumApprovals: number }
  relations: DatabaseRelation[]
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
  /** Present when the request is a projection of the canonical team Plan. */
  planId?: string
  /** Present for canonical Plan-backed changes; absent on legacy requests. */
  proposalSource?: 'human' | 'agent'
  /** Owning Agent conversation for Agent-proposed Plans. */
  sourceConversationId?: string
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

export type DatabaseConnectionTestResult = Pick<
  DatabaseConnection,
  'endpoint' | 'databaseName' | 'tls' | 'health'
>

export type MongoDatabaseSummary = {
  name: string
  sizeOnDisk: number | null
  empty: boolean
}

export type MongoCollectionSummary = {
  name: string
  type: 'collection' | 'view' | 'timeseries'
  documentCount: number | null
  avgDocumentSize: number | null
  storageSize: number | null
  totalIndexSize: number | null
  indexCount: number | null
}

export type MongoDatabaseCatalog = {
  databases: MongoDatabaseSummary[]
  truncated: boolean
  fetchedAt: string
}

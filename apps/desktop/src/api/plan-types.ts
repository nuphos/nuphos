export type PlanCommandStatus = 'pending' | 'running' | 'done' | 'failed'

export type PlanLifecycleStatus =
  'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'cancelled'

export type PlanCommand = {
  command: string
  description?: string
  status: PlanCommandStatus
  stdout?: string
  stderr?: string
  exitCode?: number
  executedBy?: 'agent'
}

export type PlanJob = {
  title: string
  description?: string
  commands?: PlanCommand[]
}

export type PlanStep = {
  title: string
  description?: string
  jobs: PlanJob[]
}

export type PlanDecision = {
  label: string
  value: string
}

export type PlanApprovalRequirement = {
  requesterApprovalRequired: boolean
  minimumOtherApprovals: number
  policySource: 'legacy-default' | 'team-policy'
  policyVersion: number
}

export type PlanApproval = {
  userId: string
  role: 'requester' | 'other'
  policyVersion: number
  approvedAt: string
}

export type PlanApprovalProgress = {
  requesterApproved: boolean
  requesterApprovalRequired: boolean
  otherApprovals: number
  minimumOtherApprovals: number
  satisfied: boolean
}

export type MongoDatabasePlanAction = {
  id: string
  type: 'mongodb.change'
  connectionId: string
  engine: 'mongodb'
  kind: 'dml' | 'ddl'
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
  statementDigest: string
  statementPreview: string
  statementPreviewTruncated: boolean
  statementRedactedFields: string[]
  purpose: string
  risk: string
  rollbackPlan: string
  authorizedExecutorUserIds: string[]
  proposalSource: 'human' | 'agent'
  sourceAgentOrigin?: 'user' | 'trigger' | 'automation'
  expiresAt: string | null
  executionId: string | null
  executionStartedAt: string | null
  executionCompletedAt: string | null
  executionResult: Record<string, unknown> | null
  executionErrorCategory: string | null
  executionErrorMessage: string | null
  events: {
    type: 'created' | 'expired' | 'execution_started' | 'execution_succeeded' | 'execution_failed'
    actorUserId: string
    at: string
    comment: string | null
  }[]
}

export type Plan = {
  id: string
  teamId?: string
  createdBy: string
  /** The conversation the plan was proposed in. Used to resume that chat (with
   *  full prior context) when continuing the plan. */
  sourceConversationId?: string
  /** GitHub-PR-style sequential id (#1, #2, …), monotonic per team/user. */
  number: number
  title: string
  overview?: string
  decisions?: PlanDecision[]
  steps: PlanStep[]
  costSummary?: string
  costOneTime?: string
  costMonthly?: string
  costSavings?: string
  riskWorstCase?: string
  riskMitigations?: string[]
  /** Absent on snapshots created by desktop versions from before typed Plan actions. */
  actions?: MongoDatabasePlanAction[]
  status: PlanLifecycleStatus
  approvalRequirement: PlanApprovalRequirement
  approvals: PlanApproval[]
  approvalProgress: PlanApprovalProgress
  approvedBy?: string
  approvedAt?: string
  executionStartedAt?: string
  executionFinishedAt?: string
  executionError?: string
  rejectedBy?: string
  rejectedAt?: string
  createdAt: string
  updatedAt: string
}

export type PlansPage = {
  plans: Plan[]
  nextCursor: string | null
  hasMore: boolean
}

export type TeamSkillObject = {
  key: string
  size: number
  etag: string
  lastModified?: string
}

export type TeamSkillSummary = {
  name: string
  displayName: string
  description: string | null
  fileCount: number
  hasSkillMd: boolean
  totalBytes: number
  lastModified: string | null
  metadata?: TeamSkillMetadata
}

export type TeamSkillMutationSource = 'desktop' | 'admin' | 'agent' | 'import' | 'legacy'

export type TeamSkillMetadata = {
  createdAt: string | null
  createdByUserId: string | null
  createdSource: TeamSkillMutationSource
  updatedAt: string | null
  updatedByUserId: string | null
  updatedSource: TeamSkillMutationSource
  revision: number
  status: 'active' | 'deleted'
  deletedAt: string | null
  deletedByUserId: string | null
  legacy: boolean
}

export type TeamSkillMutationEvent = {
  id: string
  mutationId: string
  phase: 'intent' | 'result'
  scope: string
  teamId: string | null
  skillName: string
  action: 'create' | 'update' | 'delete_object' | 'delete_skill'
  status: 'pending' | 'applied' | 'failed' | 'partial'
  actorUserId: string | null
  source: TeamSkillMutationSource
  requestId: string | null
  conversationId: string | null
  toolCallId: string | null
  changedKeys: string[]
  revision: number | null
  beforeEtags: Record<string, string>
  afterEtags: Record<string, string>
  error: string | null
  createdAt: string
}

export type TeamSkillHistory = {
  scope: string
  name: string
  metadata: TeamSkillMetadata
  events: TeamSkillMutationEvent[]
}

export type TeamSkillManifest = {
  scope: string
  skills: TeamSkillSummary[]
  orphans: TeamSkillObject[]
  truncated: boolean
  limit: number
}

export type TeamSkillObjectDetail = {
  scope: string
  key: string
  size: number
  etag: string
  contentType: string | null
  lastModified: string | null
  presignedUrl: string
  text: string | null
  textTruncated: boolean
}

export type PlanUpdatePatch = {
  status?: PlanLifecycleStatus
  commandStatuses?: {
    stepIdx: number
    jobIdx: number
    cmdIdx: number
    status: PlanCommandStatus
  }[]
  commandResults?: {
    stepIdx: number
    jobIdx: number
    cmdIdx: number
    status: PlanCommandStatus
    stdout?: string
    stderr?: string
    exitCode?: number
    executedBy?: 'agent'
  }[]
  executionError?: string
}

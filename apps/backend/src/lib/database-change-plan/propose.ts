import { ObjectId } from 'mongodb'

import { createPlan } from '@/lib/agent/plans'
import {
  assertMongoChangeStatement,
  mongoChangeKind,
  mongoChangeStatementDigest,
  mongoChangeStatementPreview,
} from '@/lib/database-change'
import { canAccessDatabaseConnection } from '@/lib/database-connections'
import { encryptDatabaseCredential } from '@/lib/database-credentials'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'

import type { MongoDatabasePlanAction, PlanDTO, PlanProposalSource } from '@/lib/agent/plans'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers'
import type { MongoDatabaseChangeStatement } from '@/lib/database-change'
import type { DatabaseConnection } from '@/models'

export type ProposeMongoDatabasePlanInput = {
  connection: DatabaseConnection
  requesterUserId: string
  requesterTeamRole: string
  title: string
  description: string
  risk: string
  rollbackPlan: string
  statement: MongoDatabaseChangeStatement
  authorizedExecutorUserIds: string[]
  expiresAt: Date | null
  proposalSource: PlanProposalSource
  sourceConversationId?: string
  sourceAgentOrigin?: AgentSessionOrigin
}

export async function resolveMongoPlanExecutors(
  connection: DatabaseConnection,
  requesterUserId: string,
  requested: string[],
): Promise<string[]> {
  const ids = [...new Set([requesterUserId, ...requested])]
  const members = await getTeamMembers(connection.teamId.toHexString())
  const byId = new Map(members.map((member) => [member.id, member]))

  for (const id of ids) {
    const member = byId.get(id)

    if (!member) {
      throw new AppError(
        422,
        'database_change_executor_not_member',
        'Every authorized executor must be an active team member.',
      )
    }
    if (!canAccessDatabaseConnection(connection.access, id, member.role)) {
      throw new AppError(
        422,
        'database_change_executor_access_denied',
        'Every authorized executor must have access to this database connection.',
      )
    }
  }

  return ids
}

export async function proposeMongoDatabasePlan(
  input: ProposeMongoDatabasePlanInput,
): Promise<PlanDTO> {
  try {
    assertMongoChangeStatement(input.statement)
  } catch (error) {
    throw new AppError(
      422,
      'database_change_statement_rejected',
      error instanceof Error ? error.message : 'Invalid MongoDB change statement.',
    )
  }
  if (
    !canAccessDatabaseConnection(
      input.connection.access,
      input.requesterUserId,
      input.requesterTeamRole,
    )
  ) {
    throw new AppError(
      403,
      'database_connection_access_denied',
      'You do not have access to this database connection.',
    )
  }
  const authorizedExecutorUserIds = await resolveMongoPlanExecutors(
    input.connection,
    input.requesterUserId,
    input.authorizedExecutorUserIds,
  )
  const preview = mongoChangeStatementPreview(input.statement)
  const digest = mongoChangeStatementDigest(input.statement)
  const now = new Date()
  const action: MongoDatabasePlanAction = {
    id: new ObjectId().toHexString(),
    type: 'mongodb.change',
    connectionId: input.connection._id.toHexString(),
    engine: 'mongodb',
    kind: mongoChangeKind(input.statement.operation),
    operation: input.statement.operation,
    database: input.statement.database,
    collection: input.statement.collection,
    encryptedStatement: encryptDatabaseCredential(JSON.stringify(input.statement)),
    statementDigest: digest,
    statementPreview: preview.statement,
    statementPreviewTruncated: preview.truncated,
    statementRedactedFields: preview.redactedFields,
    purpose: input.description,
    risk: input.risk,
    rollbackPlan: input.rollbackPlan,
    authorizedExecutorUserIds,
    proposalSource: input.proposalSource,
    sourceAgentOrigin: input.sourceAgentOrigin,
    expiresAt: input.expiresAt,
    executionId: null,
    executionStartedAt: null,
    executionCompletedAt: null,
    executionResult: null,
    executionErrorCategory: null,
    executionErrorMessage: null,
    events: [{ type: 'created', actorUserId: input.requesterUserId, at: now, comment: null }],
  }

  return createPlan({
    teamId: input.connection.teamId.toHexString(),
    createdBy: input.requesterUserId,
    sourceConversationId: input.sourceConversationId,
    title: input.title,
    overview: input.description,
    decisions: [
      { label: 'Database connection', value: input.connection.name },
      { label: 'Namespace', value: `${action.database}.${action.collection}` },
      { label: 'Operation', value: action.operation },
      { label: 'Approved statement digest', value: digest },
    ],
    steps: [
      {
        title: `Execute ${action.operation}`,
        description:
          'An authorized executor explicitly runs the immutable approved statement through the Nuphos database gateway.',
        jobs: [
          {
            title: `${action.database}.${action.collection}`,
            description:
              'Credentials remain in the backend; the statement digest is verified immediately before execution.',
          },
        ],
      },
    ],
    costSummary: 'No infrastructure cost change expected.',
    riskWorstCase: input.risk,
    riskMitigations: [
      input.rollbackPlan,
      'Approval and execution are separate actions; only explicitly authorized executors can run the approved digest.',
      'The database account remains the final permission boundary.',
    ],
    actions: [action],
  })
}

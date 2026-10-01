import { describe, expect, test } from 'bun:test'

import { serializePlan } from './agent/plans'
import { mongoPlanChangeStatus, mongoPlanChangeView } from './database-change-plan'

import type { MongoDatabasePlanAction, Plan } from './agent/plans'

function fixture(status: Plan['status'], expiresAt: Date | null = null) {
  const action: MongoDatabasePlanAction = {
    id: 'action-1',
    type: 'mongodb.change',
    connectionId: 'connection-1',
    engine: 'mongodb',
    kind: 'dml',
    operation: 'deleteOne',
    database: 'app',
    collection: 'staleRows',
    encryptedStatement: {
      v: 1,
      alg: 'A256GCM',
      keyId: 'test',
      iv: 'iv',
      authTag: 'tag',
      ciphertext: 'ciphertext',
    },
    statementDigest: 'digest',
    statementPreview: '{}',
    statementPreviewTruncated: false,
    statementRedactedFields: [],
    purpose: 'Remove one stale row.',
    risk: 'The wrong row could be removed.',
    rollbackPlan: 'Reinsert it from the recorded values.',
    authorizedExecutorUserIds: ['requester'],
    proposalSource: 'human',
    expiresAt,
    executionId: null,
    executionStartedAt: null,
    executionCompletedAt: null,
    executionResult: null,
    executionErrorCategory: null,
    executionErrorMessage: null,
    events: [],
  }
  const plan: Plan = {
    createdBy: 'requester',
    number: 1,
    title: 'Delete stale row',
    steps: [],
    actions: [action],
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  return { plan, action }
}

describe('MongoDB Plan change status', () => {
  test('an approved action cannot remain executable after its expiry', () => {
    const { plan, action } = fixture('approved', new Date(Date.now() - 1_000))

    expect(mongoPlanChangeStatus(plan, action)).toBe('expired')
  })

  test('a terminal successful action remains succeeded after its expiry time', () => {
    const { plan, action } = fixture('completed', new Date(Date.now() - 1_000))

    expect(mongoPlanChangeStatus(plan, action)).toBe('succeeded')
  })

  test('a persisted expiry event remains visible after the Plan is cancelled', () => {
    const { plan, action } = fixture('cancelled')

    action.events.push({
      type: 'expired',
      actorUserId: 'system',
      at: new Date(),
      comment: null,
    })
    expect(mongoPlanChangeStatus(plan, action)).toBe('expired')
  })

  test('Agent, Plans, and Changes expose one approved action and approval policy', () => {
    const { plan, action } = fixture('approved')
    const requesterApprovedAt = new Date('2026-07-18T03:00:00.000Z')
    const teammateApprovedAt = new Date('2026-07-18T03:01:00.000Z')

    plan.teamId = 'team-1'
    plan.sourceConversationId = 'conversation-1'
    plan.approvalRequirement = {
      requesterApprovalRequired: true,
      minimumOtherApprovals: 1,
      policySource: 'team-policy',
      policyVersion: 7,
    }
    plan.approvals = [
      { userId: 'requester', role: 'requester', policyVersion: 7, approvedAt: requesterApprovedAt },
      { userId: 'reviewer', role: 'other', policyVersion: 7, approvedAt: teammateApprovedAt },
    ]
    action.proposalSource = 'agent'
    action.sourceAgentOrigin = 'user'
    action.authorizedExecutorUserIds = ['requester', 'executor']

    const planView = serializePlan(plan)
    const changeView = mongoPlanChangeView({
      plan,
      action,
      userId: 'executor',
      teamRole: 'EDITOR',
      memberCanUse: true,
    })

    expect(planView).toMatchObject({
      id: '1',
      sourceConversationId: 'conversation-1',
      status: 'approved',
      approvalProgress: {
        requesterApproved: true,
        requesterApprovalRequired: true,
        otherApprovals: 1,
        minimumOtherApprovals: 1,
        satisfied: true,
      },
    })
    expect(planView.actions[0]).toMatchObject({
      id: 'action-1',
      type: 'mongodb.change',
      proposalSource: 'agent',
      sourceAgentOrigin: 'user',
      statementDigest: 'digest',
    })
    expect(changeView).toMatchObject({
      id: '1',
      planId: '1',
      proposalSource: 'agent',
      sourceConversationId: 'conversation-1',
      status: 'approved',
      requiredApprovals: 2,
      currentApprovals: 2,
      statementDigest: 'digest',
      canExecute: true,
    })
  })

  test('Plans and Changes converge on the same completed execution result', () => {
    const { plan, action } = fixture('completed')
    const startedAt = new Date('2026-07-18T04:00:00.000Z')
    const completedAt = new Date('2026-07-18T04:00:01.000Z')
    const result = { acknowledged: true, deletedCount: 1 }

    action.executionId = 'execution-1'
    action.executionStartedAt = startedAt
    action.executionCompletedAt = completedAt
    action.executionResult = result
    action.events.push(
      { type: 'execution_started', actorUserId: 'requester', at: startedAt, comment: null },
      { type: 'execution_succeeded', actorUserId: 'requester', at: completedAt, comment: null },
    )

    const planView = serializePlan(plan)
    const changeView = mongoPlanChangeView({
      plan,
      action,
      userId: 'requester',
      teamRole: 'EDITOR',
      memberCanUse: true,
    })

    expect(planView.status).toBe('completed')
    expect(planView.actions[0]).toMatchObject({
      executionId: 'execution-1',
      executionCompletedAt: completedAt.toISOString(),
      executionResult: result,
    })
    expect(changeView).toMatchObject({
      planId: '1',
      status: 'succeeded',
      executionId: 'execution-1',
      executionCompletedAt: completedAt,
      executionResult: result,
      canExecute: false,
    })
  })
})

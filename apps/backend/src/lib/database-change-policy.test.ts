import { describe, expect, test } from 'bun:test'

import {
  databaseChangePermissions,
  validDatabaseChangeApprovalCount,
} from './database-change-policy'

const digest = 'approved-digest'
const policy = { minimumApprovals: 1, version: 3 }

function request(overrides: Record<string, unknown> = {}) {
  return {
    status: 'pending_approval' as const,
    requesterUserId: 'requester',
    authorizedExecutorUserIds: ['requester'],
    statementDigest: digest,
    approvals: [],
    ...overrides,
  }
}

describe('database change approval and execution policy', () => {
  test('counts only unique approvals for the immutable digest and current policy', () => {
    expect(
      validDatabaseChangeApprovalCount(
        {
          statementDigest: digest,
          approvals: [
            {
              userId: 'reviewer-a',
              digest,
              policyVersion: 3,
              comment: null,
              createdAt: new Date(),
            },
            {
              userId: 'reviewer-a',
              digest,
              policyVersion: 3,
              comment: null,
              createdAt: new Date(),
            },
            {
              userId: 'reviewer-b',
              digest: 'old-digest',
              policyVersion: 3,
              comment: null,
              createdAt: new Date(),
            },
            {
              userId: 'reviewer-c',
              digest,
              policyVersion: 2,
              comment: null,
              createdAt: new Date(),
            },
          ],
        },
        policy,
      ),
    ).toBe(1)
  })

  test('the requester cannot approve their own request but remains an executor', () => {
    const permissions = databaseChangePermissions({
      request: request(),
      policy,
      userId: 'requester',
      teamRole: 'MEMBER',
      memberCanUse: true,
    })

    expect(permissions.canApprove).toBe(false)
    expect(permissions.canCancel).toBe(true)
    expect(permissions.canExecute).toBe(false)
  })

  test('approval does not grant the reviewer execution authority', () => {
    const approved = request({
      status: 'approved' as const,
      approvals: [
        { userId: 'reviewer', digest, policyVersion: 3, comment: null, createdAt: new Date() },
      ],
    })
    const reviewer = databaseChangePermissions({
      request: approved,
      policy,
      userId: 'reviewer',
      teamRole: 'MEMBER',
      memberCanUse: true,
    })
    const requester = databaseChangePermissions({
      request: approved,
      policy,
      userId: 'requester',
      teamRole: 'MEMBER',
      memberCanUse: true,
    })

    expect(reviewer.canExecute).toBe(false)
    expect(requester.canExecute).toBe(true)
  })

  test('a designated executor can execute only after approval and while access remains valid', () => {
    const approved = request({
      status: 'approved' as const,
      authorizedExecutorUserIds: ['requester', 'operator'],
      approvals: [
        { userId: 'reviewer', digest, policyVersion: 3, comment: null, createdAt: new Date() },
      ],
    })

    expect(
      databaseChangePermissions({
        request: approved,
        policy,
        userId: 'operator',
        teamRole: 'MEMBER',
        memberCanUse: true,
      }).canExecute,
    ).toBe(true)
    expect(
      databaseChangePermissions({
        request: approved,
        policy,
        userId: 'operator',
        teamRole: 'MEMBER',
        memberCanUse: false,
      }).canExecute,
    ).toBe(false)
  })
})

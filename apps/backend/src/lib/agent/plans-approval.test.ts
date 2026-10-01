import { describe, expect, test } from 'bun:test'

import {
  getPlanApprovalProgress,
  normalizePlanApprovalRequirement,
  normalizePlanApprovals,
} from './plans'

import type { Plan } from './plans'

function approvalPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    createdBy: 'requester',
    number: 1,
    title: 'Change a database field',
    steps: [],
    status: 'proposed',
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    ...overrides,
  }
}

describe('plan approval compatibility', () => {
  test('missing fields preserve the legacy requester-only policy', () => {
    const plan = approvalPlan()

    expect(normalizePlanApprovalRequirement(plan)).toEqual({
      requesterApprovalRequired: true,
      minimumOtherApprovals: 0,
      policySource: 'legacy-default',
      policyVersion: 0,
    })
    expect(getPlanApprovalProgress(plan)).toEqual({
      requesterApproved: false,
      requesterApprovalRequired: true,
      otherApprovals: 0,
      minimumOtherApprovals: 0,
      satisfied: false,
    })
  })

  test('old approvedBy and approvedAt are synthesized without rewriting storage', () => {
    const approvedAt = new Date('2026-07-17T01:00:00.000Z')
    const plan = approvalPlan({
      status: 'approved',
      approvedBy: 'requester',
      approvedAt,
    })

    expect(normalizePlanApprovals(plan)).toEqual([
      {
        userId: 'requester',
        role: 'requester',
        policyVersion: 0,
        approvedAt,
      },
    ])
    expect(getPlanApprovalProgress(plan).satisfied).toBe(true)
  })

  test('requester plus distinct other members satisfy a team quorum', () => {
    const plan = approvalPlan({
      approvalRequirement: {
        requesterApprovalRequired: true,
        minimumOtherApprovals: 2,
        policySource: 'team-policy',
        policyVersion: 4,
      },
      approvals: [
        {
          userId: 'member-a',
          role: 'other',
          policyVersion: 4,
          approvedAt: new Date('2026-07-17T01:00:00.000Z'),
        },
        {
          userId: 'requester',
          role: 'requester',
          policyVersion: 4,
          approvedAt: new Date('2026-07-17T01:01:00.000Z'),
        },
        {
          userId: 'member-b',
          role: 'other',
          policyVersion: 4,
          approvedAt: new Date('2026-07-17T01:02:00.000Z'),
        },
      ],
    })

    expect(getPlanApprovalProgress(plan)).toEqual({
      requesterApproved: true,
      requesterApprovalRequired: true,
      otherApprovals: 2,
      minimumOtherApprovals: 2,
      satisfied: true,
    })
  })

  test('duplicate users and approvals from an older policy version do not count', () => {
    const plan = approvalPlan({
      approvalRequirement: {
        requesterApprovalRequired: true,
        minimumOtherApprovals: 1,
        policySource: 'team-policy',
        policyVersion: 8,
      },
      approvals: [
        {
          userId: 'requester',
          role: 'requester',
          policyVersion: 7,
          approvedAt: new Date('2026-07-17T01:00:00.000Z'),
        },
        {
          userId: 'member-a',
          role: 'other',
          policyVersion: 8,
          approvedAt: new Date('2026-07-17T01:01:00.000Z'),
        },
        {
          userId: 'member-a',
          role: 'other',
          policyVersion: 8,
          approvedAt: new Date('2026-07-17T01:02:00.000Z'),
        },
      ],
    })

    expect(getPlanApprovalProgress(plan)).toEqual({
      requesterApproved: false,
      requesterApprovalRequired: true,
      otherApprovals: 1,
      minimumOtherApprovals: 1,
      satisfied: false,
    })
  })

  test('stale structured approvals do not fall back to legacy approvedBy', () => {
    const plan = approvalPlan({
      approvalRequirement: {
        requesterApprovalRequired: true,
        minimumOtherApprovals: 0,
        policySource: 'team-policy',
        policyVersion: 2,
      },
      approvals: [
        {
          userId: 'requester',
          role: 'requester',
          policyVersion: 1,
          approvedAt: new Date('2026-07-17T01:00:00.000Z'),
        },
      ],
      approvedBy: 'requester',
      approvedAt: new Date('2026-07-17T01:00:00.000Z'),
    })

    expect(normalizePlanApprovals(plan)).toEqual([])
    expect(getPlanApprovalProgress(plan).satisfied).toBe(false)
  })
})

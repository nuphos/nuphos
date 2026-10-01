import { describe, expect, test } from 'bun:test'

import { serializePlan } from './plans'

import type { MongoDatabasePlanAction, Plan } from './plans'

function databaseAction(overrides: Partial<MongoDatabasePlanAction> = {}): MongoDatabasePlanAction {
  return {
    id: 'action-1',
    type: 'mongodb.change',
    connectionId: 'connection-1',
    engine: 'mongodb',
    kind: 'dml',
    operation: 'updateOne',
    database: 'app',
    collection: 'customers',
    encryptedStatement: {
      v: 1,
      alg: 'A256GCM',
      keyId: 'database-action-key',
      iv: 'secret-iv',
      authTag: 'secret-auth-tag',
      ciphertext: 'secret-ciphertext',
    },
    statementDigest: 'sha256:approved',
    statementPreview: '{ "operation": "updateOne", "update": "[REDACTED]" }',
    statementPreviewTruncated: false,
    statementRedactedFields: ['update.$set.apiKey'],
    purpose: 'Rotate a stale value.',
    risk: 'The selected customer could receive the wrong value.',
    rollbackPlan: 'Restore the previous value.',
    authorizedExecutorUserIds: ['requester'],
    proposalSource: 'agent',
    sourceAgentOrigin: 'user',
    expiresAt: new Date('2026-07-19T00:00:00.000Z'),
    executionId: null,
    executionStartedAt: null,
    executionCompletedAt: null,
    executionResult: null,
    executionErrorCategory: null,
    executionErrorMessage: null,
    events: [
      {
        type: 'created',
        actorUserId: 'requester',
        at: new Date('2026-07-18T00:00:00.000Z'),
        comment: null,
      },
    ],
    ...overrides,
  }
}

function plan(action: MongoDatabasePlanAction): Plan {
  return {
    createdBy: 'requester',
    number: 12,
    title: 'Update one customer',
    steps: [],
    actions: [action],
    status: 'proposed',
    createdAt: new Date('2026-07-18T00:00:00.000Z'),
    updatedAt: new Date('2026-07-18T00:00:00.000Z'),
  }
}

describe('typed Plan action serialization', () => {
  test('returns the reviewable statement preview without exposing the sealed statement', () => {
    const dto = serializePlan(plan(databaseAction()))
    const serialized = JSON.stringify(dto)

    expect(dto.actions).toHaveLength(1)
    expect(dto.actions[0]?.statementPreview).toContain('[REDACTED]')
    expect(dto.actions[0]?.events[0]?.at).toBe('2026-07-18T00:00:00.000Z')
    expect(dto.actions[0]?.expiresAt).toBe('2026-07-19T00:00:00.000Z')
    expect(serialized).not.toContain('encryptedStatement')
    expect(serialized).not.toContain('secret-ciphertext')
    expect(serialized).not.toContain('secret-auth-tag')
    expect(serialized).not.toContain('secret-iv')
  })

  test('serializes an expired lifecycle event without exposing backend state', () => {
    const action = databaseAction({
      events: [
        {
          type: 'expired',
          actorUserId: 'system',
          at: new Date('2026-07-19T00:00:00.000Z'),
          comment: 'Expired before approval.',
        },
      ],
    })

    expect(serializePlan(plan(action)).actions[0]?.events[0]).toEqual({
      type: 'expired',
      actorUserId: 'system',
      at: '2026-07-19T00:00:00.000Z',
      comment: 'Expired before approval.',
    })
  })
})

import { describe, expect, test } from 'bun:test'

import {
  assertMongoReadQuery,
  boundQueryRows,
  mongoAuditStatement,
  mongoQueryShape,
  sanitizeMongoRows,
} from './database-query'

describe('MongoDB read-only query gateway', () => {
  test('rejects mutation stages and server-side JavaScript recursively', () => {
    expect(() =>
      assertMongoReadQuery({
        operation: 'aggregate',
        database: 'app',
        collection: 'users',
        pipeline: [{ $out: 'copied' }],
      }),
    ).toThrow('not allowed')
    expect(() =>
      assertMongoReadQuery({
        operation: 'find',
        database: 'app',
        collection: 'users',
        filter: { $where: 'return true' },
      }),
    ).toThrow('not allowed')
    expect(() =>
      assertMongoReadQuery({
        operation: 'aggregate',
        database: 'app',
        collection: 'users',
        pipeline: [{ $changeStream: {} }],
      }),
    ).toThrow('read-only gateway')
  })

  test('allows bounded read filters and common read-only aggregation stages', () => {
    expect(() =>
      assertMongoReadQuery({
        operation: 'find',
        database: 'app',
        collection: 'users',
        filter: { active: true },
        limit: 25,
      }),
    ).not.toThrow()
    expect(() =>
      assertMongoReadQuery({
        operation: 'aggregate',
        database: 'app',
        collection: 'users',
        pipeline: [{ $match: { active: true } }, { $group: { _id: '$plan', count: { $sum: 1 } } }],
      }),
    ).not.toThrow()
  })

  test('redacts common secret fields without dropping surrounding data', () => {
    const result = sanitizeMongoRows([
      {
        name: 'Ada',
        password: 'do-not-return',
        accessToken: 'also-hidden',
        profile: { api_key: 'hidden', city: 'Taipei' },
      },
    ])

    expect(result.rows).toEqual([
      {
        name: 'Ada',
        password: '[REDACTED]',
        accessToken: '[REDACTED]',
        profile: { api_key: '[REDACTED]', city: 'Taipei' },
      },
    ])
    expect(result.redactedFields).toEqual(['accessToken', 'password', 'profile.api_key'])
  })

  test('caps serialized response bytes and records value-free query shape', () => {
    const neverAudited = 'never-audit-value'
    const bounded = boundQueryRows([{ id: 1 }, { payload: 'x'.repeat(200) }], 40)

    expect(bounded.rows).toEqual([{ id: 1 }])
    expect(bounded.truncated).toBe(true)
    expect(
      mongoQueryShape({
        operation: 'find',
        database: 'app',
        collection: 'users',
        filter: { status: 'active', password: neverAudited },
      }),
    ).toEqual(['status', 'password'])
  })

  test('retains a useful audit statement while redacting sensitive query values', () => {
    const audit = mongoAuditStatement({
      operation: 'find',
      database: 'app',
      collection: 'users',
      filter: {
        status: 'active',
        email: 'ada@example.com',
        nested: { accessToken: 'never-store-me' },
        callback: 'mongodb://user:password@example.test/app',
      },
      projection: { name: 1, status: 1 },
      sort: { createdAt: -1 },
      skip: 20,
      limit: 10,
    })

    expect(audit.statement).toContain('"status": "active"')
    expect(audit.statement).toContain('"email": "[REDACTED]"')
    expect(audit.statement).not.toContain('ada@example.com')
    expect(audit.statement).not.toContain('never-store-me')
    expect(audit.statement).not.toContain('user:password')
    expect(audit.statement).toContain('.skip(20)')
    expect(audit.statement).toContain('.limit(10)')
    expect(audit.redactedFields).toEqual([
      'filter.callback',
      'filter.email',
      'filter.nested.accessToken',
    ])
    expect(audit.queryInput?.filter).toEqual({
      status: 'active',
      email: '[REDACTED]',
      nested: { accessToken: '[REDACTED]' },
      callback: '[REDACTED]',
    })
  })

  test('keeps projection selectors reloadable while protecting match values', () => {
    const audit = mongoAuditStatement({
      operation: 'aggregate',
      database: 'app',
      collection: 'users',
      pipeline: [
        { $match: { email: 'ada@example.com', status: 'active' } },
        { $project: { email: 1, status: 1, _id: 0 } },
      ],
    })

    expect(audit.queryInput?.pipeline).toEqual([
      { $match: { email: '[REDACTED]', status: 'active' } },
      { $project: { email: 1, status: 1, _id: 0 } },
    ])
    expect(audit.redactedFields).toEqual(['pipeline.0.$match.email'])
  })
})

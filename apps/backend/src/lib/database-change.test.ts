import { describe, expect, test } from 'bun:test'

import {
  assertMongoChangeStatement,
  mongoChangeKind,
  mongoChangeStatementDigest,
  mongoChangeStatementPreview,
} from './database-change'

describe('MongoDB change gateway', () => {
  test('classifies DML and DDL operations', () => {
    expect(mongoChangeKind('updateMany')).toBe('dml')
    expect(mongoChangeKind('createIndex')).toBe('ddl')
  })

  test('produces a stable digest independent of object key order', () => {
    const first = mongoChangeStatementDigest({
      operation: 'updateMany',
      database: 'demo',
      collection: 'customers',
      filter: { status: 'trial', region: 'TW' },
      update: { $set: { status: 'active' } },
    })
    const second = mongoChangeStatementDigest({
      collection: 'customers',
      database: 'demo',
      operation: 'updateMany',
      update: { $set: { status: 'active' } },
      filter: { region: 'TW', status: 'trial' },
    })

    expect(first).toBe(second)
  })

  test('rejects broad writes and server-side JavaScript', () => {
    expect(() =>
      assertMongoChangeStatement({
        operation: 'deleteMany',
        database: 'demo',
        collection: 'customers',
        filter: {},
      }),
    ).toThrow('non-empty filter')
    expect(() =>
      assertMongoChangeStatement({
        operation: 'updateOne',
        database: 'demo',
        collection: 'customers',
        filter: { $where: 'true' },
        update: { $set: { status: 'active' } },
      }),
    ).toThrow('$where')
  })

  test('rejects system namespace mutations and unsafe update forms', () => {
    expect(() =>
      assertMongoChangeStatement({
        operation: 'insertOne',
        database: 'admin',
        collection: 'users',
        document: { ok: true },
      }),
    ).toThrow('system databases')
    expect(() =>
      assertMongoChangeStatement({
        operation: 'updateOne',
        database: 'demo',
        collection: 'customers',
        filter: { customerNo: 'CUS-1' },
        update: { status: 'active' },
      }),
    ).toThrow('allowlisted')
  })

  test('redacts sensitive statement fields without changing the executable digest', () => {
    const statement = {
      operation: 'insertOne' as const,
      database: 'demo',
      collection: 'customers',
      document: { displayName: 'Demo', email: 'demo@example.test', apiToken: 'secret-value' },
    }
    const digest = mongoChangeStatementDigest(statement)
    const preview = mongoChangeStatementPreview(statement)

    expect(preview.statement).toContain('[REDACTED]')
    expect(preview.statement).not.toContain('demo@example.test')
    expect(preview.statement).not.toContain('secret-value')
    expect(preview.redactedFields).toContain('document.email')
    expect(mongoChangeStatementDigest(statement)).toBe(digest)
  })
})

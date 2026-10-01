import { describe, expect, test } from 'bun:test'

import { databaseConnectionCreateSchema } from '@/lib/api/database-connections'
import {
  canAccessDatabaseConnection,
  databaseConnectionHealthIsStorable,
  classifyDatabaseError,
  databaseAgentPolicyAllows,
  parseDatabaseConnection,
  redactDatabaseSecrets,
} from '@/lib/database-connections'

describe('database connection parsing', () => {
  test('keeps provider-managed engines out of the direct connection API', () => {
    expect(
      databaseConnectionCreateSchema.safeParse({
        name: 'D1',
        engine: 'cloudflare-d1',
        connectionUri: 'cloudflare://account/d1/database',
        environment: 'provider-managed',
        tags: [],
        networkMode: 'public',
        access: { memberAllowList: ['*'], agentPolicy: 'metadata-only' },
        relations: [],
      }).success,
    ).toBe(false)
  })

  test('parses and redacts a multi-host MongoDB URI', () => {
    const parsed = parseDatabaseConnection(
      'mongodb',
      'mongodb://reporter:p%40ss@mongo-1.example:27017,mongo-2.example:27018/orders?replicaSet=rs0&tls=true',
    )

    expect(parsed).toMatchObject({
      engine: 'mongodb',
      endpoint: 'mongodb://mongo-1.example:27017,mongo-2.example:27018/orders',
      databaseName: 'orders',
      username: 'reporter',
      tls: { enabled: true, mode: 'enabled' },
    })
    expect(parsed.endpoint).not.toContain('reporter')
    expect(parsed.endpoint).not.toContain('p%40ss')
    expect(parsed.endpoint).not.toContain('replicaSet')
  })

  test('treats mongodb+srv as TLS by default', () => {
    const parsed = parseDatabaseConnection(
      'mongodb',
      'mongodb+srv://reader:secret@cluster.example.test/app',
    )

    expect(parsed.endpoint).toBe('mongodb+srv://cluster.example.test/app')
    expect(parsed.tls).toEqual({ enabled: true, mode: 'srv-default' })
  })

  test('parses PostgreSQL without exposing credentials or parameters', () => {
    const parsed = parseDatabaseConnection(
      'postgresql',
      'postgresql://readonly:topsecret@db.example.test:6432/app?sslmode=verify-full&application_name=nuphos',
    )

    expect(parsed).toMatchObject({
      endpoint: 'postgresql://db.example.test:6432/app',
      databaseName: 'app',
      username: 'readonly',
      tls: { enabled: true, mode: 'verify-full' },
    })
    expect(JSON.stringify(parsed.endpoint)).not.toContain('topsecret')
  })

  test('rejects MySQL during phase one while retaining the engine abstraction', () => {
    expect(() => parseDatabaseConnection('mysql', 'mysql://reader:secret@db/app')).toThrow(
      'not supported in phase one',
    )
  })

  test('rejects whitespace and engine/scheme mismatches', () => {
    expect(() => parseDatabaseConnection('mongodb', 'postgresql://reader:secret@db/app')).toThrow(
      'Invalid MongoDB',
    )
    expect(() =>
      parseDatabaseConnection('postgresql', 'postgresql://reader:secret@db/app\n'),
    ).toThrow('without whitespace')
  })
})

describe('database secret redaction', () => {
  test('removes database URIs, key-value secrets, and explicit secret values', () => {
    const raw =
      'failed uri=postgresql://reader:secret@db/app password=hunter2 token=abc123 detail=hunter2'
    const redacted = redactDatabaseSecrets(raw, ['hunter2'])

    expect(redacted).not.toContain('reader')
    expect(redacted).not.toContain('secret')
    expect(redacted).not.toContain('hunter2')
    expect(redacted).not.toContain('abc123')
    expect(redacted).toContain('[REDACTED]')
  })
})

describe('database health error classification', () => {
  test.each([
    [{ code: 'ENOTFOUND' }, 'unreachable', 'dns'],
    [{ message: 'self signed certificate' }, 'unreachable', 'tls'],
    [{ code: '28P01' }, 'auth-failed', 'authentication'],
    [{ code: 18 }, 'auth-failed', 'authentication'],
    [{ code: '42501' }, 'permission-denied', 'authorization'],
    [{ code: 'ECONNREFUSED' }, 'unreachable', 'route'],
    [
      { name: 'MongoServerSelectionError', message: 'Server selection timed out after 5000 ms' },
      'unreachable',
      'route',
    ],
    [{ code: '3D000' }, 'unreachable', 'database-unavailable'],
    [{ message: 'unexpected protocol problem' }, 'unknown', 'unknown'],
  ] as const)('classifies %o as %s/%s', (error, status, category) => {
    expect(classifyDatabaseError(error)).toMatchObject({ status, category })
  })

  test('walks nested causes without returning the raw error', () => {
    const result = classifyDatabaseError({
      message: 'connection failed for postgresql://reader:secret@db/app',
      cause: { code: 'ENOTFOUND' },
    })

    expect(result).toMatchObject({ status: 'unreachable', category: 'dns' })
    expect(result.message).not.toContain('secret')
  })
})

describe('database access policy', () => {
  const restricted = { memberAllowList: ['member-a'] }

  test('administrators bypass the member allowlist for repair and policy changes', () => {
    expect(canAccessDatabaseConnection(restricted, 'admin', 'ADMINISTRATOR')).toBe(true)
  })

  test('members require wildcard or explicit access', () => {
    expect(canAccessDatabaseConnection(restricted, 'member-a', 'EDITOR')).toBe(true)
    expect(canAccessDatabaseConnection(restricted, 'member-b', 'VIEWER')).toBe(false)
    expect(canAccessDatabaseConnection({ memberAllowList: ['*'] }, 'member-b', 'VIEWER')).toBe(true)
  })

  test('agent policy separates discovery from query access', () => {
    expect(databaseAgentPolicyAllows('disabled', 'metadata')).toBe(false)
    expect(databaseAgentPolicyAllows('metadata-only', 'metadata')).toBe(true)
    expect(databaseAgentPolicyAllows('metadata-only', 'query')).toBe(false)
    expect(databaseAgentPolicyAllows('read-only', 'metadata')).toBe(true)
    expect(databaseAgentPolicyAllows('read-only', 'query')).toBe(true)
  })

  test('credential write capability does not change whether a healthy connection can be stored', () => {
    expect(databaseConnectionHealthIsStorable({ status: 'healthy' })).toBe(true)
    expect(databaseConnectionHealthIsStorable({ status: 'unreachable' })).toBe(false)
  })

  test('new connections default to all members but no Agent access', () => {
    const value = databaseConnectionCreateSchema.parse({
      name: 'Orders',
      engine: 'postgresql',
      connectionUri: 'postgresql://reader:test-only@db.example.test/orders',
      environment: 'test',
    })

    expect(value.access).toEqual({ memberAllowList: ['*'], agentPolicy: 'disabled' })
    expect(value.networkMode).toBe('public')
  })

  test('accepts an explicit Tailscale OAuth binding and advertised tag', () => {
    const value = databaseConnectionCreateSchema.parse({
      name: 'Private MongoDB',
      engine: 'mongodb',
      connectionUri: 'mongodb://reader:test-only@mongo.internal/app',
      environment: 'test',
      networkMode: 'tailscale',
      tailscale: { bindingId: '507f1f77bcf86cd799439011', tag: 'tag:nuphos-database' },
    })

    expect(value.tailscale).toEqual({
      bindingId: '507f1f77bcf86cd799439011',
      tag: 'tag:nuphos-database',
    })
  })

  test('rejects missing, unexpected, or malformed Tailscale selections', () => {
    const base = {
      name: 'Private MongoDB',
      engine: 'mongodb' as const,
      connectionUri: 'mongodb://reader:test-only@mongo.internal/app',
      environment: 'test',
    }

    expect(
      databaseConnectionCreateSchema.safeParse({ ...base, networkMode: 'tailscale' }).success,
    ).toBe(false)
    expect(
      databaseConnectionCreateSchema.safeParse({
        ...base,
        networkMode: 'public',
        tailscale: { bindingId: '507f1f77bcf86cd799439011', tag: 'tag:nuphos-database' },
      }).success,
    ).toBe(false)
    expect(
      databaseConnectionCreateSchema.safeParse({
        ...base,
        networkMode: 'tailscale',
        tailscale: { bindingId: '507f1f77bcf86cd799439011', tag: 'nuphos-database' },
      }).success,
    ).toBe(false)
  })

  test('rejects an ambiguous wildcard allowlist', () => {
    const result = databaseConnectionCreateSchema.safeParse({
      name: 'Orders',
      engine: 'postgresql',
      connectionUri: 'postgresql://reader:test-only@db.example.test/orders',
      environment: 'test',
      access: { memberAllowList: ['*', 'member-a'], agentPolicy: 'read-only' },
    })

    expect(result.success).toBe(false)
  })
})

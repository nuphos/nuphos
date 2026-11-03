import { beforeEach, expect, test } from 'bun:test'

import { real as audit } from '@/lib/test/doubles/agent-devices-audit'
import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import type { DeviceExecAuditEntry, DeviceExecAuditInput } from './audit'

const records = new Map<string, DeviceExecAuditEntry>()
const failures: string[] = []
let unavailable = false
const collection = {
  updateOne: (filter: { operationId: string }, update: { $set: DeviceExecAuditEntry }) => {
    if (unavailable) throw new Error('synthetic database outage')
    records.set(filter.operationId, update.$set)

    return Promise.resolve()
  },
  insertOne: (entry: DeviceExecAuditEntry) => {
    if (unavailable) throw new Error('synthetic database outage')
    records.set(`legacy-${String(records.size)}`, entry)

    return Promise.resolve()
  },
}

useDb({ db: () => ({ collection: () => collection }) })
useObservability({
  logError: (event) => {
    failures.push(event)
  },
})

beforeEach(() => {
  records.clear()
  failures.length = 0
  unavailable = false
})

function intent(): DeviceExecAuditInput {
  return {
    operationId: 'operation-1',
    ownerUserId: 'host',
    deviceId: 'computer',
    actorUserId: 'teammate',
    conversationOwnerUserId: 'teammate',
    origin: 'user',
    teamId: 'team',
    sessionId: 'session',
    command: 'git status',
    requestedAt: new Date('2026-11-03T00:00:00Z'),
    finishedAt: null,
    outcome: 'unknown',
  }
}

test('an interrupted dispatch leaves one unfinished record and retries update the same operation', async () => {
  const input = intent()

  await audit.recordDeviceExecAudit(input)
  expect(records.get('operation-1')).toMatchObject({
    outcome: 'unknown',
    finishedAt: null,
    durationMs: null,
  })
  const completed = {
    ...input,
    outcome: 'ok' as const,
    finishedAt: new Date('2026-11-03T00:00:02Z'),
    exitCode: 0,
  }

  await audit.recordDeviceExecAudit(completed)
  await audit.recordDeviceExecAudit(completed)
  expect(records.size).toBe(1)
  expect(records.get('operation-1')).toMatchObject({
    outcome: 'ok',
    durationMs: 2000,
    actorUserId: 'teammate',
    ownerUserId: 'host',
  })
})

test('a failed completion write preserves unknown and reports a persistence failure', async () => {
  const input = intent()

  await audit.recordDeviceExecAudit(input)
  unavailable = true
  await audit.recordDeviceExecAudit({
    ...input,
    outcome: 'ok',
    finishedAt: new Date(),
    exitCode: 0,
  })
  expect(records.get('operation-1')?.outcome).toBe('unknown')
  expect(failures).toEqual(['agent.device_exec_audit.write_failed'])
})

test('a completion can be retained when the initial write failed', async () => {
  const input = intent()

  unavailable = true
  await audit.recordDeviceExecAudit(input)
  unavailable = false
  await audit.recordDeviceExecAudit({
    ...input,
    outcome: 'error',
    finishedAt: new Date(),
    reason: 'dispatch_failed',
  })
  expect(records.size).toBe(1)
  expect(records.get('operation-1')?.outcome).toBe('error')
  expect(failures).toHaveLength(1)
})

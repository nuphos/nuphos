import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import {
  auditCursorFilter,
  buildDeviceExecAuditEntry,
  decodeAuditCursor,
  encodeAuditCursor,
} from './audit'

import type { DeviceExecAuditInput } from './audit'

function input(command: string): DeviceExecAuditInput {
  return {
    ownerUserId: 'u1',
    deviceId: 'd1',
    actorUserId: 'u1',
    conversationOwnerUserId: 'u1',
    origin: 'user',
    teamId: 't1',
    sessionId: 's1',
    command,
    requestedAt: new Date('2026-09-01T00:00:00.000Z'),
    dispatchedAt: new Date('2026-09-01T00:00:00.100Z'),
    finishedAt: new Date('2026-09-01T00:00:02.500Z'),
    outcome: 'ok',
    exitCode: 0,
  }
}

describe('buildDeviceExecAuditEntry', () => {
  test('keeps a harmless command verbatim and derives the duration', () => {
    const entry = buildDeviceExecAuditEntry(input('git status'))

    expect(entry.command).toBe('git status')
    expect(entry.commandRedacted).toBe(false)
    expect(entry.durationMs).toBe(2500)
  })

  test('redacts secrets in the command before it is stored', () => {
    const entry = buildDeviceExecAuditEntry(
      input(
        'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://x && export API_KEY=supersecretvalue && gh auth login --token ghp_abcdefghijklmnopqrstuvwxyz0123',
      ),
    )

    expect(entry.commandRedacted).toBe(true)
    expect(entry.command).not.toContain('abcdefghijklmnop1234')
    expect(entry.command).not.toContain('supersecretvalue')
    expect(entry.command).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123')
    expect(entry.command).toContain('[REDACTED:')
  })

  test('caps a very long command', () => {
    const entry = buildDeviceExecAuditEntry(input(`echo ${'a '.repeat(5000)}`))

    expect(entry.command.length).toBeLessThanOrEqual(4001)
    expect(entry.command.endsWith('…')).toBe(true)
  })
})

describe('audit cursor', () => {
  test('round-trips time and id so entries sharing a millisecond are not skipped', () => {
    const requestedAt = new Date('2026-09-01T00:00:00.000Z')
    const id = new ObjectId('65f000000000000000000002')
    const cursor = encodeAuditCursor({ requestedAt, _id: id })

    expect(cursor).toBe('2026-09-01T00:00:00.000Z_65f000000000000000000002')
    const decoded = decodeAuditCursor(cursor ?? '')

    expect(decoded?.requestedAt.getTime()).toBe(requestedAt.getTime())
    expect(decoded?.id.equals(id)).toBe(true)
    expect(auditCursorFilter({ requestedAt, id })).toEqual({
      $or: [{ requestedAt: { $lt: requestedAt } }, { requestedAt, _id: { $lt: id } }],
    })
  })

  test('ignores a malformed cursor', () => {
    expect(decodeAuditCursor('2026-09-01T00:00:00.000Z')).toBeNull()
    expect(decodeAuditCursor('nope_65f000000000000000000002')).toBeNull()
    expect(decodeAuditCursor('2026-09-01T00:00:00.000Z_zz')).toBeNull()
  })
})

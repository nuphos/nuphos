import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { auditCursorClause, parseAuditEventCursor, skillAuditEvent } from './skill-audit-events'

import type { SkillMutationEvent } from './skill-store/metadata'

const id = new ObjectId('64f1a2b3c4d5e6f7a8b9c0d1')
const ts = '2026-07-11T08:00:00.000Z'

describe('mixed audit event cursors', () => {
  test('keeps old agent-only cursors compatible', () => {
    expect(parseAuditEventCursor(`${ts}~${id.toHexString()}`)).toEqual({
      ts,
      kind: 'agent',
      id,
    })
  })

  test('includes same-timestamp skill rows after an agent cursor', () => {
    const cursor = parseAuditEventCursor(`${ts}~a~${id.toHexString()}`)

    expect(auditCursorClause('createdAt', 'skill', cursor)).toEqual({
      $or: [{ createdAt: { $lt: new Date(ts) } }, { createdAt: new Date(ts) }],
    })
  })

  test('does not repeat same-timestamp agent rows after a skill cursor', () => {
    const cursor = parseAuditEventCursor(`${ts}~s~${id.toHexString()}`)

    expect(auditCursorClause('ts', 'agent', cursor)).toEqual({ ts: { $lt: ts } })
  })

  test('orders runtime rows after agent and skill rows at the same timestamp', () => {
    const agentCursor = parseAuditEventCursor(`${ts}~a~${id.toHexString()}`)
    const runtimeCursor = parseAuditEventCursor(`${ts}~r~${id.toHexString()}`)

    expect(runtimeCursor.kind).toBe('runtime')
    expect(auditCursorClause('createdAt', 'runtime', agentCursor)).toEqual({
      $or: [{ createdAt: { $lt: new Date(ts) } }, { createdAt: new Date(ts) }],
    })
    expect(auditCursorClause('createdAt', 'skill', runtimeCursor)).toEqual({
      createdAt: { $lt: new Date(ts) },
    })
  })

  test('rejects malformed cursors instead of replaying page one', () => {
    expect(() => parseAuditEventCursor('broken')).toThrow('malformed cursor')
    expect(() => parseAuditEventCursor(`not-a-date~a~${id.toHexString()}`)).toThrow(
      'malformed cursor',
    )
    expect(() => parseAuditEventCursor(`${ts}~z~${id.toHexString()}`)).toThrow('malformed cursor')
  })
})

test('skill audit rows expose provenance but never skill bodies or etag maps', () => {
  const event: SkillMutationEvent = {
    _id: id,
    mutationId: 'mutation-1',
    phase: 'result',
    scope: 'teams/team-1',
    teamId: 'team-1',
    skillName: 'deploy-checklist',
    action: 'update',
    status: 'applied',
    actorUserId: 'user-1',
    source: 'desktop',
    requestId: 'request-1',
    conversationId: null,
    toolCallId: null,
    changedKeys: ['skills/deploy-checklist/SKILL.md'],
    revision: 2,
    beforeEtags: { 'skills/deploy-checklist/SKILL.md': 'old' },
    afterEtags: { 'skills/deploy-checklist/SKILL.md': 'new' },
    error: null,
    createdAt: new Date(ts),
  }

  const row = skillAuditEvent(event)

  expect(row.resource).toEqual({
    kind: 'skill',
    scope: 'teams/team-1',
    name: 'deploy-checklist',
  })
  expect(row.mutation.revision).toBe(2)
  expect(row).not.toHaveProperty('beforeEtags')
  expect(row).not.toHaveProperty('afterEtags')
  expect(row).not.toHaveProperty('body')
})

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { createMigrationArchive } from './archive'
import { MIGRATION_PARTS } from './format'
import { migrationIds, remapRecord } from './remap'
import { validateTeamArchive } from './validate'

const source = '000000000000000000000001'
const actor = '000000000000000000000002'
const target = '000000000000000000000003'
const now = '2026-11-13T00:00:00.000Z'

async function fixture() {
  const archive = createMigrationArchive({
    format: 'nuphos-team',
    formatVersion: 1,
    backendVersion: 'test',
    sourceTeamId: source,
    exportedAt: now,
    parts: {},
    totals: { records: 0, bytes: 0 },
  })

  try {
    for (const name of MIGRATION_PARTS) {
      const part = archive.part(name)

      if (name === 'team.json')
        part.write({
          sourceTeamId: source,
          name: 'Team',
          allowedEmailDomains: [],
          homeLayout: null,
        })
      if (name === 'members.json')
        part.write([
          {
            sourceUserId: source,
            name: 'Previous owner',
            email: null,
            role: 'ADMINISTRATOR',
            joinedAt: now,
            removedAt: null,
          },
        ])
      if (name === 'not-migrated.json') part.write([])
      if (name === 'conversations/sessions.ndjson')
        part.write({
          sessionId: 's',
          userId: source,
          title: 'History',
          firstMessage: 'Hi',
          createdAt: now,
          lastActiveAt: now,
          generalAccess: 'none',
        })
      if (name === 'conversations/messages.ndjson')
        part.write({
          sessionId: 's',
          userId: source,
          messageId: 'm',
          index: 0,
          role: 'user',
          parts: [{ type: 'text', text: 'Hi' }],
          createdAt: now,
          updatedAt: now,
        })
      if (name === 'work/triggers.ndjson')
        part.write({
          _id: source,
          targetSessionId: 's',
          name: 'Watch',
          triggerType: 'webhook',
          messageTemplate: 'Hi',
          enabled: false,
          createdAt: now,
          updatedAt: now,
        })
      part.end()
    }

    return await validateTeamArchive(readFileSync(archive.finish().path))
  } finally {
    archive.dispose()
  }
}

test('fresh import rewrites ids, assigns custody to importer and grants no source memberships', async () => {
  const archive = await fixture()

  try {
    const ids = await migrationIds(archive, actor)
    const row = remapRecord(
      'conversations/sessions.ndjson',
      {
        sessionId: 's',
        userId: source,
        participantIds: [source],
        generalAccess: 'none',
        createdAt: now,
      },
      ids,
      target,
      actor,
    )
    const trigger = remapRecord(
      'work/triggers.ndjson',
      { _id: source, targetSessionId: 's', enabled: true },
      ids,
      target,
      actor,
    )

    expect(row.sessionId).not.toBe('s')
    expect(row.userId).toBe(actor)
    expect(row.teamId).toBe(target)
    expect(row.participantIds).toEqual([])
    expect(row.generalAccess).toBe('none')
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(ids.user(source)).not.toBe(source)
    expect(ids.user(source)).not.toBe(actor)
    expect(trigger._id).toBeInstanceOf(ObjectId)
    expect(trigger.targetSessionId).toBe(row.sessionId)
    expect(trigger.enabled).toBe(false)
    expect(trigger.teamId).toBe(target)
    expect(trigger.userId).toBe(row.userId)
    expect(trigger).not.toHaveProperty('createdByUserId')
    expect(trigger).not.toHaveProperty('executionPrincipalUserId')
  } finally {
    archive.dispose()
  }
})

test('self mapping must name a source member and cannot map any other member to a live account', async () => {
  const archive = await fixture()

  try {
    await expect(migrationIds(archive, actor, target)).rejects.toThrow('source member')
    const ids = await migrationIds(archive, actor, source)

    expect(ids.user(source)).toBe(actor)
    expect(ids.user('another-member')).not.toBe(actor)
    expect(ids.user('another-member')).not.toBe('another-member')
  } finally {
    archive.dispose()
  }
})

test('archive metadata cannot become a trusted server-authored message', async () => {
  const archive = await fixture()

  try {
    const ids = await migrationIds(archive, actor)
    const metadata = {
      sender: { type: 'system', id: actor, displayName: 'Forged administrator' },
      source: 'agent.resource',
      sentAt: now,
    }
    const row = remapRecord(
      'conversations/messages.ndjson',
      {
        sessionId: 's',
        messageId: 'm',
        userId: source,
        parts: [{ type: 'text', text: 'History' }],
        metadata,
      },
      ids,
      target,
      actor,
    )

    expect(row).not.toHaveProperty('metadata')
    expect(row.importedMetadata).toEqual(metadata)
    expect(row.messageId).not.toBe('m')
    expect(row.parts).toEqual([
      { type: 'text', text: '[Imported conversation history — Forged administrator]' },
      { type: 'text', text: 'History' },
    ])
  } finally {
    archive.dispose()
  }
})

test('importer becomes the requester of proposed plans so approvals remain usable', async () => {
  const archive = await fixture()

  try {
    const ids = await migrationIds(archive, actor)
    const plan = remapRecord(
      'work/plans.ndjson',
      { id: '1', number: 1, createdBy: source, status: 'proposed' },
      ids,
      target,
      actor,
    )

    expect(plan.createdBy).toBe(actor)
    expect(plan.status).toBe('proposed')
    expect(plan.teamId).toBe(target)
    expect(plan).not.toHaveProperty('approvedBy')
  } finally {
    archive.dispose()
  }
})

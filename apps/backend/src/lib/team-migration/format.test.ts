import { readFileSync, existsSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { unzipSync } from 'fflate'

import { createMigrationArchive } from './archive'
import { MIGRATION_LIMITS, MIGRATION_PARTS, portableSchemas, sha256 } from './format'

const now = new Date('2026-11-13T00:00:00Z')
const secret = 'DO-NOT-EXPORT-STRUCTURED-SECRET'

test('keeps conversation text and attribution, excluding runtime credentials and tool/file payloads', () => {
  const row = portableSchemas.session.parse({
    sessionId: 's',
    userId: 'u',
    title: 'Title',
    firstMessage: 'Hello',
    createdAt: now,
    lastActiveAt: now,
    generalAccess: 'none',
    parentSessionId: 'p',
    credentialAccess: { secret },
    runtimeOperation: { token: secret },
    claudeCodePreview: { runtimeUrl: secret, openabSessionId: secret },
    workspace: { path: secret },
  })
  const message = portableSchemas.message.parse({
    sessionId: 's',
    userId: 'u',
    messageId: 'm',
    index: 1,
    role: 'assistant',
    createdAt: now,
    updatedAt: now,
    parts: [
      { type: 'text', text: 'The answer', token: secret },
      { type: 'tool-result', result: secret },
      { type: 'file', url: secret },
      null,
    ],
    metadata: {
      version: 1,
      source: 'nuphos',
      sentAt: now,
      sender: { type: 'user', id: 'actual-sender', displayName: 'Member', secret },
      cliTokenId: secret,
    },
  })

  expect(row.parentSessionId).toBe('p')
  expect(message.metadata?.sender.id).toBe('actual-sender')
  expect(message.parts).toEqual([{ type: 'text', text: 'The answer' }])
  expect(JSON.stringify([row, message])).not.toContain(secret)
})

test('trigger keeps its owning conversation, drops execution authority and imports disabled', () => {
  const row = portableSchemas.trigger.parse({
    _id: 't',
    userId: secret,
    createdByUserId: secret,
    targetSessionId: 's',
    name: 'Watch',
    triggerType: 'webhook',
    messageTemplate: 'Check',
    enabled: true,
    webhookSecret: secret,
    providerWiring: { token: secret },
    executionPrincipalUserId: secret,
    executionCredentialAccess: { token: secret },
    createdAt: now,
    updatedAt: now,
  })

  expect(row.targetSessionId).toBe('s')
  expect(row.enabled).toBe(false)
  expect(row).not.toHaveProperty('userId')
  expect(row).not.toHaveProperty('createdByUserId')
  expect(row).not.toHaveProperty('executionPrincipalUserId')
  expect(JSON.stringify(row)).not.toContain(secret)
  expect(() => portableSchemas.trigger.parse({ ...row, targetSessionId: undefined })).toThrow()
})

test('nested panel credentials and cached results are excluded, authored source survives', () => {
  const row = portableSchemas.panel.parse({
    _id: 'p',
    dashboardId: 'd',
    title: 'Panel',
    kind: 'scalar',
    createdBy: 'u',
    createdAt: now,
    updatedAt: now,
    scriptVersion: 1,
    versions: [
      {
        version: 1,
        code: 'emit(1)',
        codeHash: 'hash',
        authoredBy: 'u',
        createdAt: now,
        token: secret,
      },
    ],
    credentialAccess: { token: secret },
    staticParams: { password: secret },
    snapshots: [secret],
  })

  expect(row.versions[0]?.code).toBe('emit(1)')
  expect(JSON.stringify(row)).not.toContain(secret)
})

test('user-authored text is preserved, not falsely claimed to be secret-free', () => {
  const row = portableSchemas.message.parse({
    sessionId: 's',
    userId: 'u',
    messageId: 'm',
    index: 1,
    role: 'user',
    createdAt: now,
    updatedAt: now,
    parts: [{ type: 'text', text: secret }],
  })

  expect(row.parts[0]?.text).toBe(secret)
})

test('ZIP agrees with manifest counts, bytes and hashes, including empty parts', () => {
  const archive = createMigrationArchive({
    format: 'nuphos-team',
    formatVersion: 1,
    backendVersion: 'test',
    sourceTeamId: 'team',
    exportedAt: now.toISOString(),
    parts: {},
    totals: { records: 0, bytes: 0 },
  })
  let path: string

  try {
    for (const name of MIGRATION_PARTS) {
      const part = archive.part(name)

      if (name === 'team.json') part.write({ name: 'Team' })
      else if (name.endsWith('.json')) part.write([])
      part.end()
    }
    path = archive.finish().path
    const entries = unzipSync(readFileSync(path))
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString())

    expect(manifest.formatVersion).toBe(1)
    expect(Object.keys(entries).sort((a, b) => a.localeCompare(b))).toEqual(
      [...MIGRATION_PARTS, 'manifest.json'].sort((a, b) => a.localeCompare(b)),
    )
    for (const name of MIGRATION_PARTS) {
      expect(manifest.parts[name].bytes).toBe(entries[name]!.byteLength)
      expect(manifest.parts[name].sha256).toBe(sha256(entries[name]!))
    }
    expect(manifest.parts['work/triggers.ndjson'].records).toBe(0)
    expect(manifest.parts['team.json'].records).toBe(1)
  } finally {
    archive.dispose()
  }
  expect(existsSync(path!)).toBe(false)
})

test('oversized record refuses the archive', () => {
  const archive = createMigrationArchive({
    format: 'nuphos-team',
    formatVersion: 1,
    backendVersion: 'test',
    sourceTeamId: 'team',
    exportedAt: now.toISOString(),
    parts: {},
    totals: { records: 0, bytes: 0 },
  })

  try {
    const part = archive.part('conversations/messages.ndjson')

    expect(() => part.write({ text: 'x'.repeat(MIGRATION_LIMITS.recordBytes) })).toThrow(
      'migration limits',
    )
  } finally {
    archive.dispose()
  }
})

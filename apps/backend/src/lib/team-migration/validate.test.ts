import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { unzipSync, zipSync } from 'fflate'

import { createMigrationArchive } from './archive'
import { MIGRATION_PARTS } from './format'
import { validateTeamArchive } from './validate'
import { inspectTeamZip } from './zip'

const now = '2026-11-13T00:00:00.000Z'
const source = '000000000000000000000001'

function archive(extra: Record<string, unknown[]> = {}) {
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
      else if (name === 'members.json' || name === 'not-migrated.json') part.write([])
      else for (const row of extra[name] ?? []) part.write(row)
      part.end()
    }

    return readFileSync(archive.finish().path)
  } finally {
    archive.dispose()
  }
}
function changeManifest(bytes: Buffer, update: (value: any) => void) {
  const entries = unzipSync(bytes),
    value = JSON.parse(Buffer.from(entries['manifest.json']!).toString())

  update(value)
  entries['manifest.json'] = Buffer.from(JSON.stringify(value))

  return Buffer.from(zipSync(entries))
}
const message = {
  sessionId: 's',
  userId: source,
  messageId: 'm',
  index: 0,
  role: 'user',
  parts: [{ type: 'text', text: 'Hi' }],
  createdAt: now,
  updatedAt: now,
}

test('accepts the actual export ZIP contract and verifies every part before returning staging', async () => {
  const result = await validateTeamArchive(archive())

  try {
    expect(result.paths.size).toBe(MIGRATION_PARTS.length)
    expect(result.manifest.formatVersion).toBe(1)
  } finally {
    result.dispose()
  }
})
test('unknown version and inconsistent totals are refused', async () => {
  await expect(
    validateTeamArchive(
      changeManifest(archive(), (value) => {
        value.formatVersion = 2
      }),
    ),
  ).rejects.toThrow()
  await expect(
    validateTeamArchive(
      changeManifest(archive(), (value) => {
        value.totals.records++
      }),
    ),
  ).rejects.toThrow('totals')
})
test('unsafe paths and undeclared entries are refused', () => {
  const entries = unzipSync(archive())

  entries['../team.json'] = entries['team.json']!
  delete entries['team.json']
  expect(() => inspectTeamZip(Buffer.from(zipSync(entries)))).toThrow('path')
})
test('links and encryption are refused from ZIP headers', () => {
  const original = archive()

  for (const [offset, value, message] of [
    [38, 0xa1ff0000, 'links'],
    [8, 1, 'encryption'],
  ] as const) {
    const bytes = Buffer.from(original),
      central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))

    if (offset === 38) bytes.writeUInt32LE(value, central + offset)
    else bytes.writeUInt16LE(value, central + offset)
    expect(() => inspectTeamZip(bytes)).toThrow(message)
  }
})
test('hash mismatch is refused even when ZIP CRC is valid', async () => {
  const entries = unzipSync(archive())

  entries['team.json'] = Buffer.from(
    Buffer.from(entries['team.json']!).toString().replace('"name":"Team"', '"name":"Tame"'),
  )
  await expect(validateTeamArchive(Buffer.from(zipSync(entries)))).rejects.toThrow('checksum')
})
test('unknown structured fields and non-text message payloads are refused instead of copied', async () => {
  await expect(
    validateTeamArchive(
      archive({
        'conversations/messages.ndjson': [{ ...message, credentialAccess: { token: 'secret' } }],
      }),
    ),
  ).rejects.toThrow('unsupported record field')
  await expect(
    validateTeamArchive(
      archive({
        'conversations/messages.ndjson': [
          { ...message, parts: [{ type: 'tool-result', result: 'secret' }] },
        ],
      }),
    ),
  ).rejects.toThrow('array')
})
test('duplicate ids and enabled trigger records are refused', async () => {
  await expect(
    validateTeamArchive(archive({ 'conversations/messages.ndjson': [message, message] })),
  ).rejects.toThrow('duplicate')
  await expect(
    validateTeamArchive(
      archive({
        'work/triggers.ndjson': [
          {
            _id: source,
            targetSessionId: 's',
            name: 'T',
            triggerType: 'webhook',
            messageTemplate: 'Hi',
            enabled: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    ),
  ).rejects.toThrow()
})

const session = {
  sessionId: 's',
  userId: source,
  title: 'Task',
  firstMessage: 'Hi',
  createdAt: now,
  lastActiveAt: now,
}

test('conversation messages round-trip, while dangling owner and parent references refuse the entire archive', async () => {
  const result = await validateTeamArchive(
    archive({
      'conversations/sessions.ndjson': [session],
      'conversations/messages.ndjson': [message],
    }),
  )

  result.dispose()
  await expect(
    validateTeamArchive(archive({ 'conversations/messages.ndjson': [message] })),
  ).rejects.toThrow('owning conversation')
  await expect(
    validateTeamArchive(
      archive({ 'conversations/sessions.ndjson': [{ ...session, parentSessionId: 'missing' }] }),
    ),
  ).rejects.toThrow('parent conversation')
})
test('a disabled trigger still needs an owning conversation', async () => {
  await expect(
    validateTeamArchive(
      archive({
        'work/triggers.ndjson': [
          {
            _id: source,
            targetSessionId: 'missing',
            name: 'T',
            triggerType: 'webhook',
            messageTemplate: 'Hi',
            enabled: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    ),
  ).rejects.toThrow('trigger owner')
})

test('team knowledge records round-trip without provider credentials or embeddings', async () => {
  const record = {
    kind: 'record',
    _id: source,
    scope: 'team',
    type: 'fact',
    text: 'Team knowledge',
    categories: [],
    source: 'save_memory',
    conversationId: null,
    createdAt: now,
    updatedAt: now,
  }
  const result = await validateTeamArchive(archive({ 'knowledge/memories.ndjson': [record] }))

  try {
    expect(result.keys.get('knowledge/memories.ndjson')?.has(`record:${source}`)).toBe(true)
  } finally {
    result.dispose()
  }
})

test('conversation parent cycles are refused before any destination write', async () => {
  await expect(
    validateTeamArchive(
      archive({
        'conversations/sessions.ndjson': [
          { ...session, parentSessionId: 's2' },
          { ...session, sessionId: 's2', parentSessionId: 's' },
        ],
      }),
    ),
  ).rejects.toThrow('parent cycle')
})

test('legacy group chats containing Tasks are refused before destination writes', async () => {
  const base = {
    userId: source,
    title: 'History',
    firstMessage: 'Hi',
    createdAt: now,
    lastActiveAt: now,
  }

  await expect(
    validateTeamArchive(
      archive({
        'conversations/sessions.ndjson': [
          { ...base, sessionId: 'task' },
          { ...base, sessionId: 'chat', kind: 'channel', agentSessionIds: ['task'] },
        ],
      }),
    ),
  ).rejects.toThrow('group chats can only reference exported Bots')
})

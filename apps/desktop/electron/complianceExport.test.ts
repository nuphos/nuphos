import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { buildComplianceExportFiles } from './complianceExport.ts'

import type { AgentComplianceExportBundle } from './agent.ts'

const execFileAsync = promisify(execFile)

function canonical(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>

  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function bundle(): AgentComplianceExportBundle {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-15T03:00:00.000Z',
    generatedByUserId: 'user-1',
    scope: 'team',
    teamId: 'team-1',
    filters: { from: '2026-07-14T03:00:00.000Z', to: null, mutationsOnly: false },
    selection: {
      semantics: 'matching-sessions-complete-chains',
      sessionCount: 1,
      agentEventCount: 1,
      resourceEventCount: 0,
    },
    users: { 'user-1': { name: 'Ada', username: 'ada', avatarURL: '' } },
    resourceEvents: [],
    sessions: [
      {
        sessionId: 'session/unsafe',
        title: 'Production access',
        ownerUserId: 'user-1',
        actors: ['user-1'],
        firstEventAt: '2026-07-15T02:00:00.000Z',
        lastEventAt: '2026-07-15T02:00:00.000Z',
        integrity: {
          chainOk: true,
          contentDivergenceCount: 0,
          eventCount: 1,
          verifiedThroughSeq: 1,
          headHash: 'c'.repeat(64),
          sealedThrough: 1,
          lastAnchorAt: '2026-07-15T02:30:00.000Z',
          level: 'anchored',
          violations: [],
        },
        events: [
          (() => {
            const payload = { access: { awsRoleIds: ['role-1'] } }
            const payloadHash = sha256(canonical(payload))
            const header = {
              v: 1 as const,
              eventId: 'event-1',
              seq: 1,
              ts: '2026-07-15T02:00:00.000Z',
              type: 'credential_grant' as const,
              actor: { userId: 'user-1', teamId: 'team-1' },
              session: {
                conversationId: 'session/unsafe',
                requestId: 'request-1',
                streamId: 'stream-1',
                toolCallId: null,
                modelId: 'model-1',
              },
              payloadHash,
              prevHash: '0'.repeat(64),
            }
            const entryHash = sha256(canonical(header))

            return {
              ...header,
              payload,
              entryHash,
            }
          })(),
        ],
      },
    ],
  }
}

test('compliance export contains readable and independently checksummed evidence', () => {
  const files = buildComplianceExportFiles(bundle())
  const names = files.map((file) => file.name)

  assert.ok(names.includes('manifest.json'))
  assert.ok(names.includes('audit-events.csv'))
  assert.ok(
    names.some((name) => /^evidence\/sessions\/session_unsafe-[a-f0-9]{10}\.json$/.test(name)),
  )
  assert.ok(names.includes('SHA256SUMS.txt'))

  const manifest = JSON.parse(files.find((file) => file.name === 'manifest.json')!.content) as {
    sessions: { sessionId: string; evidenceFile: string }[]
    files: { name: string; bytes: number; sha256: string }[]
    trustBoundary: { authentication: string; followUp: string }
  }

  assert.equal(manifest.sessions[0]?.sessionId, 'session/unsafe')
  assert.match(manifest.sessions[0]!.evidenceFile, /^evidence\/sessions\//)
  assert.deepEqual(
    new Set(manifest.files.map((file) => file.name)),
    new Set(names.filter((name) => name !== 'manifest.json' && name !== 'SHA256SUMS.txt')),
  )
  assert.equal(manifest.trustBoundary.authentication, 'unsigned-self-contained')
  assert.match(manifest.trustBoundary.followUp, /NUPS-436/)

  const csv = files.find((file) => file.name === 'audit-events.csv')!.content

  assert.match(csv, /"Ada"/)
  assert.match(csv, /awsRoleIds/)
  assert.match(csv, /"anchored"/)

  const sums = files.find((file) => file.name === 'SHA256SUMS.txt')!.content

  assert.match(sums, / {2}manifest\.json/)
  assert.doesNotMatch(sums, /SHA256SUMS\.txt/)
})

test('human-readable CSV neutralizes spreadsheet formulas', () => {
  const exportBundle = bundle()

  exportBundle.users['user-1']!.name = '=HYPERLINK("https://example.invalid")'
  const csv = buildComplianceExportFiles(exportBundle).find(
    (file) => file.name === 'audit-events.csv',
  )!.content

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/)
})

test('bundled verifier accepts intact files and rejects a modified CSV', async () => {
  const exportBundle = bundle()

  exportBundle.sessions[0]!.integrity.headHash = exportBundle.sessions[0]!.events[0]!.entryHash
  const files = buildComplianceExportFiles(exportBundle)
  const directory = await mkdtemp(path.join(tmpdir(), 'nuphos-compliance-'))

  try {
    for (const file of files) {
      const destination = path.join(directory, file.name)

      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, file.content, 'utf8')
    }
    const verified = await execFileAsync(process.execPath, ['verify.mjs'], { cwd: directory })

    assert.match(verified.stdout, /complete session chain\(s\) verified/)

    await writeFile(path.join(directory, 'audit-events.csv'), 'tampered\n', 'utf8')
    await assert.rejects(
      execFileAsync(process.execPath, ['verify.mjs'], { cwd: directory }),
      /checksum mismatch: audit-events\.csv/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bundled verifier rejects missing or unexpected inventory files', async () => {
  const exportBundle = bundle()

  exportBundle.sessions[0]!.integrity.headHash = exportBundle.sessions[0]!.events[0]!.entryHash
  const files = buildComplianceExportFiles(exportBundle)
  const directory = await mkdtemp(path.join(tmpdir(), 'nuphos-compliance-inventory-'))

  try {
    for (const file of files) {
      const destination = path.join(directory, file.name)

      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, file.content, 'utf8')
    }
    const sessionFile = files.find((file) => file.name.startsWith('evidence/sessions/'))!

    await rm(path.join(directory, sessionFile.name))
    await assert.rejects(
      execFileAsync(process.execPath, ['verify.mjs'], { cwd: directory }),
      /listed file missing|inventory file missing|expected file missing/,
    )

    await writeFile(path.join(directory, sessionFile.name), sessionFile.content, 'utf8')
    await writeFile(path.join(directory, 'unlisted.txt'), 'not evidence', 'utf8')
    await assert.rejects(
      execFileAsync(process.execPath, ['verify.mjs'], { cwd: directory }),
      /unexpected file not in manifest/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bundled verifier never reads checksum paths outside the declared inventory', async () => {
  const exportBundle = bundle()

  exportBundle.sessions[0]!.integrity.headHash = exportBundle.sessions[0]!.events[0]!.entryHash
  const files = buildComplianceExportFiles(exportBundle)
  const directory = await mkdtemp(path.join(tmpdir(), 'nuphos-compliance-paths-'))
  const outsideName = `${path.basename(directory)}-outside.txt`
  const outsidePath = path.join(path.dirname(directory), outsideName)

  try {
    for (const file of files) {
      const destination = path.join(directory, file.name)

      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, file.content, 'utf8')
    }
    await writeFile(outsidePath, 'local secret', 'utf8')
    const sumsPath = path.join(directory, 'SHA256SUMS.txt')
    const sums = files.find((file) => file.name === 'SHA256SUMS.txt')!.content

    await writeFile(sumsPath, `${sums}${sha256('attacker guess')}  ../${outsideName}\n`, 'utf8')

    let failure: unknown

    try {
      await execFileAsync(process.execPath, ['verify.mjs'], { cwd: directory })
    } catch (error) {
      failure = error
    }
    assert.ok(failure)
    const stderr = (failure as { stderr?: string }).stderr ?? ''

    assert.match(stderr, /unsafe checksum path:/)
    assert.doesNotMatch(stderr, /checksum mismatch: \.\.\//)
    assert.doesNotMatch(stderr, /listed file missing: \.\.\//)
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(outsidePath, { force: true })
  }
})

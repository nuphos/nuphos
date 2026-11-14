import { createHash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateSkillObjectKey } from '@/lib/agent/skill-store/service'

import { MIGRATION_LIMITS, MIGRATION_PARTS, sha256 } from './format'
import { importSchemas, manifestSchema } from './import-schemas'
import { boundedJsonLines } from './records'
import { checkArchiveReferences } from './references'
import { decodeTeamZipEntry, inspectTeamZip, invalidArchive } from './zip'

import type { MigrationPart } from './format'

function noUnknownFields(raw: unknown, parsed: unknown): void {
  if (Array.isArray(raw)) {
    if (!Array.isArray(parsed) || raw.length !== parsed.length)
      invalidArchive('unsupported array contents')
    raw.forEach((value, index) => {
      noUnknownFields(value, parsed[index])
    })
  } else if (raw && typeof raw === 'object') {
    if (!parsed || typeof parsed !== 'object') invalidArchive('unsupported object contents')
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(parsed, key)) invalidArchive('unsupported record field')
      noUnknownFields(value, (parsed as Record<string, unknown>)[key])
    }
  }
}

function recordKey(name: MigrationPart, row: Record<string, unknown>): string | null {
  if (name.endsWith('.json')) return null
  if (name === 'conversations/messages.ndjson')
    return `${String(row.sessionId)}:${String(row.messageId)}`
  if (name === 'knowledge/memories.ndjson') return `${String(row.kind)}:${String(row._id)}`
  if (name === 'knowledge/skill-files.ndjson') return String(row.key)
  if (name === 'knowledge/skills.ndjson') return String(row.name)

  return String(row._id ?? row.id ?? row.sessionId)
}

export async function validateTeamArchive(bytes: Buffer) {
  const entries = inspectTeamZip(bytes)
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')!

  if (manifestEntry.size > MIGRATION_LIMITS.recordBytes) invalidArchive('manifest size limit')
  const manifestRows = []

  for await (const row of boundedJsonLines(decodeTeamZipEntry(bytes, manifestEntry), false))
    manifestRows.push(row)
  const manifestResult = manifestSchema.safeParse(manifestRows[0])

  if (!manifestResult.success) invalidArchive('unsupported manifest version or shape')
  const manifest = manifestResult.data
  const sums = Object.values(manifest.parts).reduce(
    (total, part) => ({ bytes: total.bytes + part.bytes, records: total.records + part.records }),
    { bytes: 0, records: 0 },
  )

  if (sums.bytes !== manifest.totals.bytes || sums.records !== manifest.totals.records)
    invalidArchive('manifest totals disagree')
  const directory = mkdtempSync(join(tmpdir(), 'nuphos-import-'))
  const paths = new Map<MigrationPart, string>()
  const keys = new Map<MigrationPart, Set<string>>()

  try {
    for (const name of MIGRATION_PARTS) {
      const entry = entries.find((value) => value.name === name)!
      const expected = manifest.parts[name]!

      if (entry.size !== expected.bytes) invalidArchive('part length disagrees with manifest')
      const path = join(directory, String(paths.size))
      const fd = openSync(path, 'wx', 0o600)
      const hash = createHash('sha256')
      let count = 0
      const seen = new Set<string>()

      try {
        const chunks = async function* () {
          for await (const chunk of decodeTeamZipEntry(bytes, entry)) {
            hash.update(chunk)
            yield chunk
          }
        }

        for await (const raw of boundedJsonLines(chunks(), name.endsWith('.ndjson'))) {
          const result = importSchemas[name]!.safeParse(raw)

          if (!result.success) invalidArchive('unsupported record shape')
          const parsed = result.data as Record<string, unknown>

          noUnknownFields(raw, parsed)
          const key = recordKey(name, parsed)

          if (key !== null && seen.has(key)) invalidArchive('duplicate source id or name')
          if (key !== null) seen.add(key)
          if (name === 'knowledge/skill-files.ndjson') {
            validateSkillObjectKey(String(parsed.key))
            if (sha256(Buffer.from(String(parsed.text))) !== parsed.sha256)
              invalidArchive('skill content hash mismatch')
          }
          writeSync(fd, `${JSON.stringify(parsed)}\n`)
          count++
          if (count > expected.records || count > MIGRATION_LIMITS.records)
            invalidArchive('record count limit')
        }
        if (count !== expected.records || hash.digest('hex') !== expected.sha256)
          invalidArchive('part count or checksum mismatch')
      } finally {
        closeSync(fd)
      }
      keys.set(name, seen)
      paths.set(name, path)
    }
    const archive = {
      manifest,
      paths,
      keys,
      digest: sha256(bytes),
      dispose: () => {
        rmSync(directory, { recursive: true, force: true })
      },
    }

    await checkArchiveReferences(archive)

    return archive
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

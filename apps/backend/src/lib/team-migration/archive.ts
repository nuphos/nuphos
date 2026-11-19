import { createHash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Zip, ZipDeflate } from 'fflate'

import { AppError } from '@/lib/errors'

import { MIGRATION_LIMITS } from './format'

import type { MigrationManifest, MigrationPart } from './format'

// Stage the bounded archive so failures never return a successful partial ZIP.
export function createMigrationArchive(manifest: MigrationManifest) {
  const directory = mkdtempSync(join(tmpdir(), 'nuphos-migration-'))
  const path = join(directory, 'team.zip')
  const fd = openSync(path, 'wx', 0o600)
  let closed = false
  const archiveHash = createHash('sha256')
  let compressedBytes = 0
  let records = 0
  let expandedBytes = 0
  const zip = new Zip((error, bytes) => {
    if (error) throw error
    compressedBytes += bytes.byteLength
    if (compressedBytes > MIGRATION_LIMITS.compressedBytes) limit()
    archiveHash.update(bytes)
    writeSync(fd, bytes)
  })

  function limit(): never {
    throw new AppError(
      413,
      'migration_limit',
      'Team exceeds the ZIP migration limits; nothing was exported',
    )
  }

  function part(name: MigrationPart) {
    const entry = new ZipDeflate(name, { level: 1 })
    const hash = createHash('sha256')
    let count = 0
    let size = 0

    zip.add(entry)

    return {
      write(value: unknown) {
        const bytes = Buffer.from(`${JSON.stringify(value)}${name.endsWith('.ndjson') ? '\n' : ''}`)

        if (bytes.byteLength > MIGRATION_LIMITS.recordBytes) limit()
        expandedBytes += bytes.byteLength
        if (expandedBytes > MIGRATION_LIMITS.expandedBytes || ++records > MIGRATION_LIMITS.records)
          limit()
        count++
        size += bytes.byteLength
        hash.update(bytes)
        entry.push(bytes)
      },
      end() {
        entry.push(new Uint8Array(), true)
        manifest.parts[name] = { records: count, bytes: size, sha256: hash.digest('hex') }
      },
    }
  }

  return {
    part,
    finish() {
      manifest.totals = { records, bytes: expandedBytes }
      const entry = new ZipDeflate('manifest.json', { level: 1 })

      zip.add(entry)
      entry.push(Buffer.from(JSON.stringify(manifest)), true)
      zip.end()
      closeSync(fd)
      closed = true

      return { path, bytes: compressedBytes, sha256: archiveHash.digest('hex'), digest: manifest }
    },
    dispose() {
      if (!closed) {
        zip.terminate()
        closeSync(fd)
        closed = true
      }
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

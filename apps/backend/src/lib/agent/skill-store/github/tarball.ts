import { gunzipSync } from 'node:zlib'

import { AppError } from '@/lib/errors'

export const TARBALL_LIMITS = {
  compressedBytes: 25_000_000,
  expandedBytes: 100_000_000,
  entries: 20_000,
  /** Folders below the archive root; discovery searches at most five deep. */
  pathDepth: 32,
  pathLength: 4096,
}

export type RepoArchive = {
  /** Full commit SHA from the pax global header GitHub writes. */
  commitSha: string | null
  /** Regular files, keyed by path relative to the repository root. */
  files: Map<string, Uint8Array>
  /** Links and other non-regular entries, never written anywhere. */
  skipped: string[]
}

const BLOCK = 512

function invalid(reason: string): never {
  throw new AppError(422, 'invalid_archive', `Cannot read repository archive: ${reason}`)
}

function field(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length)
  const end = raw.indexOf(0)

  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8')
}

function octal(block: Buffer, start: number, length: number): number {
  if ((block[start] ?? 0) & 0x80) invalid('unsupported size encoding')
  const value = Number.parseInt(field(block, start, length).trim() || '0', 8)

  if (!Number.isSafeInteger(value) || value < 0) invalid('bad entry size')

  return value
}

function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>()
  let at = 0

  while (at < data.length) {
    const space = data.indexOf(0x20, at)
    const length = Number.parseInt(data.subarray(at, space).toString('utf8'), 10)

    if (space < 0 || !Number.isSafeInteger(length) || length <= 0) invalid('bad pax header')
    const record = data.subarray(space + 1, at + length - 1).toString('utf8')
    const eq = record.indexOf('=')

    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1))
    at += length
  }

  return records
}

/** Drops GitHub's `<repo>-<ref>/` root folder and refuses anything that leaves it. */
function repoPath(name: string): string | null {
  if (name.includes('\0') || name.includes('\\') || name.startsWith('/'))
    invalid(`unsafe path ${name}`)
  if (name.length > TARBALL_LIMITS.pathLength) invalid('path too long')
  const parts = name.split('/').filter((part) => part && part !== '.')

  if (parts.includes('..')) invalid(`unsafe path ${name}`)
  if (parts.length > TARBALL_LIMITS.pathDepth + 1) invalid('path nested too deeply')

  return parts.length > 1 ? parts.slice(1).join('/') : null
}

function header(block: Buffer, pending: Map<string, string>) {
  const prefix = field(block, 345, 155)
  const name = field(block, 0, 100)

  return {
    path: pending.get('path') ?? (prefix ? `${prefix}/${name}` : name),
    size: octal(block, 124, 12),
    type: block[156] ? String.fromCharCode(block[156]) : '0',
  }
}

/** Reads a GitHub tarball (`codeload.github.com/<o>/<r>/tar.gz/<ref>`) into memory. */
export function readRepoTarball(input: Uint8Array): RepoArchive {
  if (input.byteLength > TARBALL_LIMITS.compressedBytes) invalid('archive is too large')
  let tar: Buffer

  try {
    tar = gunzipSync(input, { maxOutputLength: TARBALL_LIMITS.expandedBytes })
  } catch {
    return invalid('not a gzip archive, or larger than the expanded size limit')
  }
  const archive: RepoArchive = { commitSha: null, files: new Map(), skipped: [] }
  let pending = new Map<string, string>()
  let entries = 0

  for (let at = 0; at + BLOCK <= tar.length;) {
    const block = tar.subarray(at, at + BLOCK)

    if (block.every((byte) => byte === 0)) break
    if (++entries > TARBALL_LIMITS.entries) invalid('too many entries')
    const entry = header(block, pending)
    const data = tar.subarray(at + BLOCK, at + BLOCK + entry.size)

    if (data.length < entry.size) invalid('truncated entry')
    at += BLOCK + Math.ceil(entry.size / BLOCK) * BLOCK
    if (entry.type === 'g') {
      archive.commitSha = paxRecords(data).get('comment') ?? archive.commitSha
      continue
    }
    if (entry.type === 'x') {
      pending = paxRecords(data)
      continue
    }
    if (entry.type === 'L') {
      pending = new Map([['path', field(data, 0, data.length)]])
      continue
    }
    pending = new Map()
    const path = repoPath(entry.path)

    if (!path || entry.type === '5') continue
    if (entry.type === '0' || entry.type === '7') archive.files.set(path, data)
    else archive.skipped.push(path)
  }

  return archive
}

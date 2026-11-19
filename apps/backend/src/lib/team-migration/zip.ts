import { Readable } from 'node:stream'
import { createInflateRaw } from 'node:zlib'

import { AppError } from '@/lib/errors'

import { MIGRATION_LIMITS, MIGRATION_PARTS } from './format'

export type ZipEntry = {
  name: string
  flags: number
  method: number
  crc: number
  size: number
  compressed: number
  offset: number
  start: number
}
const names = new Set<string>(['manifest.json', ...MIGRATION_PARTS])
const decoder = new TextDecoder('utf-8', { fatal: true })

export function invalidArchive(reason: string): never {
  throw new AppError(400, 'invalid_migration_archive', `Cannot import team ZIP: ${reason}`)
}

function endOffset(bytes: Buffer): number {
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (
      bytes.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
    )
      return at
  }

  return invalidArchive('invalid ZIP end record')
}

function localEntry(bytes: Buffer, entry: Omit<ZipEntry, 'start'>, directory: number): ZipEntry {
  const at = entry.offset

  if (at + 30 > directory || bytes.readUInt32LE(at) !== 0x04034b50)
    invalidArchive('invalid local header')
  const length = bytes.readUInt16LE(at + 26)
  const start = at + 30 + length + bytes.readUInt16LE(at + 28)

  if (start + entry.compressed > directory) invalidArchive('entry exceeds ZIP data')
  const name = decoder.decode(bytes.subarray(at + 30, at + 30 + length))

  if (
    name !== entry.name ||
    bytes.readUInt16LE(at + 6) !== entry.flags ||
    bytes.readUInt16LE(at + 8) !== entry.method
  )
    invalidArchive('ZIP headers disagree')
  if (
    !(entry.flags & 8) &&
    (bytes.readUInt32LE(at + 14) !== entry.crc ||
      bytes.readUInt32LE(at + 18) !== entry.compressed ||
      bytes.readUInt32LE(at + 22) !== entry.size)
  )
    invalidArchive('ZIP sizes disagree')

  return { ...entry, start }
}

export function inspectTeamZip(bytes: Buffer): ZipEntry[] {
  if (bytes.length > MIGRATION_LIMITS.compressedBytes || bytes.length < 22)
    invalidArchive('compressed size limit')
  const end = endOffset(bytes)
  const count = bytes.readUInt16LE(end + 10)
  const directory = bytes.readUInt32LE(end + 16)

  if (
    count !== names.size ||
    bytes.readUInt32LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    directory + bytes.readUInt32LE(end + 12) !== end
  )
    invalidArchive('invalid directory or entry count')
  const found: ZipEntry[] = []
  const seen = new Set<string>()
  let at = directory
  let expanded = 0

  for (let index = 0; index < count; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50)
      invalidArchive('invalid directory entry')
    const length = bytes.readUInt16LE(at + 28)
    const next = at + 46 + length + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)

    if (next > end) invalidArchive('truncated directory')
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + length))

    if (!names.has(name) || seen.has(name)) invalidArchive('unknown, unsafe or duplicate path')
    seen.add(name)
    const flags = bytes.readUInt16LE(at + 8),
      method = bytes.readUInt16LE(at + 10)
    const unixType = (bytes.readUInt32LE(at + 38) >>> 16) & 0xf000

    if ((flags & ~0x080e) !== 0 || ![0, 8].includes(method))
      invalidArchive('unsupported encoding or encryption')
    if (unixType !== 0 && unixType !== 0x8000)
      invalidArchive('links and special files are forbidden')
    if (bytes.readUInt16LE(at + 34) !== 0) invalidArchive('multi-volume ZIP is unsupported')
    const entry = {
      name,
      flags,
      method,
      crc: bytes.readUInt32LE(at + 16),
      size: bytes.readUInt32LE(at + 24),
      compressed: bytes.readUInt32LE(at + 20),
      offset: bytes.readUInt32LE(at + 42),
    }

    expanded += entry.size
    if (
      expanded > MIGRATION_LIMITS.expandedBytes + MIGRATION_LIMITS.recordBytes ||
      entry.size === 0xffffffff ||
      entry.compressed === 0xffffffff
    )
      invalidArchive('expanded size limit or ZIP64')
    found.push(localEntry(bytes, entry, directory))
    at = next
  }
  if (at !== end) invalidArchive('directory length mismatch')
  let expected = 0

  for (const entry of [...found].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset !== expected) invalidArchive('overlapping or undeclared ZIP data')
    expected = entry.start + entry.compressed
    if (entry.flags & 8) {
      if (expected + 12 > directory) invalidArchive('missing data descriptor')
      if (bytes.readUInt32LE(expected) === 0x08074b50) expected += 4
      if (
        expected + 12 > directory ||
        bytes.readUInt32LE(expected) !== entry.crc ||
        bytes.readUInt32LE(expected + 4) !== entry.compressed ||
        bytes.readUInt32LE(expected + 8) !== entry.size
      )
        invalidArchive('invalid data descriptor')
      expected += 12
    }
  }
  if (expected !== directory) invalidArchive('undeclared ZIP data')

  return found
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value

  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))

  return crc >>> 0
})

export async function* decodeTeamZipEntry(bytes: Buffer, entry: ZipEntry): AsyncGenerator<Buffer> {
  const compressed = bytes.subarray(entry.start, entry.start + entry.compressed)
  const source = Readable.from(
    (function* () {
      for (let at = 0; at < compressed.length; at += 64 * 1024)
        yield compressed.subarray(at, at + 64 * 1024)
    })(),
  )
  const output =
    entry.method === 0 ? source : source.pipe(createInflateRaw({ chunkSize: 64 * 1024 }))
  let size = 0,
    crc = 0xffffffff

  try {
    for await (const chunk of output) {
      const data = Buffer.from(chunk as Uint8Array)

      size += data.length
      if (size > entry.size || size > MIGRATION_LIMITS.expandedBytes)
        invalidArchive('expanded size limit')
      for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!
      yield data
    }
    if (size !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
      invalidArchive('ZIP integrity mismatch')
  } finally {
    output.destroy()
    source.destroy()
  }
}

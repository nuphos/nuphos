import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

import { findSecrets } from '@/lib/secrets/scan'

import { BUNDLE_LIMITS, botBundleSchema, bundlePath } from './manifest'

import type { BotBundle } from './manifest'

export type BotBundleArchive = {
  digest: string
  manifest: BotBundle
  files: Map<string, Uint8Array>
  expandedBytes: number
}

function invalid(reason: string): never {
  throw new Error(`Cannot import bundle: ${reason}`)
}

// Known key shapes (secretlint's preset plus the Nuphos token rule) refuse an export
// anywhere. Its keyword and entropy rules match ordinary prose, code, links and
// compressed bytes, so text instead refuses a secret keyword followed by a
// key-shaped value (20+ characters, letters and digits).
const KEYED_VALUE =
  // eslint-disable-next-line sonarjs/regex-complexity -- key names mirror the scanner's assignment rule
  /(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth)[\w-]*["']?(?:\s*[=:]\s*|\s+)["']?(?=[\w-]*[a-z])(?=[\w-]*\d)[\w-]{20,}/i

const secretBearing = () => invalid('secret-bearing content; remove credentials and export again')

/** Checks text now for keyed values and queues it for the async key-shape scan. */
type Check = (text: string, prose?: boolean) => void

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }

  return (crc ^ 0xffffffff) >>> 0
}

function endOffset(bytes: Buffer): number {
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (
      bytes.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
    )
      return at
  }

  return invalid('invalid ZIP end record')
}

type Entry = {
  name: string
  flags: number
  method: number
  crc: number
  size: number
  compressed: number
  offset: number
}

function entries(bytes: Buffer, checkSecret: Check): Entry[] {
  const end = endOffset(bytes)
  const count = bytes.readUInt16LE(end + 10)
  const directory = bytes.readUInt32LE(end + 16)
  const size = bytes.readUInt32LE(end + 12)

  if (bytes.readUInt32LE(end + 4) !== 0 || bytes.readUInt16LE(end + 8) !== count)
    invalid('multi-volume ZIP is unsupported')
  if (count === 0 || count > BUNDLE_LIMITS.entries || directory + size !== end)
    invalid('invalid ZIP directory or entry limit')
  const found: Entry[] = []
  const names = new Set<string>()
  let at = directory

  for (let index = 0; index < count; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50)
      invalid('invalid ZIP directory entry')
    const nameBytes = bytes.readUInt16LE(at + 28)
    const next = at + 46 + nameBytes + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)

    if (next > end) invalid('truncated ZIP directory entry')
    const rawName = bytes.subarray(at + 46, at + 46 + nameBytes)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName)
    const normal = name.replace(/\/$/u, '').normalize('NFC').toLowerCase()

    if (!bundlePath(name.replace(/\/$/u, '')) || names.has(normal))
      invalid('unsafe or duplicate ZIP path')
    names.add(normal)
    checkSecret(name)
    const flags = bytes.readUInt16LE(at + 8)
    const method = bytes.readUInt16LE(at + 10)
    const unixType = (bytes.readUInt32LE(at + 38) >>> 16) & 0xf000

    // Bits 1-2 only record the deflate level (zip -9 / -1); bit 3 is a data descriptor, bit 11 UTF-8.
    if ((flags & ~0x080e) !== 0 || ![0, 8].includes(method))
      invalid('unsupported ZIP encoding or encryption')
    if (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000)
      invalid('ZIP links or special files are not allowed')
    if (bytes.readUInt16LE(at + 34) !== 0) invalid('multi-volume ZIP is unsupported')
    const entry = {
      name,
      flags,
      method,
      crc: bytes.readUInt32LE(at + 16),
      size: bytes.readUInt32LE(at + 24),
      compressed: bytes.readUInt32LE(at + 20),
      offset: bytes.readUInt32LE(at + 42),
    }

    if (entry.offset >= directory || entry.size > BUNDLE_LIMITS.fileBytes)
      invalid('entry is too large or outside the ZIP data')
    if (entry.size > Math.max(1, entry.compressed) * BUNDLE_LIMITS.ratio)
      invalid('ZIP expansion ratio limit exceeded')
    if (!name.endsWith('/')) found.push(entry)
    else if (entry.size !== 0) invalid('directory contains data')
    at = next
  }
  if (at !== end) invalid('invalid ZIP directory length')

  return found
}

function decodeEntry(bytes: Buffer, entry: Entry, payloads: [number, number][]): Uint8Array {
  const at = entry.offset

  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== 0x04034b50)
    invalid('invalid ZIP local header')
  const nameLength = bytes.readUInt16LE(at + 26)
  const start = at + 30 + nameLength + bytes.readUInt16LE(at + 28)
  const localName = new TextDecoder('utf-8', { fatal: true }).decode(
    bytes.subarray(at + 30, at + 30 + nameLength),
  )

  if (
    localName !== entry.name ||
    bytes.readUInt16LE(at + 6) !== entry.flags ||
    bytes.readUInt16LE(at + 8) !== entry.method
  )
    invalid('ZIP headers disagree')
  if (start + entry.compressed > bytes.length) invalid('truncated ZIP data')
  const compressed = bytes.subarray(start, start + entry.compressed)

  payloads.push([start, start + entry.compressed])
  const output =
    entry.method === 0
      ? compressed
      : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) })

  if (output.length !== entry.size || crc32(output) !== entry.crc)
    invalid('ZIP content integrity check failed')

  return output
}

function manifestReferences(manifest: BotBundle, files: Map<string, Uint8Array>) {
  const declared = new Set(['manifest.json'])

  for (const bot of manifest.bots) {
    if (bot.avatar) declared.add(bot.avatar)
    for (const file of bot.files) declared.add(file.path)
    for (const skill of bot.skills) {
      if (!files.has(`${skill.directory}/SKILL.md`)) invalid('skill is missing SKILL.md')
      for (const name of files.keys())
        if (name.startsWith(`${skill.directory}/`)) declared.add(name)
    }
  }
  for (const name of declared) if (!files.has(name)) invalid('manifest references a missing file')
  for (const name of files.keys()) if (!declared.has(name)) invalid('ZIP contains undeclared files')
}

function checkAsset(name: string, data: Uint8Array, avatars: Set<string>, checkSecret: Check) {
  if (avatars.has(name)) {
    const png =
      data.length >= 24 && Buffer.from(data.subarray(0, 8)).toString('hex') === '89504e470d0a1a0a'

    if (!png || data.length > 512 * 1024) invalid('avatar must be a PNG of at most 512 KiB')
    const header = Buffer.from(data)
    const width = header.readUInt32BE(16)
    const height = header.readUInt32BE(20)

    if (!width || !height || width > 2048 || height > 2048)
      invalid('avatar dimensions exceed limits')
  }
  // Scan raw decoded bytes as well as parsed fields; filenames never exempt content.
  let text: string | undefined

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    // Binary content: concrete credential formats only.
  }
  checkSecret(text ?? new TextDecoder().decode(data), text !== undefined)
}

export async function readBotBundle(input: Uint8Array): Promise<BotBundleArchive> {
  const queued: string[] = []
  const checkSecret: Check = (text, prose = true) => {
    if (prose && KEYED_VALUE.test(text)) secretBearing()
    queued.push(text)
  }

  if (input.byteLength > BUNDLE_LIMITS.uploadBytes || input.byteLength < 22)
    invalid('ZIP upload limit or empty archive')
  const bytes = Buffer.from(input)

  const directory = entries(bytes, checkSecret)
  const total = directory.reduce((sum, entry) => sum + entry.size, 0)

  if (total > BUNDLE_LIMITS.expandedBytes) invalid('ZIP expanded size limit exceeded')
  const manifestEntry = directory.find((entry) => entry.name === 'manifest.json')

  if (!manifestEntry || manifestEntry.size > BUNDLE_LIMITS.manifestBytes)
    invalid('missing or oversized manifest.json')
  const payloads: [number, number][] = []
  const manifestBytes = decodeEntry(bytes, manifestEntry, payloads)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)

  checkSecret(text)
  const parsed: unknown = JSON.parse(text)
  const result = botBundleSchema.safeParse(parsed)

  if (!result.success) invalid('manifest does not match nuphos-bot-bundle version 1')
  // Walk parsed strings separately: JSON escaping must not conceal a secret from the scanner.
  const strings: string[] = []
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      if (KEYED_VALUE.test(value)) secretBearing()
      strings.push(value)
    } else if (Array.isArray(value)) value.forEach(scan)
    else if (value && typeof value === 'object') Object.values(value).forEach(scan)
  }

  scan(parsed)
  queued.push(strings.join('\n'))
  const files = new Map<string, Uint8Array>([['manifest.json', manifestBytes]])
  const avatars = new Set(result.data.bots.flatMap((bot) => (bot.avatar ? [bot.avatar] : [])))

  for (const entry of directory) {
    if (entry.name === 'manifest.json') continue
    const data = decodeEntry(bytes, entry, payloads)

    checkAsset(entry.name, data, avatars, checkSecret)
    files.set(entry.name, data)
  }
  manifestReferences(result.data, files)
  // Staging keeps the raw ZIP, so scan everything outside entry payloads too (comments,
  // extra fields, gaps). Payloads are scanned above once decoded.
  const outside: string[] = []
  let from = 0

  for (const [start, end] of payloads.toSorted((a, b) => a[0] - b[0])) {
    outside.push(new TextDecoder().decode(bytes.subarray(from, start)))
    from = Math.max(from, end)
  }
  outside.push(new TextDecoder().decode(bytes.subarray(from)))
  queued.push(outside.join('\n'))
  for (const text of queued) if ((await findSecrets(text, 'tokenShapes')).length) secretBearing()

  return {
    digest: createHash('sha256').update(bytes).digest('hex'),
    manifest: result.data,
    files,
    expandedBytes: total,
  }
}

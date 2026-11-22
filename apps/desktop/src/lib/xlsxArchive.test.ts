import assert from 'node:assert/strict'
import { test } from 'node:test'

import { unpackXlsx } from './xlsxArchive.ts'

// Small adversarial ZIP: central entries alias one local stored payload, lie
// about originalSize, and use distinct selected names. Never a GiB-sized probe.
function overlappingZip(size: number, count: number, compression = 0) {
  const names = Array.from({ length: count }, (_, i) =>
    new TextEncoder().encode(`xl/worksheets/sheet${String(i)}.xml`),
  )
  const dataOffset = 30 + names[0].length
  const centralOffset = dataOffset + size
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0)
  const bytes = new Uint8Array(centralOffset + centralSize + 22)
  const view = new DataView(bytes.buffer)
  const u16 = (at: number, value: number) => view.setUint16(at, value, true)
  const u32 = (at: number, value: number) => view.setUint32(at, value, true)

  u32(0, 0x04034b50)
  u16(8, compression)
  u32(18, size)
  u32(22, 10)
  u16(26, names[0].length)
  bytes.set(names[0], 30)
  let offset = centralOffset

  for (const name of names) {
    u32(offset, 0x02014b50)
    u16(offset + 10, compression)
    u32(offset + 20, size)
    u32(offset + 24, 10)
    u16(offset + 28, name.length)
    u32(offset + 42, 0)
    bytes.set(name, offset + 46)
    offset += 46 + name.length
  }
  u32(offset, 0x06054b50)
  u16(offset + 8, count)
  u16(offset + 10, count)
  u32(offset + 12, centralSize)
  u32(offset + 16, centralOffset)
  let payloadReads = 0

  // fflate's stored-copy path obtains this view before constructing its copy.
  // Header/name reads remain allowed, so this measures actual payload copies.
  bytes.subarray = (start, end) => {
    if (start === dataOffset && end === dataOffset + size) payloadReads++

    return Uint8Array.prototype.subarray.call(bytes, start, end)
  }

  return { bytes, reads: () => payloadReads }
}

test('lying stored originalSize is rejected before the first payload allocation', () => {
  const archive = overlappingZip(2 * 1024 * 1024 + 1, 2)

  assert.throws(() => unpackXlsx(archive.bytes), /expansion limit/)
  assert.equal(archive.reads(), 0)
})

test('overlapping stored entries count every copy toward the total allocation limit', () => {
  const archive = overlappingZip(1024 * 1024, 10)

  assert.throws(() => unpackXlsx(archive.bytes), /expansion limit/)
  assert.equal(archive.reads(), 8, 'ninth copy is rejected before allocating past 8 MiB')
})

test('unsupported compression is rejected before reading the payload', () => {
  const archive = overlappingZip(64, 1, 99)

  assert.throws(() => unpackXlsx(archive.bytes), /invalid ZIP entry/)
  assert.equal(archive.reads(), 0)
})

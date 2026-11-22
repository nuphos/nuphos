// The H.264 the Mac's screen host sends must say it never reorders frames.
// Without that, a Mac's hardware decoder (the Desktop viewer's, in Chromium)
// holds every frame back, and noVNC, waiting for each one before it asks for
// the next, shows nothing: the blank tab of #2954. Builds the host's own
// Encoder on this Mac and reads the SPS it writes for a keyframe.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const source = readFileSync(new URL('mac-screen-host.swift', import.meta.url), 'utf8')
/** The host's encoder section, as it ships. */
const encoder = source
  .slice(source.indexOf('// MARK: - Encoder'), source.indexOf('// MARK: - Input'))
  .replaceAll(/^nonisolated /gmu, '')

/** The host's Encoder, run once on a 320×200 grey frame: the keyframe's Annex B bytes. */
function encodeKeyframe() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mac-screen-host-'))
  const program = path.join(dir, 'main.swift')

  writeFileSync(
    program,
    [
      'import CoreMedia',
      'import CoreVideo',
      'import Foundation',
      'import VideoToolbox',
      'func fail(_ message: String) -> Never { fatalError(message) }',
      ...source.split('\n').filter((line) => /^func be(16|32)/u.test(line)),
      encoder,
      'var image: CVPixelBuffer?',
      'CVPixelBufferCreate(nil, 320, 200, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,',
      '                    [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &image)',
      'CVPixelBufferLockBaseAddress(image!, [])',
      'for plane in 0..<2 { memset(CVPixelBufferGetBaseAddressOfPlane(image!, plane), 128,',
      '    CVPixelBufferGetBytesPerRowOfPlane(image!, plane) * CVPixelBufferGetHeightOfPlane(image!, plane)) }',
      'CVPixelBufferUnlockBaseAddress(image!, [])',
      'let done = DispatchSemaphore(value: 0)',
      'Encoder(width: 320, height: 200).encode(image!, at: .zero, keyframe: true) { data in',
      '    print((data ?? []).map { String(format: "%02x", $0) }.joined()); done.signal()',
      '}',
      'done.wait()',
    ].join('\n'),
  )
  execFileSync('xcrun', ['swiftc', '-o', path.join(dir, 'encode'), program], { stdio: 'inherit' })

  return Buffer.from(execFileSync(path.join(dir, 'encode'), { encoding: 'utf8' }).trim(), 'hex')
}

/** The SPS fields a decoder sizes its reorder buffer from (H.264 7.3.2.1.1 and E.1.1). */
function readSps(nal) {
  const raw = []

  for (let i = 1, zeros = 0; i < nal.length; i++) {
    if (zeros >= 2 && nal[i] === 3) {
      zeros = 0
      continue
    }
    raw.push(nal[i])
    zeros = nal[i] === 0 ? zeros + 1 : 0
  }
  let at = 0
  const bits = (n) => {
    let v = 0

    for (let k = 0; k < n; k++, at++) v = v * 2 + ((raw[at >> 3] >> (7 - (at & 7))) & 1)

    return v
  }
  const golomb = () => {
    let zeros = 0

    while (bits(1) === 0) zeros++

    return 2 ** zeros - 1 + bits(zeros)
  }
  const profile = bits(8)

  bits(16)
  golomb()
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profile)) {
    if (golomb() === 3) bits(1)
    golomb()
    golomb()
    bits(1)
    assert.equal(bits(1), 0, 'no scaling matrices')
  }
  golomb()
  const order = golomb()

  if (order === 0) golomb()
  const references = golomb()

  bits(1)
  const width = (golomb() + 1) * 16
  const height = (golomb() + 1) * 16

  if (bits(1) === 0) bits(1)
  bits(1)
  if (bits(1)) for (let k = 0; k < 4; k++) golomb()
  if (!bits(1)) return { order, references, width, height }
  if (bits(1) && bits(8) === 255) bits(32)
  if (bits(1)) bits(1)
  if (bits(1)) {
    bits(4)
    if (bits(1)) bits(24)
  }
  if (bits(1)) (golomb(), golomb())
  if (bits(1)) (bits(32), bits(32), bits(1))
  assert.equal(bits(2), 0, 'no HRD parameters')
  bits(1)
  if (!bits(1)) return { order, references, width, height }
  bits(1)
  for (let k = 0; k < 4; k++) golomb()

  return { order, references, width, height, reorder: golomb(), buffering: golomb() }
}

test(
  'the screen host’s SPS says frames are never reordered',
  { skip: process.platform !== 'darwin' && 'VideoToolbox is macOS only', timeout: 120_000 },
  () => {
    const frame = encodeKeyframe()
    const units = []

    for (let i = 0; i + 4 < frame.length; i++) if (frame.readUInt32BE(i) === 1) units.push(i + 4)
    const sps = units.find((start) => (frame[start] & 0x1f) === 7)

    assert.notEqual(sps, undefined, 'a keyframe starts with its SPS')
    const fields = readSps(frame.subarray(sps, units.find((start) => start > sps) - 4))

    // Picture order count type 2 already means decode order is display order.
    if (fields.order !== 2) assert.equal(fields.reorder, 0, JSON.stringify(fields))
    assert.ok(fields.buffering === undefined || fields.buffering >= fields.references)
    // Nothing before the restriction moved: still a 320×200 picture (in 16-pixel macroblocks).
    assert.deepEqual([fields.width, fields.height], [320, 208])
  },
)

/** The host's display lookup, as it ships, run against a display that is asleep for `asleep` lookups. */
function findDisplay(asleep) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mac-screen-host-'))
  const program = path.join(dir, 'main.swift')

  writeFileSync(
    program,
    [
      'import Foundation',
      source.slice(source.indexOf('// MARK: - Display'), source.indexOf('// MARK: - Main')),
      'nonisolated(unsafe) var lookups = 0',
      'nonisolated(unsafe) var wakes = 0',
      `let found = try await awakeDisplay(wake: { wakes += 1 }, find: { lookups += 1; return lookups > ${String(asleep)} ? "display" : nil })`,
      'print("\\(found ?? "none") \\(wakes) \\(lookups)")',
    ].join('\n'),
  )
  execFileSync('xcrun', ['swiftc', '-o', path.join(dir, 'find'), program], { stdio: 'inherit' })

  return execFileSync(path.join(dir, 'find'), { encoding: 'utf8' }).trim()
}

test(
  'the screen host wakes a sleeping display and waits for it (#4518)',
  { skip: process.platform !== 'darwin' && 'the host is macOS only', timeout: 120_000 },
  () => {
    // Asleep for the first two lookups: woken once, then shown.
    assert.equal(findDisplay(2), 'display 1 3')
    // Awake: shown at once, and nothing wakes a display that is on.
    assert.equal(findDisplay(0), 'display 0 1')
    // A Mac with no display at all gives up after five seconds.
    assert.equal(findDisplay(1000), 'none 1 21')
  },
)

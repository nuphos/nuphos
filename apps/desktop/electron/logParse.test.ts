import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseTimestampedLine } from './logParse.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

test('parses a normal timestamped line into timestamp + message', () => {
  const r = parseTimestampedLine('2026-06-26T06:02:16.856Z hello world', 'p', 'c')

  assert.deepEqual(r, {
    timestamp: '2026-06-26T06:02:16.856Z',
    pod: 'p',
    container: 'c',
    message: 'hello world',
  })
})

test('timestamp-only line keeps the timestamp with an empty message', () => {
  // The k8s API can emit a bare timestamp for an empty log line; it must not
  // fall through to a null-timestamp raw line. (regression: panel B2)
  const r = parseTimestampedLine('2026-06-26T06:02:16.856Z', 'p', 'c')

  assert.equal(r.timestamp, '2026-06-26T06:02:16.856Z')
  assert.equal(r.message, '')
})

test('a line without a leading RFC3339 timestamp is treated as raw', () => {
  const r = parseTimestampedLine('plain log text with no timestamp', 'p', 'c')

  assert.equal(r.timestamp, null)
  assert.equal(r.message, 'plain log text with no timestamp')
})

test('a non-timestamp first token does not falsely parse as a timestamp', () => {
  const r = parseTimestampedLine('INFO something happened', 'p', 'c')

  assert.equal(r.timestamp, null)
  assert.equal(r.message, 'INFO something happened')
})

test('a blank line is preserved as an empty raw message', () => {
  const r = parseTimestampedLine('', 'p', 'c')

  assert.equal(r.timestamp, null)
  assert.equal(r.message, '')
})

test('preserves ANSI styling in a timestamped log message for the renderer', () => {
  const r = parseTimestampedLine(
    '2026-08-24T15:54:35Z \u001b[2m2026-08-24T15:54:34.985127Z\u001b[0m \u001b[32m INFO\u001b[0m \u001b[2mopenab\u001b[0m\u001b[2m:\u001b[0m unified:',
    'p',
    'c',
  )

  assert.equal(r.timestamp, '2026-08-24T15:54:35Z')
  assert.equal(
    r.message,
    '\u001b[2m2026-08-24T15:54:34.985127Z\u001b[0m \u001b[32m INFO\u001b[0m \u001b[2mopenab\u001b[0m\u001b[2m:\u001b[0m unified:',
  )
})

test('carries pod / container through unchanged', () => {
  const r = parseTimestampedLine('2026-01-01T00:00:00Z hi', 'my-pod', 'my-ctr')

  assert.equal(r.pod, 'my-pod')
  assert.equal(r.container, 'my-ctr')
})

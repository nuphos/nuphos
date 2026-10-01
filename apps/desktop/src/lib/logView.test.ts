import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  filterLogLines,
  formatLogTimestamp,
  logLineMatches,
  logsToCsv,
  logsToText,
  plainLogMessage,
  safeAnsiLogMessage,
} from './logView.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

type Line = { timestamp: string | null; pod: string; container: string; message: string }
function line(p: Partial<Line>): Line {
  return { timestamp: null, pod: 'pod-a', container: 'app', message: 'hello', ...p }
}

const TS = '2026-06-26T03:53:58.123456789Z'

test('formatLogTimestamp: off and null render empty', () => {
  assert.equal(formatLogTimestamp(TS, 'off'), '')
  assert.equal(formatLogTimestamp(null, 'utc'), '')
  assert.equal(formatLogTimestamp(null, 'local'), '')
})

test('formatLogTimestamp: utc is ISO 8601 with a Z (distinct from local)', () => {
  assert.equal(formatLogTimestamp(TS, 'utc'), '2026-06-26T03:53:58.123Z')
})

test('formatLogTimestamp: local is the un-padded-date / padded-clock shape', () => {
  // Don't assert exact value — it depends on the host zone. Assert the format:
  // 2026/6/26 14:02:47 — slashes, un-padded month/day, padded clock, no Z.
  const out = formatLogTimestamp(TS, 'local')

  assert.match(out, /^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}:\d{2}$/)
  assert.ok(!out.endsWith('Z'), 'local must not look like UTC')
})

test('formatLogTimestamp: unparseable timestamp is returned verbatim', () => {
  assert.equal(formatLogTimestamp('not-a-date', 'utc'), 'not-a-date')
})

test('logLineMatches: empty query matches everything', () => {
  assert.equal(logLineMatches(line({ message: 'anything' }), ''), true)
})

test('logLineMatches: case-insensitive across pod / container / message', () => {
  assert.equal(logLineMatches(line({ message: 'Connection RESET' }), 'reset'), true)
  assert.equal(logLineMatches(line({ pod: 'gateway-7f9' }), 'GATEWAY'), true)
  assert.equal(logLineMatches(line({ container: 'sidecar' }), 'sidecar'), true)
  assert.equal(logLineMatches(line({ message: 'ok' }), 'nope'), false)
})

test('logLineMatches: timestamp is searchable only in the displayed mode', () => {
  const l = line({ timestamp: TS, message: 'm' })

  // off (default): the timestamp isn't shown, so it isn't matched.
  assert.equal(logLineMatches(l, '2026-06-26'), false)
  // utc: the ISO form the user sees is matched.
  assert.equal(logLineMatches(l, '2026-06-26T03:53:58', 'utc'), true)
  // local: the local-formatted form is matched (zone-independent — search the
  // exact string formatLogTimestamp produced).
  assert.equal(logLineMatches(l, formatLogTimestamp(TS, 'local'), 'local'), true)
  // null timestamp never matches a time query.
  assert.equal(logLineMatches(line({ timestamp: null }), '2026', 'utc'), false)
})

test('filterLogLines: no-op on empty query, filters otherwise', () => {
  const lines = [line({ message: 'error here' }), line({ message: 'all good' })]

  assert.equal(filterLogLines(lines, ''), lines) // same ref — no-op
  assert.deepEqual(
    filterLogLines(lines, 'error').map((l) => l.message),
    ['error here'],
  )
})

test('plainLogMessage strips ANSI styling without changing visible text', () => {
  assert.equal(
    plainLogMessage('\u001b[2m2026-08-24T15:54:34Z\u001b[0m \u001b[32mINFO\u001b[0m'),
    '2026-08-24T15:54:34Z INFO',
  )
})

test('safeAnsiLogMessage prevents backspace and carriage-return rewrites', () => {
  const hostile = 'secret\b\b\b\b\b\bpublic before\rafter'

  assert.equal(safeAnsiLogMessage(hostile), 'secretpublic beforeafter')
  assert.equal(plainLogMessage(hostile), 'secretpublic beforeafter')
})

test('safeAnsiLogMessage exposes concealed content while preserving colors', () => {
  const hostile = '\u001b[31;8mhidden\u001b[0m \u001b[32mvisible\u001b[0m'

  assert.equal(safeAnsiLogMessage(hostile), '\u001b[31mhidden\u001b[0m \u001b[32mvisible\u001b[0m')
  assert.equal(plainLogMessage(hostile), 'hidden visible')
})

test('safeAnsiLogMessage blocks zero-padded conceal parameters', () => {
  for (const conceal of ['08', '008']) {
    const hostile = `\u001b[${conceal}mhidden\u001b[0m`

    assert.equal(safeAnsiLogMessage(hostile), 'hidden\u001b[0m')
    assert.equal(plainLogMessage(hostile), 'hidden')
  }
})

test('safeAnsiLogMessage keeps color index 8 distinct from concealment', () => {
  const colored = '\u001b[038;05;008mgray\u001b[0m'

  assert.equal(safeAnsiLogMessage(colored), colored)
})

test('logLineMatches searches visible text across ANSI style boundaries', () => {
  assert.equal(
    logLineMatches(
      line({ message: '\u001b[2mopenab\u001b[0m\u001b[2m:\u001b[0m unified' }),
      'openab:',
    ),
    true,
  )
})

test('logsToText: single-pod omits pod tag, honors timestamp mode', () => {
  const lines = [line({ timestamp: TS, message: 'm1' }), line({ timestamp: null, message: 'm2' })]

  assert.equal(logsToText(lines, { timestamps: 'off', includePod: false }), 'm1\nm2')
  assert.equal(
    logsToText(lines, { timestamps: 'utc', includePod: false }),
    '2026-06-26T03:53:58.123Z m1\nm2',
  )
})

test('logsToText: workload view prefixes [pod/container]', () => {
  const lines = [line({ timestamp: TS, pod: 'p1', container: 'c1', message: 'hi' })]

  assert.equal(logsToText(lines, { timestamps: 'off', includePod: true }), '[p1/c1] hi')
})

test('logsToText strips ANSI styling from copied and exported text', () => {
  const lines = [line({ message: '\u001b[32mINFO\u001b[0m ready' })]

  assert.equal(logsToText(lines, { timestamps: 'off', includePod: false }), 'INFO ready')
})

test('logsToCsv: keeps raw RFC3339 timestamp + escapes cells', () => {
  const lines = [line({ timestamp: TS, message: 'has "quote", and comma' })]

  assert.equal(
    logsToCsv(lines, { includePod: false }),
    `timestamp,message\n${TS},"has ""quote"", and comma"`,
  )
})

test('logsToCsv: workload view adds pod/container columns', () => {
  const lines = [line({ timestamp: TS, pod: 'p1', container: 'c1', message: 'm' })]

  assert.equal(
    logsToCsv(lines, { includePod: true }),
    `timestamp,pod,container,message\n${TS},p1,c1,m`,
  )
})

test('logsToCsv: null timestamp becomes an empty cell', () => {
  const lines = [line({ timestamp: null, message: 'm' })]

  assert.equal(logsToCsv(lines, { includePod: false }), 'timestamp,message\n,m')
})

test('logsToCsv strips ANSI styling from message cells', () => {
  const lines = [line({ timestamp: null, message: '\u001b[31mERROR\u001b[0m failed' })]

  assert.equal(logsToCsv(lines, { includePod: false }), 'timestamp,message\n,ERROR failed')
})

test('logsToCsv: neutralizes formula-injection cells', () => {
  // A message starting with = / + / - / @ is prefixed with a quote, then the
  // quote-leading cell needs RFC4180 wrapping (the leading ' is fine bare, but
  // verify the dangerous glyph can no longer lead).
  assert.equal(
    logsToCsv([line({ timestamp: null, message: '=cmd|calc' })], { includePod: false }),
    "timestamp,message\n,'=cmd|calc",
  )
  assert.equal(
    logsToCsv([line({ timestamp: null, message: '+1' })], { includePod: false }),
    "timestamp,message\n,'+1",
  )
})

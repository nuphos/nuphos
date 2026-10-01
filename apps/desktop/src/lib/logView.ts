// Pure helpers shared by the Pod and Workload log views (search /
// timestamp / export). No React, no electron — unit-tested in logView.test.ts.
//
// A log row is the backend's WorkloadLogLine: { timestamp, pod, container,
// message }. `timestamp` is the RFC3339 string the k8s API emits with
// timestamps:true (the container's collection time), or null for a line that
// carried no parseable timestamp (e.g. a multi-line continuation).

import stripAnsi from 'strip-ansi'

import type { WorkloadLogLine } from '../types'

export type TimestampMode = 'off' | 'utc' | 'local'

// Matching the terminal control bytes is the purpose of this sanitizer.
// eslint-disable-next-line no-control-regex
const ANSI_SGR_RE = /(\u001b\[|\u009b)([0-9;]*)m/g

function isSgrParameter(value: string | undefined, expected: number): boolean {
  return value !== undefined && Number.parseInt(value, 10) === expected
}

function withoutConcealParameter(prefix: string, params: string): string {
  const values = params.split(';')
  const visible: string[] = []

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]

    // In extended colors, 8 can be a perfectly valid palette index or RGB
    // channel. Keep the whole color group so only a top-level SGR 8 is treated
    // as the conceal decoration.
    const isExtendedColor =
      isSgrParameter(value, 38) || isSgrParameter(value, 48) || isSgrParameter(value, 58)

    if (isExtendedColor && isSgrParameter(values[i + 1], 5)) {
      visible.push(...values.slice(i, i + 3))
      i += 2
      continue
    }
    if (isExtendedColor && isSgrParameter(values[i + 1], 2)) {
      visible.push(...values.slice(i, i + 5))
      i += 4
      continue
    }

    if (!isSgrParameter(value, 8)) visible.push(value)
  }

  return visible.length > 0 ? `${prefix}${visible.join(';')}m` : ''
}

// Keep presentation-only terminal styling, but do not let an untrusted
// workload rewrite or conceal log content. ansi-to-react otherwise interprets
// backspace/carriage-return as terminal edits and SGR 8 as visibility:hidden.
export function safeAnsiLogMessage(message: string): string {
  return message
    .replaceAll('\b', '')
    .replaceAll('\r', '')
    .replace(ANSI_SGR_RE, (_sequence, prefix: string, params: string) =>
      withoutConcealParameter(prefix, params),
    )
}

// Logs retain ANSI styling for on-screen rendering. Everything that consumes
// plain text (search, copy, TXT, CSV) goes through this helper so invisible
// control sequences cannot break matching or leak into exported files.
export function plainLogMessage(message: string): string {
  return stripAnsi(safeAnsiLogMessage(message))
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

// Renders an RFC3339 timestamp for display. 'off' hides it; 'utc' emits ISO
// 8601 with a Z (YYYY-MM-DDTHH:mm:ss.sssZ); 'local' emits the user's zone as
// 2026/6/26 14:02:47. An unparseable timestamp is returned verbatim so we
// never silently drop information.
export function formatLogTimestamp(ts: string | null, mode: TimestampMode): string {
  if (mode === 'off' || !ts) return ''
  const d = new Date(ts)

  if (Number.isNaN(d.getTime())) return ts
  // UTC mirrors the raw wire format: ISO 8601 with a trailing Z, shaped
  // YYYY-MM-DDTHH:mm:ss.sssZ — unambiguous and machine-sortable.
  if (mode === 'utc') return d.toISOString()

  // Local uses the user's zone in a deliberately different, human shape so the
  // two modes read distinctly at a glance: 2026/6/26 14:02:47 (un-padded
  // date, padded clock).
  return (
    `${String(d.getFullYear())}/${String(d.getMonth() + 1)}/${String(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

// Case-insensitive substring match across pod, container, and message so a
// query can target a noisy pod by name as well as log text. Empty query
// matches everything (the filter is a no-op until the user types).
export function logLineMatches(
  line: WorkloadLogLine,
  query: string,
  tsMode: TimestampMode = 'off',
): boolean {
  if (!query) return true
  // Match what the user actually sees: the timestamp is searchable only in the
  // mode it's displayed in — nothing when 'off', the ISO form for 'utc', the
  // local form for 'local' — alongside pod / container / message. So searching
  // "14:02" hits the local clock the user can see, and an off timestamp isn't
  // silently matched.
  const shownTs = formatLogTimestamp(line.timestamp, tsMode)
  const hay =
    `${shownTs} ${line.pod} ${line.container} ${plainLogMessage(line.message)}`.toLowerCase()

  return hay.includes(query.toLowerCase())
}

export function filterLogLines<T extends WorkloadLogLine>(
  lines: T[],
  query: string,
  tsMode: TimestampMode = 'off',
): T[] {
  if (!query) return lines

  return lines.filter((l) => logLineMatches(l, query, tsMode))
}

type SerializeOptions = {
  // 'off' omits the timestamp column/prefix; otherwise it's rendered with the
  // given clock. Text export honors the on-screen mode; CSV always keeps the
  // raw RFC3339 value (see logsToCsv) for machine use regardless of this.
  timestamps: TimestampMode
  // Workload (multi-pod) views prefix each line with [pod/container]; a single
  // Pod view omits it since every line shares the same pod.
  includePod: boolean
}

// Plain-text export: mirrors what the user sees on screen (timestamp prefix in
// the chosen mode, optional [pod/container] tag, then the message).
export function logsToText(lines: WorkloadLogLine[], opts: SerializeOptions): string {
  return lines
    .map((l) => {
      const ts = formatLogTimestamp(l.timestamp, opts.timestamps)
      const tsPart = ts ? `${ts} ` : ''
      const podPart = opts.includePod ? `[${l.pod}/${l.container}] ` : ''

      return `${tsPart}${podPart}${plainLogMessage(l.message)}`
    })
    .join('\n')
}

// A cell leading with one of these can execute as a formula in Excel/Sheets.
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/

function csvCell(s: string): string {
  // Neutralize spreadsheet formula injection: log text is workload-controlled,
  // so prefix a single quote before normal CSV quoting when a cell leads with a
  // dangerous glyph.
  const safe = CSV_FORMULA_LEAD.test(s) ? `'${s}` : s

  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// CSV export: always carries the raw RFC3339 timestamp column (machine-sortable)
// regardless of the on-screen mode. Workload views add pod/container columns.
export function logsToCsv(
  lines: WorkloadLogLine[],
  opts: Pick<SerializeOptions, 'includePod'>,
): string {
  const header = opts.includePod ? 'timestamp,pod,container,message' : 'timestamp,message'
  const rows = lines.map((l) =>
    (opts.includePod
      ? [l.timestamp ?? '', l.pod, l.container, plainLogMessage(l.message)]
      : [l.timestamp ?? '', plainLogMessage(l.message)]
    )
      .map(csvCell)
      .join(','),
  )

  return [header, ...rows].join('\n')
}

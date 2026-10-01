// Pure parser for a single k8s log line emitted with `timestamps: true`. Kept
// free of electron / @kubernetes imports so it's unit-testable in isolation
// (logParse.test.ts). Both the one-shot snapshot (getPodLogs) and the live
// stream (startWorkloadLogStream) call this as the single parsing chokepoint,
// so the two paths can never diverge. ANSI styling stays in `message`: the
// renderer turns it into safe React spans, while search/export strip it.

export type ParsedLogLine = {
  timestamp: string | null
  pod: string
  container: string
  message: string
}

export function parseTimestampedLine(line: string, pod: string, container: string): ParsedLogLine {
  // The message group is optional so a timestamp-only line (no trailing text)
  // still parses as { timestamp, message: '' } instead of falling through to
  // the raw fallback with a null timestamp.
  const m = /^(\S+)(?:\s(.*))?$/.exec(line)

  if (m && /^\d{4}-\d{2}-\d{2}T/.test(m[1])) {
    return { timestamp: m[1], pod, container, message: m[2] || '' }
  }

  return { timestamp: null, pod, container, message: line }
}

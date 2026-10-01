// The shape of a stranded turn, and the slice of time one probe run owns.
// Kept free of any DB/observability import so the tests for it stay out of the
// suite's mocked-module graph — a test that drags Mongo in changes module load
// order for everyone else.

export const PROBE_INTERVAL_MS = 10 * 60_000

// Long tool calls are normal; a turn idle this long with an unanswered call is
// not slow, it is abandoned. Also the report-once window: each run inspects the
// turns that went quiet exactly one interval ago, so a stranded turn is
// reported by one run and no other.
export const STRANDED_AFTER_MS = 10 * 60_000

// Client-side tools are executed by the desktop app; the rest run server-side
// and are recovered by the client re-submitting the turn. Which kind stranded
// tells the two known failure shapes apart at a glance.
export const CLIENT_SIDE_TOOLS = new Set([
  'local_exec',
  'port_forward_start',
  'port_forward_stop',
  'port_forward_list',
  'upload_attachment',
])

type ToolPart = {
  type?: unknown
  toolName?: unknown
  state?: unknown
  approval?: { approved?: unknown } | null
}

/** Tool calls in a persisted assistant turn that nobody ever answered.
 *
 *  A call parked on the user's approve/deny decision is excluded: it is waiting
 *  for a human by design, which is the one case that looks identical in the
 *  transcript and must never page anyone. */
export function strandedToolCalls(parts: unknown[]): string[] {
  return parts
    .filter((part): part is ToolPart => {
      if (!part || typeof part !== 'object') return false
      const p = part as ToolPart

      if (p.type !== 'tool' || p.state !== 'input-available') return false
      if (p.approval && p.approval.approved !== true) return false

      return typeof p.toolName === 'string'
    })
    .map((p) => p.toolName as string)
}

/** True when the turn was cut off mid-work rather than stranding a follow-up
 *  call after speaking. The two shapes have had different causes. */
export function turnHasText(parts: unknown[]): boolean {
  return parts.some((p) => {
    if (!p || typeof p !== 'object') return false
    const part = p as { type?: unknown; text?: unknown }

    return part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0
  })
}

/** The slice of time this run owns, so each stranded turn is reported once. */
export function probeWindow(now: number): { from: Date; to: Date } {
  return {
    from: new Date(now - STRANDED_AFTER_MS - PROBE_INTERVAL_MS),
    to: new Date(now - STRANDED_AFTER_MS),
  }
}

export const REASONING_STEP_ID = 'reasoning'
export const PLAN_STEP_ID = 'plan'
// Tools not worth a step: setup noise the desktop panel hides too.
export const CARDLESS_TOOLS = new Set(['skill'])

export function textDelta(payload: Record<string, unknown>): string {
  for (const key of ['delta', 'text', 'content', 'textDelta']) {
    const value = payload[key]

    if (typeof value === 'string' && value.length > 0) return value
  }

  return ''
}

export function labelOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const label = (input as { label?: unknown }).label

  return typeof label === 'string' && label.trim() ? label.trim() : undefined
}

export function outputIsError(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const value = output as { error?: unknown; ok?: unknown }

  return Boolean(value.error) || value.ok === false
}

// The card is a SHARED surface (every thread participant sees it), so we never
// render raw tool inputs (commands, URLs, prompts) or raw outputs (stdout,
// response bodies) — they can carry credentials, signed URLs, or PII. Steps show
// only the model-authored label + status; the only detail we surface is a short,
// clamped error string (so failures aren't silent) and safe result counts.
export function safeStepDetail(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined
  const record = output as Record<string, unknown>

  if (typeof record.error === 'string' && record.error.trim()) return record.error
  if (Array.isArray(record.results))
    return `${String(record.results.length)} result${record.results.length === 1 ? '' : 's'}`

  return undefined
}

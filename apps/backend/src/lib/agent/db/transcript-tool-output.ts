/**
 * Tools whose result a client reads back out of a stored transcript, to draw
 * the card for a Plan or a chart.
 *
 * Every other result is only a record of what the agent saw while it worked.
 * The runtime keeps its own copy for the model, so ours served nothing but a
 * collapsed "Output" section — and file dumps and base64 screenshots made a
 * transcript megabytes that every open had to download.
 */
const STORED_OUTPUT_TOOLS = new Set([
  'plan',
  'plan_create',
  'database_change_propose',
  'render_chart',
])

function toolNameOf(part: Record<string, unknown>): string | null {
  if (typeof part.toolName === 'string') return part.toolName
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) return part.type.slice(5)

  return null
}

/** A tool keeps its state and error; only the result body is left out. */
export function withoutToolOutputs(parts: unknown[]): unknown[] {
  return parts.map((part) => {
    if (!part || typeof part !== 'object') return part
    const { output, ...rest } = part as Record<string, unknown>
    const toolName = toolNameOf(rest)

    if (output === undefined || toolName === null || STORED_OUTPUT_TOOLS.has(toolName)) return part

    return rest
  })
}

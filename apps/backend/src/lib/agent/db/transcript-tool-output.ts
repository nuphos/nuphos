/**
 * Tools whose result a client reads back out of a stored transcript, to draw
 * the card for a Plan, a chart, or a thread (its id and the agent it ran on),
 * or to tell which request a question's card asked, so its answer finds it.
 *
 * Every other result is only a record of what the agent saw while it worked.
 * The runtime keeps its own copy for the model, so ours served nothing but a
 * collapsed "Output" section — and file dumps and base64 screenshots made a
 * transcript megabytes that every open had to download.
 */
const STORED_OUTPUT_TOOLS = new Set([
  'plan',
  'plan_create',
  'request_user_decision',
  'database_change_propose',
  'render_chart',
  'create_thread',
  'send_message_to_thread',
])

// A shell's text output is the program's stdout, so only its own result object can fail it.
const SHELL_TOOLS = new Set(['bash', 'local_exec'])
const REASON_MAX = 300

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** A result as an object, from JSON text or MCP text content too. */
function resultRecord(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'string') {
    try {
      return record(JSON.parse(output))
    } catch {
      return null
    }
  }
  if (!Array.isArray(output)) return record(output)
  const text = output.find((item) => record(item)?.type === 'text') as
    { text?: unknown } | undefined

  return typeof text?.text === 'string' ? resultRecord(text.text) : null
}

function flaggedReason(value: Record<string, unknown>): string | null {
  const result = record(value.result)?.isError === true ? record(value.result) : value

  if (result?.isError !== true) return null
  const content: unknown[] = Array.isArray(result.content) ? result.content : []
  const error = resultRecord(content)?.error

  if (typeof error === 'string' && error.trim()) return error.trim()

  return content
    .flatMap((item) => {
      const text = record(item)?.type === 'text' ? record(item)?.text : undefined

      return typeof text === 'string' && text.trim() ? [text.trim()] : []
    })
    .join(' ')
}

/**
 * What a failed result keeps, so the reloaded row still reads "Failed: <reason>": its
 * `{ error }`, or the text of an MCP result flagged `isError`. Null for any other result.
 */
function storedFailure(toolName: string, output: unknown): Record<string, unknown> | null {
  const shellText = SHELL_TOOLS.has(toolName) && (!record(output) || Array.isArray(output))
  const result = shellText ? null : resultRecord(output)

  if (!result || Array.isArray(result)) return null
  const flagged = flaggedReason(result)

  if (flagged === '') return { isError: true }
  // `{ ok: true, error }` is a success carrying a note, not a failure.
  const returned = result.ok !== true && typeof result.error === 'string' ? result.error : ''
  const error = (flagged ?? returned).trim()

  return error ? { error: error.slice(0, REASON_MAX) } : null
}

function toolNameOf(part: Record<string, unknown>): string | null {
  if (typeof part.toolName === 'string') return part.toolName
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) return part.type.slice(5)

  return null
}

/** A tool keeps its state and error, and a failed result its reason; the body is left out. */
export function withoutToolOutputs(parts: unknown[]): unknown[] {
  return parts.map((part) => {
    if (!part || typeof part !== 'object') return part
    const { output, ...rest } = part as Record<string, unknown>
    const toolName = toolNameOf(rest)

    if (output === undefined || toolName === null || STORED_OUTPUT_TOOLS.has(toolName)) return part
    const failure = rest.state === 'output-available' ? storedFailure(toolName, output) : null

    return failure ? { ...rest, output: failure } : rest
  })
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/**
 * A tool's result as a record. It arrives as an object, as JSON text, or as MCP
 * text content (Claude Code reports an MCP call's content blocks as its output).
 */
export function toolResultRecord(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'string') {
    try {
      return record(JSON.parse(output))
    } catch {
      return null
    }
  }
  if (Array.isArray(output)) {
    const text = output.find((item) => record(item)?.type === 'text') as
      { text?: unknown } | undefined

    return typeof text?.text === 'string' ? toolResultRecord(text.text) : null
  }

  return record(output)
}

function contentText(content: unknown[]): string {
  return content
    .flatMap((item) => {
      const text = record(item)?.type === 'text' ? record(item)?.text : undefined

      return typeof text === 'string' && text.trim() ? [text.trim()] : []
    })
    .join(' ')
}

/**
 * Why an MCP result flagged `isError` failed: its `{ error }` JSON text or its text, `''`
 * when it has none; null when it is not flagged. Codex wraps the result as `{ result }`.
 */
export function flaggedErrorText(value: Record<string, unknown>): string | null {
  const result = record(value.result)?.isError === true ? record(value.result) : value

  if (result?.isError !== true) return null
  const content = Array.isArray(result.content) ? result.content : []
  const error = toolResultRecord(content)?.error

  return typeof error === 'string' && error.trim() ? error.trim() : contentText(content)
}

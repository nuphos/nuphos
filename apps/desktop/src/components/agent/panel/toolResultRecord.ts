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
